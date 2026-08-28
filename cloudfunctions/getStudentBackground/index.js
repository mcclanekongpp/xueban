const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async (event = {}) => {
  const openid = cloud.getWXContext().OPENID
  const subjectId =
    typeof event.subject_id === 'string' ? event.subject_id.trim() : ''

  if (!openid || !subjectId) {
    return {
      success: false,
      code: !openid ? 'NO_OPENID' : 'STUDENT_SUBJECT_ID_REQUIRED',
      message: !openid ? '未获取到微信用户标识' : '缺少学生研究主体编号'
    }
  }

  try {
    const userResult = await db
      .collection('users')
      .where({ openid, status: 'active' })
      .limit(2)
      .get()

    if (userResult.data.length !== 1) {
      return { success: false, code: 'USER_NOT_ACTIVE', message: '当前用户不可用' }
    }

    const user = userResult.data[0]
    const bindingResult = await db
      .collection('guardian_student_bindings')
      .where({ user_id: user.user_id, subject_id: subjectId, status: 'active' })
      .limit(2)
      .get()

    if (bindingResult.data.length !== 1) {
      return {
        success: false,
        code: 'STUDENT_BINDING_NOT_ACTIVE',
        message: '当前微信没有该学生的有效采集绑定'
      }
    }

    const result = await db
      .collection('subject_background')
      .where({
        subject_id: subjectId,
        subject_type: 'student',
        framework: 'student_v1.0',
        status: 'active'
      })
      .limit(2)
      .get()

    if (result.data.length > 1) {
      return {
        success: false,
        code: 'DUPLICATE_STUDENT_BACKGROUND',
        message: '该学生存在重复的有效 S0 记录'
      }
    }

    return {
      success: true,
      has_background: result.data.length === 1,
      subject_id: subjectId,
      framework: 'student_v1.0',
      background: result.data.length === 1 ? result.data[0] : null
    }
  } catch (error) {
    console.error('getStudentBackground error:', error)
    return {
      success: false,
      code: 'GET_STUDENT_BACKGROUND_ERROR',
      message: '读取学生 S0 失败'
    }
  }
}
