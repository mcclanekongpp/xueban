const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

const STUDENT_TASKS = [
  ['S1', '认知与已有经验', 'S1-1', '观察与信息提取', '仔细看过以后你发现了什么', '想一想你最近仔细观察过的一样东西。你发现了哪些别人可能没注意到的小地方？', 1],
  ['S1', '认知与已有经验', 'S1-2', '已有经验与认知解释', '用以前的经历来解释', '有没有一件事让你想起以前见过或做过的事情？说说它们哪里像，你是怎么想到的。', 2],
  ['S1', '认知与已有经验', 'S1-3', '前概念与认知关联', '后来发现和原来想的不一样', '说一件你原来以为是这样，后来发现不太一样的事情。你后来是怎么知道的？', 3],
  ['S2', '思维与问题解决', 'S2-1', '比较与分类', '你会怎么分一分', '如果桌上有很多不一样的东西，你会怎么把它们分成几组？为什么这样分？可以说一个真的例子。', 4],
  ['S2', '思维与问题解决', 'S2-2', '预测与解释', '猜一猜接下来会怎样', '说一次你猜接下来会发生什么的经历。你当时为什么这样猜？后来真的发生了吗？', 5],
  ['S2', '思维与问题解决', 'S2-3', '证据与问题解决', '遇到问题时怎么找办法', '说一件你自己想办法解决的问题。你看到了什么、试了什么，最后怎么知道办法有用？', 6],
  ['S3', '学习与自我调节', 'S3-1', '任务专注与注意调节', '怎样把一件事做完', '当你在做一件需要认真很久的事情时，什么会让你分心？你一般怎么让自己继续做下去？', 7],
  ['S3', '学习与自我调节', 'S3-2', '困难应对与策略调整', '第一次没成功怎么办', '如果你做一件事情的时候第一次没有成功，你一般会怎么办？可以说一个你真的遇到过的例子。', 8],
  ['S3', '学习与自我调节', 'S3-3', '自我监控与不确定性感知', '不确定的时候怎么确认', '有没有一次你不确定自己的答案对不对？你怎么发现自己不确定，又做了什么来确认？', 9],
  ['S4', '表达与社会互动', 'S4-1', '表达与提问', '把自己的想法说清楚', '说一次你很想让别人明白你的想法的经历。你是怎么说的？如果没听懂，你会怎么问？', 10],
  ['S4', '表达与社会互动', 'S4-2', '倾听与回应', '听到不同想法以后', '别人说的想法和你不一样时，你通常会怎么听、怎么回答？可以说一个真的例子。', 11],
  ['S4', '表达与社会互动', 'S4-3', '合作与观点调节', '和别人一起完成事情', '说一次你和别人一起完成一件事的经历。你们意见不一样时发生了什么？后来怎么做的？', 12],
  ['S5', '动机、情绪与自我效能', 'S5-1', '好奇与学习投入意愿', '最近特别想弄明白的事', '最近有没有一件事让你特别好奇，很想弄明白？你为什么好奇，又做了什么？', 13],
  ['S5', '动机、情绪与自我效能', 'S5-2', '学习自信与挫折反应', '觉得难的时候', '说一次你觉得一件事有点难、担心做不好的经历。你当时有什么感觉，后来怎么做了？', 14],
  ['S6', '兴趣、活动经验与生活情境', 'S6-1', '兴趣领域', '最喜欢花时间做什么', '平时你最喜欢花时间做什么？是什么让你喜欢它？可以讲一次你做这件事的经历。', 15],
  ['S6', '兴趣、活动经验与生活情境', 'S6-2', '活动与生活经验', '一次印象很深的活动', '说一次让你印象很深的活动，比如参观、游戏、劳动或旅行。你做了什么，又发现了什么？', 16],
  ['S6', '兴趣、活动经验与生活情境', 'S6-3', '家庭学习支持情境', '在家遇到想学的事', '在家里遇到想知道或想学的事情时，你通常会怎么做？家里的人会怎样和你一起做？', 17]
].map(([dimensionId, dimensionName, variableId, variableName, title, prompt, order]) => ({
  _id: `SC_${variableId.replace('-', '_')}_01`,
  task_id: `SC_${variableId.replace('-', '_')}_01`,
  framework: 'student_v1.0',
  subject_type: 'student',
  dimension_id: dimensionId,
  dimension_name: dimensionName,
  variable_id: variableId,
  variable_name: variableName,
  task_type: 'voice_prompt',
  response_mode: 'voice',
  prompt_text: prompt,
  title,
  collection_phase: 'initial',
  status: 'active',
  active: true,
  required: true,
  order,
  task_order: order,
  version: '1.0'
}))

exports.main = async () => {
  const openid = cloud.getWXContext().OPENID

  if (!openid) {
    return { success: false, code: 'NO_OPENID', message: '未获取到微信用户标识' }
  }

  try {
    const userResult = await db.collection('users').where({ openid }).limit(2).get()
    const user = userResult.data.length === 1 ? userResult.data[0] : null

    if (!user || !['teacher', 'researcher', 'admin'].includes(user.role)) {
      return {
        success: false,
        code: 'INIT_STUDENT_TASKS_FORBIDDEN',
        message: '当前账号无权初始化学生任务配置'
      }
    }

    const existingResult = await db
      .collection('collection_tasks')
      .where({ subject_type: 'student', framework: 'student_v1.0' })
      .limit(100)
      .get()

    const byId = new Map(existingResult.data.map((item) => [item.task_id, item]))
    const duplicateIds = STUDENT_TASKS.filter(
      (task) => existingResult.data.filter((item) => item.task_id === task.task_id).length > 1
    ).map((task) => task.task_id)

    if (duplicateIds.length > 0) {
      return {
        success: false,
        code: 'DUPLICATE_STUDENT_COLLECTION_TASKS',
        duplicate_task_ids: duplicateIds
      }
    }

    const conflicts = STUDENT_TASKS.filter((task) => {
      const old = byId.get(task.task_id)
      return old && (old.variable_id !== task.variable_id || Number(old.task_order) !== task.task_order)
    })

    if (conflicts.length > 0) {
      return {
        success: false,
        code: 'STUDENT_TASK_CONFIG_CONFLICT',
        conflict_task_ids: conflicts.map((item) => item.task_id)
      }
    }

    const inserted = []

    for (const task of STUDENT_TASKS) {
      if (byId.has(task.task_id)) continue

      await db.collection('collection_tasks').add({
        data: { ...task, created_at: db.serverDate(), updated_at: db.serverDate() }
      })
      inserted.push(task.task_id)
    }

    return {
      success: true,
      framework: 'student_v1.0',
      total_tasks: 17,
      inserted_count: inserted.length,
      skipped_count: 17 - inserted.length,
      inserted_task_ids: inserted,
      task_order: STUDENT_TASKS.map((task) => task.variable_id)
    }
  } catch (error) {
    console.error('initStudentCollectionTasks error:', error)
    return {
      success: false,
      code: 'INIT_STUDENT_TASKS_ERROR',
      message: '初始化学生首次采集任务失败'
    }
  }
}
