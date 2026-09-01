const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const STUDENT_FRAMEWORK = 'student_v1.0'
const BIND_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

function normalizeText(value) {
  return typeof value === 'string' ? value.normalize('NFKC').trim() : ''
}

function normalizeBindCode(value) {
  return normalizeText(value).toUpperCase().replace(/[\s-]+/g, '')
}

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex')
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
  while (raw.length < 16) {
    for (const byte of crypto.randomBytes(24)) {
      if (byte >= 224) continue
      raw += BIND_CODE_ALPHABET[byte % BIND_CODE_ALPHABET.length]
      if (raw.length === 16) break
    }
  }
  return raw.match(/.{1,4}/g).join('-')
}

async function getCurrentUser(openid) {
  const result = await db.collection('users').where({ openid }).limit(2).get()
  return result.data.length === 1 ? result.data[0] : null
}

function canRegister(user, input) {
  if (!user || user.status !== 'active') return false
  if (['researcher', 'admin'].includes(user.role)) return true
  return Boolean(
    user.role === 'teacher' &&
      input.is_test === true &&
      input.school_id.startsWith('TEST_') &&
      input.class_id.startsWith('TEST_') &&
      input.research_alias.startsWith('TEST_')
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
  const openid = cloud.getWXContext().OPENID
  const schoolId = normalizeText(event.school_id)
  const classId = normalizeText(event.class_id)
  const researchAlias = normalizeText(
    event.research_alias || event.student_display_code
  ).slice(0, 40)
  const isTest = event.is_test === true

  if (!openid) {
    return { success: false, code: 'NO_OPENID', message: '未获取到微信用户标识' }
  }
  if (!schoolId || !classId || !researchAlias) {
    return {
      success: false,
      code: 'INVALID_INPUT',
      message: 'school_id、class_id 和 research_alias 均为必填项'
    }
  }

  try {
    const user = await getCurrentUser(openid)
    if (!canRegister(user, {
      school_id: schoolId,
      class_id: classId,
      research_alias: researchAlias,
      is_test: isTest
    })) {
      return { success: false, code: 'REGISTER_FORBIDDEN', message: '当前账号无权登记研究学生' }
    }

    const [schoolResult, classResult, aliasResult] = await Promise.all([
      db.collection('schools').where({ school_id: schoolId, status: 'active' }).limit(2).get(),
      db.collection('classes').where({
        class_id: classId,
        school_id: schoolId,
        status: 'active'
      }).limit(2).get(),
      db.collection('subjects').where({
        subject_type: 'student',
        model_framework: STUDENT_FRAMEWORK,
        research_alias: researchAlias,
        status: 'active'
      }).limit(2).get()
    ])

    if (schoolResult.data.length !== 1) {
      return { success: false, code: 'SCHOOL_NOT_ACTIVE', message: '学校不存在或当前不可用' }
    }
    if (classResult.data.length !== 1) {
      return { success: false, code: 'CLASS_NOT_ACTIVE', message: '班级不存在、与学校不匹配或当前不可用' }
    }
    if (aliasResult.data.length > 0) {
      const existing = aliasResult.data[0]
      const codeResult = await db.collection('student_bind_codes').where({
        subject_id: existing.subject_id,
        subject_type: 'student'
      }).limit(2).get()
      return {
        success: false,
        code: aliasResult.data.length > 1 || codeResult.data.length > 1
          ? 'DUPLICATE_STUDENT_REGISTRATION'
          : 'STUDENT_ALREADY_REGISTERED',
        message: '该学生研究别名已经登记；一个 Student Subject 只保留一个绑定码',
        existing_subject_id: existing.subject_id,
        bind_status: codeResult.data[0] ? codeResult.data[0].status || '' : ''
      }
    }

    const subjectId = makeId('S')
    const membershipId = deterministicDocId('CM', `${classId}\n${subjectId}\nstudent`)
    const bindId = makeId('SB')
    const bindCode = generateBindCode()
    const bindCodeHash = sha256(normalizeBindCode(bindCode))
    const registrationDocId = deterministicDocId('STUDENT_BIND', subjectId)
    const bindCollision = await db.collection('student_bind_codes')
      .where({ bind_code_hash: bindCodeHash })
      .limit(1)
      .get()
    if (bindCollision.data.length > 0) {
      return { success: false, code: 'BIND_CODE_COLLISION', message: '绑定码生成冲突，请重试登记' }
    }

    const now = db.serverDate()
    const subjectData = {
      _id: subjectId,
      subject_id: subjectId,
      subject_type: 'student',
      model_framework: STUDENT_FRAMEWORK,
      current_version: '',
      status: 'active',
      research_alias: researchAlias,
      is_test: isTest,
      created_at: now,
      updated_at: now
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
      created_at: now,
      updated_at: now
    }
    const bindData = {
      _id: registrationDocId,
      bind_id: bindId,
      bind_code_hash: bindCodeHash,
      subject_id: subjectId,
      subject_type: 'student',
      school_id: schoolId,
      class_id: classId,
      status: 'active',
      usage_state: 'unused',
      guardian_bound: false,
      guardian_bound_at: null,
      teacher_access_count: 0,
      first_teacher_access_at: null,
      last_teacher_access_at: null,
      last_used_at: null,
      is_test: isTest,
      created_by_user_id: user.user_id,
      created_at: now,
      updated_at: now,
      expires_at: null
    }

    await db.runTransaction(async (transaction) => {
      await transaction.collection('subjects').add({ data: subjectData })
      await transaction.collection('class_memberships').add({ data: membershipData })
      await transaction.collection('student_bind_codes').add({ data: bindData })
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
        status: 'active',
        usage_state: 'unused'
      }
    }
  } catch (error) {
    console.error('registerStudentForStudy error:', error)
    const duplicate = /duplicate|E11000|already exists/i.test(String(error && error.message || error))
    return {
      success: false,
      code: duplicate ? 'STUDENT_ALREADY_REGISTERED' : 'REGISTER_STUDENT_ERROR',
      message: duplicate ? '该学生已经登记，请勿重复创建 Student Subject' : '登记学生失败'
    }
  }
}
