const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()


// ==================================================
// createSession
//
// 支持教师首次/持续采集与学生首次/持续采集会话。
//
// 1. initial_interview
//    教师首次主体模型13项访谈
//
// 2. teaching_reflection
//    教学反思持续记录
//
// 3. student_observation
//    学生观察持续记录
//
// 4. free_dialogue
//    自由记录
//
// 设计原则：
// - initial_interview：同一任务可复用 active session
// - 其他持续记录：每次进入建立新的 session
// - 不在前端信任 subject_id / variable_id
// - 首次访谈的变量由 collection_tasks 后台确定
// ==================================================


// ==================================================
// 允许的 session 类型
// ==================================================

const ALLOWED_SESSION_TYPES = [
  'initial_interview',
  'teaching_reflection',
  'student_observation',
  'free_dialogue',
  'student_continuous_record'
]


// ==================================================
// ID
// ==================================================

function createId(prefix) {
  const time =
    Date.now()
      .toString(36)
      .toUpperCase()

  const random =
    Math.random()
      .toString(36)
      .slice(2, 7)
      .toUpperCase()

  return `${prefix}_${time}_${random}`
}


// ==================================================
// 恢复首次访谈已有转写
//
// 这里只读取已经写入 messages.content 的文本。
// 不重新调用 ASR。
// ==================================================

async function recoverSessionTranscripts(
  sessionId
) {
  if (!sessionId) {
    return {
      has_existing_response: false,
      latest_transcript: '',
      recovered_transcripts: []
    }
  }


  const messageResult =
    await db
      .collection('messages')
      .where({
        session_id: sessionId
      })
      .orderBy(
        'created_at',
        'asc'
      )
      .limit(100)
      .get()


  const messages =
    messageResult.data || []


  const recoveredTranscripts =
    messages
      .map(
        item =>
          typeof item.content ===
            'string'
            ? item.content.trim()
            : ''
      )
      .filter(Boolean)


  const latestTranscript =
    recoveredTranscripts.length > 0
      ? recoveredTranscripts[
          recoveredTranscripts.length - 1
        ]
      : ''


  return {
    has_existing_response:
      recoveredTranscripts.length > 0,

    latest_transcript:
      latestTranscript,

    recovered_transcripts:
      recoveredTranscripts
  }
}


// ==================================================
// 主函数
// ==================================================

exports.main =
  async (event, context) => {

  try {

    // ==================================================
    // 1. 微信身份
    // ==================================================

    const wxContext =
      cloud.getWXContext()

    const openid =
      wxContext.OPENID


    if (!openid) {
      return {
        success: false,
        code: 'NO_OPENID',
        message:
          '未获取到微信用户标识'
      }
    }


    // ==================================================
    // 2. 当前用户
    // ==================================================

    const userResult =
      await db
        .collection('users')
        .where({
          openid
        })
        .limit(1)
        .get()


    if (
      userResult.data.length === 0
    ) {
      return {
        success: false,
        code: 'USER_NOT_FOUND',
        message:
          '用户不存在，请先登录'
      }
    }


    const user =
      userResult.data[0]


    // ==================================================
    // 3. 当前研究主体
    //
    // 教师继续由 identity_map 解析。学生 subject_id 虽来自前端，
    // 但必须由当前 user 的 active guardian binding 重新授权。
    // ==================================================

    const requestedSubjectType =
      event && event.subject_type === 'student'
        ? 'student'
        : 'teacher'

    let subjectId = ''
    let subjectType = requestedSubjectType
    let framework = ''

    if (requestedSubjectType === 'student') {
      const requestedSubjectId =
        event && typeof event.subject_id === 'string'
          ? event.subject_id.trim()
          : ''

      if (!requestedSubjectId) {
        return {
          success: false,
          code: 'STUDENT_SUBJECT_ID_REQUIRED',
          message: '缺少学生研究主体编号'
        }
      }

      const bindingResult = await db
        .collection('guardian_student_bindings')
        .where({
          user_id: user.user_id,
          subject_id: requestedSubjectId,
          status: 'active'
        })
        .limit(2)
        .get()

      if (bindingResult.data.length !== 1) {
        return {
          success: false,
          code: 'STUDENT_BINDING_NOT_ACTIVE',
          message: '当前微信没有该学生的有效采集绑定'
        }
      }

      const subjectResult = await db
        .collection('subjects')
        .where({
          subject_id: requestedSubjectId,
          subject_type: 'student',
          model_framework: 'student_v1.0',
          status: 'active'
        })
        .limit(2)
        .get()

      if (subjectResult.data.length !== 1) {
        return {
          success: false,
          code: 'STUDENT_SUBJECT_NOT_ACTIVE',
          message: '学生研究主体不存在或已失效'
        }
      }

      subjectId = requestedSubjectId
      framework = 'student_v1.0'
    } else {
      if (user.role !== 'teacher') {
        return {
          success: false,
          code: 'NOT_TEACHER',
          message: '当前账号不是教师身份'
        }
      }

      const mapResult = await db
        .collection('identity_map')
        .where({
          user_id: user.user_id,
          identity_type: 'teacher'
        })
        .limit(1)
        .get()

      if (mapResult.data.length === 0) {
        return {
          success: false,
          code: 'SUBJECT_NOT_FOUND',
          message: '尚未建立教师主体'
        }
      }

      subjectId = mapResult.data[0].subject_id
      subjectType = 'teacher'
      framework = 'teacher_v1.0'
    }


    // ==================================================
    // 4. session_type
    // ==================================================

    const sessionType =
      event &&
      typeof event.session_type ===
        'string'
        ? event.session_type.trim()
        : ''


    if (
      !ALLOWED_SESSION_TYPES.includes(
        sessionType
      )
    ) {
      return {
        success: false,

        code:
          'INVALID_SESSION_TYPE',

        message:
          '不支持的记录类型',

        allowed_types:
          ALLOWED_SESSION_TYPES
      }
    }


    // ==================================================
    // A. 首次预设访谈
    // ==================================================

    if (
      sessionType ===
      'initial_interview'
    ) {

      // ==================================================
      // A1. 必须传 task_id
      // ==================================================

      const taskId =
        event &&
        typeof event.task_id ===
          'string'
          ? event.task_id.trim()
          : ''


      if (!taskId) {
        return {
          success: false,
          code:
            'TASK_ID_REQUIRED',
          message:
            '首次建模采集缺少 task_id'
        }
      }


      // ==================================================
      // A2. 获取当前采集进度
      // ==================================================

      const progressWhere = {
        subject_id: subjectId,
        subject_type: subjectType,
        framework: framework
      }

      if (subjectType === 'student') {
        progressWhere.collection_phase = 'initial'
      }

      const progressResult =
        await db
          .collection(
            'collection_progress'
          )
          .where(progressWhere)
          .limit(2)
          .get()


      if (
        progressResult.data.length !==
        1
      ) {
        return {
          success: false,

          code:
            'COLLECTION_PROGRESS_NOT_FOUND',

          message:
            `未找到唯一有效的${subjectType === 'student' ? '学生' : '教师'}首次采集进度`
        }
      }


      const progress =
        progressResult.data[0]


      // ==================================================
      // A3. 已完成全部首次任务
      // ==================================================

      const totalTasks =
        subjectType === 'student'
          ? 17
          : 13

      const completedCount =
        typeof progress.completed_tasks === 'number'
          ? progress.completed_tasks
          : Number(progress.completed_count || 0)

      const collectionCompleted =
        progress.status ===
          'completed' &&
        completedCount ===
          totalTasks &&
        Array.isArray(
          progress.completed_task_ids
        ) &&
        progress.completed_task_ids
          .length === totalTasks


      if (collectionCompleted) {
        return {
          success: false,

          code:
            'INITIAL_COLLECTION_COMPLETED',

          message:
            `${subjectType === 'student' ? '学生' : '教师'}首次建模采集已经完成`
        }
      }


      // ==================================================
      // A4. 前端 task_id 必须就是后台当前任务
      //
      // 防止前端自行指定其他变量。
      // ==================================================

      const currentTaskId =
        progress.current_task_id ||
        ''


      if (
        !currentTaskId ||
        currentTaskId !== taskId
      ) {
        return {
          success: false,

          code:
            'TASK_NOT_CURRENT',

          current_task_id:
            currentTaskId,

          message:
            '当前任务与教师采集进度不一致'
        }
      }


      // ==================================================
      // A5. 获取正式任务定义
      // ==================================================

      const taskResult =
        await db
          .collection(
            'collection_tasks'
          )
          .where({
            task_id:
              taskId,

            subject_type:
              subjectType,

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

          code:
            'COLLECTION_TASK_NOT_FOUND',

          message:
            `当前${subjectType === 'student' ? '学生' : '教师'}采集任务不存在`
        }
      }


      const task =
        taskResult.data[0]


      // ==================================================
      // A6. 查询同任务已有 active session
      //
      // 首次访谈允许恢复，避免：
      // 返回页面 → 再进入 → 创建重复 session
      // ==================================================

      const existingWhere = {
        subject_id: subjectId,
        session_type: 'initial_interview',
        task_id: taskId,
        status: 'active'
      }

      // 历史教师 session 可能没有 subject_type；学生 session 必须同时
      // 匹配 subject_type 与当前 operator，避免恢复旧操作者的会话。
      if (subjectType === 'student') {
        existingWhere.subject_type = 'student'
        existingWhere.user_id = user.user_id
      }

      const existingResult =
        await db
          .collection('sessions')
          .where(existingWhere)
          .orderBy(
            'created_at',
            'desc'
          )
          .limit(1)
          .get()


      // ==================================================
      // A7. 复用已有 session
      // ==================================================

      if (
        existingResult.data.length >
        0
      ) {
        const session =
          existingResult.data[0]


        const recovery =
          await recoverSessionTranscripts(
            session.session_id
          )


        return {
          success: true,

          reused_session:
            true,

          has_existing_response:
            recovery
              .has_existing_response,

          latest_transcript:
            recovery
              .latest_transcript,

          recovered_transcripts:
            recovery
              .recovered_transcripts,

          session:
            session,

          message:
            `已恢复当前${subjectType === 'student' ? '学生' : '教师'}首次采集会话`
        }
      }


      // ==================================================
      // A8. 创建新的首次访谈 session
      // ==================================================

      const sessionId =
        createId('SESS')

      const recordId =
        createId('REC')

      const now =
        db.serverDate()


      const sessionDoc = {
        record_id:
          recordId,

        session_id:
          sessionId,

        user_id:
          user.user_id,

        subject_id:
          subjectId,

        subject_type:
          subjectType,

        framework:
          framework,

        session_type:
          'initial_interview',

        collection_phase:
          'initial',

        operator_user_id:
          user.user_id,

        task_id:
          task.task_id,

        task_order:
          typeof task.task_order ===
            'number'
            ? task.task_order
            : null,

        target_dimension:
          task.dimension_id || '',

        target_dimension_name:
          task.dimension_name || '',

        target_variable:
          task.variable_id || '',

        target_variable_name:
          task.variable_name || '',

        status:
          'active',

        started_at:
          now,

        created_at:
          now,

        updated_at:
          now
      }


      const addResult =
        await db
          .collection('sessions')
          .add({
            data:
              sessionDoc
          })


      return {
        success: true,

        reused_session:
          false,

        has_existing_response:
          false,

        latest_transcript:
          '',

        recovered_transcripts:
          [],

        session: {
          ...sessionDoc,

          _id:
            addResult._id
        },

        message:
          `${subjectType === 'student' ? '学生' : '教师'}首次采集会话创建成功`
      }
    }


    // ==================================================
    // B. 持续记录
    //
    // teaching_reflection
    // student_observation
    // free_dialogue
    //
    // 每次进入建立新的 session。
    //
    // 不在这里绑定 T1—T5 某个变量。
    // 后续由证据分析判断该记录支持哪些变量。
    // ==================================================

    if (
      subjectType === 'student' &&
      sessionType !== 'student_continuous_record'
    ) {
      return {
        success: false,
        code: 'STUDENT_SESSION_TYPE_NOT_SUPPORTED',
        message: '不支持当前学生采集会话类型'
      }
    }

    if (
      subjectType === 'teacher' &&
      sessionType === 'student_continuous_record'
    ) {
      return {
        success: false,
        code: 'TEACHER_SESSION_TYPE_MISMATCH',
        message: '学生持续采集类型不能用于教师主体'
      }
    }

    const sessionId =
      createId('SESS')

    const recordId =
      createId('REC')

    const now =
      db.serverDate()


    // ==================================================
    // 持续记录的中文类型
    // 方便后续管理和展示
    // ==================================================

    const typeNameMap = {
      teaching_reflection:
        '教学反思',

      student_observation:
        '学生观察',

      free_dialogue:
        '自由记录',

      student_continuous_record:
        '再说一说'
    }


    const sessionDoc = {
      record_id:
        recordId,

      session_id:
        sessionId,

      user_id:
        user.user_id,

      subject_id:
        subjectId,

      subject_type:
        subjectType,

      framework:
        framework,

      session_type:
        sessionType,

      session_type_name:
        typeNameMap[
          sessionType
        ] || '',

      collection_phase:
        'continuous',

      operator_user_id:
        user.user_id,

      // 持续记录阶段不预先指定变量
      target_dimension:
        '',

      target_variable:
        '',

      status:
        'active',

      started_at:
        now,

      created_at:
        now,

      updated_at:
        now
    }


    const addResult =
      await db
        .collection('sessions')
        .add({
          data:
            sessionDoc
        })


    return {
      success: true,

      reused_session:
        false,

      has_existing_response:
        false,

      latest_transcript:
        '',

      recovered_transcripts:
        [],

      session: {
        ...sessionDoc,

        _id:
          addResult._id
      },

      message:
        `${typeNameMap[sessionType] || '持续记录'}会话创建成功`
    }

  } catch (error) {

    console.error(
      'createSession error:',
      error
    )


    return {
      success: false,

      code:
        'CREATE_SESSION_ERROR',

      message:
        error.message ||
        '创建教师采集会话失败'
    }
  }
}
