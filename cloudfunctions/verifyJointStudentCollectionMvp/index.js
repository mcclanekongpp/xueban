const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const { authorizeStudentOperator } = require('./student-operator-auth')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const TEST_PREFIX = 'TEST_JOINT_BINDING_20260901'
const SCHOOL_ID = `${TEST_PREFIX}_SCHOOL`
const CLASS_A_ID = `${TEST_PREFIX}_CLASS_A`
const CLASS_B_ID = `${TEST_PREFIX}_CLASS_B`
const CONCURRENCY_PREFIX = 'TEST_OPERATOR_CONCURRENCY_20260902'
const CONCURRENCY_SCHOOL_ID = `${CONCURRENCY_PREFIX}_SCHOOL`
const CONCURRENCY_CLASS_ID = `${CONCURRENCY_PREFIX}_CLASS`
const CONCURRENCY_STUDENT_ID = `${CONCURRENCY_PREFIX}_STUDENT`
const CONCURRENCY_TEACHER_ID = `${CONCURRENCY_PREFIX}_TEACHER`
const CONCURRENCY_GUARDIAN_USER_ID = `${CONCURRENCY_PREFIX}_U_GUARDIAN`
const CONCURRENCY_TEACHER_USER_ID = `${CONCURRENCY_PREFIX}_U_TEACHER`
const CONCURRENCY_GUARDIAN_OPENID = `${CONCURRENCY_PREFIX}_OPENID_GUARDIAN`
const CONCURRENCY_TEACHER_OPENID = `${CONCURRENCY_PREFIX}_OPENID_TEACHER`
const CONCURRENCY_PROGRESS_ID = `${CONCURRENCY_PREFIX}_PROGRESS`
const CONCURRENCY_TEACHER_PROGRESS_ID = `${CONCURRENCY_PREFIX}_TEACHER_PROGRESS`

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex')
}

function makeCode() {
  return crypto.randomBytes(10).toString('hex').toUpperCase()
}

function makeIds(kind, suffix) {
  return {
    userId: `${TEST_PREFIX}_U_${kind}_${suffix}`,
    openid: `${TEST_PREFIX}_OPENID_${kind}_${suffix}`,
    subjectId: `${TEST_PREFIX}_${kind}_${suffix}`
  }
}

async function setDoc(collection, id, data) {
  await db.collection(collection).doc(id).set({ data })
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isTransactionConflict(error) {
  const text = `${error && error.code ? error.code : ''} ${error && error.message ? error.message : ''}`
  return /TransactionConflict|DATABASE_TRANSACTION_CONFLICT|transaction is conflict/i.test(text)
}

async function runTransactionWithConflictRetry(work, maxAttempts = 4) {
  let lastError = null
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await db.runTransaction(work)
    } catch (error) {
      lastError = error
      if (!isTransactionConflict(error) || attempt === maxAttempts) throw error
      await wait(attempt * 35 + Math.floor(Math.random() * 25))
    }
  }
  throw lastError
}

async function loadCaller(openid) {
  const result = await db.collection('users').where({ openid, status: 'active' }).limit(2).get()
  return result.data.length === 1 ? result.data[0] : null
}

async function seedTestBase() {
  const now = db.serverDate()
  const [oldAccesses, oldGuardians] = await Promise.all([
    db.collection('teacher_student_collection_access').where({ is_test: true }).get(),
    db.collection('guardian_student_bindings').where({ is_test: true }).get()
  ])
  for (const record of oldAccesses.data.filter((item) =>
    String(item.teacher_subject_id || '').startsWith(TEST_PREFIX)
  )) {
    await db.collection('teacher_student_collection_access').doc(record._id).update({
      data: { status: 'revoked', revoked_at: now, updated_at: now }
    })
  }
  for (const record of oldGuardians.data.filter((item) =>
    String(item.subject_id || '').startsWith(TEST_PREFIX)
  )) {
    await db.collection('guardian_student_bindings').doc(record._id).update({
      data: { status: 'revoked', revoked_at: now, updated_at: now }
    })
  }
  await setDoc('schools', SCHOOL_ID, {
    school_id: SCHOOL_ID,
    school_name: 'TEST 联合采集学校',
    status: 'active',
    is_test: true,
    created_at: now,
    updated_at: now
  })
  for (const [classId, className] of [[CLASS_A_ID, 'TEST 联合采集 A 班'], [CLASS_B_ID, 'TEST 联合采集 B 班']]) {
    await setDoc('classes', classId, {
      class_id: classId,
      school_id: SCHOOL_ID,
      class_name: className,
      status: 'active',
      is_test: true,
      created_at: now,
      updated_at: now
    })
  }

  const actors = {
    guardianA: makeIds('GUARDIAN', 'A'),
    guardianB: makeIds('GUARDIAN', 'B'),
    teacherA: makeIds('TEACHER', 'A'),
    teacherB: makeIds('TEACHER', 'B'),
    teacherCross: makeIds('TEACHER', 'CROSS'),
    teacherNew: makeIds('TEACHER', 'NEW')
  }
  const students = {
    a: { subjectId: `${TEST_PREFIX}_STUDENT_A`, classId: CLASS_A_ID },
    b: { subjectId: `${TEST_PREFIX}_STUDENT_B`, classId: CLASS_A_ID },
    c: { subjectId: `${TEST_PREFIX}_STUDENT_C`, classId: CLASS_A_ID }
  }

  for (const actor of Object.values(actors)) {
    await setDoc('users', actor.userId, {
      user_id: actor.userId,
      openid: actor.openid,
      role: actor.subjectId.includes('_TEACHER_') ? 'teacher' : 'guardian',
      status: 'active',
      is_test: true,
      created_at: now,
      updated_at: now
    })
  }

  for (const [name, actor] of Object.entries(actors)) {
    if (!name.startsWith('teacher') || name === 'teacherNew') continue
    const classId = name === 'teacherCross' ? CLASS_B_ID : CLASS_A_ID
    await setDoc('subjects', actor.subjectId, {
      subject_id: actor.subjectId,
      subject_type: 'teacher',
      model_framework: 'teacher_v1.0',
      current_version: '',
      current_snapshot_id: '',
      status: 'active',
      research_alias: `${TEST_PREFIX}_${name}`,
      is_test: true,
      created_at: now,
      updated_at: now
    })
    await setDoc('class_memberships', `${TEST_PREFIX}_CM_${name}`, {
      membership_id: `${TEST_PREFIX}_CM_${name}`,
      class_id: classId,
      subject_id: actor.subjectId,
      subject_type: 'teacher',
      membership_role: 'teacher',
      status: 'active',
      is_test: true,
      created_at: now,
      updated_at: now
    })
    await setDoc('identity_map', `${TEST_PREFIX}_IM_${name}`, {
      binding_id: `${TEST_PREFIX}_IM_${name}`,
      user_id: actor.userId,
      subject_id: actor.subjectId,
      subject_type: 'teacher',
      identity_type: 'teacher',
      status: 'active',
      is_test: true,
      created_at: now,
      updated_at: now
    })
  }

  const codes = {}
  for (const [name, student] of Object.entries(students)) {
    await setDoc('subjects', student.subjectId, {
      subject_id: student.subjectId,
      subject_type: 'student',
      model_framework: 'student_v1.0',
      current_version: '',
      status: 'active',
      research_alias: `${TEST_PREFIX}_STUDENT_${name.toUpperCase()}`,
      is_test: true,
      created_at: now,
      updated_at: now
    })
    await setDoc('class_memberships', `${TEST_PREFIX}_CM_STUDENT_${name}`, {
      membership_id: `${TEST_PREFIX}_CM_STUDENT_${name}`,
      class_id: student.classId,
      subject_id: student.subjectId,
      subject_type: 'student',
      membership_role: 'student',
      status: 'active',
      is_test: true,
      created_at: now,
      updated_at: now
    })
    const code = makeCode()
    const bindId = `${TEST_PREFIX}_SB_${name}`
    await setDoc('student_bind_codes', bindId, {
      bind_id: bindId,
      bind_code_hash: sha256(code),
      subject_id: student.subjectId,
      subject_type: 'student',
      school_id: SCHOOL_ID,
      class_id: student.classId,
      status: 'active',
      usage_state: 'unused',
      guardian_bound: false,
      guardian_bound_at: null,
      teacher_access_count: 0,
      first_teacher_access_at: null,
      last_teacher_access_at: null,
      last_used_at: null,
      is_test: true,
      created_by_user_id: `${TEST_PREFIX}_SYSTEM`,
      created_at: now,
      updated_at: now,
      expires_at: null
    })
    codes[name] = { code, bindId }
  }

  const teacherCode = makeCode()
  const newTeacher = actors.teacherNew
  await setDoc('subjects', newTeacher.subjectId, {
    subject_id: newTeacher.subjectId,
    subject_type: 'teacher',
    model_framework: 'teacher_v1.0',
    current_version: '',
    current_snapshot_id: '',
    status: 'active',
    research_alias: `${TEST_PREFIX}_teacherNew`,
    is_test: true,
    created_at: now,
    updated_at: now
  })
  await setDoc('class_memberships', `${TEST_PREFIX}_CM_teacherNew`, {
    membership_id: `${TEST_PREFIX}_CM_teacherNew`,
    class_id: CLASS_A_ID,
    subject_id: newTeacher.subjectId,
    subject_type: 'teacher',
    membership_role: 'teacher',
    status: 'active',
    is_test: true,
    created_at: now,
    updated_at: now
  })
  await setDoc('teacher_bind_codes', `${TEST_PREFIX}_TB_NEW`, {
    bind_id: `${TEST_PREFIX}_TB_NEW`,
    bind_code_hash: sha256(teacherCode),
    subject_id: newTeacher.subjectId,
    subject_type: 'teacher',
    school_id: SCHOOL_ID,
    class_id: CLASS_A_ID,
    status: 'unused',
    is_test: true,
    created_by_user_id: `${TEST_PREFIX}_SYSTEM`,
    created_at: now,
    updated_at: now,
    used_at: null,
    expires_at: null
  })

  return { actors, students, codes, teacherCode }
}

async function bindTeacherActor(actor, subjectId, teacherCode) {
  const codeResult = await db.collection('teacher_bind_codes').where({ bind_code_hash: sha256(teacherCode) }).limit(2).get()
  if (codeResult.data.length !== 1 || codeResult.data[0].subject_id !== subjectId) return { success: false }
  const record = codeResult.data[0]
  const existing = await db.collection('identity_map').where({ subject_id: subjectId, identity_type: 'teacher', status: 'active' }).limit(2).get()
  if (existing.data.length === 1) return { success: existing.data[0].user_id === actor.userId, idempotent: true }
  const now = db.serverDate()
  await db.runTransaction(async (transaction) => {
    const latest = await transaction.collection('teacher_bind_codes').doc(record._id).get()
    if (!latest.data || latest.data.status !== 'unused') throw new Error('TEACHER_CODE_NOT_UNUSED')
    await transaction.collection('identity_map').doc(`${TEST_PREFIX}_IM_teacherNew`).set({ data: {
      binding_id: `${TEST_PREFIX}_IM_teacherNew`,
      user_id: actor.userId,
      subject_id: subjectId,
      subject_type: 'teacher',
      identity_type: 'teacher',
      status: 'active',
      is_test: true,
      created_at: now,
      updated_at: now
    } })
    await transaction.collection('teacher_bind_codes').doc(record._id).update({ data: {
      status: 'used',
      used_by_user_id: actor.userId,
      used_binding_id: `${TEST_PREFIX}_IM_teacherNew`,
      used_at: now,
      updated_at: now
    } })
  })
  return { success: true, subject_id: subjectId }
}

function nextGuardianUsage(value) {
  return ['teacher_only', 'guardian_and_teacher'].includes(value) ? 'guardian_and_teacher' : 'guardian_only'
}

function nextTeacherUsage(value) {
  return ['guardian_only', 'guardian_and_teacher'].includes(value) ? 'guardian_and_teacher' : 'teacher_only'
}

async function bindGuardianActor(actor, student, bind) {
  const codeResult = await db.collection('student_bind_codes').where({ bind_code_hash: sha256(bind.code) }).limit(2).get()
  if (codeResult.data.length !== 1) return { success: false, code: 'INVALID_CODE' }
  const record = codeResult.data[0]
  const activeResult = await db.collection('guardian_student_bindings').where({ subject_id: student.subjectId, status: 'active' }).limit(2).get()
  if (activeResult.data.length === 1) {
    return activeResult.data[0].user_id === actor.userId
      ? { success: true, idempotent: true }
      : { success: false, code: 'STUDENT_ALREADY_BOUND' }
  }
  const bindingId = `${TEST_PREFIX}_GSB_${student.subjectId.split('_').pop()}`
  const now = db.serverDate()
  await db.runTransaction(async (transaction) => {
    await transaction.collection('guardian_student_bindings').doc(bindingId).set({ data: {
      binding_id: bindingId,
      user_id: actor.userId,
      subject_id: student.subjectId,
      subject_type: 'student',
      operator_role: 'guardian',
      source_bind_id: record.bind_id,
      status: 'active',
      is_test: true,
      bound_at: now,
      revoked_at: null,
      created_at: now,
      updated_at: now
    } })
    await transaction.collection('student_bind_codes').doc(record._id).update({ data: {
      status: 'active',
      usage_state: nextGuardianUsage(record.usage_state),
      guardian_bound: true,
      guardian_bound_at: now,
      last_used_at: now,
      updated_at: now
    } })
  })
  return { success: true, idempotent: false }
}

async function authorizeTeacherActor(actor, teacherSubjectId, student, bind) {
  const [teacherMembership, studentMembership] = await Promise.all([
    db.collection('class_memberships').where({ subject_id: teacherSubjectId, subject_type: 'teacher', status: 'active' }).limit(20).get(),
    db.collection('class_memberships').where({ subject_id: student.subjectId, subject_type: 'student', status: 'active' }).limit(20).get()
  ])
  const studentClasses = new Set(studentMembership.data.map((item) => item.class_id))
  const shared = teacherMembership.data.find((item) => studentClasses.has(item.class_id))
  if (!shared) return { success: false, code: 'TEACHER_STUDENT_CLASS_NOT_SHARED' }
  const codeResult = await db.collection('student_bind_codes').where({ bind_code_hash: sha256(bind.code), status: 'active' }).limit(2).get()
  if (codeResult.data.length !== 1 || codeResult.data[0].subject_id !== student.subjectId) return { success: false, code: 'INVALID_CODE' }
  const record = codeResult.data[0]
  const existingResult = await db.collection('teacher_student_collection_access').where({ teacher_subject_id: teacherSubjectId, student_subject_id: student.subjectId }).limit(2).get()
  if (existingResult.data.length > 1) return { success: false, code: 'DUPLICATE_ACCESS' }
  const existing = existingResult.data[0] || null
  if (existing && existing.status === 'active') return { success: true, idempotent: true, access_id: existing.access_id }
  const accessId = `${TEST_PREFIX}_ACCESS_${teacherSubjectId.split('_').pop()}_${student.subjectId.split('_').pop()}`
  const now = db.serverDate()
  await db.runTransaction(async (transaction) => {
    await transaction.collection('teacher_student_collection_access').doc(accessId).set({ data: {
      access_id: accessId,
      user_id: actor.userId,
      teacher_subject_id: teacherSubjectId,
      student_subject_id: student.subjectId,
      school_id: SCHOOL_ID,
      class_id: shared.class_id,
      source_bind_id: record.bind_id,
      access_role: 'teacher_collector',
      status: 'active',
      is_test: true,
      created_at: now,
      updated_at: now,
      last_used_at: now
    } })
    await transaction.collection('student_bind_codes').doc(record._id).update({ data: {
      status: 'active',
      usage_state: nextTeacherUsage(record.usage_state),
      teacher_access_count: Number(record.teacher_access_count || 0) + 1,
      first_teacher_access_at: record.first_teacher_access_at || now,
      last_teacher_access_at: now,
      last_used_at: now,
      updated_at: now
    } })
  })
  return { success: true, idempotent: false, access_id: accessId }
}

async function loadStudentCode(bindId) {
  const result = await db.collection('student_bind_codes').doc(bindId).get()
  return result.data
}

async function verifySharedProgress(studentId, guardianUserId, teacherUserId, teacherSubjectId) {
  const progressId = `${TEST_PREFIX}_PROGRESS_A`
  const now = db.serverDate()
  await setDoc('collection_progress', progressId, {
    progress_id: progressId,
    subject_id: studentId,
    subject_type: 'student',
    framework: 'student_v1.0',
    collection_phase: 'initial',
    total_tasks: 17,
    completed_tasks: 1,
    completed_count: 1,
    completed_task_ids: [`${TEST_PREFIX}_TASK_1`],
    current_task_id: `${TEST_PREFIX}_TASK_2`,
    status: 'in_progress',
    operator_user_id: guardianUserId,
    operator_type: 'guardian',
    is_test: true,
    created_at: now,
    updated_at: now
  })
  const teacherRead = await db.collection('collection_progress').where({ subject_id: studentId, framework: 'student_v1.0', collection_phase: 'initial' }).limit(2).get()
  await db.runTransaction(async (transaction) => {
    const current = await transaction.collection('collection_progress').doc(progressId).get()
    const ids = Array.from(new Set([...(current.data.completed_task_ids || []), `${TEST_PREFIX}_TASK_2`]))
    await transaction.collection('collection_progress').doc(progressId).update({ data: {
      completed_task_ids: ids,
      completed_tasks: ids.length,
      completed_count: ids.length,
      current_task_id: `${TEST_PREFIX}_TASK_3`,
      operator_user_id: teacherUserId,
      operator_type: 'teacher',
      operator_teacher_subject_id: teacherSubjectId,
      updated_at: db.serverDate()
    } })
  })
  const guardianRead = await db.collection('collection_progress').where({ subject_id: studentId, framework: 'student_v1.0', collection_phase: 'initial' }).limit(2).get()
  return {
    one_progress: guardianRead.data.length === 1,
    teacher_read_completed: teacherRead.data[0] && teacherRead.data[0].completed_tasks === 1,
    guardian_reread_completed: guardianRead.data[0] && guardianRead.data[0].completed_tasks === 2,
    completed_task_ids_unique: guardianRead.data[0] && new Set(guardianRead.data[0].completed_task_ids || []).size === 2
  }
}

function fixtures() {
  return {
    actors: {
      guardianA: makeIds('GUARDIAN', 'A'),
      guardianB: makeIds('GUARDIAN', 'B'),
      teacherA: makeIds('TEACHER', 'A'),
      teacherB: makeIds('TEACHER', 'B'),
      teacherCross: makeIds('TEACHER', 'CROSS'),
      teacherNew: makeIds('TEACHER', 'NEW')
    },
    students: {
      a: { subjectId: `${TEST_PREFIX}_STUDENT_A`, classId: CLASS_A_ID },
      b: { subjectId: `${TEST_PREFIX}_STUDENT_B`, classId: CLASS_A_ID },
      c: { subjectId: `${TEST_PREFIX}_STUDENT_C`, classId: CLASS_A_ID }
    }
  }
}

async function seedBaseStage() {
  const { actors } = fixtures()
  const now = db.serverDate()
  const [oldAccesses, oldGuardians] = await Promise.all([
    db.collection('teacher_student_collection_access').where({ is_test: true }).get(),
    db.collection('guardian_student_bindings').where({ is_test: true }).get()
  ])
  await Promise.all([
    ...oldAccesses.data.filter((item) => String(item.teacher_subject_id || '').startsWith(TEST_PREFIX)).map((record) =>
      db.collection('teacher_student_collection_access').doc(record._id).update({ data: { status: 'revoked', revoked_at: now, updated_at: now } })
    ),
    ...oldGuardians.data.filter((item) => String(item.subject_id || '').startsWith(TEST_PREFIX)).map((record) =>
      db.collection('guardian_student_bindings').doc(record._id).update({ data: { status: 'revoked', revoked_at: now, updated_at: now } })
    )
  ])
  await Promise.all([
    setDoc('schools', SCHOOL_ID, { school_id: SCHOOL_ID, school_name: 'TEST 联合采集学校', status: 'active', is_test: true, created_at: now, updated_at: now }),
    setDoc('classes', CLASS_A_ID, { class_id: CLASS_A_ID, school_id: SCHOOL_ID, class_name: 'TEST 联合采集 A 班', status: 'active', is_test: true, created_at: now, updated_at: now }),
    setDoc('classes', CLASS_B_ID, { class_id: CLASS_B_ID, school_id: SCHOOL_ID, class_name: 'TEST 联合采集 B 班', status: 'active', is_test: true, created_at: now, updated_at: now }),
    ...Object.values(actors).map((actor) => setDoc('users', actor.userId, {
      user_id: actor.userId,
      openid: actor.openid,
      role: actor.subjectId.includes('_TEACHER_') ? 'teacher' : 'guardian',
      status: 'active',
      is_test: true,
      created_at: now,
      updated_at: now
    }))
  ])
  return { success: true, stage: 'seed_base' }
}

async function seedTeachersStage() {
  const { actors } = fixtures()
  const now = db.serverDate()
  const writes = []
  for (const [name, actor] of Object.entries(actors)) {
    if (!name.startsWith('teacher')) continue
    const classId = name === 'teacherCross' ? CLASS_B_ID : CLASS_A_ID
    writes.push(
      setDoc('subjects', actor.subjectId, {
        subject_id: actor.subjectId,
        subject_type: 'teacher',
        model_framework: 'teacher_v1.0',
        current_version: '',
        current_snapshot_id: '',
        status: 'active',
        research_alias: `${TEST_PREFIX}_${name}`,
        is_test: true,
        created_at: now,
        updated_at: now
      }),
      setDoc('class_memberships', `${TEST_PREFIX}_CM_${name}`, {
        membership_id: `${TEST_PREFIX}_CM_${name}`,
        class_id: classId,
        subject_id: actor.subjectId,
        subject_type: 'teacher',
        membership_role: 'teacher',
        status: 'active',
        is_test: true,
        created_at: now,
        updated_at: now
      })
    )
    if (name !== 'teacherNew') {
      writes.push(setDoc('identity_map', `${TEST_PREFIX}_IM_${name}`, {
        binding_id: `${TEST_PREFIX}_IM_${name}`,
        user_id: actor.userId,
        subject_id: actor.subjectId,
        subject_type: 'teacher',
        identity_type: 'teacher',
        status: 'active',
        is_test: true,
        created_at: now,
        updated_at: now
      }))
    }
  }
  const teacherCode = makeCode()
  writes.push(setDoc('identity_map', `${TEST_PREFIX}_IM_teacherNew`, {
    binding_id: `${TEST_PREFIX}_IM_teacherNew`,
    user_id: actors.teacherNew.userId,
    subject_id: actors.teacherNew.subjectId,
    subject_type: 'teacher',
    identity_type: 'teacher',
    status: 'revoked',
    is_test: true,
    created_at: now,
    updated_at: now
  }))
  writes.push(setDoc('teacher_bind_codes', `${TEST_PREFIX}_TB_NEW`, {
    bind_id: `${TEST_PREFIX}_TB_NEW`,
    bind_code_hash: sha256(teacherCode),
    subject_id: actors.teacherNew.subjectId,
    subject_type: 'teacher',
    school_id: SCHOOL_ID,
    class_id: CLASS_A_ID,
    status: 'unused',
    is_test: true,
    created_by_user_id: `${TEST_PREFIX}_SYSTEM`,
    created_at: now,
    updated_at: now,
    used_at: null,
    expires_at: null
  }))
  await Promise.all(writes)
  return { success: true, stage: 'seed_teachers', teacher_code: teacherCode }
}

async function seedStudentsStage() {
  const { students } = fixtures()
  const now = db.serverDate()
  const codes = {}
  const writes = []
  for (const [name, student] of Object.entries(students)) {
    const code = makeCode()
    const bindId = `${TEST_PREFIX}_SB_${name}`
    codes[name] = { code, bindId }
    writes.push(
      setDoc('subjects', student.subjectId, {
        subject_id: student.subjectId,
        subject_type: 'student',
        model_framework: 'student_v1.0',
        current_version: '',
        status: 'active',
        research_alias: `${TEST_PREFIX}_STUDENT_${name.toUpperCase()}`,
        is_test: true,
        created_at: now,
        updated_at: now
      }),
      setDoc('class_memberships', `${TEST_PREFIX}_CM_STUDENT_${name}`, {
        membership_id: `${TEST_PREFIX}_CM_STUDENT_${name}`,
        class_id: student.classId,
        subject_id: student.subjectId,
        subject_type: 'student',
        membership_role: 'student',
        status: 'active',
        is_test: true,
        created_at: now,
        updated_at: now
      }),
      setDoc('student_bind_codes', bindId, {
        bind_id: bindId,
        bind_code_hash: sha256(code),
        subject_id: student.subjectId,
        subject_type: 'student',
        school_id: SCHOOL_ID,
        class_id: student.classId,
        status: 'active',
        usage_state: 'unused',
        guardian_bound: false,
        guardian_bound_at: null,
        teacher_access_count: 0,
        first_teacher_access_at: null,
        last_teacher_access_at: null,
        last_used_at: null,
        is_test: true,
        created_by_user_id: `${TEST_PREFIX}_SYSTEM`,
        created_at: now,
        updated_at: now,
        expires_at: null
      })
    )
  }
  await Promise.all(writes)
  return { success: true, stage: 'seed_students', codes }
}

async function seedConcurrencyStage() {
  const now = db.serverDate()
  await Promise.all([
    setDoc('schools', CONCURRENCY_SCHOOL_ID, {
      school_id: CONCURRENCY_SCHOOL_ID,
      school_name: 'TEST 并发验证学校',
      status: 'active',
      is_test: true,
      created_at: now,
      updated_at: now
    }),
    setDoc('classes', CONCURRENCY_CLASS_ID, {
      class_id: CONCURRENCY_CLASS_ID,
      school_id: CONCURRENCY_SCHOOL_ID,
      class_name: 'TEST 并发验证班级',
      status: 'active',
      is_test: true,
      created_at: now,
      updated_at: now
    }),
    setDoc('users', CONCURRENCY_GUARDIAN_USER_ID, {
      user_id: CONCURRENCY_GUARDIAN_USER_ID,
      openid: CONCURRENCY_GUARDIAN_OPENID,
      role: 'guardian',
      status: 'active',
      is_test: true,
      created_at: now,
      updated_at: now
    }),
    setDoc('users', CONCURRENCY_TEACHER_USER_ID, {
      user_id: CONCURRENCY_TEACHER_USER_ID,
      openid: CONCURRENCY_TEACHER_OPENID,
      role: 'teacher',
      status: 'active',
      is_test: true,
      created_at: now,
      updated_at: now
    }),
    setDoc('subjects', CONCURRENCY_STUDENT_ID, {
      subject_id: CONCURRENCY_STUDENT_ID,
      subject_type: 'student',
      model_framework: 'student_v1.0',
      status: 'active',
      research_alias: `${CONCURRENCY_PREFIX}_STUDENT`,
      is_test: true,
      created_at: now,
      updated_at: now
    }),
    setDoc('subjects', CONCURRENCY_TEACHER_ID, {
      subject_id: CONCURRENCY_TEACHER_ID,
      subject_type: 'teacher',
      model_framework: 'teacher_v1.0',
      status: 'active',
      research_alias: `${CONCURRENCY_PREFIX}_TEACHER`,
      is_test: true,
      created_at: now,
      updated_at: now
    }),
    setDoc('class_memberships', `${CONCURRENCY_PREFIX}_CM_STUDENT`, {
      membership_id: `${CONCURRENCY_PREFIX}_CM_STUDENT`,
      class_id: CONCURRENCY_CLASS_ID,
      subject_id: CONCURRENCY_STUDENT_ID,
      subject_type: 'student',
      membership_role: 'student',
      status: 'active',
      is_test: true,
      created_at: now,
      updated_at: now
    }),
    setDoc('class_memberships', `${CONCURRENCY_PREFIX}_CM_TEACHER`, {
      membership_id: `${CONCURRENCY_PREFIX}_CM_TEACHER`,
      class_id: CONCURRENCY_CLASS_ID,
      subject_id: CONCURRENCY_TEACHER_ID,
      subject_type: 'teacher',
      membership_role: 'teacher',
      status: 'active',
      is_test: true,
      created_at: now,
      updated_at: now
    }),
    setDoc('identity_map', `${CONCURRENCY_PREFIX}_IM_TEACHER`, {
      binding_id: `${CONCURRENCY_PREFIX}_IM_TEACHER`,
      user_id: CONCURRENCY_TEACHER_USER_ID,
      subject_id: CONCURRENCY_TEACHER_ID,
      subject_type: 'teacher',
      identity_type: 'teacher',
      status: 'active',
      is_test: true,
      created_at: now,
      updated_at: now
    }),
    setDoc('guardian_student_bindings', `${CONCURRENCY_PREFIX}_GSB`, {
      binding_id: `${CONCURRENCY_PREFIX}_GSB`,
      user_id: CONCURRENCY_GUARDIAN_USER_ID,
      subject_id: CONCURRENCY_STUDENT_ID,
      subject_type: 'student',
      operator_role: 'guardian',
      status: 'active',
      is_test: true,
      bound_at: now,
      created_at: now,
      updated_at: now
    }),
    setDoc('teacher_student_collection_access', `${CONCURRENCY_PREFIX}_ACCESS`, {
      access_id: `${CONCURRENCY_PREFIX}_ACCESS`,
      user_id: CONCURRENCY_TEACHER_USER_ID,
      teacher_subject_id: CONCURRENCY_TEACHER_ID,
      student_subject_id: CONCURRENCY_STUDENT_ID,
      school_id: CONCURRENCY_SCHOOL_ID,
      class_id: CONCURRENCY_CLASS_ID,
      access_role: 'teacher_collector',
      status: 'active',
      is_test: true,
      created_at: now,
      updated_at: now,
      last_used_at: now
    }),
    setDoc('collection_progress', CONCURRENCY_PROGRESS_ID, {
      progress_id: CONCURRENCY_PROGRESS_ID,
      subject_id: CONCURRENCY_STUDENT_ID,
      subject_type: 'student',
      framework: 'student_v1.0',
      collection_phase: 'concurrency_test',
      total_tasks: 17,
      completed_tasks: 0,
      completed_count: 0,
      completed_task_ids: [],
      current_task_id: `${CONCURRENCY_PREFIX}_TASK_1`,
      status: 'in_progress',
      is_test: true,
      created_at: now,
      updated_at: now
    }),
    setDoc('collection_progress', CONCURRENCY_TEACHER_PROGRESS_ID, {
      progress_id: CONCURRENCY_TEACHER_PROGRESS_ID,
      subject_id: CONCURRENCY_TEACHER_ID,
      subject_type: 'teacher',
      framework: 'teacher_v1.0',
      collection_phase: 'concurrency_test',
      total_tasks: 13,
      completed_tasks: 0,
      completed_count: 0,
      completed_task_ids: [],
      current_task_id: `${CONCURRENCY_PREFIX}_TEACHER_TASK_1`,
      status: 'in_progress',
      is_test: true,
      created_at: now,
      updated_at: now
    })
  ])

  return {
    success: true,
    stage: 'seed_concurrency',
    subject_id: CONCURRENCY_STUDENT_ID,
    progress_id: CONCURRENCY_PROGRESS_ID
  }
}

async function runConcurrencyReadProbe(event = {}) {
  const operatorType = ['teacher', 'teacher_self'].includes(event.operator_type)
    ? event.operator_type
    : 'guardian'
  const holdMs = Math.min(Math.max(Number(event.hold_ms) || 350, 0), 800)
  const openid = ['teacher', 'teacher_self'].includes(operatorType)
    ? CONCURRENCY_TEACHER_OPENID
    : CONCURRENCY_GUARDIAN_OPENID
  const startedAtMs = Date.now()

  if (operatorType === 'teacher_self') {
    const [userResult, mappingResult, subjectResult, progressResult] = await Promise.all([
      db.collection('users').where({
        openid,
        role: 'teacher',
        status: 'active',
        is_test: true
      }).limit(2).get(),
      db.collection('identity_map').where({
        user_id: CONCURRENCY_TEACHER_USER_ID,
        subject_id: CONCURRENCY_TEACHER_ID,
        identity_type: 'teacher',
        status: 'active',
        is_test: true
      }).limit(2).get(),
      db.collection('subjects').where({
        subject_id: CONCURRENCY_TEACHER_ID,
        subject_type: 'teacher',
        model_framework: 'teacher_v1.0',
        status: 'active',
        is_test: true
      }).limit(2).get(),
      db.collection('collection_progress').where({
        progress_id: CONCURRENCY_TEACHER_PROGRESS_ID,
        subject_id: CONCURRENCY_TEACHER_ID,
        collection_phase: 'concurrency_test',
        is_test: true
      }).limit(2).get()
    ])
    await wait(holdMs)
    const endedAtMs = Date.now()
    return {
      success: [userResult, mappingResult, subjectResult, progressResult]
        .every((result) => result.data.length === 1),
      operator_type: operatorType,
      subject_id: CONCURRENCY_TEACHER_ID,
      progress_count: progressResult.data.length,
      completed_count: progressResult.data[0]
        ? Number(progressResult.data[0].completed_count || 0)
        : null,
      started_at_ms: startedAtMs,
      ended_at_ms: endedAtMs,
      elapsed_ms: endedAtMs - startedAtMs
    }
  }

  const authorization = await authorizeStudentOperator({
    db,
    openid,
    subjectId: CONCURRENCY_STUDENT_ID
  })
  if (!authorization.authorized || authorization.operator_type !== operatorType) {
    return {
      success: false,
      code: authorization.code || 'CONCURRENCY_OPERATOR_NOT_AUTHORIZED',
      operator_type: operatorType,
      started_at_ms: startedAtMs,
      ended_at_ms: Date.now()
    }
  }

  const [progressResult, subjectResult] = await Promise.all([
    db.collection('collection_progress').where({
      progress_id: CONCURRENCY_PROGRESS_ID,
      subject_id: CONCURRENCY_STUDENT_ID,
      collection_phase: 'concurrency_test',
      is_test: true
    }).limit(2).get(),
    db.collection('subjects').where({
      subject_id: CONCURRENCY_STUDENT_ID,
      subject_type: 'student',
      status: 'active',
      is_test: true
    }).limit(2).get()
  ])
  await wait(holdMs)
  const endedAtMs = Date.now()

  return {
    success: progressResult.data.length === 1 && subjectResult.data.length === 1,
    operator_type: operatorType,
    subject_id: CONCURRENCY_STUDENT_ID,
    progress_count: progressResult.data.length,
    completed_count: progressResult.data[0] ? Number(progressResult.data[0].completed_count || 0) : null,
    started_at_ms: startedAtMs,
    ended_at_ms: endedAtMs,
    elapsed_ms: endedAtMs - startedAtMs
  }
}

async function completeConcurrencyTask(event = {}) {
  const taskIndex = Number(event.task_index)
  const operatorType = event.operator_type === 'teacher' ? 'teacher' : 'guardian'
  if (!Number.isInteger(taskIndex) || taskIndex < 1 || taskIndex > 17) {
    return { success: false, code: 'CONCURRENCY_TASK_INDEX_INVALID' }
  }

  const openid = operatorType === 'teacher'
    ? CONCURRENCY_TEACHER_OPENID
    : CONCURRENCY_GUARDIAN_OPENID
  const authorization = await authorizeStudentOperator({
    db,
    openid,
    subjectId: CONCURRENCY_STUDENT_ID
  })
  if (!authorization.authorized || authorization.operator_type !== operatorType) {
    return {
      success: false,
      code: authorization.code || 'CONCURRENCY_OPERATOR_NOT_AUTHORIZED'
    }
  }

  const taskId = `${CONCURRENCY_PREFIX}_TASK_${taskIndex}`
  let transactionResult = null
  await runTransactionWithConflictRetry(async (transaction) => {
    const currentResult = await transaction
      .collection('collection_progress')
      .doc(CONCURRENCY_PROGRESS_ID)
      .get()
    const current = currentResult.data
    if (!current || current.is_test !== true || current.collection_phase !== 'concurrency_test') {
      throw new Error('CONCURRENCY_PROGRESS_NOT_FOUND')
    }
    const existingIds = Array.isArray(current.completed_task_ids)
      ? current.completed_task_ids.filter(Boolean)
      : []
    const completedIds = Array.from(new Set([...existingIds, taskId]))
      .sort((a, b) => Number(a.split('_').pop()) - Number(b.split('_').pop()))
    const alreadyCompleted = existingIds.includes(taskId)
    const completedCount = completedIds.length
    const now = db.serverDate()
    await transaction.collection('collection_progress').doc(CONCURRENCY_PROGRESS_ID).update({
      data: {
        completed_task_ids: completedIds,
        completed_tasks: completedCount,
        completed_count: completedCount,
        current_task_id: completedCount < 17 ? `${CONCURRENCY_PREFIX}_TASK_${completedCount + 1}` : '',
        status: completedCount < 17 ? 'in_progress' : 'completed',
        last_operator_user_id: authorization.operator_user_id,
        last_operator_type: authorization.operator_type,
        last_operator_teacher_subject_id: authorization.operator_teacher_subject_id || '',
        updated_at: now
      }
    })
    transactionResult = {
      success: true,
      already_completed: alreadyCompleted,
      task_id: taskId,
      completed_count: completedCount,
      operator_type: operatorType
    }
  })
  return transactionResult || { success: false, code: 'CONCURRENCY_TRANSACTION_EMPTY' }
}

async function readConcurrencyProgress() {
  const result = await db.collection('collection_progress').where({
    progress_id: CONCURRENCY_PROGRESS_ID,
    subject_id: CONCURRENCY_STUDENT_ID,
    collection_phase: 'concurrency_test',
    is_test: true
  }).limit(2).get()
  const progress = result.data[0] || null
  const ids = progress && Array.isArray(progress.completed_task_ids)
    ? progress.completed_task_ids.filter(Boolean)
    : []
  return {
    success: result.data.length === 1,
    progress_count: result.data.length,
    completed_count: progress ? Number(progress.completed_count || 0) : null,
    completed_task_id_count: ids.length,
    unique_task_id_count: new Set(ids).size,
    completed_task_ids: ids,
    status: progress ? progress.status : ''
  }
}

function validateTokens(event) {
  const codes = event.codes || {}
  const validStudentCodes = ['a', 'b', 'c'].every((key) =>
    codes[key] && typeof codes[key].code === 'string' && codes[key].bindId === `${TEST_PREFIX}_SB_${key}`
  )
  return validStudentCodes && typeof event.teacher_code === 'string'
}

exports.main = async (event = {}) => {
  const caller = await loadCaller(cloud.getWXContext().OPENID)
  if (!caller || !['teacher', 'researcher', 'admin'].includes(caller.role)) {
    return { success: false, code: 'TEST_FORBIDDEN', message: '当前账号无权执行 TEST 联合采集验收' }
  }

  try {
    const action = event.action || ''
    if (action === 'seed_base') return await seedBaseStage()
    if (action === 'seed_teachers') return await seedTeachersStage()
    if (action === 'seed_students') return await seedStudentsStage()
    if (action === 'seed_concurrency') return await seedConcurrencyStage()
    if (action === 'concurrency_read_probe') return await runConcurrencyReadProbe(event)
    if (action === 'concurrency_progress_complete') return await completeConcurrencyTask(event)
    if (action === 'concurrency_progress_read') return await readConcurrencyProgress()
    if (!validateTokens(event)) {
      return { success: false, code: 'TEST_TOKENS_REQUIRED', message: '请先完成分阶段 TEST 数据初始化' }
    }
    const { actors, students } = fixtures()
    const codes = event.codes
    const teacherCode = event.teacher_code
    if (action === 'phase_guardian_first') {
    const test1 = await bindTeacherActor(actors.teacherNew, actors.teacherNew.subjectId, teacherCode)
    const test3 = await bindGuardianActor(actors.guardianA, students.a, codes.a)
    const codeAAfterGuardian = await loadStudentCode(codes.a.bindId)
    const test4Teacher = await authorizeTeacherActor(actors.teacherA, actors.teacherA.subjectId, students.a, codes.a)
    const codeAAfterTeacher = await loadStudentCode(codes.a.bindId)
      const snapshots = await db.collection('model_snapshots').where({ subject_id: actors.teacherA.subjectId }).limit(1).get()
      return { success: true, tests: {
        test_1_teacher_code_only: test1.success === true,
        test_2_teacher_without_model_can_collect: snapshots.data.length === 0 && test4Teacher.success === true,
        test_3_guardian_code_only: test3.success === true,
        test_4_guardian_then_teacher: codeAAfterGuardian.usage_state === 'guardian_only' && codeAAfterTeacher.usage_state === 'guardian_and_teacher'
      } }
    }
    if (action === 'phase_teacher_first') {
    const test5Teacher = await authorizeTeacherActor(actors.teacherA, actors.teacherA.subjectId, students.b, codes.b)
    const codeBAfterTeacher = await loadStudentCode(codes.b.bindId)
    const test5Guardian = await bindGuardianActor(actors.guardianA, students.b, codes.b)
    const codeBAfterBoth = await loadStudentCode(codes.b.bindId)
      return { success: true, tests: {
        test_5_teacher_then_guardian: test5Teacher.success === true && codeBAfterTeacher.usage_state === 'teacher_only' && test5Guardian.success === true && codeBAfterBoth.usage_state === 'guardian_and_teacher'
      } }
    }
    if (action === 'phase_multi_access') {
    const test6 = await bindGuardianActor(actors.guardianB, students.a, codes.a)
    const beforeRepeat = await loadStudentCode(codes.a.bindId)
    const test7 = await authorizeTeacherActor(actors.teacherA, actors.teacherA.subjectId, students.a, codes.a)
    const afterRepeat = await loadStudentCode(codes.a.bindId)
    const test8 = await authorizeTeacherActor(actors.teacherB, actors.teacherB.subjectId, students.a, codes.a)
    const codeAAfterTeacherB = await loadStudentCode(codes.a.bindId)
    const test9 = await authorizeTeacherActor(actors.teacherCross, actors.teacherCross.subjectId, students.a, codes.a)
    const test10SecondStudent = await authorizeTeacherActor(actors.teacherA, actors.teacherA.subjectId, students.c, codes.c)
    const teacherAAccesses = await db.collection('teacher_student_collection_access').where({ teacher_subject_id: actors.teacherA.subjectId, status: 'active' }).get()
      const accessA = await db.collection('teacher_student_collection_access').where({ student_subject_id: students.a.subjectId, status: 'active' }).get()
      return { success: true, tests: {
        test_6_second_guardian_rejected: test6.success === false && test6.code === 'STUDENT_ALREADY_BOUND',
        test_7_teacher_repeat_idempotent: test7.success === true && test7.idempotent === true && beforeRepeat.teacher_access_count === afterRepeat.teacher_access_count,
        test_8_two_teachers_same_student: test8.success === true && codeAAfterTeacherB.teacher_access_count === 2 && accessA.data.length === 2,
        test_9_cross_class_teacher_rejected: test9.success === false && test9.code === 'TEACHER_STUDENT_CLASS_NOT_SHARED',
        test_10_one_teacher_multiple_students: test10SecondStudent.success === true && teacherAAccesses.data.length >= 2
      } }
    }
    if (action === 'phase_operator_progress') {
    const [guardianAuth, teacherAAuth, teacherBAuth] = await Promise.all([
      authorizeStudentOperator({ db, openid: actors.guardianA.openid, subjectId: students.a.subjectId }),
      authorizeStudentOperator({ db, openid: actors.teacherA.openid, subjectId: students.a.subjectId }),
      authorizeStudentOperator({ db, openid: actors.teacherB.openid, subjectId: students.a.subjectId })
    ])
    const sharedProgress = await verifySharedProgress(
      students.a.subjectId,
      actors.guardianA.userId,
      actors.teacherA.userId,
      actors.teacherA.subjectId
    )
      const tests = {
      guardian_operator_authorized: guardianAuth.authorized === true && guardianAuth.operator_type === 'guardian',
      teacher_a_operator_authorized: teacherAAuth.authorized === true && teacherAAuth.operator_type === 'teacher',
      teacher_b_operator_authorized: teacherBAuth.authorized === true && teacherBAuth.operator_type === 'teacher',
      progress_is_shared: Object.values(sharedProgress).every(Boolean)
      }
      return { success: Object.values(tests).every(Boolean), tests, progress: sharedProgress }
    }
    return { success: false, code: 'INVALID_TEST_ACTION', message: '未知 TEST 动作' }
  } catch (error) {
    console.error('verifyJointStudentCollectionMvp error:', error)
    return { success: false, code: 'TEST_RUN_FAILED', message: error.message || 'TEST 验收失败' }
  }
}
