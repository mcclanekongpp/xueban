// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// ==================================================
// 生成 evidence_id
// ==================================================

function createEvidenceId() {
  const time = Date.now()
    .toString(36)
    .toUpperCase()

  const random = Math.random()
    .toString(36)
    .slice(2, 7)
    .toUpperCase()

  return `EVI_${time}_${random}`
}


// ==================================================
// 云函数入口函数
// ==================================================

exports.main = async (event, context) => {
  try {
    const wxContext =
      cloud.getWXContext()

    const openid =
      wxContext.OPENID

    const sessionId =
      event.session_id || ''

    // ==================================================
    // 1. 基础身份校验
    // ==================================================

    if (!openid) {
      return {
        success: false,
        code: 'NO_OPENID',
        message: '未获取到微信用户标识'
      }
    }

    if (!sessionId) {
      return {
        success: false,
        code: 'SESSION_ID_REQUIRED',
        message: '缺少会话编号'
      }
    }

    // ==================================================
    // 2. 查询当前用户
    // ==================================================

    const userResult =
      await db.collection('users')
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
    // 3. 找到当前教师主体
    // ==================================================

    const mapResult =
      await db.collection('identity_map')
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
    // 4. 查询目标 session
    // ==================================================

    const sessionResult =
      await db.collection('sessions')
        .where({
          session_id: sessionId,
          user_id: user.user_id,
          subject_id: subjectId
        })
        .limit(1)
        .get()

    if (
      sessionResult.data.length === 0
    ) {
      return {
        success: false,
        code: 'SESSION_NOT_FOUND',
        message: '未找到对应采集会话'
      }
    }

    const session =
      sessionResult.data[0]

    // 当前函数只处理首次预设采集
    if (
      session.session_type !==
      'initial_interview'
    ) {
      return {
        success: false,
        code: 'INVALID_SESSION_TYPE',
        message: '当前会话不是首次预设采集会话'
      }
    }

    if (
      !session.task_id ||
      !session.target_variable
    ) {
      return {
        success: false,
        code: 'SESSION_TASK_MISSING',
        message: '当前会话缺少任务或建模变量信息'
      }
    }

    const framework =
      session.framework ||
      'teacher_v1.0'

    // ==================================================
    // 5. 核验 task_id 与 variable_id 的真实关系
    // ==================================================

    const taskResult =
      await db.collection('collection_tasks')
        .where({
          task_id: session.task_id,
          subject_type: 'teacher',
          framework: framework,
          status: 'active'
        })
        .limit(1)
        .get()

    if (
      taskResult.data.length === 0
    ) {
      return {
        success: false,
        code: 'TASK_NOT_FOUND',
        message: '对应预设采集任务不存在或不可用'
      }
    }

    const task =
      taskResult.data[0]

    if (
      task.variable_id !==
      session.target_variable
    ) {
      return {
        success: false,
        code: 'TARGET_VARIABLE_MISMATCH',
        message: '会话建模变量与预设任务配置不一致'
      }
    }

    // ==================================================
    // 6. 读取该 session 中教师的语音消息
    // ==================================================

    const messageResult =
      await db.collection('messages')
        .where({
          session_id: sessionId,
          subject_id: subjectId,
          speaker: 'teacher',
          message_type: 'voice'
        })
        .limit(100)
        .get()

    const validMessages =
      messageResult.data
        .filter(item => {
          return (
            typeof item.content === 'string' &&
            item.content.trim().length > 0
          )
        })
        .sort((a, b) => {
          const sequenceA =
            typeof a.sequence === 'number'
              ? a.sequence
              : 0

          const sequenceB =
            typeof b.sequence === 'number'
              ? b.sequence
              : 0

          return sequenceA - sequenceB
        })

    if (
      validMessages.length === 0
    ) {
      return {
        success: false,
        code: 'NO_VALID_MESSAGES',
        message: '当前会话没有可归档的有效语音文本'
      }
    }

    // ==================================================
    // 7. 读取对应 voice_records
    // ==================================================

    const voiceResult =
      await db.collection('voice_records')
        .where({
          session_id: sessionId,
          subject_id: subjectId,
          asr_status: 'success'
        })
        .limit(100)
        .get()

    const voiceMap = {}

    voiceResult.data.forEach(item => {
      if (
        item.message_id &&
        typeof item.transcript === 'string' &&
        item.transcript.trim().length > 0
      ) {
        voiceMap[item.message_id] =
          item
      }
    })

    // ==================================================
    // 8. 查询该 session 已经生成过的 evidence
    // 防止重复归档
    // ==================================================

    const existingEvidenceResult =
      await db.collection('evidence')
        .where({
          subject_id: subjectId,
          session_id: sessionId,
          source_type: 'initial_interview'
        })
        .limit(100)
        .get()

    const existingMessageIds =
      new Set(
        existingEvidenceResult.data
          .map(item => item.message_id)
          .filter(Boolean)
      )

    // ==================================================
    // 9. 为每一段有效语音生成一条原始证据
    // ==================================================

    const createdEvidence = []

    let skippedCount = 0

    for (
      const message of validMessages
    ) {
      // 已归档过则跳过
      if (
        existingMessageIds.has(
          message.message_id
        )
      ) {
        skippedCount++
        continue
      }

      const voice =
        voiceMap[
          message.message_id
        ]

      // 必须能追溯到成功 ASR 的 voice_record
      if (!voice) {
        skippedCount++
        continue
      }

      const evidenceId =
        createEvidenceId()

      const evidenceData = {
        evidence_id:
          evidenceId,

        // =========================
        // 主体与模型位置
        // =========================

        subject_id:
          subjectId,

        subject_type:
          'teacher',

        framework:
          framework,

        dimension_id:
          task.dimension_id || '',

        dimension_name:
          task.dimension_name || '',

        variable_id:
          task.variable_id,

        variable_name:
          task.variable_name || '',

        // =========================
        // 来源任务
        // =========================

        source_type:
          'initial_interview',

        evidence_type:
          'voice_response',

        task_id:
          task.task_id,

        task_order:
          task.task_order,

        // =========================
        // 原始来源链
        // =========================

        session_id:
          sessionId,

        message_id:
          message.message_id,

        voice_id:
          voice.voice_id || '',

        file_id:
          voice.file_id || '',

        sequence:
          typeof message.sequence ===
            'number'
            ? message.sequence
            : null,

        // =========================
        // 原始证据内容
        // =========================

        raw_text:
          message.content.trim(),

        transcript:
          message.content.trim(),

        duration_ms:
          typeof voice.duration_ms ===
            'number'
            ? voice.duration_ms
            : null,

        // =========================
        // 分析层暂不处理
        // =========================

        analysis_status:
          'pending',

        interpretation:
          '',

        confidence:
          null,

        model_change_status:
          'not_evaluated',

        // =========================
        // 状态
        // =========================

        status:
          'active',

        created_at:
          db.serverDate(),

        updated_at:
          db.serverDate()
      }

      const addResult =
        await db.collection('evidence')
          .add({
            data: evidenceData
          })

      createdEvidence.push({
        record_id:
          addResult._id,

        evidence_id:
          evidenceId,

        message_id:
          message.message_id,

        voice_id:
          voice.voice_id || '',

        variable_id:
          task.variable_id,

        raw_text:
          message.content.trim()
      })
    }

    // ==================================================
    // 10. 返回归档结果
    // ==================================================

    return {
      success: true,

      subject_id:
        subjectId,

      framework:
        framework,

      task: {
        task_id:
          task.task_id,

        task_order:
          task.task_order,

        variable_id:
          task.variable_id,

        variable_name:
          task.variable_name
      },

      session_id:
        sessionId,

      valid_message_count:
        validMessages.length,

      created_count:
        createdEvidence.length,

      skipped_count:
        skippedCount,

      evidence:
        createdEvidence,

      message:
        createdEvidence.length > 0
          ? '教师任务原始证据归档完成'
          : '当前有效回答已经归档，无需重复创建'
    }

  } catch (error) {
    console.error(
      'createTeacherTaskEvidence error:',
      error
    )

    return {
      success: false,
      code: 'CREATE_EVIDENCE_ERROR',
      message:
        error.message ||
        '教师任务证据归档失败'
    }
  }
}