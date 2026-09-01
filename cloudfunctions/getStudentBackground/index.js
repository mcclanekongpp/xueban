const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const { authorizeStudentOperator } = require('./student-operator-auth')

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
    const authorization = await authorizeStudentOperator({ db, openid, subjectId })

    if (!authorization.authorized) {
      return {
        success: false,
        code: authorization.code,
        message: authorization.message
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
