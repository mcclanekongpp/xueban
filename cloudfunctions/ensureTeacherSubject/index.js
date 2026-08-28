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
      .limit(1)
      .get()

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
        .limit(1)
        .get()

      if (subjectResult.data.length > 0) {
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

    // 4. 生成匿名教师主体编号
    const subjectId =
      'T_' +
      Date.now().toString(36).toUpperCase() +
      '_' +
      Math.random().toString(36).slice(2, 7).toUpperCase()

    // 5. 创建匿名教师主体
    const subjectData = {
      subject_id: subjectId,
      subject_type: 'teacher',

      // 当前使用的教师主体模型框架
      model_framework: 'teacher_v1.0',

      // 尚未完成首次主体模型构建
      current_version: '',

      status: 'active',

      created_at: db.serverDate(),
      updated_at: db.serverDate()
    }

    await db.collection('subjects').add({
      data: subjectData
    })

    // 6. 建立账号与匿名教师主体之间的映射
    const identityMapData = {
      user_id: user.user_id,
      subject_id: subjectId,
      identity_type: 'teacher',

      created_at: db.serverDate(),
      updated_at: db.serverDate()
    }

    await db.collection('identity_map').add({
      data: identityMapData
    })

    return {
      success: true,
      is_new_subject: true,
      subject: {
        subject_id: subjectId,
        subject_type: 'teacher',
        model_framework: 'teacher_v1.0',
        current_version: '',
        status: 'active'
      }
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