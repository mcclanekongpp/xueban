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

  // 前端传入的角色
  const role = event.role

  // 目前只允许这两种身份
  const allowedRoles = ['teacher', 'guardian']

  if (!openid) {
    return {
      success: false,
      code: 'NO_OPENID',
      message: '未获取到微信用户标识'
    }
  }

  if (!allowedRoles.includes(role)) {
    return {
      success: false,
      code: 'INVALID_ROLE',
      message: '无效的用户身份'
    }
  }

  try {
    // 根据当前微信用户的 openid 查找自己的 users 记录
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

    // 目前仅允许尚未设置身份的用户进行首次身份设置
    if (
      user.role &&
      user.role !== 'unassigned' &&
      user.role !== role
    ) {
      return {
        success: false,
        code: 'ROLE_ALREADY_SET',
        message: '用户身份已经设置，暂不能自行修改'
      }
    }

    // 更新当前用户自己的角色
    await db.collection('users')
      .doc(user._id)
      .update({
        data: {
          role: role,
          updated_at: db.serverDate()
        }
      })

    return {
      success: true,
      user: {
        user_id: user.user_id,
        role: role,
        status: user.status
      }
    }

  } catch (error) {
    console.error('setUserRole error:', error)

    return {
      success: false,
      code: 'SET_ROLE_ERROR',
      message: error.message || '身份设置失败'
    }
  }
}