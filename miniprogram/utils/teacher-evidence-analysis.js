// ==================================================
// teacher-evidence-analysis.js
//
// 教师证据批量分析前端编排工具
//
// 职责：
// 1. 获取当前教师待分析 evidence
// 2. 按顺序逐条直接调用 analyzeTeacherEvidence
// 3. 每一次调用都由小程序直接发起，因此保留真实 OPENID
// 4. 单条失败不会中断整个批次
//
// 不负责：
// - 修改主体模型
// - 生成 model_snapshots
// ==================================================


/**
 * 获取当前教师待分析证据
 */
async function getPendingTeacherEvidence(limit = 10) {
  const result =
    await wx.cloud.callFunction({
      name: 'analyzePendingTeacherEvidence',
      data: {
        limit
      }
    })

  const data =
    result && result.result
      ? result.result
      : null

  if (
    !data ||
    data.success !== true
  ) {
    throw new Error(
      data && data.message
        ? data.message
        : '读取待分析教师证据失败'
    )
  }

  return data
}


/**
 * 分析一条教师证据
 */
async function analyzeOneTeacherEvidence(
  evidenceId
) {
  if (!evidenceId) {
    throw new Error(
      '缺少 evidence_id'
    )
  }

  const result =
    await wx.cloud.callFunction({
      name: 'analyzeTeacherEvidence',
      data: {
        evidence_id:
          evidenceId,

        save_analysis:
          true
      }
    })

  const data =
    result && result.result
      ? result.result
      : null

  if (
    !data ||
    data.success !== true
  ) {
    throw new Error(
      data && data.message
        ? data.message
        : '教师证据分析失败'
    )
  }

  return data
}


/**
 * 批量分析当前教师待分析证据
 *
 * 首版只处理当前返回批次。
 * 默认最多 10 条。
 */
async function analyzePendingTeacherEvidenceBatch(
  limit = 10
) {
  // ==================================================
  // 1. 获取 pending evidence
  // ==================================================

  const pendingResult =
    await getPendingTeacherEvidence(
      limit
    )

  const list =
    Array.isArray(
      pendingResult.pending_evidence
    )
      ? pendingResult.pending_evidence
      : []


  // ==================================================
  // 2. 当前没有待分析证据
  // ==================================================

  if (list.length === 0) {
    return {
      success: true,

      total_pending:
        pendingResult.total_pending || 0,

      batch_size:
        0,

      analyzed_count:
        0,

      already_analyzed_count:
        0,

      failed_count:
        0,

      results:
        [],

      message:
        '当前没有待分析的教师证据'
    }
  }


  // ==================================================
  // 3. 串行分析
  // ==================================================

  const results = []

  let analyzedCount = 0
  let alreadyAnalyzedCount = 0
  let failedCount = 0


  for (
    const item of list
  ) {
    const evidenceId =
      item.evidence_id

    try {
      const analysisResult =
        await analyzeOneTeacherEvidence(
          evidenceId
        )


      // 已有分析结果
      if (
        analysisResult.already_analyzed ===
        true
      ) {
        alreadyAnalyzedCount++

        results.push({
          evidence_id:
            evidenceId,

          success:
            true,

          already_analyzed:
            true,

          analysis_id:
            analysisResult.analysis_id ||
            '',

          message:
            analysisResult.message ||
            '证据已有分析结果'
        })

        continue
      }


      // 本次正式分析成功
      if (
        analysisResult.saved === true
      ) {
        analyzedCount++

        results.push({
          evidence_id:
            evidenceId,

          success:
            true,

          already_analyzed:
            false,

          saved:
            true,

          analysis_id:
            analysisResult.analysis_id ||
            '',

          relevance_status:
            analysisResult.analysis &&
            analysisResult.analysis
              .relevance_status
              ? analysisResult.analysis
                  .relevance_status
              : '',

          evidence_sufficiency:
            analysisResult.analysis &&
            analysisResult.analysis
              .evidence_sufficiency
              ? analysisResult.analysis
                  .evidence_sufficiency
              : '',

          message:
            analysisResult.message ||
            '证据分析成功'
        })

        continue
      }


      // 未识别结果
      failedCount++

      results.push({
        evidence_id:
          evidenceId,

        success:
          false,

        message:
          '证据分析返回未识别状态'
      })

    } catch (error) {
      // ==================================================
      // 4. 单条失败不影响下一条
      // ==================================================

      console.error(
        `教师证据分析失败 ${evidenceId}:`,
        error
      )

      failedCount++

      results.push({
        evidence_id:
          evidenceId,

        success:
          false,

        message:
          error.message ||
          '教师证据分析失败'
      })
    }
  }


  // ==================================================
  // 5. 返回批量结果
  // ==================================================

  return {
    success: true,

    total_pending:
      pendingResult.total_pending || 0,

    batch_size:
      list.length,

    analyzed_count:
      analyzedCount,

    already_analyzed_count:
      alreadyAnalyzedCount,

    failed_count:
      failedCount,

    results:
      results,

    message:
      failedCount === 0
        ? '教师待分析证据处理完成'
        : '教师待分析证据处理完成，部分证据失败'
  }
}


module.exports = {
  getPendingTeacherEvidence,
  analyzeOneTeacherEvidence,
  analyzePendingTeacherEvidenceBatch
}