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
  'teacher_bind_codes',
  'student_bind_codes',
  'guardian_student_bindings',
  'variable_evidence_profiles',
  'model_change_candidates'
])

const ACTIVE_TEACHER_HARDEN_ONLY = new Set([
  'teacher_bind_codes',
  'variable_evidence_profiles',
  'model_change_candidates'
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
    ![
      'STUDENT_BINDING_MVP_ADMINONLY',
      'SUBJECT_BINDING_MVP_ADMINONLY',
      'SUBJECT_MODEL_PIPELINE_ADMINONLY'
    ].includes(event.confirmation) ||
    !ALLOWED_COLLECTIONS.has(collectionName)
  ) {
    return {
      success: false,
      code: 'INVALID_CONFIGURATION_REQUEST',
      message: '配置请求不在 Subject Binding 集合白名单内'
    }
  }

  try {
    const user = await getCurrentUser(openid)

    // 该例外只允许已绑定教师把新增教师绑定码集合收紧为 ADMINONLY，
    // 不能修改其他集合，也不能把权限放宽。
    const canHardenWhitelistedCollection =
      user &&
      user.status === 'active' &&
      user.role === 'teacher' &&
      ACTIVE_TEACHER_HARDEN_ONLY.has(collectionName)

    if (
      !user ||
      user.status !== 'active' ||
      (!['researcher', 'admin'].includes(user.role) &&
        !canHardenWhitelistedCollection)
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
