const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const STUDENT_FRAMEWORK = 'student_v1.0'

function normalizeText(value) {
  return typeof value === 'string'
    ? value.normalize('NFKC').trim()
    : ''
}

function normalizeBindCode(value) {
  return normalizeText(value)
    .toUpperCase()
    .replace(/[\s-]+/g, '')
}

function normalizeStudentNo(value) {
  return normalizeText(value)
    .toUpperCase()
    .replace(/\s+/g, '')
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(value, 'utf8')
    .digest('hex')
}

function studentNoHash(schoolId, normalizedStudentNo) {
  return sha256(`${schoolId}\n${normalizedStudentNo}`)
}

function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') {
    return false
  }

  const leftBuffer = Buffer.from(left, 'utf8')
  const rightBuffer = Buffer.from(right, 'utf8')

  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  )
}

function deterministicDocId(prefix, value) {
  return `${prefix}_${sha256(value).slice(0, 24).toUpperCase()}`
}

async function getCurrentUser(openid) {
  const result = await db
    .collection('users')
    .where({ openid })
    .limit(2)
    .get()

  if (result.data.length !== 1) {
    return null
  }

  return result.data[0]
}

async function getActiveBindings(subjectId) {
  return db
    .collection('guardian_student_bindings')
    .where({
      subject_id: subjectId,
      status: 'active'
    })
    .limit(2)
    .get()
}

function safeStudent(subject) {
  return {
    subject_id: subject.subject_id,
    subject_type: subject.subject_type,
    framework: subject.model_framework,
    status: subject.status,
    research_alias: subject.research_alias || ''
  }
}

function successResult(binding, subject, idempotent) {
  return {
    success: true,
    idempotent: idempotent === true,
    binding: {
      binding_id: binding.binding_id,
      subject_id: binding.subject_id,
      status: binding.status,
      bound_at: binding.bound_at || null
    },
    student: safeStudent(subject)
  }
}

exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!openid) {
    return {
      success: false,
      code: 'NO_OPENID',
      message: '未获取到微信用户标识'
    }
  }

  // 前端只能提交 bind_code 与 student_no；身份与 Student_ID 均由云端解析。
  const normalizedCode = normalizeBindCode(event.bind_code)
  const normalizedStudentNo = normalizeStudentNo(event.student_no)

  if (!normalizedCode || !normalizedStudentNo) {
    return {
      success: false,
      code: 'INVALID_INPUT',
      message: '请输入绑定码和学生学号'
    }
  }

  if (
    normalizedCode.length < 8 ||
    normalizedCode.length > 32 ||
    normalizedStudentNo.length > 64
  ) {
    return {
      success: false,
      code: 'INVALID_BIND_CREDENTIALS',
      message: '绑定码或学生学号不正确'
    }
  }

  try {
    const user = await getCurrentUser(openid)

    if (!user || user.status !== 'active') {
      return {
        success: false,
        code: 'USER_NOT_ACTIVE',
        message: '当前用户不存在或不可用，请重新登录'
      }
    }

    const bindCodeHash = sha256(normalizedCode)
    const codeResult = await db
      .collection('student_bind_codes')
      .where({ bind_code_hash: bindCodeHash })
      .limit(2)
      .get()

    if (codeResult.data.length === 0) {
      return {
        success: false,
        code: 'INVALID_BIND_CREDENTIALS',
        message: '绑定码或学生学号不正确'
      }
    }

    if (codeResult.data.length > 1) {
      return {
        success: false,
        code: 'DUPLICATE_BIND_CODE',
        message: '绑定码数据异常，请联系研究团队'
      }
    }

    const bindRecord = codeResult.data[0]
    const expectedStudentNoHash = studentNoHash(
      bindRecord.school_id,
      normalizedStudentNo
    )

    if (!safeEqual(expectedStudentNoHash, bindRecord.student_no_hash)) {
      return {
        success: false,
        code: 'INVALID_BIND_CREDENTIALS',
        message: '绑定码或学生学号不正确'
      }
    }

    const subjectResult = await db
      .collection('subjects')
      .where({
        subject_id: bindRecord.subject_id,
        subject_type: 'student'
      })
      .limit(2)
      .get()

    if (subjectResult.data.length !== 1) {
      return {
        success: false,
        code: 'STUDENT_SUBJECT_NOT_FOUND',
        message: '学生研究主体不存在'
      }
    }

    const subject = subjectResult.data[0]

    if (
      subject.status !== 'active' ||
      subject.model_framework !== STUDENT_FRAMEWORK
    ) {
      return {
        success: false,
        code: 'STUDENT_SUBJECT_NOT_ACTIVE',
        message: '学生研究主体当前不可用'
      }
    }

    const membershipResult = await db
      .collection('class_memberships')
      .where({
        class_id: bindRecord.class_id,
        subject_id: bindRecord.subject_id,
        subject_type: 'student',
        membership_role: 'student',
        status: 'active'
      })
      .limit(2)
      .get()

    if (membershipResult.data.length !== 1) {
      return {
        success: false,
        code: 'STUDENT_CLASS_MEMBERSHIP_INVALID',
        message: '学生班级关系不存在或异常'
      }
    }

    const activeBindings = await getActiveBindings(bindRecord.subject_id)

    if (activeBindings.data.length > 1) {
      return {
        success: false,
        code: 'DUPLICATE_ACTIVE_GUARDIAN_BINDINGS',
        message: '学生绑定关系异常，请联系研究团队'
      }
    }

    if (activeBindings.data.length === 1) {
      const existingBinding = activeBindings.data[0]

      if (existingBinding.user_id === user.user_id) {
        return successResult(existingBinding, subject, true)
      }

      return {
        success: false,
        code: 'STUDENT_ALREADY_BOUND',
        message: '该学生已经由其他微信用户绑定'
      }
    }

    if (bindRecord.status === 'used') {
      return {
        success: false,
        code: 'BIND_CODE_USED',
        message: '该绑定码已经使用'
      }
    }

    if (bindRecord.status === 'revoked') {
      return {
        success: false,
        code: 'BIND_CODE_REVOKED',
        message: '该绑定码已经撤销'
      }
    }

    if (bindRecord.status !== 'unused') {
      return {
        success: false,
        code: 'BIND_CODE_NOT_AVAILABLE',
        message: '该绑定码当前不可用'
      }
    }

    const bindingDocId = deterministicDocId(
      'GUARDIAN_STUDENT',
      bindRecord.subject_id
    )
    const bindingId = deterministicDocId(
      'GSB',
      bindRecord.subject_id
    )

    const bindingData = {
      _id: bindingDocId,
      binding_id: bindingId,
      user_id: user.user_id,
      subject_id: bindRecord.subject_id,
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
        const currentCode = await transaction
          .collection('student_bind_codes')
          .doc(bindRecord._id)
          .get()

        if (!currentCode.data || currentCode.data.status !== 'unused') {
          throw new Error('BIND_CODE_STATE_CHANGED')
        }

        await transaction
          .collection('guardian_student_bindings')
          .add({ data: bindingData })

        await transaction
          .collection('student_bind_codes')
          .doc(bindRecord._id)
          .update({
            data: {
              status: 'used',
              used_at: db.serverDate(),
              used_by_user_id: user.user_id,
              used_binding_id: bindingId,
              updated_at: db.serverDate()
            }
          })
      })
    } catch (transactionError) {
      // 并发重复提交时，以已经落库的同一用户绑定作为幂等成功结果。
      const latestBindings = await getActiveBindings(bindRecord.subject_id)

      if (
        latestBindings.data.length === 1 &&
        latestBindings.data[0].user_id === user.user_id
      ) {
        return successResult(latestBindings.data[0], subject, true)
      }

      throw transactionError
    }

    return successResult(bindingData, subject, false)
  } catch (error) {
    console.error('bindStudentByCode error:', error)

    return {
      success: false,
      code: 'BIND_STUDENT_ERROR',
      message: '学生绑定失败，请重试'
    }
  }
}
