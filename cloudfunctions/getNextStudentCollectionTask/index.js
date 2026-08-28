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
  const subjectId =
    typeof event.subject_id === 'string' ? event.subject_id.trim() : ''
  const start = event.start !== false

  if (!openid || !subjectId) {
    return {
      success: false,
      code: !openid ? 'NO_OPENID' : 'STUDENT_SUBJECT_ID_REQUIRED',
      message: !openid ? '未获取到微信用户标识' : '缺少学生研究主体编号'
    }
  }

  try {
    const userResult = await db
      .collection('users')
      .where({ openid, status: 'active' })
      .limit(2)
      .get()

    if (userResult.data.length !== 1) {
      return { success: false, code: 'USER_NOT_ACTIVE', message: '当前用户不可用' }
    }

    const user = userResult.data[0]
    const [bindingResult, subjectResult, taskResult] = await Promise.all([
      db.collection('guardian_student_bindings').where({
        user_id: user.user_id,
        subject_id: subjectId,
        status: 'active'
      }).limit(2).get(),
      db.collection('subjects').where({
        subject_id: subjectId,
        subject_type: 'student',
        model_framework: 'student_v1.0',
        status: 'active'
      }).limit(2).get(),
      db.collection('collection_tasks').where({
        subject_type: 'student',
        framework: 'student_v1.0',
        collection_phase: 'initial',
        status: 'active'
      }).orderBy('task_order', 'asc').limit(100).get()
    ])

    if (bindingResult.data.length !== 1) {
      return {
        success: false,
        code: 'STUDENT_BINDING_NOT_ACTIVE',
        message: '当前微信没有该学生的有效采集绑定'
      }
    }

    if (subjectResult.data.length !== 1) {
      return {
        success: false,
        code: 'STUDENT_SUBJECT_NOT_ACTIVE',
        message: '学生研究主体不存在或已失效'
      }
    }

    const tasks = taskResult.data

    if (tasks.length !== 17 || new Set(tasks.map((item) => item.variable_id)).size !== 17) {
      return {
        success: false,
        code: 'STUDENT_TASK_CONFIG_INCOMPLETE',
        configured_tasks: tasks.length,
        message: '学生首次采集任务配置不完整'
      }
    }

    const progressResult = await db.collection('collection_progress').where({
      subject_id: subjectId,
      subject_type: 'student',
      framework: 'student_v1.0',
      collection_phase: 'initial'
    }).limit(2).get()

    if (progressResult.data.length > 1) {
      return {
        success: false,
        code: 'DUPLICATE_STUDENT_COLLECTION_PROGRESS',
        message: '该学生存在重复首次采集进度'
      }
    }

    if (progressResult.data.length === 0 && !start) {
      return {
        success: true,
        is_new_progress: false,
        collection_completed: false,
        subject_id: subjectId,
        framework: 'student_v1.0',
        progress: {
          total_tasks: 17,
          completed_tasks: 0,
          completed_count: 0,
          status: 'not_started',
          current_task_id: tasks[0].task_id
        },
        task: tasks[0]
      }
    }

    let progress = progressResult.data[0]

    if (!progress) {
      const progressId = makeId('CP')
      const now = db.serverDate()
      progress = {
        progress_id: progressId,
        subject_id: subjectId,
        subject_type: 'student',
        framework: 'student_v1.0',
        collection_phase: 'initial',
        total_tasks: 17,
        completed_tasks: 0,
        completed_count: 0,
        completed_task_ids: [],
        current_task_id: tasks[0].task_id,
        current_order: 1,
        status: 'in_progress',
        is_test: subjectResult.data[0].is_test === true,
        started_at: now,
        completed_at: null,
        created_at: now,
        updated_at: now
      }
      const addResult = await db.collection('collection_progress').add({ data: progress })
      progress._id = addResult._id
    } else if (start && progress.status === 'not_started') {
      await db.collection('collection_progress').doc(progress._id).update({
        data: { status: 'in_progress', started_at: db.serverDate(), updated_at: db.serverDate() }
      })
      progress.status = 'in_progress'
    }

    const completed = progress.status === 'completed'
    const task = completed
      ? null
      : tasks.find((item) => item.task_id === progress.current_task_id) || null

    if (!completed && !task) {
      return {
        success: false,
        code: 'CURRENT_STUDENT_TASK_NOT_FOUND',
        message: '当前进度对应的学生任务不存在'
      }
    }

    return {
      success: true,
      is_new_progress: progressResult.data.length === 0,
      collection_completed: completed,
      subject_id: subjectId,
      framework: 'student_v1.0',
      progress,
      task
    }
  } catch (error) {
    console.error('getNextStudentCollectionTask error:', error)
    return {
      success: false,
      code: 'GET_NEXT_STUDENT_TASK_ERROR',
      message: '读取学生首次采集任务失败'
    }
  }
}
