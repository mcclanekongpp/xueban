// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 教师主体模型 V1.0：13 个首次预设采集任务
const teacherTasks = [
  {
    task_id: 'TC_T1_1_01',
    subject_type: 'teacher',
    framework: 'teacher_v1.0',

    dimension_id: 'T1',
    dimension_name: '课程与学习目标取向',

    variable_id: 'T1-1',
    variable_name: '课程与学习价值理解',

    task_order: 1,
    task_type: 'initial_interview',
    response_mode: 'voice',

    title: '为什么要学这门课',

    prompt_text:
      '为什么一年级孩子需要上科学课？如果一段时间以后，孩子只能从科学课中真正留下几样东西，你最希望他们留下什么？',

    probe_prompts: [
      '能不能结合你真实上过的一节课说说？',
      '你为什么特别看重这些？'
    ],

    status: 'active',
    version: '1.0'
  },

  {
    task_id: 'TC_T1_2_01',
    subject_type: 'teacher',
    framework: 'teacher_v1.0',

    dimension_id: 'T1',
    dimension_name: '课程与学习目标取向',

    variable_id: 'T1-2',
    variable_name: '学习结果判断',

    task_order: 2,
    task_type: 'initial_interview',
    response_mode: 'voice',

    title: '怎样判断孩子真正学会了',

    prompt_text:
      '请回想一个你觉得孩子真正学会了的例子，再想一个孩子表面上答对了、但你后来发现他其实还没有真正理解的例子。你当时是怎么判断的？',

    probe_prompts: [
      '你主要看到了哪些表现或证据？',
      '是什么让你改变了最初的判断？'
    ],

    status: 'active',
    version: '1.0'
  },

  {
    task_id: 'TC_T2_1_01',
    subject_type: 'teacher',
    framework: 'teacher_v1.0',

    dimension_id: 'T2',
    dimension_name: '学生理解与诊断',

    variable_id: 'T2-1',
    variable_name: '学生已有认识理解',

    task_order: 3,
    task_type: 'initial_interview',
    response_mode: 'voice',

    title: '孩子带着什么来到课堂',

    prompt_text:
      '请回想一次学生带着自己原有的想法、生活经验或解释进入课堂的情况。这个孩子当时是怎么想的？你是怎么知道的？',

    probe_prompts: [
      '孩子当时具体说了什么或做了什么？',
      '你后来怎么看待他原来的想法？'
    ],

    status: 'active',
    version: '1.0'
  },

  {
    task_id: 'TC_T2_2_01',
    subject_type: 'teacher',
    framework: 'teacher_v1.0',

    dimension_id: 'T2',
    dimension_name: '学生理解与诊断',

    variable_id: 'T2-2',
    variable_name: '学习困难诊断',

    task_order: 4,
    task_type: 'initial_interview',
    response_mode: 'voice',

    title: '孩子为什么卡住了',

    prompt_text:
      '请讲一次学生遇到学习困难的真实经历。最好是刚开始你并不确定他为什么不会，后来才逐渐弄清楚原因的例子。你是怎么判断出来的？',

    probe_prompts: [
      '一开始你以为问题出在哪里？',
      '后来出现了什么信息，让你重新判断？'
    ],

    status: 'active',
    version: '1.0'
  },

  {
    task_id: 'TC_T2_3_01',
    subject_type: 'teacher',
    framework: 'teacher_v1.0',

    dimension_id: 'T2',
    dimension_name: '学生理解与诊断',

    variable_id: 'T2-3',
    variable_name: '个体差异理解',

    task_order: 5,
    task_type: 'initial_interview',
    response_mode: 'voice',

    title: '两个不一样的孩子',

    prompt_text:
      '请想两个在你的课堂中表现很不一样的学生。这种“不一样”不只是成绩高低。你觉得他们分别有什么特点？这些差异会怎样影响你的教学？',

    probe_prompts: [
      '有没有一个学生曾经让你改变过对他的最初判断？',
      '你后来为什么会改变看法？'
    ],

    status: 'active',
    version: '1.0'
  },

  {
    task_id: 'TC_T3_1_01',
    subject_type: 'teacher',
    framework: 'teacher_v1.0',

    dimension_id: 'T3',
    dimension_name: '教学策略与PCK',

    variable_id: 'T3-1',
    variable_name: '内容表征与任务设计',

    task_order: 6,
    task_type: 'initial_interview',
    response_mode: 'voice',

    title: '把内容变成孩子能学的活动',

    prompt_text:
      '请选一节你比较有代表性的课，说说你是怎样把原本要教的知识或内容，转化成孩子能够观察、操作、思考或交流的学习活动的。',

    probe_prompts: [
      '你为什么选择这种活动，而不是另一种方式？',
      '你最希望孩子通过这个活动发现什么？'
    ],

    status: 'active',
    version: '1.0'
  },

  {
    task_id: 'TC_T3_2_01',
    subject_type: 'teacher',
    framework: 'teacher_v1.0',

    dimension_id: 'T3',
    dimension_name: '教学策略与PCK',

    variable_id: 'T3-2',
    variable_name: '提问与学习支架',

    task_order: 7,
    task_type: 'initial_interview',
    response_mode: 'voice',

    title: '孩子卡住时你怎么帮',

    prompt_text:
      '请回想一次学生卡住了，但你没有直接告诉他答案的情况。你当时是怎样一步一步帮助他的？尽量回忆一下你当时具体说了什么。',

    probe_prompts: [
      '你为什么没有直接告诉答案？',
      '孩子接下来发生了什么变化？'
    ],

    status: 'active',
    version: '1.0'
  },

  {
    task_id: 'TC_T3_3_01',
    subject_type: 'teacher',
    framework: 'teacher_v1.0',

    dimension_id: 'T3',
    dimension_name: '教学策略与PCK',

    variable_id: 'T3-3',
    variable_name: '教学策略资源',

    task_order: 8,
    task_type: 'initial_interview',
    response_mode: 'voice',

    title: '你常用哪些教学办法',

    prompt_text:
      '在平时教学中，你最常使用哪些教学方法或策略？分别在什么情况下会用？有没有一种方法你很少使用，为什么？',

    probe_prompts: [
      '哪一种策略你觉得自己最熟悉？',
      '什么情况下你会换一种教学办法？'
    ],

    status: 'active',
    version: '1.0'
  },

  {
    task_id: 'TC_T4_1_01',
    subject_type: 'teacher',
    framework: 'teacher_v1.0',

    dimension_id: 'T4',
    dimension_name: '互动与关系方式',

    variable_id: 'T4-1',
    variable_name: '提问与反馈方式',

    task_order: 9,
    task_type: 'initial_interview',
    response_mode: 'voice',

    title: '面对意外回答时你怎么回应',

    prompt_text:
      '请回想最近一次学生给出了错误、不完整，或者出乎你预料的回答。当时你的第一反应是什么？你具体是怎么回应他的？',

    probe_prompts: [
      '如果能记起来，尽量说说你当时的原话。',
      '学生听到你的回应以后发生了什么？'
    ],

    status: 'active',
    version: '1.0'
  },

  {
    task_id: 'TC_T4_2_01',
    subject_type: 'teacher',
    framework: 'teacher_v1.0',

    dimension_id: 'T4',
    dimension_name: '互动与关系方式',

    variable_id: 'T4-2',
    variable_name: '学生自主与教师介入',

    task_order: 10,
    task_type: 'initial_interview',
    response_mode: 'voice',

    title: '什么时候等，什么时候介入',

    prompt_text:
      '请讲一次你明明可以马上介入，但选择先等一等的课堂经历；也可以讲一次你原本想让学生自己解决，后来还是决定介入的经历。你当时为什么这样决定？',

    probe_prompts: [
      '什么表现会让你继续等待？',
      '什么情况出现时，你会觉得必须介入？'
    ],

    status: 'active',
    version: '1.0'
  },

  {
    task_id: 'TC_T4_3_01',
    subject_type: 'teacher',
    framework: 'teacher_v1.0',

    dimension_id: 'T4',
    dimension_name: '互动与关系方式',

    variable_id: 'T4-3',
    variable_name: '互动组织与差异关注',

    task_order: 11,
    task_type: 'initial_interview',
    response_mode: 'voice',

    title: '课堂上你在关注谁',

    prompt_text:
      '一节课里有很多学生，你通常怎么判断现在应该看谁、问谁、听谁，或者帮助谁？请结合一节真实的课说说。',

    probe_prompts: [
      '哪些学生比较容易进入你的注意范围？',
      '你怎么发现那些不太主动表达的学生？'
    ],

    status: 'active',
    version: '1.0'
  },

  {
    task_id: 'TC_T5_1_01',
    subject_type: 'teacher',
    framework: 'teacher_v1.0',

    dimension_id: 'T5',
    dimension_name: '专业自我、适应与反思',

    variable_id: 'T5-1',
    variable_name: '专业自我与教学信念',

    task_order: 12,
    task_type: 'initial_interview',
    response_mode: 'voice',

    title: '认识你这位老师',

    prompt_text:
      '如果让我真正认识你这位老师，而不是只看你的履历，你觉得我最应该先知道你什么？你觉得自己教学中比较看重什么，又有哪些地方是你一直在琢磨的？',

    probe_prompts: [
      '你理想中的课堂是什么样的？',
      '你觉得自己作为教师最稳定的特点是什么？'
    ],

    status: 'active',
    version: '1.0'
  },

  {
    task_id: 'TC_T5_2_01',
    subject_type: 'teacher',
    framework: 'teacher_v1.0',

    dimension_id: 'T5',
    dimension_name: '专业自我、适应与反思',

    variable_id: 'T5-2',
    variable_name: '适应性调整与反思',

    task_order: 13,
    task_type: 'initial_interview',
    response_mode: 'voice',

    title: '一节没有按计划发展的课',

    prompt_text:
      '请回想一节实际发展和你原来预想不太一样的课。你后来是怎么理解这件事的？之后有没有做什么调整？你又是怎么知道这个调整有没有效果的？',

    probe_prompts: [
      '当时最出乎你预料的是什么？',
      '这件事后来有没有改变你的某种教学做法或判断？'
    ],

    status: 'active',
    version: '1.0'
  }
]

// 云函数入口函数
exports.main = async (event, context) => {
  try {
    // 1. 查询当前框架已经存在的任务
    const existingResult = await db.collection('collection_tasks')
      .where({
        subject_type: 'teacher',
        framework: 'teacher_v1.0'
      })
      .get()

    const existingTaskIds = new Set(
      existingResult.data.map(item => item.task_id)
    )

    let insertedCount = 0
    let skippedCount = 0
    const insertedTaskIds = []

    // 2. 逐条检查，避免重复初始化
    for (const task of teacherTasks) {
      if (existingTaskIds.has(task.task_id)) {
        skippedCount++
        continue
      }

      await db.collection('collection_tasks').add({
        data: {
          ...task,

          required: true,

          created_at: db.serverDate(),
          updated_at: db.serverDate()
        }
      })

      insertedCount++
      insertedTaskIds.push(task.task_id)
    }

    // 3. 返回初始化结果
    return {
      success: true,

      framework: 'teacher_v1.0',

      total_tasks: teacherTasks.length,
      inserted_count: insertedCount,
      skipped_count: skippedCount,

      inserted_task_ids: insertedTaskIds,

      message:
        insertedCount > 0
          ? '教师预设采集任务初始化完成'
          : '教师预设采集任务已经存在，无需重复初始化'
    }

  } catch (error) {
    console.error(
      'initTeacherCollectionTasks error:',
      error
    )

    return {
      success: false,
      code: 'INIT_TASKS_ERROR',
      message:
        error.message ||
        '教师预设采集任务初始化失败'
    }
  }
}