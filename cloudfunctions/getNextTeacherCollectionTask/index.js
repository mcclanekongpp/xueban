// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 生成进度记录 ID
function createProgressId() {
  const time = Date.now().toString(36).toUpperCase()
  const random = Math.random()
    .toString(36)
    .substring(2, 7)
    .toUpperCase()

  return `CP_${time}_${random}`
}

// 云函数入口函数
exports.main = async (event, context) => {
  try {
    const wxContext = cloud.getWXContext()
    const openid = wxContext.OPENID

    // 1. 必须从真实小程序用户调用
    if (!openid) {
      return {
        success: false,
        code: 'NO_OPENID',
        message: '无法识别当前微信用户'
      }
    }

    // 2. 查询当前用户
    const userResult = await db.collection('users')
      .where({
        openid: openid
      })
      .limit(1)
      .get()

    if (!userResult.data.length) {
      return {
        success: false,
        code: 'USER_NOT_FOUND',
        message: '当前用户不存在'
      }
    }

    const user = userResult.data[0]

    if (user.role !== 'teacher') {
      return {
        success: false,
        code: 'NOT_TEACHER',
        message: '当前用户不是教师身份'
      }
    }

    // 3. 找到教师对应的主体
    const identityResult = await db.collection('identity_map')
      .where({
        user_id: user.user_id,
        identity_type: 'teacher'
      })
      .limit(1)
      .get()

    if (!identityResult.data.length) {
      return {
        success: false,
        code: 'TEACHER_SUBJECT_NOT_FOUND',
        message: '尚未建立教师主体'
      }
    }

    const identity = identityResult.data[0]
    const subjectId = identity.subject_id

    // 4. 确认教师主体有效
    const subjectResult = await db.collection('subjects')
      .where({
        subject_id: subjectId,
        subject_type: 'teacher',
        status: 'active'
      })
      .limit(1)
      .get()

    if (!subjectResult.data.length) {
      return {
        success: false,
        code: 'SUBJECT_NOT_FOUND',
        message: '教师主体不存在或已失效'
      }
    }

    const framework = 'teacher_v1.0'

    // 5. 查询该教师已有的采集进度
    const progressResult = await db.collection('collection_progress')
      .where({
        subject_id: subjectId,
        framework: framework
      })
      .limit(1)
      .get()

    let progress = null

    // --------------------------------------------------
    // 情况 A：教师第一次进入预设采集
    // --------------------------------------------------
    if (!progressResult.data.length) {

      // 获取第一个有效任务
      const firstTaskResult = await db.collection('collection_tasks')
        .where({
          subject_type: 'teacher',
          framework: framework,
          status: 'active'
        })
        .orderBy('task_order', 'asc')
        .limit(1)
        .get()

      if (!firstTaskResult.data.length) {
        return {
          success: false,
          code: 'NO_COLLECTION_TASKS',
          message: '尚未配置教师预设采集任务'
        }
      }

      const firstTask = firstTaskResult.data[0]

      const progressId = createProgressId()

      // 创建教师首次采集进度
      await db.collection('collection_progress').add({
        data: {
          progress_id: progressId,

          subject_id: subjectId,
          subject_type: 'teacher',
          framework: framework,

          current_task_id: firstTask.task_id,
          current_order: firstTask.task_order,

          completed_count: 0,
          completed_task_ids: [],

          status: 'in_progress',

          started_at: db.serverDate(),
          completed_at: null,

          created_at: db.serverDate(),
          updated_at: db.serverDate()
        }
      })

      progress = {
        progress_id: progressId,
        subject_id: subjectId,
        subject_type: 'teacher',
        framework: framework,
        current_task_id: firstTask.task_id,
        current_order: firstTask.task_order,
        completed_count: 0,
        completed_task_ids: [],
        status: 'in_progress'
      }

      return {
        success: true,
        is_new_progress: true,
        collection_completed: false,

        subject_id: subjectId,
        framework: framework,

        progress: progress,
        task: firstTask
      }
    }

    // --------------------------------------------------
    // 情况 B：已经存在采集进度
    // --------------------------------------------------
    progress = progressResult.data[0]

    // 6. 如果首次采集已经全部完成
    if (progress.status === 'completed') {
      return {
        success: true,
        is_new_progress: false,
        collection_completed: true,

        subject_id: subjectId,
        framework: framework,

        progress: progress,
        task: null,

        message: '教师首次主体采集已经完成'
      }
    }

    // 7. 根据 current_task_id 获取当前任务
    let taskResult = await db.collection('collection_tasks')
      .where({
        task_id: progress.current_task_id,
        subject_type: 'teacher',
        framework: framework,
        status: 'active'
      })
      .limit(1)
      .get()

    // --------------------------------------------------
    // 正常情况：当前任务仍然存在
    // --------------------------------------------------
    if (taskResult.data.length) {
      return {
        success: true,
        is_new_progress: false,
        collection_completed: false,

        subject_id: subjectId,
        framework: framework,

        progress: progress,
        task: taskResult.data[0]
      }
    }

    // --------------------------------------------------
    // 8. 容错：
    // current_task_id 对应任务不存在时，
    // 尝试按照 current_order 找任务
    // --------------------------------------------------
    taskResult = await db.collection('collection_tasks')
      .where({
        subject_type: 'teacher',
        framework: framework,
        task_order: progress.current_order,
        status: 'active'
      })
      .limit(1)
      .get()

    if (taskResult.data.length) {
      const recoveredTask = taskResult.data[0]

      // 同步修正 progress 中的 current_task_id
      await db.collection('collection_progress')
        .doc(progress._id)
        .update({
          data: {
            current_task_id: recoveredTask.task_id,
            updated_at: db.serverDate()
          }
        })

      progress.current_task_id = recoveredTask.task_id

      return {
        success: true,
        is_new_progress: false,
        collection_completed: false,
        recovered: true,

        subject_id: subjectId,
        framework: framework,

        progress: progress,
        task: recoveredTask
      }
    }

    // 9. 当前进度无法找到对应任务
    return {
      success: false,
      code: 'CURRENT_TASK_NOT_FOUND',
      message: '当前采集进度对应的任务不存在，请检查任务配置'
    }

  } catch (error) {
    console.error(
      'getNextTeacherCollectionTask error:',
      error
    )

    return {
      success: false,
      code: 'GET_NEXT_TASK_ERROR',
      message:
        error.message ||
        '获取教师当前采集任务失败'
    }
  }
}