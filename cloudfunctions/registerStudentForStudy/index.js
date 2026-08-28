const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

const STUDENT_FRAMEWORK = 'student_v1.0'
const BIND_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

function normalizeText(value) {
  return typeof value === 'string'
    ? value.normalize('NFKC').trim()
    : ''
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

function makeId(prefix) {
  return (
    prefix +
    '_' +
    Date.now().toString(36).toUpperCase() +
    '_' +
    crypto.randomBytes(4).toString('hex').slice(0, 5).toUpperCase()
  )
}

function deterministicDocId(prefix, value) {
  return `${prefix}_${sha256(value).slice(0, 24).toUpperCase()}`
}

function generateBindCode() {
  let raw = ''

  while (raw.length < 10) {
    const bytes = crypto.randomBytes(10)

    for (const byte of bytes) {
      raw += BIND_CODE_ALPHABET[byte % BIND_CODE_ALPHABET.length]

      if (raw.length === 10) {
        break
      }
    }
  }

  return `${raw.slice(0, 5)}-${raw.slice(5)}`
}

function normalizeBindCode(value) {
  return normalizeText(value)
    .toUpperCase()
    .replace(/[\s-]+/g, '')
}

function isActive(record) {
  return record && record.status === 'active'
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

function canRegister(user, input) {
  if (!isActive(user)) {
    return false
  }

  if (user.role === 'researcher' || user.role === 'admin') {
    return true
  }

  // MVP 自动验证需要复用当前教师开发账号。教师只可登记全部带 TEST
  // 前缀的测试数据，不能通过这个例外登记真实研究学生。
  return Boolean(
    user.role === 'teacher' &&
      input.is_test === true &&
      input.school_id.startsWith('TEST_') &&
      input.class_id.startsWith('TEST_') &&
      input.normalized_student_no.startsWith('TEST')
  )
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

  const schoolId = normalizeText(event.school_id)
  const classId = normalizeText(event.class_id)
  const normalizedStudentNo = normalizeStudentNo(event.student_no)
  const researchAlias = normalizeText(
    event.research_alias || event.student_display_code
  ).slice(0, 40)
  const isTest = event.is_test === true

  if (!schoolId || !classId || !normalizedStudentNo) {
    return {
      success: false,
      code: 'INVALID_INPUT',
      message: 'school_id、class_id 和 student_no 均为必填项'
    }
  }

  if (normalizedStudentNo.length > 64) {
    return {
      success: false,
      code: 'INVALID_STUDENT_NO',
      message: '学生学号格式不正确'
    }
  }

  try {
    const user = await getCurrentUser(openid)

    if (!user) {
      return {
        success: false,
        code: 'USER_NOT_FOUND',
        message: '用户不存在，请先登录'
      }
    }

    const registrationInput = {
      school_id: schoolId,
      class_id: classId,
      normalized_student_no: normalizedStudentNo,
      is_test: isTest
    }

    if (!canRegister(user, registrationInput)) {
      return {
        success: false,
        code: 'REGISTER_FORBIDDEN',
        message: '当前账号无权登记研究学生'
      }
    }

    const [schoolResult, classResult] = await Promise.all([
      db
        .collection('schools')
        .where({ school_id: schoolId })
        .limit(2)
        .get(),
      db
        .collection('classes')
        .where({ class_id: classId, school_id: schoolId })
        .limit(2)
        .get()
    ])

    if (schoolResult.data.length !== 1 || !isActive(schoolResult.data[0])) {
      return {
        success: false,
        code: 'SCHOOL_NOT_ACTIVE',
        message: '学校不存在或当前不可用'
      }
    }

    if (classResult.data.length !== 1 || !isActive(classResult.data[0])) {
      return {
        success: false,
        code: 'CLASS_NOT_ACTIVE',
        message: '班级不存在、与学校不匹配或当前不可用'
      }
    }

    const hashedStudentNo = studentNoHash(
      schoolId,
      normalizedStudentNo
    )
    const registrationDocId = deterministicDocId(
      'STUDENT_REG',
      `${schoolId}\n${hashedStudentNo}`
    )

    const existingResult = await db
      .collection('student_bind_codes')
      .where({
        school_id: schoolId,
        student_no_hash: hashedStudentNo
      })
      .limit(2)
      .get()

    if (existingResult.data.length > 0) {
      const existing = existingResult.data[0]

      return {
        success: false,
        code: 'STUDENT_ALREADY_REGISTERED',
        message: '该学校范围内的学生学号已经登记',
        existing_subject_id: existing.subject_id || '',
        bind_status: existing.status || ''
      }
    }

    const subjectId = makeId('S')
    const membershipId = deterministicDocId(
      'CM',
      `${classId}\n${subjectId}\nstudent`
    )
    const bindId = makeId('SB')
    const bindCode = generateBindCode()
    const bindCodeHash = sha256(normalizeBindCode(bindCode))

    const bindCollision = await db
      .collection('student_bind_codes')
      .where({ bind_code_hash: bindCodeHash })
      .limit(1)
      .get()

    if (bindCollision.data.length > 0) {
      return {
        success: false,
        code: 'BIND_CODE_COLLISION',
        message: '绑定码生成冲突，请重试登记'
      }
    }

    const subjectData = {
      _id: subjectId,
      subject_id: subjectId,
      subject_type: 'student',
      model_framework: STUDENT_FRAMEWORK,
      current_version: '',
      status: 'active',
      research_alias: researchAlias,
      is_test: isTest,
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    }

    const membershipData = {
      _id: membershipId,
      membership_id: membershipId,
      class_id: classId,
      subject_id: subjectId,
      subject_type: 'student',
      membership_role: 'student',
      status: 'active',
      is_test: isTest,
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    }

    const bindData = {
      _id: registrationDocId,
      bind_id: bindId,
      bind_code_hash: bindCodeHash,
      subject_id: subjectId,
      school_id: schoolId,
      class_id: classId,
      student_no_hash: hashedStudentNo,
      status: 'unused',
      is_test: isTest,
      created_by_user_id: user.user_id,
      created_at: db.serverDate(),
      updated_at: db.serverDate(),
      used_at: null,
      expires_at: null
    }

    await db.runTransaction(async (transaction) => {
      await transaction.collection('subjects').add({ data: subjectData })
      await transaction
        .collection('class_memberships')
        .add({ data: membershipData })
      await transaction
        .collection('student_bind_codes')
        .add({ data: bindData })
    })

    return {
      success: true,
      is_new_subject: true,
      student: safeStudent(subjectData),
      membership: {
        membership_id: membershipId,
        class_id: classId,
        membership_role: 'student',
        status: 'active'
      },
      bind: {
        bind_id: bindId,
        bind_code: bindCode,
        status: 'unused'
      }
    }
  } catch (error) {
    console.error('registerStudentForStudy error:', error)

    const errorText = `${error && error.message ? error.message : error}`
    const duplicate = /duplicate|E11000|already exists/i.test(errorText)

    return {
      success: false,
      code: duplicate
        ? 'STUDENT_ALREADY_REGISTERED'
        : 'REGISTER_STUDENT_ERROR',
      message: duplicate
        ? '该学生已经登记，请勿重复创建 Student Subject'
        : '登记学生失败'
    }
  }
}
