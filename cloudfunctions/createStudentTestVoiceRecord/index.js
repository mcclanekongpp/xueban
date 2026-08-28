const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36).toUpperCase()}_${Math.random()
    .toString(36)
    .slice(2, 7)
    .toUpperCase()}`
}

exports.main = async (event = {}) => {
  const openid = cloud.getWXContext().OPENID
  const sessionId = String(event.session_id || '').trim()
  const transcript = String(event.transcript || '').trim()

  if (!openid || !sessionId || !transcript.startsWith('TEST：')) {
    return {
      success: false,
      code: 'INVALID_TEST_RECORD',
      message: 'TEST 模拟记录必须具有有效会话且正文以 TEST：开头'
    }
  }

  try {
    const userResult = await db.collection('users').where({ openid }).limit(2).get()
    const user = userResult.data.length === 1 ? userResult.data[0] : null

    if (!user || !['teacher', 'researcher', 'admin'].includes(user.role)) {
      return { success: false, code: 'TEST_RECORD_FORBIDDEN', message: '无权创建测试记录' }
    }

    const sessionResult = await db.collection('sessions').where({
      session_id: sessionId,
      user_id: user.user_id,
      subject_type: 'student',
      framework: 'student_v1.0',
      status: 'active'
    }).limit(2).get()

    if (sessionResult.data.length !== 1) {
      return { success: false, code: 'TEST_SESSION_NOT_ACTIVE', message: '测试会话无效' }
    }

    const session = sessionResult.data[0]
    const subjectResult = await db.collection('subjects').where({
      subject_id: session.subject_id,
      subject_type: 'student',
      status: 'active',
      is_test: true
    }).limit(2).get()
    const bindingResult = await db.collection('guardian_student_bindings').where({
      user_id: user.user_id,
      subject_id: session.subject_id,
      status: 'active',
      is_test: true
    }).limit(2).get()

    if (subjectResult.data.length !== 1 || bindingResult.data.length !== 1) {
      return {
        success: false,
        code: 'TEST_STUDENT_NOT_AUTHORIZED',
        message: '只允许为当前绑定的 TEST Student 创建模拟记录'
      }
    }

    const existing = await db.collection('voice_records').where({
      session_id: sessionId,
      is_test: true,
      test_source: 'simulated_transcript'
    }).limit(2).get()

    if (existing.data.length > 0) {
      return {
        success: true,
        already_created: true,
        voice_id: existing.data[0].voice_id,
        message_id: existing.data[0].message_id
      }
    }

    const messageId = makeId('MSG')
    const voiceId = makeId('V')
    const now = db.serverDate()
    let messageDbId = ''

    await db.runTransaction(async (transaction) => {
      const messageAdd = await transaction.collection('messages').add({
        data: {
          message_id: messageId,
          session_id: sessionId,
          subject_id: session.subject_id,
          subject_type: 'student',
          framework: 'student_v1.0',
          operator_user_id: user.user_id,
          speaker: 'student',
          content: transcript,
          message_type: 'voice',
          sequence: 1,
          is_test: true,
          test_source: 'simulated_transcript',
          created_at: now,
          updated_at: now
        }
      })
      messageDbId = messageAdd._id
      await transaction.collection('voice_records').add({
        data: {
          voice_id: voiceId,
          user_id: user.user_id,
          operator_user_id: user.user_id,
          subject_id: session.subject_id,
          subject_type: 'student',
          framework: 'student_v1.0',
          session_id: sessionId,
          message_id: messageId,
          file_id: '',
          duration_ms: 1000,
          transcript,
          asr_status: 'success',
          is_test: true,
          test_source: 'simulated_transcript',
          created_at: now,
          updated_at: now
        }
      })
    })

    return {
      success: true,
      already_created: false,
      subject_id: session.subject_id,
      session_id: sessionId,
      message_id: messageId,
      message_database_id: messageDbId,
      voice_id: voiceId,
      is_test: true
    }
  } catch (error) {
    console.error('createStudentTestVoiceRecord error:', error)
    return { success: false, code: 'CREATE_TEST_VOICE_ERROR', message: '创建测试语音记录失败' }
  }
}
