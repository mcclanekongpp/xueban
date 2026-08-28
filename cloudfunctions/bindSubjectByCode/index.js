const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const SUBJECT_CONFIG = {
  teacher: {
    framework: 'teacher_v1.0',
    code_collection: 'teacher_bind_codes',
    no_hash_field: 'teacher_no_hash',
    membership_role: 'teacher'
  },
  student: {
    framework: 'student_v1.0',
    code_collection: 'student_bind_codes',
    no_hash_field: 'student_no_hash',
    membership_role: 'student'
  }
}

function normalizeText(value) {
  return typeof value === 'string' ? value.normalize('NFKC').trim() : ''
}

function normalizeBindCode(value) {
  return normalizeText(value).toUpperCase().replace(/[\s-]+/g, '')
}

function normalizeSubjectNo(value) {
  return normalizeText(value).toUpperCase().replace(/\s+/g, '')
}

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex')
}

function subjectNoHash(schoolId, normalizedSubjectNo) {
  return sha256(`${schoolId}\n${normalizedSubjectNo}`)
}

function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const leftBuffer = Buffer.from(left, 'utf8')
  const rightBuffer = Buffer.from(right, 'utf8')
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function deterministicDocId(prefix, value) {
  return `${prefix}_${sha256(value).slice(0, 24).toUpperCase()}`
}

async function getCurrentUser(openid) {
  const result = await db.collection('users').where({ openid }).limit(2).get()
  return result.data.length === 1 ? result.data[0] : null
}

function safeSubject(subject) {
  return {
    subject_id: subject.subject_id,
    subject_type: subject.subject_type,
    framework: subject.model_framework,
    model_framework: subject.model_framework,
    current_version: subject.current_version || '',
    status: subject.status,
    research_alias: subject.research_alias || ''
  }
}

function successResult(subjectType, binding, subject, idempotent, extra = {}) {
  const safe = safeSubject(subject)
  return {
    success: true,
    idempotent: idempotent === true,
    subject_type: subjectType,
    binding: {
      binding_id: binding.binding_id || binding._id || '',
      subject_id: binding.subject_id,
      status: binding.status || 'active',
      bound_at: binding.bound_at || binding.created_at || null
    },
    subject: safe,
    [subjectType]: safe,
    ...extra
  }
}

async function loadValidatedSubject(bindRecord, subjectType, config) {
  const [subjectResult, membershipResult] = await Promise.all([
    db.collection('subjects').where({
      subject_id: bindRecord.subject_id,
      subject_type: subjectType
    }).limit(2).get(),
    db.collection('class_memberships').where({
      class_id: bindRecord.class_id,
      subject_id: bindRecord.subject_id,
      subject_type: subjectType,
      membership_role: config.membership_role,
      status: 'active'
    }).limit(2).get()
  ])

  if (subjectResult.data.length !== 1) {
    return { error: `${subjectType.toUpperCase()}_SUBJECT_NOT_FOUND` }
  }

  const subject = subjectResult.data[0]
  if (subject.status !== 'active' || subject.model_framework !== config.framework) {
    return { error: `${subjectType.toUpperCase()}_SUBJECT_NOT_ACTIVE` }
  }

  if (membershipResult.data.length !== 1) {
    return { error: `${subjectType.toUpperCase()}_CLASS_MEMBERSHIP_INVALID` }
  }

  return { subject, membership: membershipResult.data[0] }
}

function codeStatusError(status) {
  if (status === 'used') return { code: 'BIND_CODE_USED', message: '该绑定码已经使用' }
  if (status === 'revoked') return { code: 'BIND_CODE_REVOKED', message: '该绑定码已经撤销' }
  return { code: 'BIND_CODE_NOT_AVAILABLE', message: '该绑定码当前不可用' }
}

async function bindStudent(bindRecord, user, subject) {
  const activeResult = await db.collection('guardian_student_bindings').where({
    subject_id: bindRecord.subject_id,
    status: 'active'
  }).limit(2).get()

  if (activeResult.data.length > 1) {
    return { success: false, code: 'DUPLICATE_ACTIVE_GUARDIAN_BINDINGS', message: '学生绑定关系异常，请联系研究团队' }
  }

  if (activeResult.data.length === 1) {
    const existing = activeResult.data[0]
    if (existing.user_id === user.user_id) return successResult('student', existing, subject, true)
    return { success: false, code: 'STUDENT_ALREADY_BOUND', message: '该学生已经由其他微信用户绑定' }
  }

  if (bindRecord.status !== 'unused') return { success: false, ...codeStatusError(bindRecord.status) }

  const bindingDocId = deterministicDocId('GUARDIAN_STUDENT', bindRecord.subject_id)
  const bindingId = deterministicDocId('GSB', bindRecord.subject_id)
  const bindingData = {
    _id: bindingDocId,
    binding_id: bindingId,
    user_id: user.user_id,
    subject_id: bindRecord.subject_id,
    subject_type: 'student',
    operator_role: 'guardian',
    source_bind_id: bindRecord.bind_id,
    status: 'active',
    is_test: bindRecord.is_test === true,
    bound_at: db.serverDate(),
    revoked_at: null,
    created_at: db.serverDate(),
    updated_at: db.serverDate()
  }

  try {
    await db.runTransaction(async (transaction) => {
      const currentCode = await transaction.collection('student_bind_codes').doc(bindRecord._id).get()
      if (!currentCode.data || currentCode.data.status !== 'unused') throw new Error('BIND_CODE_STATE_CHANGED')

      await transaction.collection('guardian_student_bindings').add({ data: bindingData })
      await transaction.collection('student_bind_codes').doc(bindRecord._id).update({
        data: {
          status: 'used',
          used_at: db.serverDate(),
          used_by_user_id: user.user_id,
          used_binding_id: bindingId,
          updated_at: db.serverDate()
        }
      })
    })
  } catch (error) {
    const latest = await db.collection('guardian_student_bindings').where({
      subject_id: bindRecord.subject_id,
      status: 'active'
    }).limit(2).get()
    if (latest.data.length === 1 && latest.data[0].user_id === user.user_id) {
      return successResult('student', latest.data[0], subject, true)
    }
    throw error
  }

  return successResult('student', bindingData, subject, false)
}

async function bindTeacher(bindRecord, user, subject) {
  const [subjectMaps, userMaps] = await Promise.all([
    db.collection('identity_map').where({
      subject_id: bindRecord.subject_id,
      identity_type: 'teacher'
    }).limit(2).get(),
    db.collection('identity_map').where({
      user_id: user.user_id,
      identity_type: 'teacher'
    }).limit(2).get()
  ])

  if (subjectMaps.data.length > 1 || userMaps.data.length > 1) {
    return { success: false, code: 'DUPLICATE_TEACHER_BINDINGS', message: '教师绑定关系异常，请联系研究团队' }
  }

  const subjectMap = subjectMaps.data[0] || null
  const userMap = userMaps.data[0] || null

  if (subjectMap && subjectMap.user_id !== user.user_id) {
    return { success: false, code: 'TEACHER_ALREADY_BOUND', message: '该教师已经由其他微信用户绑定' }
  }

  if (userMap && userMap.subject_id !== bindRecord.subject_id) {
    return { success: false, code: 'USER_ALREADY_BOUND_TO_TEACHER', message: '当前微信已经绑定其他教师主体' }
  }

  if (Boolean(subjectMap) !== Boolean(userMap)) {
    return { success: false, code: 'TEACHER_BINDING_INCONSISTENT', message: '教师绑定关系异常，请联系研究团队' }
  }

  if (subjectMap && userMap) {
    if (bindRecord.status === 'unused') {
      await db.runTransaction(async (transaction) => {
        const currentCode = await transaction.collection('teacher_bind_codes').doc(bindRecord._id).get()
        if (!currentCode.data || currentCode.data.status !== 'unused') throw new Error('BIND_CODE_STATE_CHANGED')
        await transaction.collection('teacher_bind_codes').doc(bindRecord._id).update({
          data: {
            status: 'used',
            used_at: db.serverDate(),
            used_by_user_id: user.user_id,
            used_binding_id: subjectMap.binding_id || subjectMap._id || '',
            updated_at: db.serverDate()
          }
        })
        if (user.role !== 'teacher') {
          await transaction.collection('users').doc(user._id).update({
            data: { role: 'teacher', updated_at: db.serverDate() }
          })
        }
      })
    } else if (bindRecord.status !== 'used') {
      return { success: false, ...codeStatusError(bindRecord.status) }
    }
    return successResult('teacher', subjectMap, subject, true, { user_role: 'teacher' })
  }

  if (bindRecord.status !== 'unused') return { success: false, ...codeStatusError(bindRecord.status) }

  if (!['unassigned', 'guardian', 'teacher'].includes(user.role)) {
    return { success: false, code: 'TEACHER_BINDING_ROLE_FORBIDDEN', message: '当前账号不能绑定教师主体' }
  }

  const bindingDocId = deterministicDocId('TEACHER_SUBJECT_BINDING', bindRecord.subject_id)
  const bindingId = deterministicDocId('TSB', bindRecord.subject_id)
  const bindingData = {
    _id: bindingDocId,
    binding_id: bindingId,
    user_id: user.user_id,
    subject_id: bindRecord.subject_id,
    identity_type: 'teacher',
    subject_type: 'teacher',
    operator_role: 'teacher',
    source_bind_id: bindRecord.bind_id,
    school_id: bindRecord.school_id,
    class_id: bindRecord.class_id,
    status: 'active',
    is_test: bindRecord.is_test === true,
    bound_at: db.serverDate(),
    revoked_at: null,
    created_at: db.serverDate(),
    updated_at: db.serverDate()
  }

  try {
    await db.runTransaction(async (transaction) => {
      const currentCode = await transaction.collection('teacher_bind_codes').doc(bindRecord._id).get()
      if (!currentCode.data || currentCode.data.status !== 'unused') throw new Error('BIND_CODE_STATE_CHANGED')

      await transaction.collection('identity_map').add({ data: bindingData })
      await transaction.collection('users').doc(user._id).update({
        data: { role: 'teacher', updated_at: db.serverDate() }
      })
      await transaction.collection('teacher_bind_codes').doc(bindRecord._id).update({
        data: {
          status: 'used',
          used_at: db.serverDate(),
          used_by_user_id: user.user_id,
          used_binding_id: bindingId,
          updated_at: db.serverDate()
        }
      })
    })
  } catch (error) {
    const latest = await db.collection('identity_map').where({
      subject_id: bindRecord.subject_id,
      identity_type: 'teacher'
    }).limit(2).get()
    if (latest.data.length === 1 && latest.data[0].user_id === user.user_id) {
      return successResult('teacher', latest.data[0], subject, true, { user_role: 'teacher' })
    }
    throw error
  }

  return successResult('teacher', bindingData, subject, false, { user_role: 'teacher' })
}

exports.main = async (event = {}) => {
  const openid = cloud.getWXContext().OPENID
  const subjectType = normalizeText(event.subject_type).toLowerCase()
  const config = SUBJECT_CONFIG[subjectType]

  if (!openid) return { success: false, code: 'NO_OPENID', message: '未获取到微信用户标识' }
  if (!config) return { success: false, code: 'INVALID_SUBJECT_TYPE', message: '绑定主体类型无效' }

  // 前端只能提交主体类型、明文绑定码和线下编号，不能提交 user_id 或 subject_id。
  const normalizedCode = normalizeBindCode(event.bind_code)
  const normalizedNo = normalizeSubjectNo(
    event.subject_no || event.teacher_no || event.student_no
  )

  if (!normalizedCode || !normalizedNo) {
    return { success: false, code: 'INVALID_INPUT', message: '请输入绑定码和线下编号' }
  }

  if (normalizedCode.length < 8 || normalizedCode.length > 32 || normalizedNo.length > 64) {
    return { success: false, code: 'INVALID_BIND_CREDENTIALS', message: '绑定码或线下编号不正确' }
  }

  try {
    const user = await getCurrentUser(openid)
    if (!user || user.status !== 'active') {
      return { success: false, code: 'USER_NOT_ACTIVE', message: '当前用户不存在或不可用，请重新登录' }
    }

    const codeResult = await db.collection(config.code_collection)
      .where({ bind_code_hash: sha256(normalizedCode) })
      .limit(2)
      .get()

    if (codeResult.data.length !== 1) {
      return {
        success: false,
        code: codeResult.data.length > 1 ? 'DUPLICATE_BIND_CODE' : 'INVALID_BIND_CREDENTIALS',
        message: codeResult.data.length > 1 ? '绑定码数据异常，请联系研究团队' : '绑定码或线下编号不正确'
      }
    }

    const bindRecord = codeResult.data[0]
    if (
      (bindRecord.subject_type && bindRecord.subject_type !== subjectType) ||
      !safeEqual(
        subjectNoHash(bindRecord.school_id, normalizedNo),
        bindRecord[config.no_hash_field]
      )
    ) {
      return { success: false, code: 'INVALID_BIND_CREDENTIALS', message: '绑定码或线下编号不正确' }
    }

    const validated = await loadValidatedSubject(bindRecord, subjectType, config)
    if (validated.error) {
      return { success: false, code: validated.error, message: '研究主体或班级关系不存在、异常或当前不可用' }
    }

    return subjectType === 'teacher'
      ? await bindTeacher(bindRecord, user, validated.subject)
      : await bindStudent(bindRecord, user, validated.subject)
  } catch (error) {
    console.error('bindSubjectByCode error:', error)
    return { success: false, code: 'BIND_SUBJECT_ERROR', message: '绑定失败，请重试' }
  }
}
