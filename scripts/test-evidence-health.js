const assert = require('assert')
const {
  buildHealthState,
  variablesFor
} = require('../cloudfunctions/advanceSubjectModel/evidence-health-core')

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

const single = state([e1], [analyses[0]])
assert.strictEqual(single.candidate_states[0].eligible_for_draft, false)

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

console.log('evidence-health rules: PASS')
