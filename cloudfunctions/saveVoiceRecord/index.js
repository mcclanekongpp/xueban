// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const { authorizeStudentOperator, operatorFields } = require('./student-operator-auth')

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  const fileId = event.file_id
  const durationMs = Number(event.duration_ms)
  const sessionId = event.session_id

  // 1. 检查微信身份
  if (!openid) {
    return {
      success: false,
      code: 'NO_OPENID',
      message: '未获取到微信用户标识'
    }
  }

  // 2. 检查录音文件
  if (!fileId || typeof fileId !== 'string') {
    return {
      success: false,
      code: 'INVALID_FILE_ID',
      message: '录音文件标识无效'
    }
  }

  // 3. 检查录音时长
  if (
    !Number.isFinite(durationMs) ||
    durationMs <= 0 ||
    durationMs > 60000
  ) {
    return {
      success: false,
      code: 'INVALID_DURATION',
      message: '录音时长无效'
    }
  }

  // 4. 检查会话编号
  if (!sessionId || typeof sessionId !== 'string') {
    return {
      success: false,
      code: 'INVALID_SESSION_ID',
      message: '当前交流会话无效'
    }
  }

  try {
    // 5. 查询当前微信账号
    const userResult = await db.collection('users')
      .where({
        openid: openid
      })
      .limit(1)
      .get()

    if (userResult.data.length === 0) {
      return {
        success: false,
        code: 'USER_NOT_FOUND',
        message: '用户不存在，请先登录'
      }
    }

    const user = userResult.data[0]

    // 6. 校验录音文件归属
    const expectedPath = `/voice/${user.user_id}/`

    if (!fileId.includes(expectedPath)) {
      return {
        success: false,
        code: 'FILE_OWNER_MISMATCH',
        message: '录音文件与当前用户不匹配'
      }
    }

    // 7. Session 只决定数据归属。Student session 可由 Guardian 或已授权
    // Teacher Collector 共用，因此必须按当前 OPENID 重新执行 Student 授权。
    const sessionResult = await db.collection('sessions')
      .where({
        session_id: sessionId,
        status: 'active'
      })
      .limit(2)
      .get()

    if (sessionResult.data.length !== 1) {
      return {
        success: false,
        code: 'SESSION_NOT_FOUND',
        message: '当前交流会话不存在或已失效'
      }
    }

    const session = sessionResult.data[0]
    const subjectId = session.subject_id
    const subjectType =
      session.subject_type === 'student'
        ? 'student'
        : 'teacher'
    const framework =
      session.framework ||
      (subjectType === 'student'
        ? 'student_v1.0'
        : 'teacher_v1.0')

    if (!subjectId) {
      return {
        success: false,
        code: 'SESSION_SUBJECT_MISSING',
        message: '当前会话缺少研究主体信息'
      }
    }

    let authorization = null
    if (subjectType === 'student') {
      authorization = await authorizeStudentOperator({ db, openid, subjectId })
      if (!authorization.authorized) {
        return { success: false, code: authorization.code, message: authorization.message }
      }
    } else if (session.user_id !== user.user_id) {
      return {
        success: false,
        code: 'TEACHER_SESSION_NOT_AUTHORIZED',
        message: '当前教师无权使用该会话'
      }
    }

    const operator = authorization
      ? operatorFields(authorization)
      : {
          operator_user_id: user.user_id,
          operator_type: 'teacher',
          operator_teacher_subject_id: subjectId
        }

    // TEST 标记由研究主体继承，不能依赖前端传入。
    // 这样真机录音与自动化技术记录都能保持同一套测试数据隔离语义。
    const subjectResult = await db.collection('subjects')
      .where({
        subject_id: subjectId,
        subject_type: subjectType
      })
      .limit(2)
      .get()
    const isTest =
      subjectResult.data.length === 1 &&
      subjectResult.data[0].is_test === true

    // 9. 生成 message_id
    const messageId =
      'MSG_' +
      Date.now().toString(36).toUpperCase() +
      '_' +
      Math.random().toString(36).slice(2, 7).toUpperCase()

    // 10. 计算当前会话中的消息顺序
    const messageCountResult = await db.collection('messages')
      .where({
        session_id: sessionId
      })
      .count()

    const sequence = messageCountResult.total + 1

    // 11. 先创建主体语音消息
    const messageData = {
      message_id: messageId,
      session_id: sessionId,
      subject_id: subjectId,
      subject_type: subjectType,
      framework: framework,
      ...operator,

      speaker: subjectType,

      // 语音尚未转写，所以正文暂为空
      content: '',

      message_type: 'voice',

      sequence: sequence,

      is_test: isTest,

      created_at: db.serverDate(),
      updated_at: db.serverDate()
    }

    const messageAddResult = await db.collection('messages').add({
      data: messageData
    })

    // 12. 生成 voice_id
    const voiceId =
      'V_' +
      Date.now().toString(36).toUpperCase() +
      '_' +
      Math.random().toString(36).slice(2, 7).toUpperCase()

    // 13. 创建 voice_records
    const voiceRecord = {
      voice_id: voiceId,

      user_id: user.user_id,
      ...operator,
      subject_id: subjectId,
      subject_type: subjectType,
      framework: framework,
      session_id: sessionId,
      message_id: messageId,

      file_id: fileId,
      duration_ms: Math.round(durationMs),

      transcript: '',
      asr_status: 'pending',

      is_test: isTest,

      created_at: db.serverDate(),
      updated_at: db.serverDate()
    }

    const voiceAddResult = await db.collection('voice_records').add({
      data: voiceRecord
    })

    console.log('message created:', {
      record_id: messageAddResult._id,
      message_id: messageId,
      session_id: sessionId,
      sequence: sequence
    })

    console.log('voice record created:', {
      record_id: voiceAddResult._id,
      voice_id: voiceId,
      message_id: messageId,
      session_id: sessionId,
      subject_id: subjectId
    })

    return {
      success: true,

      message: {
        record_id: messageAddResult._id,
        message_id: messageId,
        session_id: sessionId,
        subject_id: subjectId,
        speaker: subjectType,
        message_type: 'voice',
        sequence: sequence,
        content: '',
        is_test: isTest
      },

      voice_record: {
        record_id: voiceAddResult._id,
        voice_id: voiceId,
        user_id: user.user_id,
        operator_user_id: user.user_id,
        operator_type: operator.operator_type,
        operator_teacher_subject_id: operator.operator_teacher_subject_id,
        subject_id: subjectId,
        subject_type: subjectType,
        framework: framework,
        session_id: sessionId,
        message_id: messageId,
        file_id: fileId,
        duration_ms: Math.round(durationMs),
        asr_status: 'pending',
        is_test: isTest
      }
    }

  } catch (error) {
    console.error('saveVoiceRecord error:', error)

    return {
      success: false,
      code: 'SAVE_VOICE_RECORD_ERROR',
      message: error.message || '录音记录保存失败'
    }
  }
}
