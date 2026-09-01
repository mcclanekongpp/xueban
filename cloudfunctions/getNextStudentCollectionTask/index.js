const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const { authorizeStudentOperator } = require('./student-operator-auth')

function makeProgressId(subjectId) {
  const digest = crypto
    .createHash('sha256')
    .update(`${subjectId}|student_v1.0|initial`, 'utf8')
    .digest('hex')
    .slice(0, 24)
    .toUpperCase()
  return `CP_STUDENT_${digest}`
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
    const authorization = await authorizeStudentOperator({ db, openid, subjectId })
    if (!authorization.authorized) {
      return { success: false, code: authorization.code, message: authorization.message }
    }

    const taskResult = await db.collection('collection_tasks').where({
        subject_type: 'student',
        framework: 'student_v1.0',
        collection_phase: 'initial',
        status: 'active'
      }).orderBy('task_order', 'asc').limit(100).get()

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
      // 固定文档 ID 使 Guardian / Teacher 首次同时进入时落到同一条 Progress。
      // 两个初始化写入的数据完全相同，后续任务仍由事务推进并按 task_id 去重。
      const progressId = makeProgressId(subjectId)
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
        is_test: authorization.subject.is_test === true,
        initialized_by_operator_user_id: authorization.operator_user_id,
        initialized_by_operator_type: authorization.operator_type,
        initialized_by_teacher_subject_id: authorization.operator_teacher_subject_id || '',
        started_at: now,
        completed_at: null,
        created_at: now,
        updated_at: now
      }
      await db.collection('collection_progress').doc(progressId).set({ data: progress })
      progress._id = progressId
    } else if (start && progress.status === 'not_started') {
      await db.collection('collection_progress').doc(progress._id).update({
        data: {
          status: 'in_progress',
          started_at: db.serverDate(),
          last_operator_user_id: authorization.operator_user_id,
          last_operator_type: authorization.operator_type,
          last_operator_teacher_subject_id: authorization.operator_teacher_subject_id || '',
          updated_at: db.serverDate()
        }
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
