// 云函数入口文件
const cloud = require('wx-server-sdk')

// 使用当前云环境
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  // 获取当前微信用户身份
  const wxContext = cloud.getWXContext()

  const openid = wxContext.OPENID
  const appid = wxContext.APPID
  const unionid = wxContext.UNIONID || ''

  // 如果没有获取到 openid，则停止
  if (!openid) {
    return {
      success: false,
      code: 'NO_OPENID',
      message: '未获取到微信用户标识'
    }
  }

  try {
    // 查询 users 集合中是否已经存在当前微信用户
    const userResult = await db.collection('users')
      .where({
        openid: openid
      })
      .limit(1)
      .get()

    // 已经存在：不重复创建，只更新最后登录时间
    if (userResult.data.length > 0) {
      const user = userResult.data[0]

      await db.collection('users')
        .doc(user._id)
        .update({
          data: {
            last_login_at: db.serverDate(),
            updated_at: db.serverDate()
          }
        })

      return {
        success: true,
        is_new_user: false,
        user: {
          user_id: user.user_id,
          role: user.role,
          status: user.status
        }
      }
    }

    // 第一次进入：生成内部用户编号
    const userId =
      'U_' +
      Date.now().toString(36).toUpperCase() +
      '_' +
      Math.random().toString(36).slice(2, 7).toUpperCase()

    // 新用户数据
    const newUser = {
      user_id: userId,

      openid: openid,
      appid: appid,
      unionid: unionid,

      // 当前暂时不确定具体身份
      role: 'unassigned',

      status: 'active',

      created_at: db.serverDate(),
      updated_at: db.serverDate(),
      last_login_at: db.serverDate()
    }

    // 写入 users 集合
    await db.collection('users').add({
      data: newUser
    })

    return {
      success: true,
      is_new_user: true,
      user: {
        user_id: userId,
        role: 'unassigned',
        status: 'active'
      }
    }

  } catch (error) {
    console.error('login error:', error)

    return {
      success: false,
      code: 'LOGIN_ERROR',
      message: error.message || '登录失败'
    }
  }
}