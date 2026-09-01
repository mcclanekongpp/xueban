const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const { authorizeStudentOperator } = require('./student-operator-auth')

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36).toUpperCase()}_${Math.random()
    .toString(36)
    .slice(2, 7)
    .toUpperCase()}`
}

exports.main = async (event = {}) => {
  const openid = cloud.getWXContext().OPENID
  const sessionId =
    typeof event.session_id === 'string' ? event.session_id.trim() : ''

  if (!openid || !sessionId) {
    return {
      success: false,
      code: !openid ? 'NO_OPENID' : 'SESSION_ID_REQUIRED',
      message: !openid ? '未获取到微信用户标识' : '缺少学生采集会话编号'
    }
  }

  try {
    const userResult = await db.collection('users').where({ openid }).limit(2).get()

    if (userResult.data.length !== 1) {
      return { success: false, code: 'USER_NOT_FOUND', message: '当前用户不存在' }
    }

    const user = userResult.data[0]
    const sessionResult = await db.collection('sessions').where({
      session_id: sessionId,
      subject_type: 'student',
      framework: 'student_v1.0',
      session_type: 'initial_interview',
      status: 'active'
    }).limit(2).get()

    if (sessionResult.data.length !== 1) {
      return {
        success: false,
        code: 'STUDENT_SESSION_NOT_ACTIVE',
        message: '学生首次采集会话不存在或已失效'
      }
    }

    const session = sessionResult.data[0]
    const authorization = await authorizeStudentOperator({
      db,
      openid,
      subjectId: session.subject_id
    })

    if (!authorization.authorized) {
      return {
        success: false,
        code: authorization.code,
        message: authorization.message
      }
    }

    const taskResult = await db.collection('collection_tasks').where({
      task_id: session.task_id,
      subject_type: 'student',
      framework: 'student_v1.0',
      collection_phase: 'initial',
      status: 'active'
    }).limit(2).get()

    if (taskResult.data.length !== 1) {
      return { success: false, code: 'STUDENT_TASK_NOT_FOUND', message: '学生任务不存在' }
    }

    const task = taskResult.data[0]

    if (session.target_variable !== task.variable_id) {
      return {
        success: false,
        code: 'TARGET_VARIABLE_MISMATCH',
        message: '会话变量与学生任务配置不一致'
      }
    }

    const [messageResult, voiceResult, existingResult, subjectResult] = await Promise.all([
      db.collection('messages').where({
        session_id: sessionId,
        subject_id: session.subject_id,
        speaker: 'student',
        message_type: 'voice'
      }).limit(100).get(),
      db.collection('voice_records').where({
        session_id: sessionId,
        subject_id: session.subject_id,
        subject_type: 'student',
        asr_status: 'success'
      }).limit(100).get(),
      db.collection('evidence').where({
        subject_id: session.subject_id,
        session_id: sessionId,
        task_id: task.task_id,
        status: 'active'
      }).limit(100).get(),
      db.collection('subjects').where({
        subject_id: session.subject_id,
        subject_type: 'student',
        status: 'active'
      }).limit(2).get()
    ])

    const voiceByMessage = new Map(
      voiceResult.data
        .filter((item) => item.message_id && String(item.transcript || '').trim())
        .map((item) => [item.message_id, item])
    )
    const existingMessageIds = new Set(existingResult.data.map((item) => item.message_id))
    const validMessages = messageResult.data
      .filter((item) => String(item.content || '').trim() && voiceByMessage.has(item.message_id))
      .sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0))

    if (validMessages.length === 0) {
      return {
        success: false,
        code: 'NO_VALID_STUDENT_VOICE',
        message: '当前任务没有完成有效语音识别'
      }
    }

    const created = []

    for (const message of validMessages) {
      if (existingMessageIds.has(message.message_id)) continue

      const voice = voiceByMessage.get(message.message_id)
      const evidenceId = makeId('EVI')
      const isTest =
        (subjectResult.data[0] && subjectResult.data[0].is_test === true) ||
        message.is_test === true ||
        voice.is_test === true
      const now = db.serverDate()
      const evidence = {
        evidence_id: evidenceId,
        subject_id: session.subject_id,
        subject_type: 'student',
        framework: 'student_v1.0',
        dimension_id: task.dimension_id,
        dimension_name: task.dimension_name,
        variable_id: task.variable_id,
        variable_name: task.variable_name,
        source_type: 'initial_interview',
        source_modality: 'voice',
        evidence_type: 'voice_response',
        task_id: task.task_id,
        task_order: task.task_order,
        collection_phase: 'initial',
        session_id: sessionId,
        message_id: message.message_id,
        voice_id: voice.voice_id,
        file_id: voice.file_id || '',
        operator_user_id: message.operator_user_id || authorization.operator_user_id,
        operator_type: message.operator_type || authorization.operator_type,
        operator_teacher_subject_id:
          message.operator_teacher_subject_id || authorization.operator_teacher_subject_id || '',
        raw_text: String(message.content).trim(),
        transcript: String(message.content).trim(),
        duration_ms: typeof voice.duration_ms === 'number' ? voice.duration_ms : null,
        analysis_status: 'pending',
        model_change_status: 'not_evaluated',
        status: 'active',
        is_test: isTest,
        created_at: now,
        updated_at: now
      }

      const addResult = await db.collection('evidence').add({ data: evidence })
      created.push({
        database_id: addResult._id,
        evidence_id: evidenceId,
        message_id: message.message_id,
        voice_id: voice.voice_id,
        variable_id: task.variable_id,
        is_test: isTest
      })
    }

    const allEvidence = [
      ...existingResult.data.map((item) => ({
        evidence_id: item.evidence_id,
        message_id: item.message_id,
        voice_id: item.voice_id,
        variable_id: item.variable_id,
        is_test: item.is_test === true
      })),
      ...created
    ]

    return {
      success: true,
      subject_id: session.subject_id,
      session_id: sessionId,
      task_id: task.task_id,
      variable_id: task.variable_id,
      created_count: created.length,
      existing_count: existingResult.data.length,
      evidence: allEvidence
    }
  } catch (error) {
    console.error('createStudentTaskEvidence error:', error)
    return {
      success: false,
      code: 'CREATE_STUDENT_EVIDENCE_ERROR',
      message: '创建学生任务证据失败'
    }
  }
}
