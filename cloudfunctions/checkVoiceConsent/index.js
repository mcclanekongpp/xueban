const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const CONSENT_VERSION = '1.0'

async function getSingle(collectionName, where) {
  const result = await db.collection(collectionName).where(where).limit(2).get()
  return {
    duplicate: result.data.length > 1,
    record: result.data.length === 1 ? result.data[0] : null
  }
}

async function authorizeSubject(openid, subjectId) {
  const userResult = await getSingle('users', { openid })
  if (userResult.duplicate || !userResult.record || userResult.record.status !== 'active') {
    return { success: false, code: 'USER_NOT_ACTIVE', message: '当前用户不存在或不可用，请重新登录' }
  }

  const user = userResult.record
  const subjectResult = await getSingle('subjects', { subject_id: subjectId, status: 'active' })
  if (subjectResult.duplicate || !subjectResult.record) {
    return { success: false, code: 'SUBJECT_NOT_ACTIVE', message: '研究主体不存在或已失效' }
  }

  const subject = subjectResult.record
  if (subject.subject_type === 'teacher' && subject.model_framework === 'teacher_v1.0') {
    if (user.role !== 'teacher') {
      return { success: false, code: 'TEACHER_NOT_AUTHORIZED', message: '当前用户没有该教师主体的录音权限' }
    }

    const mappingResult = await db.collection('identity_map').where({
      user_id: user.user_id,
      subject_id: subjectId,
      identity_type: 'teacher'
    }).limit(2).get()
    const activeMappings = mappingResult.data.filter((item) => item.status !== 'revoked')

    if (activeMappings.length !== 1) {
      return { success: false, code: 'TEACHER_NOT_AUTHORIZED', message: '当前用户没有该教师主体的录音权限' }
    }
  } else if (subject.subject_type === 'student' && subject.model_framework === 'student_v1.0') {
    const bindingResult = await db.collection('guardian_student_bindings').where({
      user_id: user.user_id,
      subject_id: subjectId,
      status: 'active'
    }).limit(2).get()

    if (bindingResult.data.length !== 1) {
      return { success: false, code: 'STUDENT_NOT_AUTHORIZED', message: '当前用户没有该学生主体的录音权限' }
    }
  } else {
    return { success: false, code: 'SUBJECT_FRAMEWORK_INVALID', message: '研究主体类型或框架无效' }
  }

  return {
    success: true,
    user,
    subject
  }
}

exports.main = async (event = {}) => {
  const openid = cloud.getWXContext().OPENID
  const subjectId = typeof event.subject_id === 'string' ? event.subject_id.trim() : ''

  if (!openid) return { success: false, code: 'NO_OPENID', message: '未获取到微信用户标识' }
  if (!subjectId) return { success: false, code: 'SUBJECT_ID_REQUIRED', message: '缺少研究主体编号' }

  try {
    const authorization = await authorizeSubject(openid, subjectId)
    if (!authorization.success) return authorization

    const consentResult = await db.collection('voice_consents').where({
      user_id: authorization.user.user_id,
      subject_id: subjectId,
      consent_version: CONSENT_VERSION,
      status: 'active'
    }).limit(2).get()

    if (consentResult.data.length > 1) {
      return {
        success: false,
        code: 'DUPLICATE_ACTIVE_VOICE_CONSENTS',
        message: '录音授权记录异常，请联系研究团队'
      }
    }

    return {
      success: true,
      has_consent: consentResult.data.length === 1,
      subject_id: subjectId,
      subject_type: authorization.subject.subject_type,
      consent_version: CONSENT_VERSION
    }
  } catch (error) {
    console.error('checkVoiceConsent error:', error)
    return {
      success: false,
      code: 'CHECK_VOICE_CONSENT_ERROR',
      message: error.message || '录音授权查询失败'
    }
  }
}
