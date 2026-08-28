const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const TEACHER_FRAMEWORK = 'teacher_v1.0'
const BIND_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

function normalizeText(value) {
  return typeof value === 'string' ? value.normalize('NFKC').trim() : ''
}

function normalizeTeacherNo(value) {
  return normalizeText(value).toUpperCase().replace(/\s+/g, '')
}

function normalizeBindCode(value) {
  return normalizeText(value).toUpperCase().replace(/[\s-]+/g, '')
}

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex')
}

function teacherNoHash(schoolId, normalizedTeacherNo) {
  return sha256(`${schoolId}\n${normalizedTeacherNo}`)
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36).toUpperCase()}_${crypto
    .randomBytes(4)
    .toString('hex')
    .slice(0, 5)
    .toUpperCase()}`
}

function deterministicDocId(prefix, value) {
  return `${prefix}_${sha256(value).slice(0, 24).toUpperCase()}`
}

function generateBindCode() {
  let raw = ''

  while (raw.length < 10) {
    for (const byte of crypto.randomBytes(10)) {
      raw += BIND_CODE_ALPHABET[byte % BIND_CODE_ALPHABET.length]
      if (raw.length === 10) break
    }
  }

  return `${raw.slice(0, 5)}-${raw.slice(5)}`
}

async function getCurrentUser(openid) {
  const result = await db.collection('users').where({ openid }).limit(2).get()
  return result.data.length === 1 ? result.data[0] : null
}

function isActive(record) {
  return record && record.status === 'active'
}

function canRegister(user, input) {
  if (!isActive(user)) return false
  if (['researcher', 'admin'].includes(user.role)) return true

  // 只为自动化技术验证保留 TEST 例外；正式教师必须由研究团队登记。
  return Boolean(
    user.role === 'teacher' &&
      input.is_test === true &&
      input.school_id.startsWith('TEST_') &&
      input.class_id.startsWith('TEST_') &&
      input.normalized_teacher_no.startsWith('TEST')
  )
}

function safeTeacher(subject) {
  return {
    subject_id: subject.subject_id,
    subject_type: subject.subject_type,
    framework: subject.model_framework,
    status: subject.status,
    research_alias: subject.research_alias || ''
  }
}

exports.main = async (event = {}) => {
  const openid = cloud.getWXContext().OPENID

  if (!openid) {
    return { success: false, code: 'NO_OPENID', message: '未获取到微信用户标识' }
  }

  const schoolId = normalizeText(event.school_id)
  const classId = normalizeText(event.class_id)
  const normalizedTeacherNo = normalizeTeacherNo(event.teacher_no)
  const researchAlias = normalizeText(
    event.research_alias || event.teacher_display_code
  ).slice(0, 40)
  const isTest = event.is_test === true

  if (!schoolId || !classId || !normalizedTeacherNo) {
    return {
      success: false,
      code: 'INVALID_INPUT',
      message: 'school_id、class_id 和 teacher_no 均为必填项'
    }
  }

  if (normalizedTeacherNo.length > 64) {
    return { success: false, code: 'INVALID_TEACHER_NO', message: '教师编号格式不正确' }
  }

  try {
    const user = await getCurrentUser(openid)
    const input = {
      school_id: schoolId,
      class_id: classId,
      normalized_teacher_no: normalizedTeacherNo,
      is_test: isTest
    }

    if (!canRegister(user, input)) {
      return { success: false, code: 'REGISTER_FORBIDDEN', message: '当前账号无权登记研究教师' }
    }

    const [schoolResult, classResult] = await Promise.all([
      db.collection('schools').where({ school_id: schoolId }).limit(2).get(),
      db.collection('classes').where({ class_id: classId, school_id: schoolId }).limit(2).get()
    ])

    if (schoolResult.data.length !== 1 || !isActive(schoolResult.data[0])) {
      return { success: false, code: 'SCHOOL_NOT_ACTIVE', message: '学校不存在或当前不可用' }
    }

    if (classResult.data.length !== 1 || !isActive(classResult.data[0])) {
      return {
        success: false,
        code: 'CLASS_NOT_ACTIVE',
        message: '班级不存在、与学校不匹配或当前不可用'
      }
    }

    const hashedTeacherNo = teacherNoHash(schoolId, normalizedTeacherNo)
    const existingResult = await db.collection('teacher_bind_codes').where({
      school_id: schoolId,
      teacher_no_hash: hashedTeacherNo
    }).limit(2).get()

    if (existingResult.data.length > 0) {
      const existing = existingResult.data[0]
      return {
        success: false,
        code: existingResult.data.length > 1
          ? 'DUPLICATE_TEACHER_REGISTRATION'
          : 'TEACHER_ALREADY_REGISTERED',
        message: '该学校范围内的教师编号已经登记',
        existing_subject_id: existing.subject_id || '',
        bind_status: existing.status || ''
      }
    }

    const subjectId = makeId('T')
    const membershipId = deterministicDocId('CM', `${classId}\n${subjectId}\nteacher`)
    const bindId = makeId('TB')
    const bindCode = generateBindCode()
    const bindCodeHash = sha256(normalizeBindCode(bindCode))
    const registrationDocId = deterministicDocId(
      'TEACHER_REG',
      `${schoolId}\n${hashedTeacherNo}`
    )

    const bindCollision = await db.collection('teacher_bind_codes')
      .where({ bind_code_hash: bindCodeHash })
      .limit(1)
      .get()

    if (bindCollision.data.length > 0) {
      return { success: false, code: 'BIND_CODE_COLLISION', message: '绑定码生成冲突，请重试登记' }
    }

    const subjectData = {
      _id: subjectId,
      subject_id: subjectId,
      subject_type: 'teacher',
      model_framework: TEACHER_FRAMEWORK,
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
      subject_type: 'teacher',
      membership_role: 'teacher',
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
      subject_type: 'teacher',
      school_id: schoolId,
      class_id: classId,
      teacher_no_hash: hashedTeacherNo,
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
      await transaction.collection('class_memberships').add({ data: membershipData })
      await transaction.collection('teacher_bind_codes').add({ data: bindData })
    })

    return {
      success: true,
      is_new_subject: true,
      teacher: safeTeacher(subjectData),
      membership: {
        membership_id: membershipId,
        class_id: classId,
        membership_role: 'teacher',
        status: 'active'
      },
      bind: { bind_id: bindId, bind_code: bindCode, status: 'unused' }
    }
  } catch (error) {
    console.error('registerTeacherForStudy error:', error)
    const duplicate = /duplicate|E11000|already exists/i.test(String(error && error.message || error))
    return {
      success: false,
      code: duplicate ? 'TEACHER_ALREADY_REGISTERED' : 'REGISTER_TEACHER_ERROR',
      message: duplicate ? '该教师已经登记，请勿重复创建 Teacher Subject' : '登记教师失败'
    }
  }
}
