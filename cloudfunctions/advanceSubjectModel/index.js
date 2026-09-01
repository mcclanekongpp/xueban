const cloud = require('wx-server-sdk')
const tcb = require('@cloudbase/node-sdk')
const {
  AUTO_UPDATE_RULE_VERSION,
  FRAMEWORKS,
  buildHealthState,
  supportive,
  text,
  unique,
  variablesFor
} = require('./evidence-health-core')
const {
  deterministicId,
  mergeRevisionSources,
  nextRevision,
  validateSnapshotFramework
} = require('./revision-core')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const { authorizeStudentOperator } = require('./student-operator-auth')
const aiApp = tcb.init({
  env: 'model-dev-d9gkoyaolb464c28d',
  timeout: 120000
})

const PROFILE_COLLECTION = 'variable_evidence_profiles'
const CANDIDATE_COLLECTION = 'model_change_candidates'
const AUTOMATIC_ACTOR_ID = 'system:auto_subject_model_update'

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
  let operatorType = subjectType === 'teacher' ? 'teacher' : ''
  let operatorTeacherSubjectId = subjectType === 'teacher' ? subjectId : ''

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
      operatorTeacherSubjectId = subjectId
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
    const authorization = await authorizeStudentOperator({
      db,
      openid,
      subjectId,
      allowResearcher: true
    })
    if (!authorization.authorized) {
      const error = new Error(authorization.message)
      error.code = authorization.code
      throw error
    }
    operatorAuthorized = true
    operatorType = authorization.operator_type
    operatorTeacherSubjectId = authorization.operator_teacher_subject_id || ''
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
    operator_type: operatorType,
    operator_teacher_subject_id: operatorTeacherSubjectId,
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
    const attemptedEvidenceIds = unique(
      existingCandidate && Array.isArray(existingCandidate.auto_update_attempted_evidence_ids)
        ? existingCandidate.auto_update_attempted_evidence_ids
        : []
    )
    const currentEvidenceIds = unique(Array.isArray(state.supporting_evidence_ids) ? state.supporting_evidence_ids : [])
    const sameEvidenceAsDeferredAttempt = (
      text(existingCandidate && existingCandidate.review_status) === 'awaiting_additional_evidence' &&
      attemptedEvidenceIds.length === currentEvidenceIds.length &&
      attemptedEvidenceIds.every((id) => currentEvidenceIds.includes(id))
    )
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
      auto_update_eligible: preservedResolved && resolution.decision === 'retain_current'
        ? false
        : state.auto_update_eligible && !sameEvidenceAsDeferredAttempt,
      auto_update_blockers: sameEvidenceAsDeferredAttempt
        ? unique([...(state.auto_update_blockers || []), 'waiting_for_additional_evidence_after_contradiction'])
        : state.auto_update_blockers,
      auto_update_attempted_evidence_ids: attemptedEvidenceIds,
      auto_update_last_attempted_count: Number(existingCandidate && existingCandidate.auto_update_last_attempted_count) || 0,
      auto_update_contradiction_notes: text(existingCandidate && existingCandidate.auto_update_contradiction_notes),
      review_status: preservedResolved && resolution.decision === 'retain_current'
        ? 'resolved_no_change'
        : sameEvidenceAsDeferredAttempt
          ? 'awaiting_additional_evidence'
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

function revisionPrompt(auth, active, candidates, health, automatic = false) {
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
你是教育研究中的主体模型版本综合器。本次只处理已经通过规则门槛的 Model Change Candidate，并生成${automatic ? '可由规则引擎自动激活' : '受控'}的新版本草稿内容。

固定规则：
1. 主体类型为 ${auth.subject_type}，框架为 ${auth.framework}；不得改变固定变量框架。
2. 只能综合输入中的 Evidence Analysis，不得补充原文没有支持的特征。
3. 必须跨证据提炼“稳定出现的模式、适用情境、变化与边界”，不得拼接转写或逐条复述 extracted_points。
4. 单条新证据不能改变模型；输入候选已由系统校验至少包含 2 条新的 supportive usable 持续证据，且来自至少 2 个独立原始记录，并满足跨日、跨情境或跨来源至少一项覆盖。
5. weak / insufficient 不得单独推动模型变化。
6. 若新旧描述存在表面差异，应优先在 current_description 与 uncertainty 中保留不同情境下的变化和边界；只有无法由情境、时间或证据范围解释的逻辑冲突，contradiction_status 才能为 pending。pending 会阻断自动更新并等待后续证据，不得擅自选边。
7. 不生成总分、排名、固定人格、心理诊断、教师/学生优劣或永久性结论。
8. uncertainty 必须保留证据范围、跨时间限制和未覆盖情境。
9. overview_summary 不超过100个汉字，并覆盖当前 ${auth.subject_type === 'teacher' ? 'T1—T5' : 'S1—S6'}，作为整个新草稿的概括。
10. 只返回 JSON，不得返回 Markdown 或额外字段。

当前 active snapshot：
${JSON.stringify({
    snapshot_id: active.snapshot_id,
    model_version: active.model_version || active.version,
    overview_summary: active.model_data && active.model_data.overview_summary,
    dimensions: active.model_data && Array.isArray(active.model_data.dimensions)
      ? active.model_data.dimensions.map((dimension) => ({
        dimension_id: dimension.dimension_id,
        dimension_name: dimension.dimension_name,
        variables: (Array.isArray(dimension.variables) ? dimension.variables : []).map((variable) => ({
          variable_id: variable.variable_id,
          variable_name: variable.variable_name,
          current_status: variable.current_status,
          current_description: variable.current_description || variable.current_state,
          contexts: variable.contexts,
          uncertainty: variable.uncertainty
        }))
      }))
      : []
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
  const automaticUpdate = dryRun
    ? {
      status: 'dry_run',
      auto_update_eligible_candidate_count: calculated.health.candidate_states
        .filter((item) => item.auto_update_eligible === true).length,
      active_model_changed: false
    }
    : await automaticUpdateAfterRefresh(auth, calculated)
  const result = {
    success: true,
    action: 'refresh',
    dry_run: dryRun,
    subject_id: auth.subject_id,
    subject_type: auth.subject_type,
    framework: auth.framework,
    active_snapshot_id: text(calculated.active_snapshot && calculated.active_snapshot.snapshot_id),
    current_active_snapshot_id: text(automaticUpdate.active_snapshot_id) ||
      text(calculated.active_snapshot && calculated.active_snapshot.snapshot_id),
    profile_count: calculated.health.profiles.length,
    open_gap_count: calculated.health.profiles.reduce((sum, item) => sum + item.evidence_gaps.length, 0),
    contradiction_pending_count: calculated.health.profiles.filter((item) => item.contradiction_status === 'pending').length,
    stagnation_pending_count: calculated.health.profiles.filter((item) => item.stagnation_status === 'pending').length,
    model_change_candidate_count: calculated.health.candidate_states.length,
    draft_eligible_candidate_count: calculated.health.candidate_states.filter((item) => item.eligible_for_draft).length,
    auto_update_eligible_candidate_count: calculated.health.candidate_states
      .filter((item) => item.auto_update_eligible === true).length,
    automatic_update: automaticUpdate,
    profiles: calculated.health.profiles.map((item) => cleanProfile(item)),
    model_change_candidates: dryRun ? calculated.health.candidate_states : writeResult.candidates,
    safety: {
      active_model_changed: automaticUpdate.active_model_changed === true,
      snapshot_created: automaticUpdate.snapshot_created === true,
      single_evidence_can_update_model: false,
      weak_or_insufficient_can_update_model: false,
      history_snapshot_overwritten: false
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

async function buildDraftAction(auth, dryRun, options = {}) {
  const automatic = options.automatic === true
  const calculated = options.calculated || await calculateHealth(auth)
  const active = calculated.active_snapshot
  if (!active) {
    return { success: false, code: 'ACTIVE_MODEL_REQUIRED', message: '尚无 active 模型，不能构建持续证据版本' }
  }
  if (!dryRun && options.health_written !== true) await writeHealth(auth, calculated)

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
    if (automatic && text(existing.auto_update_rule_version) !== AUTO_UPDATE_RULE_VERSION) {
      return {
        success: false,
        action: 'build_draft',
        code: 'LEGACY_REVISION_DRAFT_BLOCKS_AUTO_UPDATE',
        message: '当前 active 模型下存在旧版人工草稿，自动更新不会静默批准该草稿',
        draft_snapshot_id: existing.snapshot_id
      }
    }
    return {
      success: true,
      action: 'build_draft',
      dry_run: dryRun,
      reused_draft: true,
      draft_created: false,
      draft_snapshot_id: existing.snapshot_id,
      model_version: existing.model_version,
      parent_snapshot_id: active.snapshot_id,
      automatic
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
    .filter((item) => (
      (automatic ? item.auto_update_eligible : item.eligible_for_draft) === true &&
      item.review_status !== 'resolved_no_change'
    ))

  if (candidates.length === 0) {
    return {
      success: true,
      action: 'build_draft',
      dry_run: dryRun,
      draft_created: false,
      no_change: true,
      code: 'NO_DRAFT_ELIGIBLE_CANDIDATES',
      message: automatic
        ? '当前没有同时满足证据数量、独立记录、覆盖度与无矛盾门槛的自动更新候选'
        : '当前没有达到新模型草稿门槛的 Model Change Candidate'
    }
  }

  const unresolved = candidates.filter((item) => item.contradiction_status === 'pending')
  if (unresolved.length) {
    return {
      success: false,
      code: automatic ? 'AUTO_UPDATE_BLOCKED_BY_CONTRADICTION' : 'CONTRADICTION_REVIEW_REQUIRED',
      candidate_ids: unresolved.map((item) => item.candidate_id),
      message: automatic
        ? '存在待解释矛盾，系统将保留证据并等待后续采集，不自动改变当前模型'
        : '存在待解释矛盾，人工处理前不生成新模型草稿'
    }
  }

  const model = aiApp.ai().createModel('cloudbase')
  const aiResult = await model.generateText({
    model: 'hy3',
    messages: [{
      role: 'user',
      content: revisionPrompt(auth, active, candidates, calculated.health, automatic)
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
              contradiction_status: automatic ? 'auto_deferred' : 'pending',
              contradiction_notes: contradiction.contradiction_notes,
              eligible_for_draft: false,
              auto_update_eligible: false,
              auto_update_attempted_evidence_ids: automatic
                ? candidate.supporting_evidence_ids
                : candidate.auto_update_attempted_evidence_ids || [],
              auto_update_last_attempted_count: automatic
                ? Number(candidate.new_supportive_usable_count || 0)
                : Number(candidate.auto_update_last_attempted_count || 0),
              auto_update_contradiction_notes: automatic
                ? contradiction.contradiction_notes
                : text(candidate.auto_update_contradiction_notes),
              review_status: automatic ? 'awaiting_additional_evidence' : 'blocked_by_contradiction',
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
              contradiction_status: automatic ? 'auto_deferred' : 'pending',
              auto_update_contradiction_notes: automatic
                ? contradiction.contradiction_notes
                : '',
              updated_at: now
            }
          })
        }
      }
    }
    return {
      success: false,
      code: automatic ? 'AUTO_UPDATE_BLOCKED_BY_CONTRADICTION' : 'CONTRADICTION_REVIEW_REQUIRED',
      contradictions,
      message: automatic
        ? '跨证据综合发现潜在矛盾，已保留证据并停止自动更新，等待后续证据'
        : 'AI跨证据综合发现潜在矛盾，已停止生成草稿并等待人工解释'
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
  const candidateIds = candidates.map((item) => item.candidate_id).filter(Boolean)
  const { sourceEvidenceIds, sourceAnalysisIds } = mergeRevisionSources(
    active,
    candidates,
    calculated.health.supportive_pairs_by_variable
  )
  const automaticKey = `${auth.subject_id}|${active.snapshot_id}|${candidateIds.slice().sort().join('|')}|${sourceEvidenceIds.slice().sort().join('|')}`
  const snapshotId = automatic ? deterministicId('MS_AUTO', automaticKey) : makeId('MS')
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
    source_evidence_ids: sourceEvidenceIds,
    source_analysis_ids: sourceAnalysisIds,
    source_evidence_count: sourceEvidenceIds.length,
    model_change_candidate_ids: candidateIds,
    generation_method: 'ai_evidence_synthesis',
    generation_protocol: automatic ? 'subject_model_auto_revision_v1.0' : 'subject_model_revision_v1.0',
    model_provider: 'cloudbase',
    model_name: 'hy3',
    status: 'draft',
    is_test: auth.subject.is_test === true,
    activation_mode: automatic ? 'automatic_rule' : 'controlled_review',
    auto_update_rule_version: automatic ? AUTO_UPDATE_RULE_VERSION : '',
    auto_update_key: automatic ? automaticKey : '',
    triggered_by_user_id: automatic ? auth.user.user_id : '',
    operator_user_id: auth.user.user_id,
    operator_type: auth.operator_type || auth.subject_type,
    operator_teacher_subject_id: auth.operator_teacher_subject_id || ''
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
      automatic,
      snapshot
    }
  }

  const now = db.serverDate()
  let addResult
  let reusedConcurrentDraft = false
  try {
    addResult = await db.collection('model_snapshots').add({
      data: {
        ...(automatic ? { _id: snapshotId } : {}),
        ...snapshot,
        created_at: now,
        updated_at: now
      }
    })
  } catch (error) {
    const concurrent = automatic
      ? await db.collection('model_snapshots').where({
        snapshot_id: snapshotId,
        subject_id: auth.subject_id,
        parent_snapshot_id: active.snapshot_id
      }).limit(2).get()
      : { data: [] }
    if (concurrent.data.length !== 1) throw error
    addResult = { _id: concurrent.data[0]._id }
    reusedConcurrentDraft = true
  }
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
    draft_created: !reusedConcurrentDraft,
    reused_draft: reusedConcurrentDraft,
    reused_concurrent_draft: reusedConcurrentDraft,
    draft_snapshot_id: snapshotId,
    database_id: addResult._id,
    parent_snapshot_id: active.snapshot_id,
    model_version: modelVersion,
    candidate_ids: candidateIds,
    automatic,
    usage: aiResult.usage || null,
    safety: {
      active_model_changed: false,
      human_review_required: !automatic,
      automatic_activation_allowed: automatic
    }
  }
}

async function automaticUpdateAfterRefresh(auth, calculated) {
  if (!calculated.active_snapshot) {
    return {
      status: 'waiting_for_initial_active_model',
      active_model_changed: false,
      snapshot_created: false,
      rule_version: AUTO_UPDATE_RULE_VERSION
    }
  }

  try {
    const buildResult = await buildDraftAction(auth, false, {
      automatic: true,
      calculated,
      health_written: true
    })

    if (!buildResult.success) {
      return {
        status: buildResult.code === 'AUTO_UPDATE_BLOCKED_BY_CONTRADICTION'
          ? 'blocked_by_contradiction'
          : 'failed',
        code: buildResult.code,
        message: buildResult.message,
        active_model_changed: false,
        snapshot_created: false,
        rule_version: AUTO_UPDATE_RULE_VERSION
      }
    }
    if (!buildResult.draft_snapshot_id) {
      return {
        status: 'waiting_for_rule_threshold',
        code: buildResult.code || 'NO_AUTO_UPDATE_ELIGIBLE_CANDIDATES',
        active_model_changed: false,
        snapshot_created: false,
        rule_version: AUTO_UPDATE_RULE_VERSION
      }
    }

    const activation = await activateRevisionSnapshot(
      auth,
      buildResult.draft_snapshot_id,
      true
    )
    if (!activation.success) {
      return {
        status: activation.code === 'AUTO_UPDATE_BLOCKED_BY_CONTRADICTION'
          ? 'blocked_by_contradiction'
          : 'failed',
        code: activation.code,
        message: activation.message,
        draft_snapshot_id: buildResult.draft_snapshot_id,
        active_model_changed: false,
        snapshot_created: buildResult.draft_created === true,
        rule_version: AUTO_UPDATE_RULE_VERSION
      }
    }

    return {
      status: 'updated',
      active_model_changed: activation.already_active !== true,
      snapshot_created: buildResult.draft_created === true,
      previous_snapshot_id: activation.previous_snapshot_id || '',
      active_snapshot_id: activation.snapshot_id,
      model_version: activation.model_version,
      rule_version: AUTO_UPDATE_RULE_VERSION
    }
  } catch (error) {
    console.error('automatic subject model update error:', error)
    return {
      status: 'failed',
      code: error.code || 'AUTOMATIC_MODEL_UPDATE_ERROR',
      message: error.message || '自动模型更新失败，已保留现有模型和全部证据',
      active_model_changed: false,
      snapshot_created: false,
      rule_version: AUTO_UPDATE_RULE_VERSION
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

async function markCandidatesApplied(candidates, draft, auth, automatic, now) {
  for (const candidate of candidates) {
    await db.collection(CANDIDATE_COLLECTION).doc(candidate._id).update({
      data: {
        review_status: 'applied',
        applied_snapshot_id: draft.snapshot_id,
        application_mode: automatic ? 'automatic_rule' : 'controlled_review',
        ...(automatic
          ? {
            auto_applied_at: now,
            auto_applied_by: AUTOMATIC_ACTOR_ID,
            auto_update_eligible: false
          }
          : {
            reviewed_by_user_id: auth.user.user_id,
            reviewed_at: now
          }),
        updated_at: now
      }
    })
  }
}

async function activateRevisionSnapshot(auth, snapshotId, automatic = false) {
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
  if (automatic && text(draft.auto_update_rule_version) !== AUTO_UPDATE_RULE_VERSION) {
    return {
      success: false,
      code: 'AUTO_UPDATE_DRAFT_RULE_MISMATCH',
      message: '该草稿不是由当前自动更新规则生成，系统不会自动激活'
    }
  }
  const candidates = await loadAll(CANDIDATE_COLLECTION, {
    subject_id: auth.subject_id,
    draft_snapshot_id: snapshotId
  })
  if (draft.status === 'active') {
    await markCandidatesApplied(candidates, draft, auth, automatic, db.serverDate())
    return {
      success: true,
      action: automatic ? 'auto_activate' : 'approve_draft',
      already_approved: true,
      already_active: true,
      snapshot_id: snapshotId,
      model_version: draft.model_version
    }
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
  if (candidates.some((item) => item.contradiction_status === 'pending')) {
    return {
      success: false,
      code: automatic ? 'AUTO_UPDATE_BLOCKED_BY_CONTRADICTION' : 'CONTRADICTION_REVIEW_REQUIRED',
      message: automatic
        ? '仍有待解释矛盾，系统保留当前 active 模型并等待后续证据'
        : '仍有待解释矛盾，不能批准新模型版本'
    }
  }
  validateSnapshotFramework(draft, variablesFor(auth.framework))
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
        activated_at: now,
        activation_mode: automatic ? 'automatic_rule' : 'controlled_review',
        ...(automatic
          ? {
            auto_activated_at: now,
            auto_activated_by: AUTOMATIC_ACTOR_ID,
            auto_update_rule_version: AUTO_UPDATE_RULE_VERSION,
            triggered_by_user_id: text(draft.triggered_by_user_id) || auth.user.user_id
          }
          : {
            approved_at: now,
            approved_by_user_id: auth.user.user_id
          }),
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
  await markCandidatesApplied(candidates, draft, auth, automatic, now)
  return {
    success: true,
    action: automatic ? 'auto_activate' : 'approve_draft',
    already_approved: false,
    approved: !automatic,
    auto_activated: automatic,
    previous_snapshot_id: active.snapshot_id,
    snapshot_id: draft.snapshot_id,
    model_version: draft.model_version,
    auto_update_rule_version: automatic ? AUTO_UPDATE_RULE_VERSION : ''
  }
}

async function approveDraftAction(auth, event) {
  const snapshotId = text(event.snapshot_id)
  if (!snapshotId) return { success: false, code: 'SNAPSHOT_ID_REQUIRED', message: '缺少 revision draft 编号' }
  return activateRevisionSnapshot(auth, snapshotId, false)
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
    pending_candidate_count: candidates.filter((item) => (
      ['pending_review', 'draft_created', 'blocked_by_contradiction', 'awaiting_additional_evidence']
        .includes(item.review_status)
    )).length,
    auto_update_rule_version: AUTO_UPDATE_RULE_VERSION,
    auto_update_eligible_candidate_count: candidates.filter((item) => item.auto_update_eligible === true).length,
    auto_update_waiting_for_more_evidence_count: candidates.filter((item) => (
      text(item.review_status) === 'awaiting_additional_evidence'
    )).length,
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
  deterministicId,
  nextRevision,
  validateSnapshotFramework,
  validateRevisionOutput,
  variablesFor
}
