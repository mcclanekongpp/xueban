const cloud = require('wx-server-sdk')
const CloudBaseModule = require('@cloudbase/manager-node')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const CloudBase = CloudBaseModule.default || CloudBaseModule

const TARGET_ENV = 'model-dev-d9gkoyaolb464c28d'
const ALLOWED_FUNCTION_TIMEOUTS = Object.freeze({
  analyzeStudentEvidence: 120,
  analyzeTeacherEvidence: 120,
  advanceSubjectModel: 120,
  buildStudentInitialModel: 30,
  transcribeVoice: 60
})

const ACTIVE_TEACHER_TIMEOUT_ONLY = new Set([
  'analyzeStudentEvidence',
  'analyzeTeacherEvidence',
  'advanceSubjectModel',
  'transcribeVoice'
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
  const functionName =
    typeof event.function_name === 'string'
      ? event.function_name.trim()
      : ''
  const timeout = ALLOWED_FUNCTION_TIMEOUTS[functionName]

  if (!openid) {
    return {
      success: false,
      code: 'NO_OPENID',
      message: '未获取到微信用户标识'
    }
  }

  if (
    ![
      'STUDENT_M0_FUNCTION_TIMEOUTS',
      'SUBJECT_MODEL_PIPELINE_TIMEOUTS'
    ].includes(event.confirmation) ||
    !timeout
  ) {
    return {
      success: false,
      code: 'INVALID_CONFIGURATION_REQUEST',
      message: '配置请求不在 Student-M0 云函数白名单内'
    }
  }

  try {
    const user = await getCurrentUser(openid)
    const canApplyCollectionPipelineTimeout =
      user &&
      user.status === 'active' &&
      user.role === 'teacher' &&
      ACTIVE_TEACHER_TIMEOUT_ONLY.has(functionName)

    if (
      !user ||
      user.status !== 'active' ||
      (
        !['researcher', 'admin'].includes(user.role) &&
        !canApplyCollectionPipelineTimeout
      )
    ) {
      return {
        success: false,
        code: 'CONFIGURATION_FORBIDDEN',
        message: '当前账号无权执行云函数运行配置'
      }
    }

    const manager = CloudBase.init({
      envId: TARGET_ENV
    })

    const updateResult = await manager.functions.updateFunctionConfig({
      name: functionName,
      timeout
    })

    return {
      success: true,
      environment_id: TARGET_ENV,
      function_name: functionName,
      timeout,
      request_id: updateResult && updateResult.RequestId
    }
  } catch (error) {
    console.error('configureStudentMvpFunctions error:', error)

    return {
      success: false,
      code: 'CONFIGURE_FUNCTION_ERROR',
      message: error.message || '云函数运行配置失败'
    }
  }
}
