const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const ALLOWED_STATUSES = ['证据不足', '初步描述', '已有一定支持', '较稳定']

function toUncertaintyList(value) {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  return items
    .map((item) => String(item || '').trim())
    .filter((item) => item && !['none', '无', '暂无'].includes(item.toLowerCase()))
    .slice(0, 8)
}

// Guardian 只获得首次模型展示需要的安全摘要。
// 不返回 Evidence 原文、Evidence Analysis reasoning、证据 ID 或身份哈希。
function sanitizeModel(modelData) {
  const dimensions = Array.isArray(modelData && modelData.dimensions)
    ? modelData.dimensions
    : []

  return {
    overview_summary: String(modelData && modelData.overview_summary || '').trim().slice(0, 100),
    dimensions: dimensions.map((dimension) => ({
      dimension_id: String(dimension.dimension_id || '').trim(),
      dimension_name: String(dimension.dimension_name || '').trim(),
      variables: (Array.isArray(dimension.variables) ? dimension.variables : []).map((variable) => ({
        variable_id: String(variable.variable_id || '').trim(),
        variable_name: String(variable.variable_name || '').trim(),
        current_status: ALLOWED_STATUSES.includes(variable.current_status)
          ? variable.current_status
          : '证据不足',
        current_description: String(variable.current_description || '现有信息还不足以形成描述。').trim(),
        uncertainty: toUncertaintyList(variable.uncertainty)
      }))
    })),
    model_cautions: [
      '当前结果只基于已经完成的采集形成，不是分数、排名或最终结论。',
      '后续仍可根据新的真实信息持续完善。'
    ]
  }
}

function createdTime(item) {
  const value = item && item.created_at
  const time = value instanceof Date ? value.getTime() : new Date(value || 0).getTime()
  return Number.isFinite(time) ? time : 0
}

exports.main = async (event = {}) => {
  const openid = cloud.getWXContext().OPENID
  const subjectId = String(event.subject_id || '').trim()

  if (!openid || !subjectId) {
    return {
      success: false,
      code: !openid ? 'NO_OPENID' : 'STUDENT_SUBJECT_ID_REQUIRED',
      message: !openid ? '未获取到微信用户标识' : '缺少学生研究主体编号'
    }
  }

  try {
    const userResult = await db.collection('users').where({ openid }).limit(2).get()

    if (userResult.data.length !== 1) {
      return { success: false, code: 'USER_NOT_FOUND', message: '当前用户不存在' }
    }

    const user = userResult.data[0]
    const [bindingResult, subjectResult] = await Promise.all([
      db.collection('guardian_student_bindings').where({
        user_id: user.user_id,
        subject_id: subjectId,
        status: 'active'
      }).limit(2).get(),
      db.collection('subjects').where({
        subject_id: subjectId,
        subject_type: 'student',
        model_framework: 'student_v1.0',
        status: 'active'
      }).limit(2).get()
    ])

    if (subjectResult.data.length !== 1) {
      return {
        success: false,
        code: 'STUDENT_SUBJECT_NOT_ACTIVE',
        message: '学生研究主体不存在或已失效'
      }
    }

    if (bindingResult.data.length > 1) {
      return {
        success: false,
        code: 'DUPLICATE_ACTIVE_STUDENT_BINDINGS',
        message: '学生采集绑定存在重复，请联系研究人员处理'
      }
    }

    const hasActiveBinding = bindingResult.data.length === 1
    const isResearchOperator = ['researcher', 'admin'].includes(user.role)

    if (!hasActiveBinding && !isResearchOperator) {
      return {
        success: false,
        code: 'STUDENT_MODEL_NOT_AUTHORIZED',
        message: '当前微信无权读取该学生的首次建模结果'
      }
    }

    const activeResult = await db.collection('model_snapshots').where({
      subject_id: subjectId,
      subject_type: 'student',
      framework: 'student_v1.0',
      status: 'active'
    }).limit(2).get()

    if (activeResult.data.length > 1) {
      return {
        success: false,
        code: 'MULTIPLE_ACTIVE_STUDENT_MODELS',
        message: '该学生存在多个 active 模型，需研究人员处理'
      }
    }

    let snapshot = activeResult.data[0] || null

    if (!snapshot) {
      const draftResult = await db.collection('model_snapshots').where({
        subject_id: subjectId,
        subject_type: 'student',
        framework: 'student_v1.0',
        model_type: 'initial',
        status: 'draft'
      }).limit(20).get()
      snapshot = (draftResult.data || []).sort((a, b) => createdTime(b) - createdTime(a))[0] || null
    }

    if (!snapshot) {
      return {
        success: true,
        has_model: false,
        subject_id: subjectId,
        framework: 'student_v1.0',
        snapshot_id: '',
        model_status: '',
        model: null
      }
    }

    const modelStatus = snapshot.status === 'active' ? 'active' : 'draft'
    const activationMode = String(snapshot.activation_mode || '').trim()

    return {
      success: true,
      has_model: true,
      subject_id: subjectId,
      framework: 'student_v1.0',
      snapshot_id: snapshot.snapshot_id,
      snapshot_type: snapshot.snapshot_type || snapshot.model_type || 'initial',
      model_version: snapshot.model_version || snapshot.version || '1.0',
      model_status: modelStatus,
      model_status_name: modelStatus === 'active'
        ? activationMode === 'automatic_rule'
          ? '规则自动更新'
          : activationMode === 'automatic_initial'
            ? '自动构建'
            : '历史已生效'
        : '自动构建待完成',
      activation_mode: activationMode,
      model: sanitizeModel(snapshot.model_data),
      approved_at: modelStatus === 'active' ? snapshot.approved_at || null : null,
      activated_at: modelStatus === 'active' ? snapshot.activated_at || snapshot.approved_at || null : null,
      created_at: snapshot.created_at || null,
      updated_at: snapshot.updated_at || null,
      access_scope: hasActiveBinding ? 'bound_student_safe_summary' : 'research_safe_summary'
    }
  } catch (error) {
    console.error('getStudentCurrentModel error:', error)
    return {
      success: false,
      code: 'GET_STUDENT_CURRENT_MODEL_ERROR',
      message: '读取学生首次建模结果失败'
    }
  }
}
