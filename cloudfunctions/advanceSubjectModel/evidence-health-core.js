const FRAMEWORKS = {
  'teacher_v1.0': {
    subject_type: 'teacher',
    dimensions: [
      ['T1', '课程与学习目标取向', [
        ['T1-1', '课程与学习价值理解'],
        ['T1-2', '学习结果判断']
      ]],
      ['T2', '学生理解与诊断', [
        ['T2-1', '学生已有认识理解'],
        ['T2-2', '学习困难诊断'],
        ['T2-3', '个体差异理解']
      ]],
      ['T3', '教学策略与PCK', [
        ['T3-1', '内容表征与任务设计'],
        ['T3-2', '提问与学习支架'],
        ['T3-3', '教学策略资源']
      ]],
      ['T4', '互动与关系方式', [
        ['T4-1', '提问与反馈方式'],
        ['T4-2', '学生自主与教师介入'],
        ['T4-3', '互动组织与差异关注']
      ]],
      ['T5', '专业自我、适应与反思', [
        ['T5-1', '专业自我与教学信念'],
        ['T5-2', '适应性调整与反思']
      ]]
    ]
  },
  'student_v1.0': {
    subject_type: 'student',
    dimensions: [
      ['S1', '认知与已有经验', [
        ['S1-1', '观察与信息提取'],
        ['S1-2', '已有经验与认知解释'],
        ['S1-3', '前概念与认知关联']
      ]],
      ['S2', '思维与问题解决', [
        ['S2-1', '比较与分类'],
        ['S2-2', '预测与解释'],
        ['S2-3', '证据与问题解决']
      ]],
      ['S3', '学习与自我调节', [
        ['S3-1', '任务专注与注意调节'],
        ['S3-2', '困难应对与策略调整'],
        ['S3-3', '自我监控与不确定性感知']
      ]],
      ['S4', '表达与社会互动', [
        ['S4-1', '表达与提问'],
        ['S4-2', '倾听与回应'],
        ['S4-3', '合作与观点调节']
      ]],
      ['S5', '动机、情绪与自我效能', [
        ['S5-1', '好奇与学习投入意愿'],
        ['S5-2', '学习自信与挫折反应']
      ]],
      ['S6', '兴趣、活动经验与生活情境', [
        ['S6-1', '兴趣领域'],
        ['S6-2', '活动与生活经验'],
        ['S6-3', '家庭学习支持情境']
      ]]
    ]
  }
}

const SUPPORTIVE_RELEVANCE = new Set(['relevant', 'partially_relevant'])
const SUPPORTIVE_SUFFICIENCY = new Set(['usable', 'weak'])
const INVALID_STATUSES = new Set([
  'deleted',
  'invalid',
  'archived',
  'disabled',
  'cancelled',
  'canceled'
])

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim()
}

function list(value) {
  if (Array.isArray(value)) return value
  return value === null || value === undefined || value === '' ? [] : [value]
}

function unique(values) {
  return [...new Set(values.map(text).filter(Boolean))]
}

function hasOwn(value, key) {
  return !!value && Object.prototype.hasOwnProperty.call(value, key)
}

function active(record) {
  const status = text(record && record.status).toLowerCase()
  return !!record && (!status || !INVALID_STATUSES.has(status))
}

function dateValue(value) {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const raw = value && value.$date ? value.$date : value
  const result = new Date(raw)
  return Number.isNaN(result.getTime()) ? null : result
}

function recordTime(record) {
  return record && (
    record.created_at ||
    record.createdAt ||
    record.updated_at ||
    record.updatedAt ||
    record.analyzed_at ||
    null
  )
}

function chinaDate(value) {
  const date = dateValue(value)
  if (!date) return ''
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function contentField(record, field) {
  if (hasOwn(record, field)) return record[field]
  const nested = record && record.analysis && typeof record.analysis === 'object'
    ? record.analysis
    : null
  return hasOwn(nested, field) ? nested[field] : undefined
}

function normalizeAnalysis(record) {
  if (!record) return null
  return {
    ...record,
    relevance_status: text(contentField(record, 'relevance_status')),
    evidence_sufficiency: text(contentField(record, 'evidence_sufficiency')),
    extracted_points: list(contentField(record, 'extracted_points')).map(text).filter(Boolean),
    reasoning_basis: text(contentField(record, 'reasoning_basis')),
    context: contentField(record, 'context'),
    uncertainty: contentField(record, 'uncertainty'),
    protocol_version: text(contentField(record, 'protocol_version')),
    analysis_version: text(contentField(record, 'analysis_version'))
  }
}

function identityValues(record, field) {
  const nested = record && record.analysis && typeof record.analysis === 'object'
    ? record.analysis
    : null
  return unique([
    hasOwn(record, field) ? record[field] : '',
    hasOwn(nested, field) ? nested[field] : ''
  ])
}

function consistent(analysis, evidence, framework) {
  if (!analysis || text(analysis.evidence_id) !== text(evidence.evidence_id)) return false
  const checks = [
    ['subject_id', text(evidence.subject_id)],
    ['framework', text(evidence.framework) || framework],
    ['variable_id', text(evidence.variable_id)]
  ]
  return checks.every(([field, expected]) => {
    const values = identityValues(analysis, field)
    return values.length === 0 || values.every((value) => value === expected)
  })
}

function supportive(analysis) {
  return !!analysis &&
    SUPPORTIVE_RELEVANCE.has(analysis.relevance_status) &&
    SUPPORTIVE_SUFFICIENCY.has(analysis.evidence_sufficiency)
}

function contexts(analysis) {
  return unique(list(analysis && analysis.context))
}

function modality(evidence) {
  const direct = text(evidence && evidence.source_modality).toLowerCase()
  if (direct) return direct
  if (evidence && evidence.voice_id) return 'voice'
  if (evidence && evidence.behavior_record_id) return 'behavior'
  if (evidence && evidence.media_record_id) return 'media'
  if (evidence && evidence.message_id) return 'text'
  return 'unknown'
}

function variablesFor(framework) {
  const config = FRAMEWORKS[framework]
  if (!config) throw new Error(`UNSUPPORTED_FRAMEWORK:${framework}`)
  return config.dimensions.flatMap(([dimensionId, dimensionName, variables]) => (
    variables.map(([variableId, variableName]) => ({
      subject_type: config.subject_type,
      framework,
      dimension_id: dimensionId,
      dimension_name: dimensionName,
      variable_id: variableId,
      variable_name: variableName
    }))
  ))
}

function supportStatus(profile) {
  const count = profile.supportive_usable_count + profile.supportive_weak_count
  if (count === 0) return ['insufficient', '证据不足']
  if (
    profile.supportive_usable_count >= 4 &&
    profile.time_point_count >= 3 &&
    profile.context_count >= 2 &&
    (profile.source_type_count >= 2 || profile.effective_modality_count >= 2) &&
    profile.contradiction_status !== 'pending'
  ) return ['relatively_stable', '较稳定']
  if (
    profile.supportive_usable_count >= 2 &&
    (
      profile.time_point_count >= 2 ||
      profile.source_type_count >= 2 ||
      profile.context_count >= 2
    )
  ) return ['supported', '已有一定支持']
  return ['initial', '初步描述']
}

function buildGaps(profile, nowMs) {
  const gaps = []
  if (profile.evidence_count === 0) {
    gaps.push({ gap_type: 'no_evidence', priority: 100, reason: '尚无该变量的有效 Evidence。' })
  } else if (profile.supportive_evidence_count === 0) {
    gaps.push({ gap_type: 'insufficient_detail', priority: 95, reason: '已有记录，但尚无通过相关性与充分性门槛的 Evidence。' })
  } else {
    if (profile.supportive_usable_count === 0) {
      gaps.push({ gap_type: 'insufficient_detail', priority: 85, reason: '当前只有 supportive weak Evidence，需要更具体的经过、判断依据或结果。' })
    }
    if (profile.time_point_count < 2) {
      gaps.push({ gap_type: 'single_time_point', priority: 60, reason: 'supportive Evidence 仍集中在一个中国标准时间自然日。' })
    }
    if (profile.context_count < 2) {
      gaps.push({ gap_type: 'single_context', priority: 55, reason: 'supportive Evidence 的原始情境覆盖仍不足。' })
    }
    if (profile.source_type_count < 2 && profile.effective_modality_count < 2) {
      gaps.push({ gap_type: 'single_source', priority: 45, reason: 'supportive Evidence 尚未形成跨来源或有效多模态覆盖。' })
    }
  }

  if (profile.contradiction_status === 'pending') {
    gaps.push({ gap_type: 'contradiction_pending', priority: 110, reason: '新旧证据之间存在待人工解释的潜在矛盾。' })
  }

  const latest = dateValue(profile.latest_evidence_at)
  if (
    latest &&
    profile.supportive_evidence_count > 0 &&
    nowMs - latest.getTime() >= 60 * 24 * 60 * 60 * 1000
  ) {
    gaps.push({ gap_type: 'stale_evidence', priority: 40, reason: '最近 supportive Evidence 距今已超过 60 天。' })
  }

  return gaps.sort((a, b) => b.priority - a.priority)
}

function stagnation(profile, nowMs) {
  if (profile.evidence_count < 2) return ['not_evaluated', []]
  const reasons = []
  if (profile.supportive_evidence_count === 0) reasons.push('repeated_without_supportive_evidence')
  if (profile.supportive_weak_count >= 2 && profile.supportive_usable_count === 0) reasons.push('repeated_weak_only')
  if (
    profile.supportive_evidence_count >= 3 &&
    profile.time_point_count === 1 &&
    profile.context_count === 1
  ) reasons.push('repeated_single_context_and_time')
  const latest = dateValue(profile.latest_evidence_at)
  if (latest && nowMs - latest.getTime() >= 60 * 24 * 60 * 60 * 1000) {
    reasons.push('no_supportive_update_60_days')
  }
  return reasons.length ? ['pending', reasons] : ['none', []]
}

function modelVariable(snapshot, variableId) {
  const dimensions = snapshot && snapshot.model_data && Array.isArray(snapshot.model_data.dimensions)
    ? snapshot.model_data.dimensions
    : []
  for (const dimension of dimensions) {
    const found = (Array.isArray(dimension.variables) ? dimension.variables : [])
      .find((item) => text(item.variable_id) === variableId)
    if (found) return found
  }
  return null
}

function isContinuous(evidence) {
  const source = text(evidence && evidence.source_type)
  return text(evidence && evidence.collection_phase) === 'continuous' ||
    ['teaching_reflection', 'student_observation', 'free_dialogue', 'student_continuous_record']
      .includes(source)
}

function buildHealthState({
  subjectId,
  subjectType,
  framework,
  evidenceRows,
  analysisRows,
  existingProfiles = [],
  currentSnapshot = null,
  nowMs = Date.now()
}) {
  const variables = variablesFor(framework)
  const variableIds = new Set(variables.map((item) => item.variable_id))
  const existingByVariable = new Map()

  for (const profile of existingProfiles) {
    if (!variableIds.has(text(profile.variable_id))) continue
    if (existingByVariable.has(profile.variable_id)) {
      throw new Error(`DUPLICATE_VARIABLE_EVIDENCE_PROFILES:${profile.variable_id}`)
    }
    existingByVariable.set(profile.variable_id, profile)
  }

  const analysisByEvidence = new Map()
  const sortedAnalyses = analysisRows
    .filter(active)
    .slice()
    .sort((a, b) => {
      const at = dateValue(recordTime(a))
      const bt = dateValue(recordTime(b))
      return (bt ? bt.getTime() : 0) - (at ? at.getTime() : 0)
    })

  const evidence = evidenceRows.filter((item) => (
    active(item) &&
    text(item.subject_id) === subjectId &&
    variableIds.has(text(item.variable_id)) &&
    (!item.subject_type || item.subject_type === subjectType) &&
    (!item.framework || item.framework === framework)
  ))

  const evidenceById = new Map(evidence.map((item) => [text(item.evidence_id), item]))
  for (const raw of sortedAnalyses) {
    const evidenceItem = evidenceById.get(text(raw.evidence_id))
    if (!evidenceItem || analysisByEvidence.has(text(raw.evidence_id))) continue
    const normalized = normalizeAnalysis(raw)
    if (consistent(normalized, evidenceItem, framework)) {
      analysisByEvidence.set(text(raw.evidence_id), normalized)
    }
  }

  const currentEvidenceIds = new Set(
    list(currentSnapshot && currentSnapshot.source_evidence_ids).map(text).filter(Boolean)
  )

  const profiles = []
  const candidateStates = []
  const supportivePairsByVariable = new Map()

  for (const variable of variables) {
    const existing = existingByVariable.get(variable.variable_id) || null
    const variableEvidence = evidence.filter((item) => item.variable_id === variable.variable_id)
    const pairs = variableEvidence
      .map((item) => ({ evidence: item, analysis: analysisByEvidence.get(text(item.evidence_id)) || null }))
    const analyzed = pairs.filter((item) => item.analysis)
    const supportivePairs = analyzed.filter((item) => supportive(item.analysis))
    supportivePairsByVariable.set(variable.variable_id, supportivePairs)

    const relevant = analyzed.filter((item) => item.analysis.relevance_status === 'relevant').length
    const partiallyRelevant = analyzed.filter((item) => item.analysis.relevance_status === 'partially_relevant').length
    const irrelevant = analyzed.filter((item) => item.analysis.relevance_status === 'irrelevant').length
    const uncertain = analyzed.filter((item) => item.analysis.relevance_status === 'uncertain').length
    const usable = analyzed.filter((item) => item.analysis.evidence_sufficiency === 'usable').length
    const weak = analyzed.filter((item) => item.analysis.evidence_sufficiency === 'weak').length
    const insufficient = analyzed.filter((item) => item.analysis.evidence_sufficiency === 'insufficient').length
    const supportiveUsable = supportivePairs.filter((item) => item.analysis.evidence_sufficiency === 'usable').length
    const supportiveWeak = supportivePairs.filter((item) => item.analysis.evidence_sufficiency === 'weak').length
    const sourceTypes = unique(supportivePairs.map((item) => item.evidence.source_type))
    const sourceModalities = unique(supportivePairs.map((item) => modality(item.evidence)))
    const evidenceDates = unique(supportivePairs.map((item) => chinaDate(recordTime(item.evidence) || recordTime(item.analysis)))).sort()
    // context_count 是 V1.0 辅助覆盖指标：只做原文精确去重，不能解释为标准化情境类别数量。
    const contextValues = unique(supportivePairs.flatMap((item) => contexts(item.analysis)))
    const supportiveTimes = supportivePairs
      .map((item) => dateValue(recordTime(item.evidence) || recordTime(item.analysis)))
      .filter(Boolean)
      .sort((a, b) => a.getTime() - b.getTime())
    const explicitPending = supportivePairs.some(({ analysis }) => (
      text(analysis.contradiction_status) === 'pending' ||
      analysis.contradicts_current_model === true
    ))
    const existingContradiction = text(existing && existing.contradiction_status)
    const contradictionStatus = explicitPending || existingContradiction === 'pending'
      ? 'pending'
      : existingContradiction === 'resolved'
        ? 'resolved'
        : 'none'

    const profile = {
      subject_id: subjectId,
      ...variable,
      evidence_count: variableEvidence.length,
      analyzed_count: analyzed.length,
      relevant_count: relevant,
      partially_relevant_count: partiallyRelevant,
      irrelevant_count: irrelevant,
      uncertain_count: uncertain,
      usable_count: usable,
      weak_count: weak,
      insufficient_count: insufficient,
      supportive_evidence_count: supportivePairs.length,
      supportive_usable_count: supportiveUsable,
      supportive_weak_count: supportiveWeak,
      source_types: sourceTypes,
      source_type_count: sourceTypes.length,
      source_modalities: sourceModalities,
      modality_count: sourceModalities.length,
      effective_modality_count: sourceModalities.filter((item) => item !== 'unknown').length,
      evidence_dates: evidenceDates,
      time_point_count: evidenceDates.length,
      contexts: contextValues,
      context_count: contextValues.length,
      first_evidence_at: supportiveTimes[0] || null,
      latest_evidence_at: supportiveTimes[supportiveTimes.length - 1] || null,
      contradiction_status: contradictionStatus,
      contradiction_resolution: existing && existing.contradiction_resolution
        ? existing.contradiction_resolution
        : null,
      profile_version: '1.1'
    }
    const [stagnationStatus, stagnationReasons] = stagnation(profile, nowMs)
    profile.stagnation_status = stagnationStatus
    profile.stagnation_reasons = stagnationReasons
    const [status, statusName] = supportStatus(profile)
    profile.support_status = status
    profile.support_status_name = statusName
    profile.evidence_gaps = buildGaps(profile, nowMs)
    profile.gap_status = profile.evidence_gaps.length ? 'open' : 'sufficient_for_current_stage'
    profile.support_summary = `共有${profile.evidence_count}条 Evidence，${profile.analyzed_count}条已分析；` +
      `${profile.supportive_evidence_count}条 supportive（usable ${supportiveUsable}、weak ${supportiveWeak}）；` +
      `覆盖${profile.time_point_count}个时间点、${profile.context_count}条精确去重情境和${profile.source_type_count}类来源。`
    profile.existing_profile_id = text(existing && existing.profile_id)
    profile.existing_document_id = text(existing && existing._id)
    profiles.push(profile)

    if (!currentSnapshot) continue
    const newContinuousUsable = supportivePairs.filter(({ evidence: item, analysis }) => (
      analysis.evidence_sufficiency === 'usable' &&
      isContinuous(item) &&
      !currentEvidenceIds.has(text(item.evidence_id))
    ))
    if (newContinuousUsable.length === 0) continue

    const currentVariable = modelVariable(currentSnapshot, variable.variable_id)
    const currentContexts = unique(list(currentVariable && currentVariable.contexts))
    const newContexts = unique(newContinuousUsable.flatMap((item) => contexts(item.analysis)))
      .filter((item) => !currentContexts.includes(item))
    let changeType = 'support_strengthening'
    if (contradictionStatus === 'pending') changeType = 'contradiction_pending'
    else if (!currentVariable || ['证据不足', 'insufficient'].includes(text(currentVariable.current_status || currentVariable.confidence))) {
      changeType = 'content_update'
    } else if (newContexts.length > 0) changeType = 'context_refinement'

    candidateStates.push({
      ...variable,
      current_snapshot_id: text(currentSnapshot.snapshot_id),
      candidate_key: `${subjectId}|${text(currentSnapshot.snapshot_id)}|${variable.variable_id}`,
      change_type: changeType,
      old_state: currentVariable || null,
      candidate_state: {
        support_status: profile.support_status,
        support_status_name: profile.support_status_name,
        support_summary: profile.support_summary,
        new_contexts: newContexts
      },
      supporting_evidence_ids: newContinuousUsable.map((item) => text(item.evidence.evidence_id)),
      supporting_analysis_ids: newContinuousUsable.map((item) => text(item.analysis.analysis_id)),
      new_supportive_usable_count: newContinuousUsable.length,
      eligible_for_draft: newContinuousUsable.length >= 2 && contradictionStatus !== 'pending',
      contradiction_status: contradictionStatus,
      review_status: contradictionStatus === 'pending' ? 'blocked_by_contradiction' : 'pending_review',
      reasoning_basis: newContinuousUsable.flatMap((item) => item.analysis.extracted_points).slice(0, 12),
      context_changes: newContexts,
      profile_id: text(existing && existing.profile_id)
    })
  }

  return {
    variables,
    profiles,
    candidate_states: candidateStates,
    supportive_pairs_by_variable: supportivePairsByVariable,
    latest_analysis_by_evidence: analysisByEvidence,
    evidence
  }
}

module.exports = {
  FRAMEWORKS,
  active,
  buildHealthState,
  chinaDate,
  dateValue,
  normalizeAnalysis,
  supportive,
  text,
  unique,
  variablesFor
}
