const fs = require('fs')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')
const source = path.join(
  projectRoot,
  'cloudfunctions',
  '_shared',
  'authorize-student-operator.js'
)
const targets = [
  'advanceSubjectModel',
  'analyzeStudentEvidence',
  'authorizeTeacherStudentCollectionByCode',
  'buildStudentInitialModel',
  'checkVoiceConsent',
  'completeStudentCollectionTask',
  'createSession',
  'createStudentTaskEvidence',
  'ensureStudentBackground',
  'getNextStudentCollectionTask',
  'getMyTeacherStudentCollectionAccesses',
  'getStudentBackground',
  'getStudentCurrentModel',
  'getSubjectModelGuidance',
  'saveVoiceConsent',
  'saveVoiceRecord',
  'submitStudentContinuousRecord',
  'verifyJointStudentCollectionMvp'
]

const content = fs.readFileSync(source)
for (const target of targets) {
  fs.writeFileSync(
    path.join(projectRoot, 'cloudfunctions', target, 'student-operator-auth.js'),
    content
  )
}

console.log(`Synced authorizeStudentOperator to ${targets.length} cloud functions.`)
