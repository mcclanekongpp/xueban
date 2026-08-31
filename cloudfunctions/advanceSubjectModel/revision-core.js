const crypto = require('crypto')

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim()
}

function deterministicId(prefix, value) {
  const digest = crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24).toUpperCase()
  return `${prefix}_${digest}`
}

function nextRevision(active) {
  if (Number.isInteger(active && active.revision_number) && active.revision_number >= 0) {
    return active.revision_number + 1
  }
  const match = text(active && (active.model_version || active.version)).match(/^1\.(\d+)$/)
  return match ? Number(match[1]) + 1 : 1
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))]
}

function mergeRevisionSources(active, candidates, supportivePairsByVariable) {
  const revisedVariableIds = new Set(
    (Array.isArray(candidates) ? candidates : []).map((item) => text(item && item.variable_id)).filter(Boolean)
  )
  const revisedPairs = supportivePairsByVariable instanceof Map
    ? [...supportivePairsByVariable.entries()]
      .filter(([variableId]) => revisedVariableIds.has(text(variableId)))
      .flatMap(([, pairs]) => Array.isArray(pairs) ? pairs : [])
    : []

  const sourceEvidenceIds = unique([
    ...(active && Array.isArray(active.source_evidence_ids) ? active.source_evidence_ids : []),
    ...revisedPairs.map(({ evidence }) => evidence && evidence.evidence_id)
  ])
  const sourceAnalysisIds = unique([
    ...(active && Array.isArray(active.source_analysis_ids) ? active.source_analysis_ids : []),
    ...revisedPairs.map(({ analysis }) => analysis && analysis.analysis_id)
  ])

  return { sourceEvidenceIds, sourceAnalysisIds, revisedPairs }
}

function validateSnapshotFramework(snapshot, frameworkVariables) {
  const expected = (Array.isArray(frameworkVariables) ? frameworkVariables : [])
    .map((item) => text(item && item.variable_id))
    .filter(Boolean)
  const actual = new Set()
  const dimensions = snapshot && snapshot.model_data && Array.isArray(snapshot.model_data.dimensions)
    ? snapshot.model_data.dimensions
    : []

  for (const dimension of dimensions) {
    for (const variable of (Array.isArray(dimension.variables) ? dimension.variables : [])) {
      const variableId = text(variable && variable.variable_id)
      if (variableId) actual.add(variableId)
    }
  }

  const missing = expected.filter((variableId) => !actual.has(variableId))
  if (missing.length) {
    const error = new Error(`模型草稿缺少固定变量：${missing.join(', ')}`)
    error.code = 'REVISION_FRAMEWORK_INCOMPLETE'
    throw error
  }
  return true
}

module.exports = {
  deterministicId,
  mergeRevisionSources,
  nextRevision,
  validateSnapshotFramework
}
