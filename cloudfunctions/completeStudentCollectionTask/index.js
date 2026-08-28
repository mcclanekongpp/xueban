const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

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
      user_id: user.user_id,
      subject_type: 'student',
      framework: 'student_v1.0',
      session_type: 'initial_interview'
    }).limit(2).get()

    if (sessionResult.data.length !== 1) {
      return { success: false, code: 'STUDENT_SESSION_NOT_FOUND', message: '学生会话不存在' }
    }

    const session = sessionResult.data[0]
    const bindingResult = await db.collection('guardian_student_bindings').where({
      user_id: user.user_id,
      subject_id: session.subject_id,
      status: 'active'
    }).limit(2).get()

    if (bindingResult.data.length !== 1) {
      return {
        success: false,
        code: 'STUDENT_BINDING_NOT_ACTIVE',
        message: '当前微信没有该学生的有效采集绑定'
      }
    }

    const progressResult = await db.collection('collection_progress').where({
      subject_id: session.subject_id,
      subject_type: 'student',
      framework: 'student_v1.0',
      collection_phase: 'initial'
    }).limit(2).get()

    if (progressResult.data.length !== 1) {
      return {
        success: false,
        code: 'STUDENT_COLLECTION_PROGRESS_INVALID',
        message: '学生首次采集进度缺失或重复'
      }
    }

    const progress = progressResult.data[0]
    const completedIds = Array.isArray(progress.completed_task_ids)
      ? progress.completed_task_ids
      : []

    if (completedIds.includes(session.task_id)) {
      return {
        success: true,
        already_completed: true,
        collection_completed: progress.status === 'completed',
        progress
      }
    }

    if (progress.current_task_id !== session.task_id || session.status !== 'active') {
      return {
        success: false,
        code: 'STUDENT_TASK_NOT_CURRENT',
        message: '当前会话不是正在进行的学生任务'
      }
    }

    const evidenceResult = await db.collection('evidence').where({
      subject_id: session.subject_id,
      subject_type: 'student',
      framework: 'student_v1.0',
      session_id: sessionId,
      task_id: session.task_id,
      status: 'active'
    }).limit(100).get()

    if (evidenceResult.data.length === 0) {
      return {
        success: false,
        code: 'STUDENT_EVIDENCE_REQUIRED',
        message: '当前任务尚未形成学生原始证据'
      }
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

    const taskResult = await db.collection('collection_tasks').where({
      subject_type: 'student',
      framework: 'student_v1.0',
      collection_phase: 'initial',
      status: 'active'
    }).orderBy('task_order', 'asc').limit(100).get()
    const tasks = taskResult.data
    const currentIndex = tasks.findIndex((item) => item.task_id === session.task_id)

    if (tasks.length !== 17 || currentIndex < 0) {
      return {
        success: false,
        code: 'STUDENT_TASK_CONFIG_INCOMPLETE',
        message: '学生任务配置不完整'
      }
    }

    const newCompletedIds = [...completedIds, session.task_id]
    const completedCount = newCompletedIds.length
    const nextTask = tasks[currentIndex + 1] || null
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
          updated_at: now
        }

    await db.runTransaction(async (transaction) => {
      await transaction.collection('collection_progress').doc(progress._id).update({
        data: progressUpdate
      })
      await transaction.collection('sessions').doc(session._id).update({
        data: { status: 'completed', ended_at: now, updated_at: now }
      })
    })

    return {
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
  } catch (error) {
    console.error('completeStudentCollectionTask error:', error)
    return {
      success: false,
      code: 'COMPLETE_STUDENT_TASK_ERROR',
      message: '完成学生首次采集任务失败'
    }
  }
}
