const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const SUBJECT_CONFIG = {
  teacher: {
    framework: 'teacher_v1.0',
    code_collection: 'teacher_bind_codes',
    membership_role: 'teacher'
  },
  student: {
    framework: 'student_v1.0',
    code_collection: 'student_bind_codes',
    membership_role: 'student'
  }
}
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000
const ATTEMPT_LOCK_MS = 15 * 60 * 1000
const MAX_FAILED_ATTEMPTS = 8

function normalizeText(value) {
  return typeof value === 'string' ? value.normalize('NFKC').trim() : ''
}

function normalizeBindCode(value) {
  return normalizeText(value).toUpperCase().replace(/[\s-]+/g, '')
}

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex')
}

function deterministicDocId(prefix, value) {
  return `${prefix}_${sha256(value).slice(0, 24).toUpperCase()}`
}

function asDate(value) {
  if (value === null || value === undefined || value === '') return null
  const raw = value && value.$date ? value.$date : value
  const date = raw instanceof Date ? raw : new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date
}

function codeHasExpired(record) {
  const expiresAt = asDate(record && record.expires_at)
  return Boolean(expiresAt && expiresAt.getTime() <= Date.now())
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

function codeStatusError(status) {
  if (status === 'used') return { code: 'BIND_CODE_USED', message: '该教师绑定码已经使用' }
  if (status === 'revoked') return { code: 'BIND_CODE_REVOKED', message: '该绑定码已经撤销' }
  if (status === 'expired') return { code: 'BIND_CODE_EXPIRED', message: '该绑定码已经过期' }
  return { code: 'BIND_CODE_NOT_AVAILABLE', message: '该绑定码当前不可用' }
}

function studentCodeGloballyAvailable(record) {
  return record && !['revoked', 'expired'].includes(record.status)
}

function deriveStudentUsage(record, guardianBound) {
  if (['unused', 'guardian_only', 'teacher_only', 'guardian_and_teacher'].includes(record.usage_state)) {
    return record.usage_state
  }
  if (guardianBound || record.status === 'used') return 'guardian_only'
  return 'unused'
}

function addGuardianUsage(usageState) {
  if (usageState === 'teacher_only') return 'guardian_and_teacher'
  if (usageState === 'guardian_and_teacher') return 'guardian_and_teacher'
  return 'guardian_only'
}

async function recordFailedAttempt(user) {
  if (!user || !user._id) return
  try {
    await db.runTransaction(async (transaction) => {
      const currentResult = await transaction.collection('users').doc(user._id).get()
      const current = currentResult.data || {}
      const nowMs = Date.now()
      const startedAt = asDate(current.bind_attempt_window_started_at)
      const withinWindow = startedAt && nowMs - startedAt.getTime() < ATTEMPT_WINDOW_MS
      const failedCount = withinWindow
        ? Number(current.bind_failed_attempt_count || 0) + 1
        : 1
      const update = {
        bind_attempt_window_started_at: withinWindow
          ? current.bind_attempt_window_started_at
          : new Date(nowMs),
        bind_failed_attempt_count: failedCount,
        updated_at: db.serverDate()
      }
      if (failedCount >= MAX_FAILED_ATTEMPTS) {
        update.bind_attempt_locked_until = new Date(nowMs + ATTEMPT_LOCK_MS)
      }
      await transaction.collection('users').doc(user._id).update({ data: update })
    })
  } catch (error) {
    console.warn('recordFailedAttempt skipped:', error && error.message)
  }
}

async function clearFailedAttempts(user) {
  if (!user || !user._id) return
  await db.collection('users').doc(user._id).update({
    data: {
      bind_failed_attempt_count: 0,
      bind_attempt_window_started_at: null,
      bind_attempt_locked_until: null,
      updated_at: db.serverDate()
    }
  })
}

function rateLimitError(user) {
  const lockedUntil = asDate(user && user.bind_attempt_locked_until)
  if (lockedUntil && lockedUntil.getTime() > Date.now()) {
    return {
      success: false,
      code: 'BIND_ATTEMPTS_RATE_LIMITED',
      message: '绑定尝试过于频繁，请稍后再试'
    }
  }
  return null
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
  if (subjectResult.data.length !== 1) return { error: `${subjectType.toUpperCase()}_SUBJECT_NOT_FOUND` }
  const subject = subjectResult.data[0]
  if (subject.status !== 'active' || subject.model_framework !== config.framework) {
    return { error: `${subjectType.toUpperCase()}_SUBJECT_NOT_ACTIVE` }
  }
  if (membershipResult.data.length !== 1) {
    return { error: `${subjectType.toUpperCase()}_CLASS_MEMBERSHIP_INVALID` }
  }
  return { subject, membership: membershipResult.data[0] }
}

async function normalizeStudentCodeForGuardian(bindRecord, userId, bindingId, usageState) {
  await db.collection('student_bind_codes').doc(bindRecord._id).update({
    data: {
      status: 'active',
      usage_state: addGuardianUsage(usageState),
      guardian_bound: true,
      guardian_bound_at: bindRecord.guardian_bound_at || db.serverDate(),
      last_used_at: db.serverDate(),
      used_at: bindRecord.used_at || db.serverDate(),
      used_by_user_id: bindRecord.used_by_user_id || userId,
      used_binding_id: bindRecord.used_binding_id || bindingId,
      updated_at: db.serverDate()
    }
  })
}

async function bindStudent(bindRecord, user, subject) {
  const activeResult = await db.collection('guardian_student_bindings').where({
    subject_id: bindRecord.subject_id,
    status: 'active'
  }).limit(2).get()
  if (activeResult.data.length > 1) {
    return { success: false, code: 'DUPLICATE_ACTIVE_GUARDIAN_BINDINGS', message: '学生绑定关系异常，请联系研究团队' }
  }

  const existing = activeResult.data[0] || null
  const usageState = deriveStudentUsage(bindRecord, Boolean(existing))
  if (existing) {
    if (existing.user_id !== user.user_id) {
      return { success: false, code: 'STUDENT_ALREADY_BOUND', message: '该学生已经由其他微信用户绑定' }
    }
    if (!studentCodeGloballyAvailable(bindRecord) && bindRecord.status !== 'used') {
      return { success: false, ...codeStatusError(bindRecord.status) }
    }
    await normalizeStudentCodeForGuardian(
      bindRecord,
      user.user_id,
      existing.binding_id || existing._id || '',
      usageState
    )
    return successResult('student', existing, subject, true, {
      bind_status: 'active',
      usage_state: addGuardianUsage(usageState)
    })
  }

  if (!studentCodeGloballyAvailable(bindRecord) || bindRecord.status === 'used') {
    return { success: false, ...codeStatusError(bindRecord.status) }
  }

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
      const currentResult = await transaction.collection('student_bind_codes').doc(bindRecord._id).get()
      const current = currentResult.data
      if (!studentCodeGloballyAvailable(current) || current.status === 'used') {
        throw new Error('BIND_CODE_STATE_CHANGED')
      }
      const currentUsage = deriveStudentUsage(current, false)
      await transaction.collection('guardian_student_bindings').add({ data: bindingData })
      await transaction.collection('student_bind_codes').doc(bindRecord._id).update({
        data: {
          status: 'active',
          usage_state: addGuardianUsage(currentUsage),
          guardian_bound: true,
          guardian_bound_at: db.serverDate(),
          last_used_at: db.serverDate(),
          used_at: current.used_at || db.serverDate(),
          used_by_user_id: current.used_by_user_id || user.user_id,
          used_binding_id: current.used_binding_id || bindingId,
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

  return successResult('student', bindingData, subject, false, {
    bind_status: 'active',
    usage_state: addGuardianUsage(usageState)
  })
}

async function bindTeacher(bindRecord, user, subject) {
  const [subjectMaps, userMaps] = await Promise.all([
    db.collection('identity_map').where({
      subject_id: bindRecord.subject_id,
      identity_type: 'teacher'
    }).limit(3).get(),
    db.collection('identity_map').where({
      user_id: user.user_id,
      identity_type: 'teacher'
    }).limit(3).get()
  ])
  const activeSubjectMaps = subjectMaps.data.filter((item) => item.status !== 'revoked')
  const activeUserMaps = userMaps.data.filter((item) => item.status !== 'revoked')
  if (activeSubjectMaps.length > 1 || activeUserMaps.length > 1) {
    return { success: false, code: 'DUPLICATE_TEACHER_BINDINGS', message: '教师绑定关系异常，请联系研究团队' }
  }
  const subjectMap = activeSubjectMaps[0] || null
  const userMap = activeUserMaps[0] || null
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
        const current = await transaction.collection('teacher_bind_codes').doc(bindRecord._id).get()
        if (!current.data || current.data.status !== 'unused') throw new Error('BIND_CODE_STATE_CHANGED')
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
      const current = await transaction.collection('teacher_bind_codes').doc(bindRecord._id).get()
      if (!current.data || current.data.status !== 'unused') throw new Error('BIND_CODE_STATE_CHANGED')
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
  const normalizedCode = normalizeBindCode(event.bind_code)

  if (!openid) return { success: false, code: 'NO_OPENID', message: '未获取到微信用户标识' }
  if (!config) return { success: false, code: 'INVALID_SUBJECT_TYPE', message: '绑定主体类型无效' }
  if (!normalizedCode) return { success: false, code: 'INVALID_INPUT', message: '请输入绑定码' }
  if (normalizedCode.length < 10 || normalizedCode.length > 32) {
    return { success: false, code: 'INVALID_BIND_CREDENTIALS', message: '绑定码不正确' }
  }

  try {
    const user = await getCurrentUser(openid)
    if (!user || user.status !== 'active') {
      return { success: false, code: 'USER_NOT_ACTIVE', message: '当前用户不存在或不可用，请重新登录' }
    }
    const rateLimited = rateLimitError(user)
    if (rateLimited) return rateLimited

    const codeResult = await db.collection(config.code_collection)
      .where({ bind_code_hash: sha256(normalizedCode) })
      .limit(2)
      .get()
    if (codeResult.data.length !== 1) {
      await recordFailedAttempt(user)
      return {
        success: false,
        code: codeResult.data.length > 1 ? 'DUPLICATE_BIND_CODE' : 'INVALID_BIND_CREDENTIALS',
        message: codeResult.data.length > 1 ? '绑定码数据异常，请联系研究团队' : '绑定码不正确'
      }
    }

    const bindRecord = codeResult.data[0]
    if (codeHasExpired(bindRecord)) {
      return { success: false, code: 'BIND_CODE_EXPIRED', message: '该绑定码已经过期' }
    }
    if (bindRecord.subject_type && bindRecord.subject_type !== subjectType) {
      await recordFailedAttempt(user)
      return { success: false, code: 'INVALID_BIND_CREDENTIALS', message: '绑定码不正确' }
    }
    const validated = await loadValidatedSubject(bindRecord, subjectType, config)
    if (validated.error) {
      return { success: false, code: validated.error, message: '研究主体或班级关系不存在、异常或当前不可用' }
    }

    const result = subjectType === 'teacher'
      ? await bindTeacher(bindRecord, user, validated.subject)
      : await bindStudent(bindRecord, user, validated.subject)
    if (result.success) await clearFailedAttempts(user)
    return result
  } catch (error) {
    console.error('bindSubjectByCode error:', error)
    return { success: false, code: 'BIND_SUBJECT_ERROR', message: '绑定失败，请重试' }
  }
}
