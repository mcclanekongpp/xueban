// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command


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
// 将当前任务的有效回答归档到 evidence
//
// 只做“原始证据归档”。
// 不做模型解释、不评分、不修改思想模型。
// ==================================================

async function archiveTaskEvidence({
  subjectId,
  session,
  task,
  framework
}) {
  const sessionId =
    session.session_id

  // --------------------------------
  // 1. 查询教师语音消息
  // --------------------------------

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

  if (validMessages.length === 0) {
    return {
      success: false,
      code: 'NO_VALID_MESSAGES',
      message: '当前任务没有可归档的有效语音文本'
    }
  }

  // --------------------------------
  // 2. 查询成功完成 ASR 的 voice_records
  // --------------------------------

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

  // --------------------------------
  // 3. 查询已有 evidence
  // 防止重复归档
  // --------------------------------

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

  let createdCount = 0
  let skippedCount = 0
  let archivedValidCount = 0

  const createdEvidenceIds = []

  // --------------------------------
  // 4. 每一段有效回答形成一条原始 evidence
  // --------------------------------

  for (const message of validMessages) {
    const messageId =
      message.message_id

    // 已经归档过
    if (
      existingMessageIds.has(
        messageId
      )
    ) {
      skippedCount++
      archivedValidCount++
      continue
    }

    const voice =
      voiceMap[messageId]

    // 必须能追溯到成功 ASR 的原始语音
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
      // 原始数据追溯链
      // =========================

      session_id:
        sessionId,

      message_id:
        messageId,

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
      // 后续分析层
      // 当前暂不处理
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

    await db.collection('evidence')
      .add({
        data: evidenceData
      })

    createdCount++
    archivedValidCount++

    createdEvidenceIds.push(
      evidenceId
    )
  }

  // 至少必须有一条有效回答已经进入 evidence
  if (archivedValidCount === 0) {
    return {
      success: false,
      code: 'EVIDENCE_ARCHIVE_FAILED',
      message: '有效回答未能完成证据归档'
    }
  }

  return {
    success: true,

    valid_message_count:
      validMessages.length,

    archived_valid_count:
      archivedValidCount,

    created_count:
      createdCount,

    skipped_count:
      skippedCount,

    created_evidence_ids:
      createdEvidenceIds
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

    const sessionId =
      event.session_id || ''

    // ==================================================
    // 1. 检查微信身份
    // ==================================================

    if (!openid) {
      return {
        success: false,
        code: 'NO_OPENID',
        message: '未获取到微信用户标识'
      }
    }

    // ==================================================
    // 2. 必须传 session_id
    // ==================================================

    if (!sessionId) {
      return {
        success: false,
        code: 'SESSION_ID_REQUIRED',
        message: '缺少会话编号'
      }
    }

    // ==================================================
    // 3. 查询当前微信账号
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
    // 4. 找到当前教师主体
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

    const framework =
      'teacher_v1.0'

    // ==================================================
    // 5. 查询当前采集进度
    // ==================================================

    const progressResult =
      await db.collection('collection_progress')
        .where({
          subject_id: subjectId,
          framework: framework
        })
        .limit(1)
        .get()

    if (
      progressResult.data.length === 0
    ) {
      return {
        success: false,
        code: 'COLLECTION_PROGRESS_NOT_FOUND',
        message: '尚未建立教师首次采集进度'
      }
    }

    const progress =
      progressResult.data[0]

    // ==================================================
    // 6. 查询本次会话
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
        message: '未找到当前采集会话'
      }
    }

    const session =
      sessionResult.data[0]

    // ==================================================
    // 7. 必须是首次预设采集
    // ==================================================

    if (
      session.session_type !==
      'initial_interview'
    ) {
      return {
        success: false,
        code: 'INVALID_SESSION_TYPE',
        message: '该会话不是首次预设采集会话'
      }
    }

    if (!session.task_id) {
      return {
        success: false,
        code: 'SESSION_TASK_MISSING',
        message: '当前会话没有绑定预设采集任务'
      }
    }

    // ==================================================
    // 8. 幂等处理
    //
    // 已完成任务再次提交，
    // 不重复增加 completed_count
    // ==================================================

    const completedTaskIds =
      Array.isArray(
        progress.completed_task_ids
      )
        ? progress.completed_task_ids
        : []

    if (
      completedTaskIds.includes(
        session.task_id
      )
    ) {
      return {
        success: true,

        already_completed:
          true,

        collection_completed:
          progress.status ===
          'completed',

        progress: {
          progress_id:
            progress.progress_id,

          current_task_id:
            progress.current_task_id,

          current_order:
            progress.current_order,

          completed_count:
            progress.completed_count,

          status:
            progress.status
        },

        message:
          '该任务已经完成，无需重复提交'
      }
    }

    // ==================================================
    // 9. 整个首次采集已经完成
    // ==================================================

    if (
      progress.status ===
      'completed'
    ) {
      return {
        success: true,

        already_completed:
          true,

        collection_completed:
          true,

        progress: {
          progress_id:
            progress.progress_id,

          completed_count:
            progress.completed_count,

          status:
            progress.status
        },

        message:
          '教师首次主体采集已经全部完成'
      }
    }

    // ==================================================
    // 10. session 必须对应当前任务
    // ==================================================

    if (
      progress.current_task_id !==
      session.task_id
    ) {
      return {
        success: false,
        code: 'TASK_NOT_CURRENT',
        message: '该会话对应的任务不是当前应完成任务',
        current_task_id:
          progress.current_task_id
      }
    }

    // ==================================================
    // 11. 查询任务配置
    // ==================================================

    const taskResult =
      await db.collection('collection_tasks')
        .where({
          task_id:
            session.task_id,

          subject_type:
            'teacher',

          framework:
            framework,

          status:
            'active'
        })
        .limit(1)
        .get()

    if (
      taskResult.data.length === 0
    ) {
      return {
        success: false,
        code: 'TASK_NOT_FOUND',
        message: '当前预设采集任务不存在或不可用'
      }
    }

    const currentTask =
      taskResult.data[0]

    // ==================================================
    // 12. 校验 target_variable
    // ==================================================

    if (
      session.target_variable !==
      currentTask.variable_id
    ) {
      return {
        success: false,
        code: 'TARGET_VARIABLE_MISMATCH',
        message: '会话变量与预设任务变量不一致'
      }
    }

    // ==================================================
    // 13. 确认存在有效 ASR 语音
    // ==================================================

    const voiceResult =
      await db.collection('voice_records')
        .where({
          session_id:
            sessionId,

          subject_id:
            subjectId,

          asr_status:
            'success'
        })
        .limit(100)
        .get()

    const validVoiceRecords =
      voiceResult.data
        .filter(item => {
          return (
            typeof item.transcript ===
              'string' &&
            item.transcript
              .trim()
              .length > 0
          )
        })

    if (
      validVoiceRecords.length === 0
    ) {
      return {
        success: false,
        code: 'NO_VALID_RESPONSE',
        message: '当前任务还没有完成有效的语音回答'
      }
    }

    // ==================================================
    // 14. 自动归档原始 evidence
    //
    // 关键：
    // evidence 成功以后，才允许推进任务
    // ==================================================

    const evidenceResult =
      await archiveTaskEvidence({
        subjectId:
          subjectId,

        session:
          session,

        task:
          currentTask,

        framework:
          framework
      })

    if (
      !evidenceResult.success
    ) {
      return {
        success: false,

        code:
          evidenceResult.code ||
          'EVIDENCE_ARCHIVE_FAILED',

        message:
          evidenceResult.message ||
          '当前任务证据归档失败'
      }
    }

    console.log(
      'task evidence archived:',
      {
        session_id:
          sessionId,

        task_id:
          currentTask.task_id,

        variable_id:
          currentTask.variable_id,

        created_count:
          evidenceResult.created_count,

        skipped_count:
          evidenceResult.skipped_count,

        archived_valid_count:
          evidenceResult.archived_valid_count
      }
    )

    // ==================================================
    // 15. 更新已完成任务
    // ==================================================

    const newCompletedTaskIds = [
      ...completedTaskIds,
      currentTask.task_id
    ]

    const newCompletedCount =
      newCompletedTaskIds.length

    // ==================================================
    // 16. 查询下一项有效任务
    // ==================================================

    const nextTaskResult =
      await db.collection('collection_tasks')
        .where({
          subject_type:
            'teacher',

          framework:
            framework,

          status:
            'active',

          task_order:
            _.gt(
              currentTask.task_order
            )
        })
        .orderBy(
          'task_order',
          'asc'
        )
        .limit(1)
        .get()

    // ==================================================
    // 情况 A：还有下一项任务
    // ==================================================

    if (
      nextTaskResult.data.length > 0
    ) {
      const nextTask =
        nextTaskResult.data[0]

      // 更新采集进度
      await db.collection(
        'collection_progress'
      )
        .doc(progress._id)
        .update({
          data: {
            current_task_id:
              nextTask.task_id,

            current_order:
              nextTask.task_order,

            completed_task_ids:
              newCompletedTaskIds,

            completed_count:
              newCompletedCount,

            status:
              'in_progress',

            updated_at:
              db.serverDate()
          }
        })

      // 关闭本次 session
      await db.collection('sessions')
        .doc(session._id)
        .update({
          data: {
            status:
              'completed',

            ended_at:
              db.serverDate(),

            updated_at:
              db.serverDate()
          }
        })

      return {
        success: true,

        already_completed:
          false,

        collection_completed:
          false,

        // -------------------------
        // 本次 evidence 归档结果
        // -------------------------

        evidence_archive: {
          valid_message_count:
            evidenceResult
              .valid_message_count,

          archived_valid_count:
            evidenceResult
              .archived_valid_count,

          created_count:
            evidenceResult
              .created_count,

          skipped_count:
            evidenceResult
              .skipped_count,

          created_evidence_ids:
            evidenceResult
              .created_evidence_ids
        },

        completed_task: {
          task_id:
            currentTask.task_id,

          task_order:
            currentTask.task_order,

          variable_id:
            currentTask.variable_id,

          variable_name:
            currentTask.variable_name
        },

        progress: {
          progress_id:
            progress.progress_id,

          current_task_id:
            nextTask.task_id,

          current_order:
            nextTask.task_order,

          completed_count:
            newCompletedCount,

          status:
            'in_progress'
        },

        next_task:
          nextTask,

        message:
          '当前任务已完成，原始证据已归档，并已进入下一项采集任务'
      }
    }

    // ==================================================
    // 情况 B：最后一项任务完成
    // ==================================================

    await db.collection(
      'collection_progress'
    )
      .doc(progress._id)
      .update({
        data: {
          current_task_id:
            '',

          current_order:
            null,

          completed_task_ids:
            newCompletedTaskIds,

          completed_count:
            newCompletedCount,

          status:
            'completed',

          completed_at:
            db.serverDate(),

          updated_at:
            db.serverDate()
        }
      })

    // 关闭最后一个 session
    await db.collection('sessions')
      .doc(session._id)
      .update({
        data: {
          status:
            'completed',

          ended_at:
            db.serverDate(),

          updated_at:
            db.serverDate()
        }
      })

    return {
      success: true,

      already_completed:
        false,

      collection_completed:
        true,

      evidence_archive: {
        valid_message_count:
          evidenceResult
            .valid_message_count,

        archived_valid_count:
          evidenceResult
            .archived_valid_count,

        created_count:
          evidenceResult
            .created_count,

        skipped_count:
          evidenceResult
            .skipped_count,

        created_evidence_ids:
          evidenceResult
            .created_evidence_ids
      },

      completed_task: {
        task_id:
          currentTask.task_id,

        task_order:
          currentTask.task_order,

        variable_id:
          currentTask.variable_id,

        variable_name:
          currentTask.variable_name
      },

      progress: {
        progress_id:
          progress.progress_id,

        current_task_id:
          '',

        current_order:
          null,

        completed_count:
          newCompletedCount,

        status:
          'completed'
      },

      next_task:
        null,

      message:
        '教师首次主体采集已经全部完成，原始证据已完成归档'
    }

  } catch (error) {
    console.error(
      'completeTeacherCollectionTask error:',
      error
    )

    return {
      success: false,
      code: 'COMPLETE_TASK_ERROR',
      message:
        error.message ||
        '完成教师采集任务失败'
    }
  }
}