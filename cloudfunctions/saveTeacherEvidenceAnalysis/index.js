const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// ==================================================
// saveTeacherEvidenceAnalysis
//
// 职责：
// 1. 作为 evidence_analysis 的最终数据库写入口
// 2. 重新验证教师主体与原始 evidence
// 3. 重新验证 task / variable 关系
// 4. 再次执行 evidence_analysis V1.0 校验
// 5. 防止同一 evidence 重复产生 active 分析
// 6. 写入 evidence_analysis
// 7. 更新原 evidence.analysis_status
//
// 安全原则：
// 当前版本只允许“内部调用”。
// 不允许小程序前端直接提交分析结果入库。
// ==================================================


// ==================================================
// ID 生成
// ==================================================

function createId(prefix) {
  const timePart =
    Date.now()
      .toString(36)
      .toUpperCase()

  const randomPart =
    Math.random()
      .toString(36)
      .substring(2, 7)
      .toUpperCase()

  return `${prefix}_${timePart}_${randomPart}`
}


// ==================================================
// evidence_analysis V1.0 内部校验
//
// 注意：
// 即使分析结果已经经过独立校验函数，
// 在真正写库前仍然再次校验。
// ==================================================

function validateAnalysis(analysis) {
  if (
    !analysis ||
    typeof analysis !== 'object' ||
    Array.isArray(analysis)
  ) {
    return {
      valid: false,
      code: 'ANALYSIS_REQUIRED',
      message: '缺少有效的证据分析结果'
    }
  }

  const allowedFields = [
    'relevance_status',
    'evidence_sufficiency',
    'extracted_points',
    'reasoning_basis',
    'context',
    'uncertainty'
  ]

  const receivedFields =
    Object.keys(analysis)

  const unexpectedFields =
    receivedFields.filter(
      key => !allowedFields.includes(key)
    )

  if (unexpectedFields.length > 0) {
    return {
      valid: false,
      code: 'UNEXPECTED_FIELDS',
      message: '分析结果包含未允许的字段',
      unexpected_fields: unexpectedFields
    }
  }

  const missingFields =
    allowedFields.filter(
      key =>
        !Object.prototype.hasOwnProperty.call(
          analysis,
          key
        )
    )

  if (missingFields.length > 0) {
    return {
      valid: false,
      code: 'MISSING_FIELDS',
      message: '分析结果缺少必要字段',
      missing_fields: missingFields
    }
  }

  const allowedRelevance = [
    'relevant',
    'partially_relevant',
    'irrelevant',
    'uncertain'
  ]

  if (
    typeof analysis.relevance_status !== 'string' ||
    !allowedRelevance.includes(
      analysis.relevance_status
    )
  ) {
    return {
      valid: false,
      code: 'INVALID_RELEVANCE_STATUS',
      message: 'relevance_status 不符合 V1.0 规范'
    }
  }

  const allowedSufficiency = [
    'usable',
    'weak',
    'insufficient'
  ]

  if (
    typeof analysis.evidence_sufficiency !== 'string' ||
    !allowedSufficiency.includes(
      analysis.evidence_sufficiency
    )
  ) {
    return {
      valid: false,
      code: 'INVALID_EVIDENCE_SUFFICIENCY',
      message: 'evidence_sufficiency 不符合 V1.0 规范'
    }
  }

  if (
    !Array.isArray(
      analysis.extracted_points
    )
  ) {
    return {
      valid: false,
      code: 'INVALID_EXTRACTED_POINTS',
      message: 'extracted_points 必须是数组'
    }
  }

  if (
    analysis.extracted_points.length > 10
  ) {
    return {
      valid: false,
      code: 'TOO_MANY_EXTRACTED_POINTS',
      message: 'extracted_points 最多允许 10 条'
    }
  }

  const normalizedPoints = []

  for (
    let i = 0;
    i < analysis.extracted_points.length;
    i++
  ) {
    const point =
      analysis.extracted_points[i]

    if (typeof point !== 'string') {
      return {
        valid: false,
        code: 'INVALID_EXTRACTED_POINT_TYPE',
        message:
          `extracted_points 第 ${i + 1} 条不是字符串`
      }
    }

    const trimmedPoint =
      point.trim()

    if (!trimmedPoint) {
      return {
        valid: false,
        code: 'EMPTY_EXTRACTED_POINT',
        message:
          `extracted_points 第 ${i + 1} 条为空`
      }
    }

    if (trimmedPoint.length > 300) {
      return {
        valid: false,
        code: 'EXTRACTED_POINT_TOO_LONG',
        message:
          `extracted_points 第 ${i + 1} 条内容过长`
      }
    }

    normalizedPoints.push(
      trimmedPoint
    )
  }

  if (
    typeof analysis.reasoning_basis !== 'string'
  ) {
    return {
      valid: false,
      code: 'INVALID_REASONING_BASIS',
      message: 'reasoning_basis 必须是字符串'
    }
  }

  const reasoningBasis =
    analysis.reasoning_basis.trim()

  if (!reasoningBasis) {
    return {
      valid: false,
      code: 'EMPTY_REASONING_BASIS',
      message: 'reasoning_basis 不能为空'
    }
  }

  if (reasoningBasis.length > 2000) {
    return {
      valid: false,
      code: 'REASONING_BASIS_TOO_LONG',
      message: 'reasoning_basis 内容过长'
    }
  }

  if (
    typeof analysis.context !== 'string'
  ) {
    return {
      valid: false,
      code: 'INVALID_CONTEXT',
      message: 'context 必须是字符串'
    }
  }

  const analysisContext =
    analysis.context.trim()

  if (analysisContext.length > 1000) {
    return {
      valid: false,
      code: 'CONTEXT_TOO_LONG',
      message: 'context 内容过长'
    }
  }

  if (
    typeof analysis.uncertainty !== 'string'
  ) {
    return {
      valid: false,
      code: 'INVALID_UNCERTAINTY',
      message: 'uncertainty 必须是字符串'
    }
  }

  const uncertainty =
    analysis.uncertainty.trim()

  if (uncertainty.length > 1000) {
    return {
      valid: false,
      code: 'UNCERTAINTY_TOO_LONG',
      message: 'uncertainty 内容过长'
    }
  }

  // irrelevant 只能是 insufficient
  if (
    analysis.relevance_status === 'irrelevant' &&
    analysis.evidence_sufficiency !== 'insufficient'
  ) {
    return {
      valid: false,
      code: 'IRRELEVANT_SUFFICIENCY_CONFLICT',
      message:
        'irrelevant 证据的 evidence_sufficiency 必须为 insufficient'
    }
  }

  // irrelevant 不能提取信息点
  if (
    analysis.relevance_status === 'irrelevant' &&
    normalizedPoints.length > 0
  ) {
    return {
      valid: false,
      code: 'IRRELEVANT_POINTS_CONFLICT',
      message:
        'irrelevant 证据不应包含 extracted_points'
    }
  }

  // uncertain 只能是 insufficient
  if (
    analysis.relevance_status === 'uncertain' &&
    analysis.evidence_sufficiency !== 'insufficient'
  ) {
    return {
      valid: false,
      code: 'UNCERTAIN_SUFFICIENCY_CONFLICT',
      message:
        'uncertain 证据的 evidence_sufficiency 必须为 insufficient'
    }
  }

  // uncertain 不形成正式信息点
  if (
    analysis.relevance_status === 'uncertain' &&
    normalizedPoints.length > 0
  ) {
    return {
      valid: false,
      code: 'UNCERTAIN_POINTS_CONFLICT',
      message:
        'uncertain 证据不应包含 extracted_points'
    }
  }

  // usable 至少一个信息点
  if (
    analysis.evidence_sufficiency === 'usable' &&
    normalizedPoints.length === 0
  ) {
    return {
      valid: false,
      code: 'USABLE_WITHOUT_POINTS',
      message:
        'usable 证据必须至少包含一个 extracted_point'
    }
  }

  // usable 必须与变量相关
  if (
    analysis.evidence_sufficiency === 'usable' &&
    ![
      'relevant',
      'partially_relevant'
    ].includes(
      analysis.relevance_status
    )
  ) {
    return {
      valid: false,
      code: 'USABLE_RELEVANCE_CONFLICT',
      message:
        'usable 证据必须为 relevant 或 partially_relevant'
    }
  }

  return {
    valid: true,

    normalized_analysis: {
      relevance_status:
        analysis.relevance_status,

      evidence_sufficiency:
        analysis.evidence_sufficiency,

      extracted_points:
        normalizedPoints,

      reasoning_basis:
        reasoningBasis,

      context:
        analysisContext,

      uncertainty:
        uncertainty
    }
  }
}


// ==================================================
// 云函数入口
// ==================================================

exports.main = async (event, context) => {
  try {
    const wxContext =
      cloud.getWXContext()

    const openid =
      wxContext.OPENID

    const evidenceId =
      event && event.evidence_id
        ? String(event.evidence_id).trim()
        : ''

    const analysis =
      event && event.analysis
        ? event.analysis
        : null

    // ==================================================
    // 1. 内部调用保护
    //
    // 后续真实接入分析链路时：
    // analyzeTeacherEvidence 会在云端生成 analysis，
    // 再进入该写库逻辑。
    //
    // 当前不允许普通前端直接写分析。
    // ==================================================

    const internalCall =
      event &&
      event.internal_call === true

    if (!internalCall) {
      return {
        success: false,
        code: 'INTERNAL_ONLY',
        message:
          '该函数仅供后台证据分析流程内部使用'
      }
    }

    // ==================================================
    // 2. 基础参数检查
    // ==================================================

    if (!openid) {
      return {
        success: false,
        code: 'NO_OPENID',
        message: '未获取到微信用户标识'
      }
    }

    if (!evidenceId) {
      return {
        success: false,
        code: 'EVIDENCE_ID_REQUIRED',
        message: '缺少证据编号'
      }
    }

    // ==================================================
    // 3. 再次执行 V1.0 分析结果校验
    // ==================================================

    const validationResult =
      validateAnalysis(analysis)

    if (!validationResult.valid) {
      return {
        success: false,
        valid: false,
        code:
          validationResult.code ||
          'INVALID_ANALYSIS',

        message:
          validationResult.message ||
          '证据分析结果未通过校验',

        unexpected_fields:
          validationResult.unexpected_fields,

        missing_fields:
          validationResult.missing_fields
      }
    }

    const normalizedAnalysis =
      validationResult.normalized_analysis

    // ==================================================
    // 4. 查询当前教师用户
    // ==================================================

    const userResult = await db
      .collection('users')
      .where({
        openid: openid
      })
      .limit(1)
      .get()

    if (userResult.data.length === 0) {
      return {
        success: false,
        code: 'USER_NOT_FOUND',
        message: '用户不存在'
      }
    }

    const user =
      userResult.data[0]

    if (user.role !== 'teacher') {
      return {
        success: false,
        code: 'NOT_TEACHER',
        message: '当前账号不是教师身份'
      }
    }

    // ==================================================
    // 5. 查询当前教师主体
    // ==================================================

    const mapResult = await db
      .collection('identity_map')
      .where({
        user_id: user.user_id,
        identity_type: 'teacher'
      })
      .limit(1)
      .get()

    if (mapResult.data.length === 0) {
      return {
        success: false,
        code: 'SUBJECT_NOT_FOUND',
        message: '尚未建立教师主体'
      }
    }

    const subjectId =
      mapResult.data[0].subject_id

    // ==================================================
    // 6. 重新读取真实 evidence
    // ==================================================

    const evidenceResult = await db
      .collection('evidence')
      .where({
        evidence_id: evidenceId,
        subject_id: subjectId,
        subject_type: 'teacher',
        status: 'active'
      })
      .limit(1)
      .get()

    if (evidenceResult.data.length === 0) {
      return {
        success: false,
        code: 'EVIDENCE_NOT_FOUND',
        message:
          '未找到当前教师对应的有效证据'
      }
    }

    const evidence =
      evidenceResult.data[0]

    // ==================================================
    // 7. 检查 evidence 基础字段
    // ==================================================

    if (
      !evidence.task_id ||
      !evidence.variable_id
    ) {
      return {
        success: false,
        code: 'EVIDENCE_INCOMPLETE',
        message:
          '当前证据缺少任务或变量信息'
      }
    }

    const framework =
      evidence.framework ||
      'teacher_v1.0'

    // ==================================================
    // 8. 再次读取并核对 collection_task
    // ==================================================

    const taskResult = await db
      .collection('collection_tasks')
      .where({
        task_id: evidence.task_id,
        subject_type: 'teacher',
        framework: framework,
        status: 'active'
      })
      .limit(1)
      .get()

    if (taskResult.data.length === 0) {
      return {
        success: false,
        code: 'TASK_NOT_FOUND',
        message:
          '证据对应的采集任务不存在或不可用'
      }
    }

    const task =
      taskResult.data[0]

    if (
      task.variable_id !==
      evidence.variable_id
    ) {
      return {
        success: false,
        code: 'VARIABLE_MISMATCH',
        message:
          '证据变量与任务配置不一致'
      }
    }

    if (
      task.dimension_id &&
      evidence.dimension_id &&
      task.dimension_id !==
        evidence.dimension_id
    ) {
      return {
        success: false,
        code: 'DIMENSION_MISMATCH',
        message:
          '证据维度与任务配置不一致'
      }
    }

    // ==================================================
    // 9. 幂等检查
    //
    // 同一 evidence 只允许一条 active 正式分析。
    // ==================================================

    const existingResult = await db
      .collection('evidence_analysis')
      .where({
        evidence_id: evidenceId,
        subject_id: subjectId,
        status: 'active'
      })
      .limit(1)
      .get()

    if (existingResult.data.length > 0) {
      return {
        success: true,

        already_saved: true,

        analysis_id:
          existingResult.data[0]
            .analysis_id,

        evidence_id:
          evidenceId,

        analysis:
          existingResult.data[0],

        message:
          '当前证据已经存在有效分析结果'
      }
    }

    // ==================================================
    // 10. 创建正式 analysis 记录
    // ==================================================

    const now =
      new Date()

    const analysisId =
      createId('EA')

    const analysisRecord = {
      analysis_id:
        analysisId,

      evidence_id:
        evidenceId,

      subject_id:
        subjectId,

      subject_type:
        'teacher',

      framework:
        framework,

      dimension_id:
        evidence.dimension_id ||
        task.dimension_id ||
        '',

      dimension_name:
        evidence.dimension_name ||
        task.dimension_name ||
        '',

      variable_id:
        evidence.variable_id,

      variable_name:
        evidence.variable_name ||
        task.variable_name ||
        '',

      task_id:
        evidence.task_id,

      relevance_status:
        normalizedAnalysis
          .relevance_status,

      evidence_sufficiency:
        normalizedAnalysis
          .evidence_sufficiency,

      extracted_points:
        normalizedAnalysis
          .extracted_points,

      reasoning_basis:
        normalizedAnalysis
          .reasoning_basis,

      context:
        normalizedAnalysis
          .context,

      uncertainty:
        normalizedAnalysis
          .uncertainty,

      analysis_method:
        'teacher_evidence_analysis',

      analysis_version:
        '1.0',

      status:
        'active',

      created_at:
        now,

      updated_at:
        now
    }

    const addResult = await db
      .collection('evidence_analysis')
      .add({
        data: analysisRecord
      })

    // ==================================================
    // 11. 更新原始 evidence 的分析状态
    //
    // 不覆盖 raw_text、transcript 等原始信息。
    // ==================================================

    await db
      .collection('evidence')
      .doc(evidence._id)
      .update({
        data: {
          analysis_status:
            'completed',

          analysis_id:
            analysisId,

          analyzed_at:
            now,

          updated_at:
            now
        }
      })

    // ==================================================
    // 12. 返回结果
    // ==================================================

    return {
      success: true,

      already_saved: false,

      analysis_id:
        analysisId,

      evidence_id:
        evidenceId,

      database_id:
        addResult._id,

      analysis:
        analysisRecord,

      message:
        '教师证据分析结果已正式归档'
    }

  } catch (error) {
    console.error(
      'saveTeacherEvidenceAnalysis error:',
      error
    )

    return {
      success: false,
      code: 'SAVE_ANALYSIS_ERROR',
      message:
        error.message ||
        '教师证据分析结果保存失败'
    }
  }
}