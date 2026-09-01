function isActiveRecord(record) {
  return Boolean(record && record.status !== 'revoked' && record.status !== 'inactive')
}

async function getSingle(db, collectionName, where, duplicateCode) {
  const result = await db.collection(collectionName).where(where).limit(2).get()

  if (result.data.length > 1) {
    return {
      error: duplicateCode,
      message: '授权关系存在重复，请联系研究团队'
    }
  }

  return { record: result.data[0] || null }
}

async function loadActiveTeacherMapping(db, userId) {
  const result = await db.collection('identity_map').where({
    user_id: userId,
    identity_type: 'teacher'
  }).limit(3).get()
  const active = result.data.filter(isActiveRecord)

  if (active.length > 1) {
    return {
      error: 'DUPLICATE_TEACHER_BINDINGS',
      message: '教师主体绑定关系异常，请联系研究团队'
    }
  }

  return { record: active[0] || null }
}

async function loadSharedOrganization(db, teacherSubjectId, studentSubjectId, preferredClassId = '') {
  const [teacherMemberships, studentMemberships] = await Promise.all([
    db.collection('class_memberships').where({
      subject_id: teacherSubjectId,
      subject_type: 'teacher',
      membership_role: 'teacher',
      status: 'active'
    }).limit(100).get(),
    db.collection('class_memberships').where({
      subject_id: studentSubjectId,
      subject_type: 'student',
      membership_role: 'student',
      status: 'active'
    }).limit(100).get()
  ])
  const studentClassIds = new Set(studentMemberships.data.map((item) => item.class_id))
  const sharedClassIds = teacherMemberships.data
    .map((item) => item.class_id)
    .filter((classId) => classId && studentClassIds.has(classId))
    .sort()
  if (preferredClassId && sharedClassIds.includes(preferredClassId)) {
    sharedClassIds.splice(sharedClassIds.indexOf(preferredClassId), 1)
    sharedClassIds.unshift(preferredClassId)
  }

  for (const classId of sharedClassIds) {
    const classResult = await getSingle(
      db,
      'classes',
      { class_id: classId, status: 'active' },
      'DUPLICATE_ACTIVE_CLASSES'
    )
    if (classResult.error || !classResult.record) continue

    const schoolResult = await getSingle(
      db,
      'schools',
      { school_id: classResult.record.school_id, status: 'active' },
      'DUPLICATE_ACTIVE_SCHOOLS'
    )
    if (schoolResult.error || !schoolResult.record) continue

    return {
      class_id: classId,
      class_name: classResult.record.class_name || classResult.record.display_name || '',
      school_id: schoolResult.record.school_id,
      school_name: schoolResult.record.school_name || schoolResult.record.display_name || ''
    }
  }

  return null
}

async function authorizeStudentOperator(options = {}) {
  const db = options.db
  const openid = typeof options.openid === 'string' ? options.openid.trim() : ''
  const subjectId = typeof options.subjectId === 'string' ? options.subjectId.trim() : ''
  const allowResearcher = options.allowResearcher === true

  if (!db || !openid || !subjectId) {
    return {
      authorized: false,
      code: !openid ? 'NO_OPENID' : 'STUDENT_SUBJECT_ID_REQUIRED',
      message: !openid ? '未获取到微信用户标识' : '缺少学生研究主体编号'
    }
  }

  const [userResult, subjectResult] = await Promise.all([
    getSingle(db, 'users', { openid, status: 'active' }, 'DUPLICATE_ACTIVE_USERS'),
    getSingle(db, 'subjects', {
      subject_id: subjectId,
      subject_type: 'student',
      model_framework: 'student_v1.0',
      status: 'active'
    }, 'DUPLICATE_ACTIVE_STUDENT_SUBJECTS')
  ])

  if (userResult.error) {
    return { authorized: false, code: userResult.error, message: userResult.message }
  }
  if (!userResult.record) {
    return { authorized: false, code: 'USER_NOT_ACTIVE', message: '当前用户不存在或不可用' }
  }
  if (subjectResult.error) {
    return { authorized: false, code: subjectResult.error, message: subjectResult.message }
  }
  if (!subjectResult.record) {
    return { authorized: false, code: 'STUDENT_SUBJECT_NOT_ACTIVE', message: '学生研究主体不存在或已失效' }
  }

  const user = userResult.record
  const subject = subjectResult.record
  const guardianResult = await getSingle(db, 'guardian_student_bindings', {
    user_id: user.user_id,
    subject_id: subjectId,
    status: 'active'
  }, 'DUPLICATE_ACTIVE_GUARDIAN_BINDINGS')

  if (guardianResult.error) {
    return { authorized: false, code: guardianResult.error, message: guardianResult.message }
  }
  if (guardianResult.record) {
    return {
      authorized: true,
      operator_type: 'guardian',
      operator_user_id: user.user_id,
      operator_teacher_subject_id: '',
      student_subject_id: subjectId,
      user,
      subject,
      binding: guardianResult.record,
      shared_organization: null
    }
  }

  if (allowResearcher && ['researcher', 'admin'].includes(user.role)) {
    return {
      authorized: true,
      operator_type: 'researcher',
      operator_user_id: user.user_id,
      operator_teacher_subject_id: '',
      student_subject_id: subjectId,
      user,
      subject,
      binding: null,
      shared_organization: null
    }
  }

  const teacherMapping = await loadActiveTeacherMapping(db, user.user_id)
  if (teacherMapping.error) {
    return { authorized: false, code: teacherMapping.error, message: teacherMapping.message }
  }
  if (!teacherMapping.record) {
    return {
      authorized: false,
      code: 'STUDENT_OPERATOR_NOT_AUTHORIZED',
      message: '当前微信没有该学生的有效采集权限'
    }
  }

  const teacherSubjectId = teacherMapping.record.subject_id
  const teacherSubjectResult = await getSingle(db, 'subjects', {
    subject_id: teacherSubjectId,
    subject_type: 'teacher',
    model_framework: 'teacher_v1.0',
    status: 'active'
  }, 'DUPLICATE_ACTIVE_TEACHER_SUBJECTS')

  if (teacherSubjectResult.error || !teacherSubjectResult.record) {
    return {
      authorized: false,
      code: teacherSubjectResult.error || 'TEACHER_SUBJECT_NOT_ACTIVE',
      message: teacherSubjectResult.message || '当前教师主体不存在或已失效'
    }
  }

  const accessResult = await getSingle(db, 'teacher_student_collection_access', {
    user_id: user.user_id,
    teacher_subject_id: teacherSubjectId,
    student_subject_id: subjectId,
    status: 'active'
  }, 'DUPLICATE_ACTIVE_TEACHER_STUDENT_ACCESS')

  if (accessResult.error) {
    return { authorized: false, code: accessResult.error, message: accessResult.message }
  }
  if (!accessResult.record) {
    return {
      authorized: false,
      code: 'TEACHER_STUDENT_ACCESS_NOT_ACTIVE',
      message: '当前教师尚未获得该学生的采集权限'
    }
  }

  const sharedOrganization = await loadSharedOrganization(
    db,
    teacherSubjectId,
    subjectId,
    accessResult.record.class_id || ''
  )
  if (!sharedOrganization) {
    return {
      authorized: false,
      code: 'TEACHER_STUDENT_CLASS_NOT_SHARED',
      message: '教师与学生当前没有共同的有效班级'
    }
  }

  if (
    accessResult.record.class_id &&
    accessResult.record.class_id !== sharedOrganization.class_id
  ) {
    return {
      authorized: false,
      code: 'TEACHER_STUDENT_ACCESS_CLASS_CHANGED',
      message: '教师学生采集权限与当前班级关系不一致，请重新授权'
    }
  }

  return {
    authorized: true,
    operator_type: 'teacher',
    operator_user_id: user.user_id,
    operator_teacher_subject_id: teacherSubjectId,
    student_subject_id: subjectId,
    user,
    subject,
    binding: accessResult.record,
    teacher_subject: teacherSubjectResult.record,
    shared_organization: sharedOrganization
  }
}

function operatorFields(authorization) {
  return {
    operator_user_id: authorization.operator_user_id,
    operator_type: authorization.operator_type,
    operator_teacher_subject_id: authorization.operator_teacher_subject_id || ''
  }
}

module.exports = {
  authorizeStudentOperator,
  loadActiveTeacherMapping,
  loadSharedOrganization,
  operatorFields
}
