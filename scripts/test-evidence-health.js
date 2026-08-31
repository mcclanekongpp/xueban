const assert = require('assert')
const {
  buildHealthState,
  variablesFor
} = require('../cloudfunctions/advanceSubjectModel/evidence-health-core')
const {
  deterministicId,
  mergeRevisionSources,
  nextRevision,
  validateSnapshotFramework
} = require('../cloudfunctions/advanceSubjectModel/revision-core')

function evidence(id, variableId, date, extra = {}) {
  return {
    evidence_id: id,
    subject_id: 'TEST_SUBJECT',
    subject_type: 'teacher',
    framework: 'teacher_v1.0',
    dimension_id: variableId.split('-')[0],
    variable_id: variableId,
    source_type: 'teaching_reflection',
    collection_phase: 'continuous',
    status: 'active',
    created_at: new Date(date),
    ...extra
  }
}

function analysis(id, evidenceId, variableId, relevance, sufficiency, context) {
  return {
    analysis_id: id,
    evidence_id: evidenceId,
    subject_id: 'TEST_SUBJECT',
    subject_type: 'teacher',
    framework: 'teacher_v1.0',
    variable_id: variableId,
    relevance_status: relevance,
    evidence_sufficiency: sufficiency,
    extracted_points: [`${evidenceId} 的可追溯信息点`],
    reasoning_basis: 'TEST',
    context,
    uncertainty: 'TEST uncertainty',
    status: 'active',
    created_at: new Date('2026-08-31T00:00:00Z')
  }
}

function state(evidenceRows, analysisRows, existingProfiles = []) {
  return buildHealthState({
    subjectId: 'TEST_SUBJECT',
    subjectType: 'teacher',
    framework: 'teacher_v1.0',
    evidenceRows,
    analysisRows,
    existingProfiles,
    currentSnapshot: {
      snapshot_id: 'MS_TEST_ACTIVE',
      source_evidence_ids: [],
      model_data: {
        dimensions: [{
          dimension_id: 'T2',
          dimension_name: '学生理解与诊断',
          variables: [{
            variable_id: 'T2-2',
            variable_name: '学习困难诊断',
            current_status: '证据不足',
            current_description: '现有信息不足。',
            contexts: []
          }]
        }]
      }
    },
    nowMs: new Date('2026-08-31T00:00:00Z').getTime()
  })
}

assert.strictEqual(variablesFor('teacher_v1.0').length, 13)
assert.strictEqual(variablesFor('student_v1.0').length, 17)
assert.strictEqual(deterministicId('MS_AUTO', 'same-input'), deterministicId('MS_AUTO', 'same-input'))
assert.notStrictEqual(deterministicId('MS_AUTO', 'same-input'), deterministicId('MS_AUTO', 'different-input'))
assert.strictEqual(nextRevision({ version: '1.0' }), 1)
assert.strictEqual(nextRevision({ model_version: '1.4', revision_number: 4 }), 5)

const teacherVariables = variablesFor('teacher_v1.0')
const completeTeacherDraft = {
  model_data: {
    dimensions: teacherVariables.reduce((dimensions, variable) => {
      let dimension = dimensions.find((item) => item.dimension_id === variable.dimension_id)
      if (!dimension) {
        dimension = { dimension_id: variable.dimension_id, variables: [] }
        dimensions.push(dimension)
      }
      dimension.variables.push({ variable_id: variable.variable_id })
      return dimensions
    }, [])
  }
}
assert.strictEqual(validateSnapshotFramework(completeTeacherDraft, teacherVariables), true)
assert.throws(
  () => validateSnapshotFramework({ model_data: { dimensions: [] } }, teacherVariables),
  (error) => error && error.code === 'REVISION_FRAMEWORK_INCOMPLETE'
)

const mergedRevisionSources = mergeRevisionSources(
  { source_evidence_ids: ['E_INITIAL'], source_analysis_ids: ['A_INITIAL'] },
  [{ variable_id: 'T2-2' }],
  new Map([
    ['T2-2', [{ evidence: { evidence_id: 'E_NEW_T2' }, analysis: { analysis_id: 'A_NEW_T2' } }]],
    ['T3-2', [{ evidence: { evidence_id: 'E_NOT_REVISED' }, analysis: { analysis_id: 'A_NOT_REVISED' } }]]
  ])
)
assert.deepStrictEqual(mergedRevisionSources.sourceEvidenceIds, ['E_INITIAL', 'E_NEW_T2'])
assert.deepStrictEqual(mergedRevisionSources.sourceAnalysisIds, ['A_INITIAL', 'A_NEW_T2'])

const e1 = evidence('E1', 'T2-2', '2026-08-29T02:00:00Z', { voice_id: 'V1' })
const e2 = evidence('E2', 'T2-2', '2026-08-30T02:00:00Z', { message_id: 'M2' })
const e3 = evidence('E3', 'T2-2', '2026-08-30T03:00:00Z', { source_modality: 'unknown' })
const analyses = [
  analysis('A1', 'E1', 'T2-2', 'relevant', 'usable', '课堂观察'),
  analysis('A2', 'E2', 'T2-2', 'partially_relevant', 'usable', '备课反思'),
  analysis('A3', 'E3', 'T2-2', 'irrelevant', 'usable', '不应计入')
]

const calculated = state([e1, e2, e3], analyses)
const profile = calculated.profiles.find((item) => item.variable_id === 'T2-2')
assert.strictEqual(profile.evidence_count, 3)
assert.strictEqual(profile.usable_count, 3)
assert.strictEqual(profile.supportive_evidence_count, 2)
assert.strictEqual(profile.supportive_usable_count, 2)
assert.strictEqual(profile.context_count, 2)
assert.strictEqual(profile.time_point_count, 2)
assert.strictEqual(profile.modality_count, 2)
assert.strictEqual(profile.effective_modality_count, 2)
assert.strictEqual(profile.support_status, 'supported')
assert(!profile.contexts.includes('不应计入'))
assert.strictEqual(calculated.candidate_states.length, 1)
assert.strictEqual(calculated.candidate_states[0].eligible_for_draft, true)
assert.strictEqual(calculated.candidate_states[0].auto_update_eligible, true)
assert.strictEqual(calculated.candidate_states[0].independent_source_record_count, 2)
assert.strictEqual(calculated.candidate_states[0].new_time_point_count, 2)

const single = state([e1], [analyses[0]])
assert.strictEqual(single.candidate_states[0].eligible_for_draft, false)
assert.strictEqual(single.candidate_states[0].auto_update_eligible, false)

const unknownOnly = state(
  [evidence('E4', 'T2-2', '2026-08-29T02:00:00Z', { source_modality: 'unknown' })],
  [analysis('A4', 'E4', 'T2-2', 'relevant', 'usable', '课堂观察')]
)
const unknownProfile = unknownOnly.profiles.find((item) => item.variable_id === 'T2-2')
assert.strictEqual(unknownProfile.modality_count, 1)
assert.strictEqual(unknownProfile.effective_modality_count, 0)

const contradicted = state([e1, e2], analyses.slice(0, 2), [{
  _id: 'P1',
  profile_id: 'VEP1',
  subject_id: 'TEST_SUBJECT',
  framework: 'teacher_v1.0',
  variable_id: 'T2-2',
  contradiction_status: 'pending'
}])
const contradictedCandidate = contradicted.candidate_states[0]
assert.strictEqual(contradictedCandidate.change_type, 'contradiction_pending')
assert.strictEqual(contradictedCandidate.eligible_for_draft, false)
assert.strictEqual(contradictedCandidate.auto_update_eligible, false)
assert(contradictedCandidate.auto_update_blockers.includes('contradiction_pending'))

const sameCoverageEvidence = [
  evidence('E5', 'T2-2', '2026-08-30T02:00:00Z', { voice_id: 'V5' }),
  evidence('E6', 'T2-2', '2026-08-30T03:00:00Z', { voice_id: 'V6' })
]
const sameCoverageAnalyses = [
  analysis('A5', 'E5', 'T2-2', 'relevant', 'usable', '同一情境'),
  analysis('A6', 'E6', 'T2-2', 'partially_relevant', 'usable', '同一情境')
]
const sameCoverageCandidate = state(sameCoverageEvidence, sameCoverageAnalyses).candidate_states[0]
assert.strictEqual(sameCoverageCandidate.eligible_for_draft, true)
assert.strictEqual(sameCoverageCandidate.auto_update_eligible, false)
assert(sameCoverageCandidate.auto_update_blockers.includes('cross_time_context_or_source_coverage_missing'))

const crossContextAnalyses = [
  sameCoverageAnalyses[0],
  analysis('A7', 'E6', 'T2-2', 'partially_relevant', 'usable', '另一个情境')
]
const crossContextCandidate = state(sameCoverageEvidence, crossContextAnalyses).candidate_states[0]
assert.strictEqual(crossContextCandidate.auto_update_eligible, true)
assert.strictEqual(crossContextCandidate.new_context_count, 2)

const sameVoiceEvidence = [
  evidence('E7', 'T2-2', '2026-08-29T02:00:00Z', { voice_id: 'V_SHARED' }),
  evidence('E8', 'T2-2', '2026-08-30T02:00:00Z', { voice_id: 'V_SHARED' })
]
const sameVoiceAnalyses = [
  analysis('A8', 'E7', 'T2-2', 'relevant', 'usable', '情境一'),
  analysis('A9', 'E8', 'T2-2', 'relevant', 'usable', '情境二')
]
const sameVoiceCandidate = state(sameVoiceEvidence, sameVoiceAnalyses).candidate_states[0]
assert.strictEqual(sameVoiceCandidate.auto_update_eligible, false)
assert(sameVoiceCandidate.auto_update_blockers.includes('independent_source_record_count_below_2'))

const weakOnly = state(
  [evidence('E9', 'T2-2', '2026-08-29T02:00:00Z', { voice_id: 'V9' }), evidence('E10', 'T2-2', '2026-08-30T02:00:00Z', { voice_id: 'V10' })],
  [analysis('A10', 'E9', 'T2-2', 'relevant', 'weak', '情境一'), analysis('A11', 'E10', 'T2-2', 'relevant', 'weak', '情境二')]
)
assert.strictEqual(weakOnly.candidate_states.length, 0)

console.log('evidence-health rules: PASS')
