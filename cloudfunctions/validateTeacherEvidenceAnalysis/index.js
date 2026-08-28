// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

// ==================================================
// validateTeacherEvidenceAnalysis
//
// 职责：
// 对 evidence_analysis V1.0 的模型分析结果进行结构与逻辑校验。
//
// 当前函数：
// 1. 不读取原始 evidence
// 2. 不调用大模型
// 3. 不写入数据库
// 4. 不修改主体模型
//
// 只负责：
// 模型分析结果
//      ↓
// 结构校验
//      ↓
// 逻辑校验
//      ↓
// 输出经过规范化的 analysis
// ==================================================

exports.main = async (event, context) => {
  try {
    const analysis =
      event && event.analysis
        ? event.analysis
        : null

    // ==================================================
    // 1. 基础检查
    // ==================================================

    if (
      !analysis ||
      typeof analysis !== 'object' ||
      Array.isArray(analysis)
    ) {
      return {
        success: false,
        valid: false,
        code: 'ANALYSIS_REQUIRED',
        message: '缺少有效的证据分析结果'
      }
    }

    // ==================================================
    // 2. evidence_analysis V1.0
    // 允许出现的字段
    //
    // 使用白名单，而不是黑名单。
    // 模型不得自行增加评分、教师类型、
    // 主体模型结论等字段。
    // ==================================================

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
        success: false,
        valid: false,
        code: 'UNEXPECTED_FIELDS',
        message: '分析结果包含未允许的字段',
        unexpected_fields:
          unexpectedFields
      }
    }

    // ==================================================
    // 3. 检查必需字段
    // ==================================================

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
        success: false,
        valid: false,
        code: 'MISSING_FIELDS',
        message: '分析结果缺少必要字段',
        missing_fields:
          missingFields
      }
    }

    // ==================================================
    // 4. relevance_status 校验
    // ==================================================

    const allowedRelevance = [
      'relevant',
      'partially_relevant',
      'irrelevant',
      'uncertain'
    ]

    if (
      typeof analysis.relevance_status !==
        'string' ||
      !allowedRelevance.includes(
        analysis.relevance_status
      )
    ) {
      return {
        success: false,
        valid: false,
        code: 'INVALID_RELEVANCE_STATUS',
        message:
          'relevance_status 不符合 evidence_analysis V1.0 规范'
      }
    }

    // ==================================================
    // 5. evidence_sufficiency 校验
    // ==================================================

    const allowedSufficiency = [
      'usable',
      'weak',
      'insufficient'
    ]

    if (
      typeof analysis.evidence_sufficiency !==
        'string' ||
      !allowedSufficiency.includes(
        analysis.evidence_sufficiency
      )
    ) {
      return {
        success: false,
        valid: false,
        code: 'INVALID_EVIDENCE_SUFFICIENCY',
        message:
          'evidence_sufficiency 不符合 evidence_analysis V1.0 规范'
      }
    }

    // ==================================================
    // 6. extracted_points 校验
    //
    // 必须是字符串数组。
    // 为避免模型输出失控：
    // - 最多 10 条
    // - 每条最多 300 字
    // ==================================================

    if (
      !Array.isArray(
        analysis.extracted_points
      )
    ) {
      return {
        success: false,
        valid: false,
        code: 'INVALID_EXTRACTED_POINTS',
        message:
          'extracted_points 必须是数组'
      }
    }

    if (
      analysis.extracted_points.length > 10
    ) {
      return {
        success: false,
        valid: false,
        code: 'TOO_MANY_EXTRACTED_POINTS',
        message:
          'extracted_points 最多允许 10 条'
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
          success: false,
          valid: false,
          code:
            'INVALID_EXTRACTED_POINT_TYPE',
          message:
            `extracted_points 第 ${i + 1} 条不是字符串`
        }
      }

      const trimmedPoint =
        point.trim()

      if (!trimmedPoint) {
        return {
          success: false,
          valid: false,
          code:
            'EMPTY_EXTRACTED_POINT',
          message:
            `extracted_points 第 ${i + 1} 条为空`
        }
      }

      if (trimmedPoint.length > 300) {
        return {
          success: false,
          valid: false,
          code:
            'EXTRACTED_POINT_TOO_LONG',
          message:
            `extracted_points 第 ${i + 1} 条内容过长`
        }
      }

      normalizedPoints.push(
        trimmedPoint
      )
    }

    // ==================================================
    // 7. reasoning_basis 校验
    // ==================================================

    if (
      typeof analysis.reasoning_basis !==
        'string'
    ) {
      return {
        success: false,
        valid: false,
        code: 'INVALID_REASONING_BASIS',
        message:
          'reasoning_basis 必须是字符串'
      }
    }

    const reasoningBasis =
      analysis.reasoning_basis.trim()

    if (!reasoningBasis) {
      return {
        success: false,
        valid: false,
        code: 'EMPTY_REASONING_BASIS',
        message:
          'reasoning_basis 不能为空'
      }
    }

    if (reasoningBasis.length > 2000) {
      return {
        success: false,
        valid: false,
        code: 'REASONING_BASIS_TOO_LONG',
        message:
          'reasoning_basis 内容过长'
      }
    }

    // ==================================================
    // 8. context 校验
    // ==================================================

    if (
      typeof analysis.context !==
        'string'
    ) {
      return {
        success: false,
        valid: false,
        code: 'INVALID_CONTEXT',
        message:
          'context 必须是字符串'
      }
    }

    const analysisContext =
      analysis.context.trim()

    if (analysisContext.length > 1000) {
      return {
        success: false,
        valid: false,
        code: 'CONTEXT_TOO_LONG',
        message:
          'context 内容过长'
      }
    }

    // ==================================================
    // 9. uncertainty 校验
    // ==================================================

    if (
      typeof analysis.uncertainty !==
        'string'
    ) {
      return {
        success: false,
        valid: false,
        code: 'INVALID_UNCERTAINTY',
        message:
          'uncertainty 必须是字符串'
      }
    }

    const uncertainty =
      analysis.uncertainty.trim()

    if (uncertainty.length > 1000) {
      return {
        success: false,
        valid: false,
        code: 'UNCERTAINTY_TOO_LONG',
        message:
          'uncertainty 内容过长'
      }
    }

    // ==================================================
    // 10. 逻辑一致性规则
    //
    // 规则 A：
    // irrelevant 不可能同时是 usable / weak。
    //
    // 因为既然与变量无关，
    // 就不能成为该变量的有效或弱证据。
    // ==================================================

    if (
      analysis.relevance_status ===
        'irrelevant' &&
      analysis.evidence_sufficiency !==
        'insufficient'
    ) {
      return {
        success: false,
        valid: false,
        code:
          'IRRELEVANT_SUFFICIENCY_CONFLICT',
        message:
          'irrelevant 证据的 evidence_sufficiency 必须为 insufficient'
      }
    }

    // ==================================================
    // 规则 B：
    // irrelevant 不应提取变量信息点。
    // ==================================================

    if (
      analysis.relevance_status ===
        'irrelevant' &&
      normalizedPoints.length > 0
    ) {
      return {
        success: false,
        valid: false,
        code:
          'IRRELEVANT_POINTS_CONFLICT',
        message:
          'irrelevant 证据不应包含 extracted_points'
      }
    }

    // ==================================================
    // 规则 C：
    // uncertain 表示当前无法可靠判断相关性。
    //
    // 因此不能直接认定为 usable 或 weak，
    // 也不应从中抽取正式信息点。
    // ==================================================

    if (
      analysis.relevance_status ===
        'uncertain' &&
      analysis.evidence_sufficiency !==
        'insufficient'
    ) {
      return {
        success: false,
        valid: false,
        code:
          'UNCERTAIN_SUFFICIENCY_CONFLICT',
        message:
          'uncertain 证据的 evidence_sufficiency 必须为 insufficient'
      }
    }

    if (
      analysis.relevance_status ===
        'uncertain' &&
      normalizedPoints.length > 0
    ) {
      return {
        success: false,
        valid: false,
        code:
          'UNCERTAIN_POINTS_CONFLICT',
        message:
          'uncertain 证据不应包含 extracted_points'
      }
    }

    // ==================================================
    // 规则 D：
    // usable 必须至少提取出一个明确的信息点。
    // ==================================================

    if (
      analysis.evidence_sufficiency ===
        'usable' &&
      normalizedPoints.length === 0
    ) {
      return {
        success: false,
        valid: false,
        code:
          'USABLE_WITHOUT_POINTS',
        message:
          'usable 证据必须至少包含一个 extracted_point'
      }
    }

    // ==================================================
    // 规则 E：
    // usable 必须是真正相关或部分相关。
    // ==================================================

    if (
      analysis.evidence_sufficiency ===
        'usable' &&
      ![
        'relevant',
        'partially_relevant'
      ].includes(
        analysis.relevance_status
      )
    ) {
      return {
        success: false,
        valid: false,
        code:
          'USABLE_RELEVANCE_CONFLICT',
        message:
          'usable 证据必须为 relevant 或 partially_relevant'
      }
    }

    // ==================================================
    // 11. 构造经过校验的规范化结果
    //
    // 注意：
    // 这里只返回数据。
    // 不写 evidence_analysis。
    // ==================================================

    const normalizedAnalysis = {
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

    return {
      success: true,
      valid: true,

      protocol_name:
        'teacher_evidence_analysis',

      protocol_version:
        '1.0',

      normalized_analysis:
        normalizedAnalysis,

      message:
        '证据分析结果通过 evidence_analysis V1.0 校验'
    }

  } catch (error) {
    console.error(
      'validateTeacherEvidenceAnalysis error:',
      error
    )

    return {
      success: false,
      valid: false,
      code:
        'VALIDATION_ERROR',
      message:
        error.message ||
        '证据分析结果校验失败'
    }
  }
}