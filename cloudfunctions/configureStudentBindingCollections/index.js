const cloud = require('wx-server-sdk')
const CloudBaseModule = require('@cloudbase/manager-node')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const CloudBase = CloudBaseModule.default || CloudBaseModule

const TARGET_ENV = 'model-dev-d9gkoyaolb464c28d'
const ALLOWED_COLLECTIONS = new Set([
  'schools',
  'classes',
  'class_memberships',
  'student_bind_codes',
  'guardian_student_bindings'
])

async function getCurrentUser(openid) {
  const result = await db
    .collection('users')
    .where({ openid })
    .limit(2)
    .get()

  return result.data.length === 1 ? result.data[0] : null
}

exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const collectionName =
    typeof event.collection_name === 'string'
      ? event.collection_name.trim()
      : ''

  if (!openid) {
    return {
      success: false,
      code: 'NO_OPENID',
      message: '未获取到微信用户标识'
    }
  }

  if (
    event.confirmation !== 'STUDENT_BINDING_MVP_ADMINONLY' ||
    !ALLOWED_COLLECTIONS.has(collectionName)
  ) {
    return {
      success: false,
      code: 'INVALID_CONFIGURATION_REQUEST',
      message: '配置请求不在 Student Binding 集合白名单内'
    }
  }

  try {
    const user = await getCurrentUser(openid)

    if (
      !user ||
      user.status !== 'active' ||
      !['researcher', 'admin'].includes(user.role)
    ) {
      return {
        success: false,
        code: 'CONFIGURATION_FORBIDDEN',
        message: '当前账号无权执行集合安全配置'
      }
    }

    const manager = CloudBase.init({
      envId: TARGET_ENV
    })

    const updateResult =
      await manager.permission.modifyResourcePermission({
        resourceType: 'collection',
        resource: collectionName,
        permission: 'ADMINONLY'
      })

    return {
      success: true,
      environment_id: TARGET_ENV,
      collection_name: collectionName,
      permission: 'ADMINONLY',
      updated:
        !updateResult ||
        !updateResult.Data ||
        updateResult.Data.Success !== false
    }
  } catch (error) {
    console.error('configureStudentBindingCollections error:', error)

    return {
      success: false,
      code: 'CONFIGURE_COLLECTION_PERMISSION_ERROR',
      message: error.message || '集合权限配置失败'
    }
  }
}
