const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const SUBJECT_CONFIG = {
  teacher: {
    framework: 'teacher_v1.0',
    binding_collection: 'identity_map',
    membership_role: 'teacher'
  },
  student: {
    framework: 'student_v1.0',
    binding_collection: 'guardian_student_bindings',
    membership_role: 'student'
  }
}

async function getCurrentUser(openid) {
  const result = await db.collection('users').where({ openid }).limit(2).get()
  return result.data.length === 1 ? result.data[0] : null
}

async function getSingle(collectionName, where) {
  const result = await db.collection(collectionName).where(where).limit(2).get()
  return result.data.length === 1 ? result.data[0] : null
}

async function getOrganizations(subjectId, subjectType, membershipRole) {
  const membershipResult = await db.collection('class_memberships').where({
    subject_id: subjectId,
    subject_type: subjectType,
    membership_role: membershipRole,
    status: 'active'
  }).limit(20).get()

  const organizations = []
  for (const membership of membershipResult.data) {
    const classRecord = await getSingle('classes', {
      class_id: membership.class_id,
      status: 'active'
    })
    if (!classRecord) continue

    const schoolRecord = await getSingle('schools', {
      school_id: classRecord.school_id,
      status: 'active'
    })
    if (!schoolRecord) continue

    organizations.push({
      school_id: schoolRecord.school_id,
      school_name: schoolRecord.school_name || schoolRecord.display_name || '',
      class_id: classRecord.class_id,
      class_name: classRecord.class_name || classRecord.display_name || ''
    })
  }

  return organizations
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

exports.main = async (event = {}) => {
  const openid = cloud.getWXContext().OPENID
  const subjectType = typeof event.subject_type === 'string'
    ? event.subject_type.trim().toLowerCase()
    : ''
  const config = SUBJECT_CONFIG[subjectType]

  if (!openid) return { success: false, code: 'NO_OPENID', message: '未获取到微信用户标识' }
  if (!config) return { success: false, code: 'INVALID_SUBJECT_TYPE', message: '绑定主体类型无效' }

  try {
    const user = await getCurrentUser(openid)
    if (!user || user.status !== 'active') {
      return { success: false, code: 'USER_NOT_ACTIVE', message: '当前用户不存在或不可用，请重新登录' }
    }

    const where = subjectType === 'teacher'
      ? { user_id: user.user_id, identity_type: 'teacher' }
      : { user_id: user.user_id, status: 'active' }
    const result = await db.collection(config.binding_collection).where(where).limit(20).get()
    const rawBindings = result.data.filter((item) => item.status !== 'revoked')

    if (subjectType === 'teacher' && rawBindings.length > 1) {
      return {
        success: false,
        code: 'DUPLICATE_TEACHER_BINDINGS',
        message: '教师主体绑定关系异常，请联系研究团队'
      }
    }

    const bindings = []

    for (const binding of rawBindings) {
      const subject = await getSingle('subjects', {
        subject_id: binding.subject_id,
        subject_type: subjectType,
        status: 'active'
      })
      if (!subject || subject.model_framework !== config.framework) continue

      const safe = safeSubject(subject)
      const organizations = await getOrganizations(
        subject.subject_id,
        subjectType,
        config.membership_role
      )
      const organization = organizations[0] || {
        school_id: '',
        school_name: '',
        class_id: '',
        class_name: ''
      }

      bindings.push({
        binding_id: binding.binding_id || binding._id || '',
        status: binding.status || 'active',
        bound_at: binding.bound_at || binding.created_at || null,
        subject: safe,
        [subjectType]: safe,
        organization,
        organizations
      })
    }

    return {
      success: true,
      subject_type: subjectType,
      has_bindings: bindings.length > 0,
      bindings
    }
  } catch (error) {
    console.error('getMySubjectBindings error:', error)
    return { success: false, code: 'GET_SUBJECT_BINDINGS_ERROR', message: '读取主体绑定失败' }
  }
}
