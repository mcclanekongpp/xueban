const cloud = require('wx-server-sdk')
const tcb = require('@cloudbase/node-sdk')
const {
  FRAMEWORKS,
  buildHealthState,
  supportive,
  text,
  unique,
  variablesFor
} = require('./evidence-health-core')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const aiApp = tcb.init({
  env: 'model-dev-d9gkoyaolb464c28d',
  timeout: 120000
})

const PROFILE_COLLECTION = 'variable_evidence_profiles'
const CANDIDATE_COLLECTION = 'model_change_candidates'

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36).toUpperCase()}_${Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()}`
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function timeValue(value) {
  const raw = value && value.$date ? value.$date : value
  const date = raw instanceof Date ? raw : new Date(raw || 0)
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

function activeStatus(record) {
  return !record || !record.status || record.status === 'active'
}

async function loadAll(collectionName, whereCondition, max = 1000) {
  const rows = []
  for (let skip = 0; skip < max; skip += 100) {
    const result = await db.collection(collectionName)
      .where(whereCondition)
      .skip(skip)
      .limit(100)
      .get()
    rows.push(...(result.data || []))
    if (!result.data || result.data.length < 100) break
  }
  return rows
}

async function loadUser(openid) {
  const result = await db.collection('users').where({ openid }).limit(2).get()
  if (result.data.length !== 1) {
    const error = new Error('当前用户不存在或存在重复')
    error.code = 'USER_NOT_FOUND'
    throw error
  }
  return result.data[0]
}

async function authorizeSubject(openid, event, controlled = false) {
  const user = await loadUser(openid)
  const subjectType = event.subject_type === 'student' ? 'student' : 'teacher'
  const framework = subjectType === 'student' ? 'student_v1.0' : 'teacher_v1.0'
  let subjectId = text(event.subject_id)
  let operatorAuthorized = false

  if (subjectType === 'teacher') {
    const isResearcher = ['researcher', 'admin'].includes(user.role)
    if (!isResearcher || !subjectId) {
      const mapResult = await db.collection('identity_map').where({
        user_id: user.user_id,
        identity_type: 'teacher'
      }).limit(2).get()
      if (mapResult.data.length !== 1) {
        const error = new Error('教师主体映射不存在或存在重复')
        error.code = 'TEACHER_SUBJECT_INVALID'
        throw error
      }
      const mappedSubjectId = text(mapResult.data[0].subject_id)
      if (subjectId && subjectId !== mappedSubjectId && !isResearcher) {
        const error = new Error('当前账号无权操作该教师主体')
        error.code = 'TEACHER_SUBJECT_FORBIDDEN'
        throw error
      }
      subjectId = subjectId || mappedSubjectId
      operatorAuthorized = mappedSubjectId === subjectId
    }
  }

  if (!subjectId) {
    const error = new Error('缺少研究主体编号')
    error.code = 'SUBJECT_ID_REQUIRED'
    throw error
  }

  const subjectResult = await db.collection('subjects').where({
    subject_id: subjectId,
    subject_type: subjectType,
    model_framework: framework,
    status: 'active'
  }).limit(2).get()
  if (subjectResult.data.length !== 1) {
    const error = new Error('研究主体不存在、失效或存在重复')
    error.code = 'SUBJECT_INVALID'
    throw error
  }
  const subject = subjectResult.data[0]

  if (subjectType === 'student') {
    const bindingResult = await db.collection('guardian_student_bindings').where({
      user_id: user.user_id,
      subject_id: subjectId,
      status: 'active'
    }).limit(2).get()
    if (bindingResult.data.length > 1) {
      const error = new Error('学生采集绑定存在重复')
      error.code = 'DUPLICATE_STUDENT_BINDINGS'
      throw error
    }
    operatorAuthorized = bindingResult.data.length === 1
  }

  const researchControlled = ['researcher', 'admin'].includes(user.role) ||
    (
      user.role === 'teacher' &&
      subject.is_test === true &&
      operatorAuthorized
    )

  if (controlled ? !researchControlled : (!operatorAuthorized && !researchControlled)) {
    const error = new Error(controlled
      ? '该操作只允许研究人员对正式主体或受控账号对 TEST 主体执行'
      : '当前账号无权访问该研究主体')
    error.code = controlled ? 'CONTROLLED_MODEL_OPERATION_FORBIDDEN' : 'SUBJECT_ACCESS_FORBIDDEN'
    throw error
  }

  return {
    user,
    subject,
    subject_id: subjectId,
    subject_type: subjectType,
    framework,
    research_controlled: researchControlled
  }
}

async function loadActiveSnapshot(auth) {
  const result = await db.collection('model_snapshots').where({
    subject_id: auth.subject_id,
    subject_type: auth.subject_type,
    framework: auth.framework,
    status: 'active'
  }).limit(20).get()
  if (result.data.length > 1) {
    const error = new Error('同一主体存在多个 active 模型，已停止自动处理')
    error.code = 'DUPLICATE_ACTIVE_MODELS'
    throw error
  }
  return result.data[0] || null
}

async function calculateHealth(auth) {
  const [evidence, analyses, profiles, activeSnapshot] = await Promise.all([
    loadAll('evidence', { subject_id: auth.subject_id, status: 'active' }),
    loadAll('evidence_analysis', { subject_id: auth.subject_id, status: 'active' }),
    loadAll(PROFILE_COLLECTION, {
      subject_id: auth.subject_id,
      framework: auth.framework
    }),
    loadActiveSnapshot(auth)
  ])

  return {
    active_snapshot: activeSnapshot,
    health: buildHealthState({
      subjectId: auth.subject_id,
      subjectType: auth.subject_type,
      framework: auth.framework,
      evidenceRows: evidence,
      analysisRows: analyses,
      existingProfiles: profiles,
      currentSnapshot: activeSnapshot,
      nowMs: Date.now()
    })
  }
}

function cleanProfile(profile) {
  const data = { ...profile }
  delete data.existing_profile_id
  delete data.existing_document_id
  return data
}

async function writeHealth(auth, calculated) {
  const now = db.serverDate()
  const profileIds = new Map()

  for (const profile of calculated.health.profiles) {
    const profileId = profile.existing_profile_id || makeId('VEP')
    const data = {
      ...cleanProfile(profile),
      subject_id: auth.subject_id,
      profile_id: profileId,
      updated_at: now
    }
    if (profile.existing_document_id) {
      await db.collection(PROFILE_COLLECTION).doc(profile.existing_document_id).update({ data })
    } else {
      await db.collection(PROFILE_COLLECTION).add({
        data: {
          ...data,
          created_at: now
        }
      })
    }
    profileIds.set(profile.variable_id, profileId)
  }

  const writtenCandidates = []
  for (const state of calculated.health.candidate_states) {
    const existing = await db.collection(CANDIDATE_COLLECTION).where({
      candidate_key: state.candidate_key
    }).limit(2).get()
    if (existing.data.length > 1) {
      const error = new Error(`变量 ${state.variable_id} 存在重复 Model Change Candidate`)
      error.code = 'DUPLICATE_MODEL_CHANGE_CANDIDATES'
      throw error
    }
    const existingCandidate = existing.data[0] || null
    const candidateId = text(existingCandidate && existingCandidate.candidate_id) || makeId('MCC')
    const resolution = existingCandidate && existingCandidate.contradiction_resolution
      ? existingCandidate.contradiction_resolution
      : null
    const preservedResolved = resolution && resolution.decision !== 'defer'
    const record = {
      ...state,
      candidate_id: candidateId,
      subject_id: auth.subject_id,
      subject_type: auth.subject_type,
      framework: auth.framework,
      profile_id: profileIds.get(state.variable_id) || state.profile_id || '',
      contradiction_status: preservedResolved ? 'resolved' : state.contradiction_status,
      contradiction_resolution: resolution,
      eligible_for_draft: preservedResolved && resolution.decision === 'retain_current'
        ? false
        : state.eligible_for_draft,
      review_status: preservedResolved && resolution.decision === 'retain_current'
        ? 'resolved_no_change'
        : state.review_status,
      updated_at: now
    }
    if (existingCandidate) {
      await db.collection(CANDIDATE_COLLECTION).doc(existingCandidate._id).update({ data: record })
    } else {
      await db.collection(CANDIDATE_COLLECTION).add({
        data: {
          ...record,
          created_at: now
        }
      })
    }
    writtenCandidates.push(record)
  }

  return {
    profile_ids: profileIds,
    candidates: writtenCandidates
  }
}

function parseJson(raw) {
  const cleaned = String(raw || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('AI_OUTPUT_JSON_NOT_FOUND')
  return JSON.parse(cleaned.slice(start, end + 1))
}

function normalizeTextArray(value, limit = 8) {
  const source = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  return unique(source).slice(0, limit)
}

function validateRevisionOutput(output, candidateIds) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    throw new Error('MODEL_REVISION_OUTPUT_INVALID')
  }
  const overview = text(output.overview_summary)
  if (!overview || [...overview].length > 100) throw new Error('MODEL_REVISION_OVERVIEW_INVALID')
  if (!Array.isArray(output.variables)) throw new Error('MODEL_REVISION_VARIABLES_INVALID')
  const expected = new Set(candidateIds)
  const actual = new Set()
  const variables = output.variables.map((item) => {
    const variableId = text(item && item.variable_id)
    if (!expected.has(variableId) || actual.has(variableId)) {
      throw new Error(`MODEL_REVISION_VARIABLE_INVALID:${variableId}`)
    }
    actual.add(variableId)
    const description = text(item.current_description)
    const contradictionStatus = text(item.contradiction_status) || 'none'
    if (!description || description.length > 2000) throw new Error(`MODEL_REVISION_DESCRIPTION_INVALID:${variableId}`)
    if (!['none', 'pending'].includes(contradictionStatus)) {
      throw new Error(`MODEL_REVISION_CONTRADICTION_INVALID:${variableId}`)
    }
    return {
      variable_id: variableId,
      current_description: description,
      contexts: normalizeTextArray(item.contexts, 8),
      uncertainty: normalizeTextArray(item.uncertainty, 8),
      contradiction_status: contradictionStatus,
      contradiction_notes: text(item.contradiction_notes).slice(0, 1000)
    }
  })
  if (actual.size !== expected.size) throw new Error('MODEL_REVISION_VARIABLES_INCOMPLETE')
  return { overview_summary: overview, variables }
}

function findModelVariable(modelData, variableId) {
  for (const dimension of (modelData && Array.isArray(modelData.dimensions) ? modelData.dimensions : [])) {
    const variable = (Array.isArray(dimension.variables) ? dimension.variables : [])
      .find((item) => text(item.variable_id) === variableId)
    if (variable) return variable
  }
  return null
}

function nextRevision(active) {
  if (Number.isInteger(active.revision_number) && active.revision_number >= 0) {
    return active.revision_number + 1
  }
  const match = text(active.model_version || active.version).match(/^1\.(\d+)$/)
  return match ? Number(match[1]) + 1 : 1
}

function revisionPrompt(auth, active, candidates, health) {
  const payload = candidates.map((candidate) => {
    const pairs = health.supportive_pairs_by_variable.get(candidate.variable_id) || []
    return {
      variable_id: candidate.variable_id,
      variable_name: candidate.variable_name,
      current_state: findModelVariable(active.model_data, candidate.variable_id),
      profile: health.profiles.find((item) => item.variable_id === candidate.variable_id),
      model_change_candidate: {
        change_type: candidate.change_type,
        contradiction_resolution: candidate.contradiction_resolution || null
      },
      supportive_evidence_analysis: pairs.map(({ evidence, analysis }) => ({
        evidence_id: evidence.evidence_id,
        source_type: evidence.source_type,
        evidence_date: evidence.created_at,
        relevance_status: analysis.relevance_status,
        evidence_sufficiency: analysis.evidence_sufficiency,
        extracted_points: analysis.extracted_points,
        context: analysis.context,
        uncertainty: analysis.uncertainty
      }))
    }
  })

  return `
你是教育研究中的主体模型版本综合器。本次只处理已经通过规则门槛的 Model Change Candidate，并生成待人工复核的模型草稿内容。

固定规则：
1. 主体类型为 ${auth.subject_type}，框架为 ${auth.framework}；不得改变固定变量框架。
2. 只能综合输入中的 Evidence Analysis，不得补充原文没有支持的特征。
3. 必须跨证据提炼“稳定出现的模式、适用情境、变化与边界”，不得拼接转写或逐条复述 extracted_points。
4. 单条新证据不能改变模型；输入候选已由系统校验至少包含 2 条新的 supportive usable 持续证据。
5. weak / insufficient 不得单独推动模型变化。
6. 若新旧描述存在无法由情境差异解释的冲突，contradiction_status 必须为 pending，并说明待人工核对点；不得擅自选边。
7. 不生成总分、排名、固定人格、心理诊断、教师/学生优劣或永久性结论。
8. uncertainty 必须保留证据范围、跨时间限制和未覆盖情境。
9. overview_summary 不超过100个汉字，并覆盖当前 ${auth.subject_type === 'teacher' ? 'T1—T5' : 'S1—S6'}，作为整个新草稿的概括。
10. 只返回 JSON，不得返回 Markdown 或额外字段。

当前 active snapshot：
${JSON.stringify({
    snapshot_id: active.snapshot_id,
    model_version: active.model_version || active.version,
    overview_summary: active.model_data && active.model_data.overview_summary
  })}

候选与完整 supportive 证据包：
${JSON.stringify(payload)}

返回结构：
{
  "overview_summary": "不超过100字",
  "variables": [
    {
      "variable_id": "",
      "current_description": "跨证据提炼后的当前描述",
      "contexts": [""],
      "uncertainty": [""],
      "contradiction_status": "none 或 pending",
      "contradiction_notes": ""
    }
  ]
}
`.trim()
}

async function refreshAction(auth, dryRun, compactResult) {
  const calculated = await calculateHealth(auth)
  let writeResult = { profile_ids: new Map(), candidates: [] }
  if (!dryRun) writeResult = await writeHealth(auth, calculated)
  const result = {
    success: true,
    action: 'refresh',
    dry_run: dryRun,
    subject_id: auth.subject_id,
    subject_type: auth.subject_type,
    framework: auth.framework,
    active_snapshot_id: text(calculated.active_snapshot && calculated.active_snapshot.snapshot_id),
    profile_count: calculated.health.profiles.length,
    open_gap_count: calculated.health.profiles.reduce((sum, item) => sum + item.evidence_gaps.length, 0),
    contradiction_pending_count: calculated.health.profiles.filter((item) => item.contradiction_status === 'pending').length,
    stagnation_pending_count: calculated.health.profiles.filter((item) => item.stagnation_status === 'pending').length,
    model_change_candidate_count: calculated.health.candidate_states.length,
    draft_eligible_candidate_count: calculated.health.candidate_states.filter((item) => item.eligible_for_draft).length,
    profiles: calculated.health.profiles.map((item) => cleanProfile(item)),
    model_change_candidates: dryRun ? calculated.health.candidate_states : writeResult.candidates,
    safety: {
      active_model_changed: false,
      snapshot_created: false,
      single_evidence_can_update_model: false,
      weak_or_insufficient_can_update_model: false
    }
  }

  // 正式持续采集只需要确认派生层已经刷新。省略完整 Profile / Candidate
  // 可以显著减少云函数响应序列化与小程序网络回包；研究 dry-run 仍默认返回全量明细。
  if (compactResult === true && dryRun !== true) {
    delete result.profiles
    delete result.model_change_candidates
  }
  return result
}

async function buildDraftAction(auth, dryRun) {
  const calculated = await calculateHealth(auth)
  const active = calculated.active_snapshot
  if (!active) {
    return { success: false, code: 'ACTIVE_MODEL_REQUIRED', message: '尚无 active 模型，不能构建持续证据版本' }
  }
  if (!dryRun) await writeHealth(auth, calculated)

  const existingDraftResult = await db.collection('model_snapshots').where({
    subject_id: auth.subject_id,
    subject_type: auth.subject_type,
    framework: auth.framework,
    snapshot_type: 'revision',
    parent_snapshot_id: active.snapshot_id,
    status: 'draft'
  }).limit(2).get()
  if (existingDraftResult.data.length > 1) {
    return { success: false, code: 'DUPLICATE_REVISION_DRAFTS', message: '当前模型存在重复 revision draft' }
  }
  if (existingDraftResult.data.length === 1) {
    const existing = existingDraftResult.data[0]
    return {
      success: true,
      action: 'build_draft',
      dry_run: dryRun,
      reused_draft: true,
      draft_created: false,
      draft_snapshot_id: existing.snapshot_id,
      model_version: existing.model_version,
      parent_snapshot_id: active.snapshot_id
    }
  }

  const freshCandidates = calculated.health.candidate_states
  const candidateRows = await loadAll(CANDIDATE_COLLECTION, {
    subject_id: auth.subject_id,
    current_snapshot_id: active.snapshot_id
  })
  const storedByKey = new Map(candidateRows.map((item) => [item.candidate_key, item]))
  const candidates = freshCandidates
    .map((item) => ({ ...item, ...(storedByKey.get(item.candidate_key) || {}) }))
    .filter((item) => item.eligible_for_draft === true && item.review_status !== 'resolved_no_change')

  if (candidates.length === 0) {
    return {
      success: true,
      action: 'build_draft',
      dry_run: dryRun,
      draft_created: false,
      no_change: true,
      code: 'NO_DRAFT_ELIGIBLE_CANDIDATES',
      message: '当前没有达到新模型草稿门槛的 Model Change Candidate'
    }
  }

  const unresolved = candidates.filter((item) => item.contradiction_status === 'pending')
  if (unresolved.length) {
    return {
      success: false,
      code: 'CONTRADICTION_REVIEW_REQUIRED',
      candidate_ids: unresolved.map((item) => item.candidate_id),
      message: '存在待解释矛盾，人工处理前不生成新模型草稿'
    }
  }

  const model = aiApp.ai().createModel('cloudbase')
  const aiResult = await model.generateText({
    model: 'hy3',
    messages: [{
      role: 'user',
      content: revisionPrompt(auth, active, candidates, calculated.health)
    }]
  })
  const output = validateRevisionOutput(
    parseJson(aiResult.text),
    candidates.map((item) => item.variable_id)
  )
  const contradictions = output.variables.filter((item) => item.contradiction_status === 'pending')
  if (contradictions.length) {
    if (!dryRun) {
      const now = db.serverDate()
      for (const contradiction of contradictions) {
        const candidate = candidates.find((item) => item.variable_id === contradiction.variable_id)
        if (candidate && candidate._id) {
          await db.collection(CANDIDATE_COLLECTION).doc(candidate._id).update({
            data: {
              contradiction_status: 'pending',
              contradiction_notes: contradiction.contradiction_notes,
              eligible_for_draft: false,
              review_status: 'blocked_by_contradiction',
              updated_at: now
            }
          })
        }
        const profile = calculated.health.profiles.find((item) => item.variable_id === contradiction.variable_id)
        const profileResult = profile
          ? await db.collection(PROFILE_COLLECTION).where({
            subject_id: auth.subject_id,
            framework: auth.framework,
            variable_id: contradiction.variable_id
          }).limit(2).get()
          : { data: [] }
        if (profileResult.data.length === 1) {
          await db.collection(PROFILE_COLLECTION).doc(profileResult.data[0]._id).update({
            data: {
              contradiction_status: 'pending',
              updated_at: now
            }
          })
        }
      }
    }
    return {
      success: false,
      code: 'CONTRADICTION_REVIEW_REQUIRED',
      contradictions,
      message: 'AI跨证据综合发现潜在矛盾，已停止生成草稿并等待人工解释'
    }
  }

  const modelData = clone(active.model_data || {})
  modelData.framework = auth.framework
  modelData.subject_id = auth.subject_id
  modelData.overview_summary = output.overview_summary
  const profileByVariable = new Map(calculated.health.profiles.map((item) => [item.variable_id, item]))
  for (const generated of output.variables) {
    const variable = findModelVariable(modelData, generated.variable_id)
    const profile = profileByVariable.get(generated.variable_id)
    const pairs = calculated.health.supportive_pairs_by_variable.get(generated.variable_id) || []
    if (!variable || !profile) throw new Error(`MODEL_VARIABLE_NOT_FOUND:${generated.variable_id}`)
    variable.current_status = profile.support_status_name
    variable.current_description = generated.current_description
    variable.current_state = generated.current_description
    variable.evidence_ids = pairs.map(({ evidence }) => evidence.evidence_id)
    variable.evidence_count = pairs.length
    variable.evidence_summary = pairs.map(({ evidence, analysis }) => ({
      evidence_id: evidence.evidence_id,
      analysis_id: analysis.analysis_id,
      relevance_status: analysis.relevance_status,
      evidence_sufficiency: analysis.evidence_sufficiency,
      extracted_points: analysis.extracted_points
    }))
    variable.contexts = generated.contexts
    variable.uncertainty = generated.uncertainty
    variable.updated_at = new Date()
  }

  const revisionNumber = nextRevision(active)
  const modelVersion = `1.${revisionNumber}`
  modelData.model_version = modelVersion
  modelData.model_type = auth.subject_type === 'student'
    ? 'student_subject_model_revision'
    : 'teacher_subject_model_revision'
  const supportivePairs = [...calculated.health.supportive_pairs_by_variable.values()].flat()
  const snapshotId = makeId('MS')
  const candidateIds = candidates.map((item) => item.candidate_id).filter(Boolean)
  const snapshot = {
    snapshot_id: snapshotId,
    subject_id: auth.subject_id,
    subject_type: auth.subject_type,
    framework: auth.framework,
    model_type: 'revision',
    snapshot_type: 'revision',
    version: modelVersion,
    model_version: modelVersion,
    revision_number: revisionNumber,
    model_label: auth.subject_type === 'teacher' ? `Teacher-T${revisionNumber}` : `Student-M${revisionNumber}`,
    parent_snapshot_id: active.snapshot_id,
    source_type: 'continuous_evidence',
    model_data: modelData,
    source_evidence_ids: unique(supportivePairs.map(({ evidence }) => evidence.evidence_id)),
    source_analysis_ids: unique(supportivePairs.map(({ analysis }) => analysis.analysis_id)),
    source_evidence_count: supportivePairs.length,
    model_change_candidate_ids: candidateIds,
    generation_method: 'ai_evidence_synthesis',
    generation_protocol: 'subject_model_revision_v1.0',
    model_provider: 'cloudbase',
    model_name: 'hy3',
    status: 'draft',
    is_test: auth.subject.is_test === true
  }

  if (dryRun) {
    return {
      success: true,
      action: 'build_draft',
      dry_run: true,
      draft_created: false,
      would_create: true,
      parent_snapshot_id: active.snapshot_id,
      model_version: modelVersion,
      candidate_ids: candidateIds,
      snapshot
    }
  }

  const now = db.serverDate()
  const addResult = await db.collection('model_snapshots').add({
    data: {
      ...snapshot,
      created_at: now,
      updated_at: now
    }
  })
  for (const candidate of candidates) {
    if (!candidate._id) continue
    await db.collection(CANDIDATE_COLLECTION).doc(candidate._id).update({
      data: {
        draft_snapshot_id: snapshotId,
        review_status: 'draft_created',
        updated_at: now
      }
    })
  }

  return {
    success: true,
    action: 'build_draft',
    dry_run: false,
    draft_created: true,
    draft_snapshot_id: snapshotId,
    database_id: addResult._id,
    parent_snapshot_id: active.snapshot_id,
    model_version: modelVersion,
    candidate_ids: candidateIds,
    usage: aiResult.usage || null,
    safety: {
      active_model_changed: false,
      human_review_required: true
    }
  }
}

async function resolveContradictionAction(auth, event) {
  const candidateId = text(event.candidate_id)
  const decision = text(event.decision)
  const note = text(event.resolution_note)
  if (!candidateId || !['retain_current', 'revise_with_new_evidence', 'defer'].includes(decision) || !note) {
    return {
      success: false,
      code: 'CONTRADICTION_RESOLUTION_INVALID',
      message: '需要 candidate_id、有效 decision 和人工说明'
    }
  }
  const result = await db.collection(CANDIDATE_COLLECTION).where({
    candidate_id: candidateId,
    subject_id: auth.subject_id,
    framework: auth.framework
  }).limit(2).get()
  if (result.data.length !== 1) {
    return { success: false, code: 'MODEL_CHANGE_CANDIDATE_INVALID', message: '候选不存在或存在重复' }
  }
  const candidate = result.data[0]
  const resolved = decision !== 'defer'
  const eligible = decision === 'revise_with_new_evidence' && candidate.new_supportive_usable_count >= 2
  const resolution = {
    decision,
    note: note.slice(0, 2000),
    resolved_by_user_id: auth.user.user_id,
    resolved_at: new Date()
  }
  const now = db.serverDate()
  await db.collection(CANDIDATE_COLLECTION).doc(candidate._id).update({
    data: {
      contradiction_status: resolved ? 'resolved' : 'pending',
      contradiction_resolution: resolution,
      eligible_for_draft: eligible,
      change_type: decision === 'retain_current' ? 'no_change' : candidate.change_type,
      review_status: decision === 'retain_current'
        ? 'resolved_no_change'
        : decision === 'defer'
          ? 'deferred'
          : 'pending_review',
      updated_at: now
    }
  })
  if (candidate.profile_id) {
    const profiles = await db.collection(PROFILE_COLLECTION).where({
      profile_id: candidate.profile_id,
      subject_id: auth.subject_id
    }).limit(2).get()
    if (profiles.data.length === 1) {
      await db.collection(PROFILE_COLLECTION).doc(profiles.data[0]._id).update({
        data: {
          contradiction_status: resolved ? 'resolved' : 'pending',
          contradiction_resolution: resolution,
          updated_at: now
        }
      })
    }
  }
  return {
    success: true,
    action: 'resolve_contradiction',
    candidate_id: candidateId,
    decision,
    contradiction_status: resolved ? 'resolved' : 'pending',
    eligible_for_draft: eligible
  }
}

async function approveDraftAction(auth, event) {
  const snapshotId = text(event.snapshot_id)
  if (!snapshotId) return { success: false, code: 'SNAPSHOT_ID_REQUIRED', message: '缺少 revision draft 编号' }
  const draftResult = await db.collection('model_snapshots').where({
    snapshot_id: snapshotId,
    subject_id: auth.subject_id,
    subject_type: auth.subject_type,
    framework: auth.framework,
    snapshot_type: 'revision'
  }).limit(2).get()
  if (draftResult.data.length !== 1) {
    return { success: false, code: 'REVISION_DRAFT_INVALID', message: 'revision draft 不存在或存在重复' }
  }
  const draft = draftResult.data[0]
  if (draft.status === 'active') {
    return { success: true, action: 'approve_draft', already_approved: true, snapshot_id: snapshotId }
  }
  if (draft.status !== 'draft') {
    return { success: false, code: 'SNAPSHOT_NOT_DRAFT', message: '模型快照不是 draft 状态' }
  }
  const active = await loadActiveSnapshot(auth)
  if (!active || active.snapshot_id !== draft.parent_snapshot_id) {
    return {
      success: false,
      code: 'REVISION_PARENT_NOT_CURRENT',
      message: 'draft 的父版本已不是当前 active 模型，必须重新生成候选'
    }
  }
  const candidates = await loadAll(CANDIDATE_COLLECTION, {
    subject_id: auth.subject_id,
    draft_snapshot_id: snapshotId
  })
  if (candidates.some((item) => item.contradiction_status === 'pending')) {
    return {
      success: false,
      code: 'CONTRADICTION_REVIEW_REQUIRED',
      message: '仍有待解释矛盾，不能批准新模型版本'
    }
  }
  const subjectResult = await db.collection('subjects').where({
    subject_id: auth.subject_id,
    subject_type: auth.subject_type
  }).limit(2).get()
  if (subjectResult.data.length !== 1) {
    return { success: false, code: 'SUBJECT_INVALID', message: '研究主体不存在或存在重复' }
  }
  const subject = subjectResult.data[0]
  const now = db.serverDate()
  await db.runTransaction(async (transaction) => {
    await transaction.collection('model_snapshots').doc(active._id).update({
      data: {
        status: 'superseded',
        superseded_at: now,
        superseded_by_snapshot_id: draft.snapshot_id,
        updated_at: now
      }
    })
    await transaction.collection('model_snapshots').doc(draft._id).update({
      data: {
        status: 'active',
        approved_at: now,
        approved_by_user_id: auth.user.user_id,
        updated_at: now
      }
    })
    await transaction.collection('subjects').doc(subject._id).update({
      data: {
        current_version: draft.model_version,
        current_snapshot_id: draft.snapshot_id,
        updated_at: now
      }
    })
  })
  for (const candidate of candidates) {
    await db.collection(CANDIDATE_COLLECTION).doc(candidate._id).update({
      data: {
        review_status: 'applied',
        applied_snapshot_id: draft.snapshot_id,
        reviewed_by_user_id: auth.user.user_id,
        reviewed_at: now,
        updated_at: now
      }
    })
  }
  return {
    success: true,
    action: 'approve_draft',
    already_approved: false,
    approved: true,
    previous_snapshot_id: active.snapshot_id,
    snapshot_id: draft.snapshot_id,
    model_version: draft.model_version
  }
}

async function statusAction(auth) {
  const [profiles, candidates, drafts, active] = await Promise.all([
    loadAll(PROFILE_COLLECTION, { subject_id: auth.subject_id, framework: auth.framework }),
    loadAll(CANDIDATE_COLLECTION, { subject_id: auth.subject_id, framework: auth.framework }),
    loadAll('model_snapshots', {
      subject_id: auth.subject_id,
      framework: auth.framework,
      snapshot_type: 'revision',
      status: 'draft'
    }),
    loadActiveSnapshot(auth)
  ])
  return {
    success: true,
    action: 'status',
    subject_id: auth.subject_id,
    subject_type: auth.subject_type,
    framework: auth.framework,
    active_snapshot_id: text(active && active.snapshot_id),
    profile_count: profiles.length,
    open_gap_count: profiles.reduce((sum, item) => sum + (Array.isArray(item.evidence_gaps) ? item.evidence_gaps.length : 0), 0),
    pending_candidate_count: candidates.filter((item) => ['pending_review', 'draft_created', 'blocked_by_contradiction'].includes(item.review_status)).length,
    draft_snapshot_ids: drafts.map((item) => item.snapshot_id)
  }
}

exports.main = async (event = {}) => {
  const startedAt = Date.now()
  const openid = cloud.getWXContext().OPENID
  const action = text(event.action) || 'refresh'
  const controlled = ['build_draft', 'approve_draft', 'resolve_contradiction'].includes(action)

  if (!openid) return { success: false, code: 'NO_OPENID', message: '未获取到微信用户标识' }
  if (!['refresh', 'status', 'build_draft', 'approve_draft', 'resolve_contradiction'].includes(action)) {
    return { success: false, code: 'ACTION_NOT_SUPPORTED', message: '不支持的模型演化操作' }
  }

  try {
    const auth = await authorizeSubject(openid, event, controlled)
    let result
    if (action === 'refresh') {
      result = await refreshAction(
        auth,
        event.dry_run === true,
        event.compact_result === true
      )
    }
    if (action === 'status') result = await statusAction(auth)
    if (action === 'build_draft') result = await buildDraftAction(auth, event.dry_run === true)
    if (action === 'approve_draft') result = await approveDraftAction(auth, event)
    if (action === 'resolve_contradiction') result = await resolveContradictionAction(auth, event)
    return {
      ...result,
      processing_ms: Date.now() - startedAt
    }
  } catch (error) {
    console.error('advanceSubjectModel error:', error)
    return {
      success: false,
      code: error.code || 'ADVANCE_SUBJECT_MODEL_ERROR',
      message: error.message || '主体模型演化处理失败',
      processing_ms: Date.now() - startedAt
    }
  }
}

// Exported only for local static/rule tests. Cloud calls still use exports.main.
exports.__test__ = {
  activeStatus,
  nextRevision,
  validateRevisionOutput,
  variablesFor
}
