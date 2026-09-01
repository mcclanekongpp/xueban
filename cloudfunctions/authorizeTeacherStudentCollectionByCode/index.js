const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const {
  loadActiveTeacherMapping,
  loadSharedOrganization
} = require('./student-operator-auth')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
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

function codeAvailable(record) {
  if (!record || ['revoked', 'expired'].includes(record.status)) return false
  const expiresAt = asDate(record.expires_at)
  return !expiresAt || expiresAt.getTime() > Date.now()
}

function deriveUsage(record, guardianBound) {
  if (['unused', 'guardian_only', 'teacher_only', 'guardian_and_teacher'].includes(record.usage_state)) {
    return record.usage_state
  }
  if (guardianBound || record.status === 'used') return 'guardian_only'
  return 'unused'
}

function addTeacherUsage(usageState) {
  if (usageState === 'guardian_only') return 'guardian_and_teacher'
  if (usageState === 'guardian_and_teacher') return 'guardian_and_teacher'
  return 'teacher_only'
}

async function getCurrentUser(openid) {
  const result = await db.collection('users').where({ openid, status: 'active' }).limit(2).get()
  return result.data.length === 1 ? result.data[0] : null
}

function safeStudent(subject) {
  return {
    subject_id: subject.subject_id,
    subject_type: 'student',
    framework: 'student_v1.0',
    status: subject.status,
    research_alias: subject.research_alias || ''
  }
}

function asDate(value) {
  const raw = value && value.$date ? value.$date : value
  const date = raw instanceof Date ? raw : new Date(raw || 0)
  return Number.isNaN(date.getTime()) ? null : date
}

async function recordFailedAttempt(user) {
  await db.runTransaction(async (transaction) => {
    const currentResult = await transaction.collection('users').doc(user._id).get()
    const current = currentResult.data || {}
    const nowMs = Date.now()
    const startedAt = asDate(current.bind_attempt_window_started_at)
    const withinWindow = startedAt && nowMs - startedAt.getTime() < ATTEMPT_WINDOW_MS
    const failedCount = withinWindow ? Number(current.bind_failed_attempt_count || 0) + 1 : 1
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
}

async function loadProgress(subjectId) {
  const result = await db.collection('collection_progress').where({
    subject_id: subjectId,
    subject_type: 'student',
    framework: 'student_v1.0',
    collection_phase: 'initial'
  }).limit(2).get()
  if (result.data.length > 1) return { error: 'DUPLICATE_STUDENT_COLLECTION_PROGRESS' }
  const progress = result.data[0] || null
  return {
    progress: progress
      ? {
          progress_id: progress.progress_id || progress._id || '',
          completed_tasks: Number(progress.completed_tasks || progress.completed_count || 0),
          total_tasks: 17,
          current_task_id: progress.current_task_id || '',
          status: progress.status || 'not_started'
        }
      : {
          progress_id: '',
          completed_tasks: 0,
          total_tasks: 17,
          current_task_id: '',
          status: 'not_started'
        }
  }
}

exports.main = async (event = {}) => {
  const openid = cloud.getWXContext().OPENID
  const normalizedCode = normalizeBindCode(event.bind_code)

  if (!openid) return { success: false, code: 'NO_OPENID', message: '未获取到微信用户标识' }
  if (!normalizedCode || normalizedCode.length < 10 || normalizedCode.length > 32) {
    return { success: false, code: 'INVALID_BIND_CODE', message: '请输入有效的学生绑定码' }
  }

  try {
    const user = await getCurrentUser(openid)
    if (!user) return { success: false, code: 'USER_NOT_ACTIVE', message: '当前用户不存在或不可用' }
    const lockedUntil = asDate(user.bind_attempt_locked_until)
    if (lockedUntil && lockedUntil.getTime() > Date.now()) {
      return { success: false, code: 'BIND_ATTEMPTS_RATE_LIMITED', message: '绑定尝试过于频繁，请稍后再试' }
    }

    const teacherMapping = await loadActiveTeacherMapping(db, user.user_id)
    if (teacherMapping.error) {
      return { success: false, code: teacherMapping.error, message: teacherMapping.message }
    }
    if (!teacherMapping.record) {
      return { success: false, code: 'TEACHER_BINDING_NOT_ACTIVE', message: '请先完成教师主体绑定' }
    }

    const teacherSubjectId = teacherMapping.record.subject_id
    const [teacherResult, codeResult] = await Promise.all([
      db.collection('subjects').where({
        subject_id: teacherSubjectId,
        subject_type: 'teacher',
        model_framework: 'teacher_v1.0',
        status: 'active'
      }).limit(2).get(),
      db.collection('student_bind_codes').where({
        bind_code_hash: sha256(normalizedCode)
      }).limit(2).get()
    ])
    if (teacherResult.data.length !== 1) {
      return { success: false, code: 'TEACHER_SUBJECT_NOT_ACTIVE', message: '当前教师主体不存在或已失效' }
    }
    if (codeResult.data.length !== 1) {
      await recordFailedAttempt(user)
      return {
        success: false,
        code: codeResult.data.length > 1 ? 'DUPLICATE_STUDENT_BIND_CODE' : 'INVALID_STUDENT_BIND_CODE',
        message: codeResult.data.length > 1 ? '学生绑定码数据异常' : '学生绑定码不正确'
      }
    }

    const bindRecord = codeResult.data[0]
    if (!codeAvailable(bindRecord) || (bindRecord.subject_type && bindRecord.subject_type !== 'student')) {
      const code = bindRecord.status === 'revoked' ? 'STUDENT_BIND_CODE_REVOKED' : 'STUDENT_BIND_CODE_EXPIRED'
      return { success: false, code, message: '该学生绑定码当前不可用' }
    }

    const studentResult = await db.collection('subjects').where({
      subject_id: bindRecord.subject_id,
      subject_type: 'student',
      model_framework: 'student_v1.0',
      status: 'active'
    }).limit(2).get()
    if (studentResult.data.length !== 1) {
      return { success: false, code: 'STUDENT_SUBJECT_NOT_ACTIVE', message: '学生研究主体不存在或已失效' }
    }

    const sharedOrganization = await loadSharedOrganization(
      db,
      teacherSubjectId,
      bindRecord.subject_id
    )
    if (!sharedOrganization) {
      return {
        success: false,
        code: 'TEACHER_STUDENT_CLASS_NOT_SHARED',
        message: '教师与该学生不在同一个有效班级，不能建立采集权限'
      }
    }

    const [existingResult, guardianResult] = await Promise.all([
      db.collection('teacher_student_collection_access').where({
        teacher_subject_id: teacherSubjectId,
        student_subject_id: bindRecord.subject_id
      }).limit(2).get(),
      db.collection('guardian_student_bindings').where({
        subject_id: bindRecord.subject_id,
        status: 'active'
      }).limit(2).get()
    ])
    if (existingResult.data.length > 1) {
      return { success: false, code: 'DUPLICATE_TEACHER_STUDENT_ACCESS', message: '教师学生采集权限存在重复' }
    }
    if (guardianResult.data.length > 1) {
      return { success: false, code: 'DUPLICATE_ACTIVE_GUARDIAN_BINDINGS', message: '学生监护人绑定存在重复' }
    }
    if (bindRecord.status === 'used' && guardianResult.data.length !== 1) {
      return {
        success: false,
        code: 'LEGACY_STUDENT_BIND_CODE_INCONSISTENT',
        message: '历史学生绑定码状态与监护人绑定不一致，请联系研究团队'
      }
    }

    const existing = existingResult.data[0] || null
    const alreadyActive = existing && existing.status === 'active'
    const isNewTeacher = !existing
    const accessDocId = existing
      ? existing._id
      : deterministicDocId('TSCA', `${teacherSubjectId}\n${bindRecord.subject_id}`)
    const accessId = existing
      ? existing.access_id || existing._id
      : deterministicDocId('ACCESS', `${teacherSubjectId}\n${bindRecord.subject_id}`)
    const usageState = deriveUsage(bindRecord, guardianResult.data.length === 1)
    const nextUsage = addTeacherUsage(usageState)

    await db.runTransaction(async (transaction) => {
      const currentCodeResult = await transaction.collection('student_bind_codes').doc(bindRecord._id).get()
      const currentCode = currentCodeResult.data
      if (!codeAvailable(currentCode)) throw new Error('STUDENT_BIND_CODE_STATE_CHANGED')

      const now = db.serverDate()
      const accessData = {
        access_id: accessId,
        user_id: user.user_id,
        teacher_subject_id: teacherSubjectId,
        student_subject_id: bindRecord.subject_id,
        school_id: sharedOrganization.school_id,
        class_id: sharedOrganization.class_id,
        source_bind_id: bindRecord.bind_id,
        access_role: 'teacher_collector',
        status: 'active',
        is_test: bindRecord.is_test === true && teacherResult.data[0].is_test === true,
        revoked_at: null,
        updated_at: now,
        last_used_at: now
      }
      if (existing) {
        await transaction.collection('teacher_student_collection_access').doc(accessDocId).update({
          data: accessData
        })
      } else {
        await transaction.collection('teacher_student_collection_access').add({
          data: {
            _id: accessDocId,
            ...accessData,
            created_at: now
          }
        })
      }

      const currentUsage = deriveUsage(currentCode, guardianResult.data.length === 1)
      const codeUpdate = {
        status: 'active',
        usage_state: addTeacherUsage(currentUsage),
        teacher_access_count: Number(currentCode.teacher_access_count || 0) + (isNewTeacher ? 1 : 0),
        first_teacher_access_at: currentCode.first_teacher_access_at || now,
        last_teacher_access_at: now,
        last_used_at: now,
        updated_at: now
      }
      await transaction.collection('student_bind_codes').doc(bindRecord._id).update({ data: codeUpdate })
    })

    await db.collection('users').doc(user._id).update({
      data: {
        bind_failed_attempt_count: 0,
        bind_attempt_window_started_at: null,
        bind_attempt_locked_until: null,
        updated_at: db.serverDate()
      }
    })

    const progressResult = await loadProgress(bindRecord.subject_id)
    if (progressResult.error) {
      return { success: false, code: progressResult.error, message: '学生首次采集进度存在重复' }
    }

    return {
      success: true,
      idempotent: alreadyActive,
      access: {
        access_id: accessId,
        status: 'active',
        access_role: 'teacher_collector',
        teacher_subject_id: teacherSubjectId,
        student_subject_id: bindRecord.subject_id
      },
      student: safeStudent(studentResult.data[0]),
      organization: sharedOrganization,
      progress: progressResult.progress,
      bind_status: 'active',
      usage_state: nextUsage
    }
  } catch (error) {
    console.error('authorizeTeacherStudentCollectionByCode error:', error)
    return { success: false, code: 'AUTHORIZE_TEACHER_STUDENT_ERROR', message: '建立学生采集权限失败，请重试' }
  }
}
