// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!openid) {
    return {
      success: false,
      code: 'NO_OPENID',
      message: '未获取到微信用户标识'
    }
  }

  try {
    // 1. 查询当前微信账号
    const userResult = await db.collection('users')
      .where({
        openid: openid
      })
      .limit(1)
      .get()

    if (userResult.data.length === 0) {
      return {
        success: false,
        code: 'USER_NOT_FOUND',
        message: '用户不存在，请先登录'
      }
    }

    const user = userResult.data[0]

    // 2. 当前云函数只允许教师账号调用
    if (user.role !== 'teacher') {
      return {
        success: false,
        code: 'NOT_TEACHER',
        message: '当前账号不是教师身份'
      }
    }

    // 3. 先检查 identity_map 中是否已有教师主体映射
    const mapResult = await db.collection('identity_map')
      .where({
        user_id: user.user_id,
        identity_type: 'teacher'
      })
      .limit(2)
      .get()

    if (mapResult.data.length > 1) {
      return {
        success: false,
        code: 'DUPLICATE_TEACHER_BINDINGS',
        message: '教师主体绑定关系异常，请联系研究团队'
      }
    }

    // 已经存在主体映射
    if (mapResult.data.length > 0) {
      const identityMap = mapResult.data[0]
      const subjectId = identityMap.subject_id

      // 再检查 subjects 主体是否存在
      const subjectResult = await db.collection('subjects')
        .where({
          subject_id: subjectId,
          subject_type: 'teacher'
        })
        .limit(2)
        .get()

      if (subjectResult.data.length === 1) {
        const subject = subjectResult.data[0]

        return {
          success: true,
          is_new_subject: false,
          subject: {
            subject_id: subject.subject_id,
            subject_type: subject.subject_type,
            model_framework: subject.model_framework,
            current_version: subject.current_version,
            status: subject.status
          }
        }
      }

      // 映射存在，但主体不存在，属于数据异常
      return {
        success: false,
        code: 'SUBJECT_MISSING',
        message: '教师主体映射存在，但主体数据缺失'
      }
    }

    // 新教师必须先由研究团队线下预登记，再通过绑定码完成微信绑定。
    // 本函数只读取既有映射，绝不因前端选择“教师”而临时创建 Subject。
    return {
      success: false,
      code: 'TEACHER_BINDING_REQUIRED',
      message: '尚未绑定教师研究主体，请使用线下发放的绑定码完成绑定'
    }

  } catch (error) {
    console.error('ensureTeacherSubject error:', error)

    return {
      success: false,
      code: 'ENSURE_TEACHER_SUBJECT_ERROR',
      message: error.message || '教师主体创建失败'
    }
  }
}
