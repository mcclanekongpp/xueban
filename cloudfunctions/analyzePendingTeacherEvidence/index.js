const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()


// ==================================================
// analyzePendingTeacherEvidence
//
// 当前职责：
// 1. 识别当前教师
// 2. 找到当前教师所有待分析 evidence
// 3. 返回待分析 evidence_id 列表
//
// 本函数不再：
// - 调用 analyzeTeacherEvidence
// - 调用 AI
// - 写 evidence_analysis
// - 修改 evidence
//
// 真正的逐条分析由小程序前端直接调用
// analyzeTeacherEvidence 完成。
// ==================================================

exports.main = async (event, context) => {
  try {
    const wxContext =
      cloud.getWXContext()

    const openid =
      wxContext.OPENID


    // ==================================================
    // 1. 微信身份
    // ==================================================

    if (!openid) {
      return {
        success: false,
        code: 'NO_OPENID',
        message: '未获取到微信用户标识'
      }
    }


    // ==================================================
    // 2. 当前用户
    // ==================================================

    const userResult =
      await db
        .collection('users')
        .where({
          openid: openid
        })
        .limit(1)
        .get()

    if (
      userResult.data.length === 0
    ) {
      return {
        success: false,
        code: 'USER_NOT_FOUND',
        message: '用户不存在，请先登录'
      }
    }

    const user =
      userResult.data[0]

    if (
      user.role !== 'teacher'
    ) {
      return {
        success: false,
        code: 'NOT_TEACHER',
        message: '当前账号不是教师身份'
      }
    }


    // ==================================================
    // 3. 当前教师主体
    // ==================================================

    const mapResult =
      await db
        .collection('identity_map')
        .where({
          user_id: user.user_id,
          identity_type: 'teacher'
        })
        .limit(1)
        .get()

    if (
      mapResult.data.length === 0
    ) {
      return {
        success: false,
        code: 'SUBJECT_NOT_FOUND',
        message: '尚未建立教师主体'
      }
    }

    const subjectId =
      mapResult.data[0].subject_id


    // ==================================================
    // 4. 批次上限
    //
    // 首版最多返回 20 条。
    // 防止一次给前端过多任务。
    // ==================================================

    const requestedLimit =
      Number(
        event &&
        event.limit
      )

    let limit = 20

    if (
      Number.isFinite(requestedLimit) &&
      requestedLimit > 0
    ) {
      limit =
        Math.min(
          Math.floor(requestedLimit),
          20
        )
    }


    // ==================================================
    // 5. 查询待分析 evidence
    //
    // 当前只返回：
    // - 当前教师
    // - active
    // - analysis_status = pending
    // ==================================================

    const evidenceResult =
      await db
        .collection('evidence')
        .where({
          subject_id:
            subjectId,

          subject_type:
            'teacher',

          status:
            'active',

          analysis_status:
            'pending'
        })
        .orderBy(
          'created_at',
          'asc'
        )
        .limit(limit)
        .get()

    const evidenceList =
      evidenceResult.data || []


    // ==================================================
    // 6. 构造安全返回列表
    //
    // 前端只需要 evidence_id 和少量进度信息。
    // 不需要在这里返回 raw_text。
    // ==================================================

    const pendingList =
      evidenceList
        .filter(
          item =>
            !!item.evidence_id
        )
        .map(
          item => ({
            evidence_id:
              item.evidence_id,

            task_id:
              item.task_id || '',

            task_order:
              typeof item.task_order === 'number'
                ? item.task_order
                : null,

            variable_id:
              item.variable_id || '',

            variable_name:
              item.variable_name || '',

            created_at:
              item.created_at || null
          })
        )


    // ==================================================
    // 7. 查询全部 pending 数量
    //
    // 用于前端显示剩余数量。
    // ==================================================

    const countResult =
      await db
        .collection('evidence')
        .where({
          subject_id:
            subjectId,

          subject_type:
            'teacher',

          status:
            'active',

          analysis_status:
            'pending'
        })
        .count()

    const totalPending =
      countResult.total || 0


    // ==================================================
    // 8. 返回
    // ==================================================

    return {
      success: true,

      subject_id:
        subjectId,

      total_pending:
        totalPending,

      returned_count:
        pendingList.length,

      has_pending:
        totalPending > 0,

      pending_evidence:
        pendingList,

      message:
        totalPending > 0
          ? '教师待分析证据列表读取成功'
          : '当前没有待分析的教师证据'
    }

  } catch (error) {
    console.error(
      'analyzePendingTeacherEvidence error:',
      error
    )

    return {
      success: false,

      code:
        'GET_PENDING_EVIDENCE_ERROR',

      message:
        error.message ||
        '教师待分析证据列表读取失败'
    }
  }
}