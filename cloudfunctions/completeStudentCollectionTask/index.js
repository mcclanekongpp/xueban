const cloud = require('wx-server-sdk')
const { authorizeStudentOperator } = require('./student-operator-auth')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function fail(code, message) {
  const error = new Error(message)
  error.code = code
  throw error
}

function isTransactionConflict(error) {
  const text = `${error && error.code ? error.code : ''} ${error && error.message ? error.message : ''}`
  return /TransactionConflict|DATABASE_TRANSACTION_CONFLICT|transaction is conflict/i.test(text)
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runTransactionWithConflictRetry(work, maxAttempts = 4) {
  let lastError = null
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await db.runTransaction(work)
    } catch (error) {
      lastError = error
      if (!isTransactionConflict(error) || attempt === maxAttempts) throw error
      await wait(attempt * 35 + Math.floor(Math.random() * 25))
    }
  }
  throw lastError
}

exports.main = async (event = {}) => {
  const openid = cloud.getWXContext().OPENID
  const sessionId = typeof event.session_id === 'string' ? event.session_id.trim() : ''

  if (!openid || !sessionId) {
    return {
      success: false,
      code: !openid ? 'NO_OPENID' : 'SESSION_ID_REQUIRED',
      message: !openid ? '未获取到微信用户标识' : '缺少学生采集会话编号'
    }
  }

  try {
    const sessionResult = await db.collection('sessions').where({
      session_id: sessionId,
      subject_type: 'student',
      framework: 'student_v1.0',
      session_type: 'initial_interview'
    }).limit(2).get()
    if (sessionResult.data.length !== 1) {
      return { success: false, code: 'STUDENT_SESSION_NOT_FOUND', message: '学生会话不存在或重复' }
    }

    const session = sessionResult.data[0]
    const authorization = await authorizeStudentOperator({
      db,
      openid,
      subjectId: session.subject_id
    })
    if (!authorization.authorized) {
      return { success: false, code: authorization.code, message: authorization.message }
    }

    const [progressResult, evidenceResult, taskResult] = await Promise.all([
      db.collection('collection_progress').where({
        subject_id: session.subject_id,
        subject_type: 'student',
        framework: 'student_v1.0',
        collection_phase: 'initial'
      }).limit(2).get(),
      db.collection('evidence').where({
        subject_id: session.subject_id,
        subject_type: 'student',
        framework: 'student_v1.0',
        session_id: sessionId,
        task_id: session.task_id,
        status: 'active'
      }).limit(100).get(),
      db.collection('collection_tasks').where({
        subject_type: 'student',
        framework: 'student_v1.0',
        collection_phase: 'initial',
        status: 'active'
      }).orderBy('task_order', 'asc').limit(100).get()
    ])

    if (progressResult.data.length !== 1) {
      return {
        success: false,
        code: 'STUDENT_COLLECTION_PROGRESS_INVALID',
        message: '学生首次采集进度缺失或重复'
      }
    }
    if (evidenceResult.data.length === 0) {
      return { success: false, code: 'STUDENT_EVIDENCE_REQUIRED', message: '当前任务尚未形成学生原始证据' }
    }

    const evidenceIds = evidenceResult.data.map((item) => item.evidence_id)
    const analysisResult = await db.collection('evidence_analysis').where({
      subject_id: session.subject_id,
      subject_type: 'student',
      framework: 'student_v1.0',
      task_id: session.task_id,
      status: 'active'
    }).limit(100).get()
    const analyzedIds = new Set(analysisResult.data.map((item) => item.evidence_id))
    if (evidenceIds.some((id) => !analyzedIds.has(id))) {
      return {
        success: false,
        code: 'STUDENT_ANALYSIS_INCOMPLETE',
        pending_evidence_ids: evidenceIds.filter((id) => !analyzedIds.has(id)),
        message: '当前任务证据分析尚未全部完成'
      }
    }

    const tasks = taskResult.data
    const currentIndex = tasks.findIndex((item) => item.task_id === session.task_id)
    if (
      tasks.length !== 17 ||
      new Set(tasks.map((item) => item.variable_id)).size !== 17 ||
      currentIndex < 0
    ) {
      return { success: false, code: 'STUDENT_TASK_CONFIG_INCOMPLETE', message: '学生任务配置不完整' }
    }

    const progress = progressResult.data[0]
    let finalResult = null

    await runTransactionWithConflictRetry(async (transaction) => {
      const currentProgressResult = await transaction
        .collection('collection_progress')
        .doc(progress._id)
        .get()
      const currentProgress = currentProgressResult.data
      if (!currentProgress) fail('STUDENT_COLLECTION_PROGRESS_MISSING', '学生首次采集进度不存在')

      const completedIds = Array.from(new Set(
        Array.isArray(currentProgress.completed_task_ids)
          ? currentProgress.completed_task_ids.filter(Boolean)
          : []
      ))

      if (completedIds.includes(session.task_id)) {
        if (session.status !== 'completed') {
          await transaction.collection('sessions').doc(session._id).update({
            data: { status: 'completed', ended_at: db.serverDate(), updated_at: db.serverDate() }
          })
        }
        finalResult = {
          success: true,
          already_completed: true,
          collection_completed: currentProgress.status === 'completed',
          progress: currentProgress
        }
        return
      }

      if (currentProgress.current_task_id !== session.task_id) {
        fail('STUDENT_TASK_NOT_CURRENT', '当前会话不是正在进行的学生任务')
      }

      const newCompletedIds = [...completedIds, session.task_id]
      const completedCount = newCompletedIds.length
      const nextTask = tasks[currentIndex + 1] || null
      if (completedCount > 17) {
        fail('STUDENT_PROGRESS_OVERFLOW', '学生首次采集进度超过固定任务数')
      }

      const now = db.serverDate()
      const progressUpdate = nextTask
        ? {
            current_task_id: nextTask.task_id,
            current_order: nextTask.task_order,
            completed_task_ids: newCompletedIds,
            completed_tasks: completedCount,
            completed_count: completedCount,
            total_tasks: 17,
            status: 'in_progress',
            last_operator_user_id: authorization.operator_user_id,
            last_operator_type: authorization.operator_type,
            last_operator_teacher_subject_id: authorization.operator_teacher_subject_id || '',
            updated_at: now
          }
        : {
            current_task_id: '',
            current_order: null,
            completed_task_ids: newCompletedIds,
            completed_tasks: completedCount,
            completed_count: completedCount,
            total_tasks: 17,
            status: 'completed',
            completed_at: now,
            last_operator_user_id: authorization.operator_user_id,
            last_operator_type: authorization.operator_type,
            last_operator_teacher_subject_id: authorization.operator_teacher_subject_id || '',
            updated_at: now
          }

      await transaction.collection('collection_progress').doc(progress._id).update({ data: progressUpdate })
      await transaction.collection('sessions').doc(session._id).update({
        data: { status: 'completed', ended_at: now, updated_at: now }
      })

      finalResult = {
        success: true,
        already_completed: false,
        collection_completed: !nextTask,
        completed_task: {
          task_id: session.task_id,
          variable_id: session.target_variable
        },
        progress: { ...progressUpdate, progress_id: progress.progress_id },
        next_task: nextTask
      }
    })

    return finalResult || {
      success: false,
      code: 'STUDENT_PROGRESS_TRANSACTION_EMPTY',
      message: '学生首次采集进度更新未完成'
    }
  } catch (error) {
    console.error('completeStudentCollectionTask error:', error)
    return {
      success: false,
      code: error.code || 'COMPLETE_STUDENT_TASK_ERROR',
      message: error.message || '完成学生首次采集任务失败'
    }
  }
}
