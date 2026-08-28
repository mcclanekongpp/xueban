const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

const TEACHER_VARIABLES = [
  ['T1', '课程与学习目标取向', 'T1-1', '课程与学习价值理解', '可以回想一节你觉得“值得这样教”的课：你最希望学生真正带走什么？为什么？', 'teaching_reflection'],
  ['T1', '课程与学习目标取向', 'T1-2', '学习结果判断', '最近一次你判断学生“真的学会了”是什么时候？你依据了哪些具体表现？', 'student_observation'],
  ['T2', '学生理解与诊断', 'T2-1', '学生已有认识理解', '最近备课或上课时，你怎样发现学生原来已经知道什么、又误解了什么？', 'student_observation'],
  ['T2', '学生理解与诊断', 'T2-2', '学习困难诊断', '请说一个学生卡住的具体片段：你怎样判断困难在哪里，后来如何验证？', 'student_observation'],
  ['T2', '学生理解与诊断', 'T2-3', '个体差异理解', '同一个任务中，不同学生有哪些不同反应？你分别提供了什么支持？', 'student_observation'],
  ['T3', '教学策略与PCK', 'T3-1', '内容表征与任务设计', '请说一个你最近设计或调整过的任务：为什么这样设计，学生实际怎样回应？', 'teaching_reflection'],
  ['T3', '教学策略与PCK', 'T3-2', '提问与学习支架', '回想一次学生卡住时的对话：你具体问了什么，学生的想法后来怎样变化？', 'teaching_reflection'],
  ['T3', '教学策略与PCK', 'T3-3', '教学策略资源', '最近你选择某种教学方法或资源时，为什么认为它适合当时的内容和学生？', 'teaching_reflection'],
  ['T4', '互动与关系方式', 'T4-1', '提问与反馈方式', '请回想一次学生提出意外问题或回答不完整时，你怎样回应，为什么这样回应？', 'student_observation'],
  ['T4', '互动与关系方式', 'T4-2', '学生自主与教师介入', '最近一次你决定先不介入、或及时介入学生学习是什么时候？判断依据是什么？', 'student_observation'],
  ['T4', '互动与关系方式', 'T4-3', '互动组织与差异关注', '在一次全班或小组互动中，你怎样决定关注谁、怎样组织不同学生参与？', 'student_observation'],
  ['T5', '专业自我、适应与反思', 'T5-1', '专业自我与教学信念', '最近哪次教学选择最能体现你重视的教学原则？请说说选择背后的原因。', 'teaching_reflection'],
  ['T5', '专业自我、适应与反思', 'T5-2', '适应性调整与反思', '请说一次教学没有按预期发展后，你怎样调整，以及后来如何判断调整是否有效。', 'teaching_reflection']
]

const STUDENT_VARIABLES = [
  ['S1', '认知与已有经验', 'S1-1', '观察与信息提取', '最近你认真观察过什么？你发现了哪些以前没注意到的小地方？'],
  ['S1', '认知与已有经验', 'S1-2', '已有经验与认知解释', '最近有什么新发现让你想起以前做过或见过的事情？你觉得它们有什么关系？'],
  ['S1', '认知与已有经验', 'S1-3', '前概念与认知关联', '有没有一件事，你原来是这样想的，后来发现可能不一样？发生了什么？'],
  ['S2', '思维与问题解决', 'S2-1', '比较与分类', '最近你把一些东西分过组吗？你是按什么分的，为什么这样分？'],
  ['S2', '思维与问题解决', 'S2-2', '预测与解释', '最近你猜过一件事情接下来会怎样吗？你为什么这样猜，后来真的发生了吗？'],
  ['S2', '思维与问题解决', 'S2-3', '证据与问题解决', '最近你解决过什么问题？你试了哪些办法，怎么知道哪一个办法有用？'],
  ['S3', '学习与自我调节', 'S3-1', '任务专注与注意调节', '做一件事情时如果旁边有东西让你分心，你最近是怎么让自己继续做下去的？'],
  ['S3', '学习与自我调节', 'S3-2', '困难应对与策略调整', '最近哪件事第一次没成功？你后来换了什么办法，结果怎么样？'],
  ['S3', '学习与自我调节', 'S3-3', '自我监控与不确定性感知', '最近有没有一道题或一件事让你不太确定？你怎么检查自己是不是想对了？'],
  ['S4', '表达与社会互动', 'S4-1', '表达与提问', '最近你怎样把自己的想法讲给别人听？有不明白的地方时你问了什么？'],
  ['S4', '表达与社会互动', 'S4-2', '倾听与回应', '最近别人说了一个和你不一样的想法，你听完以后怎么回应？'],
  ['S4', '表达与社会互动', 'S4-3', '合作与观点调节', '最近你和别人一起完成了什么？意见不一样时，你们后来怎么办？'],
  ['S5', '动机、情绪与自我效能', 'S5-1', '好奇与学习投入意愿', '最近什么事情让你特别想弄明白？你为了知道答案做了什么？'],
  ['S5', '动机、情绪与自我效能', 'S5-2', '学习自信与挫折反应', '最近遇到做不好的事情时，你当时有什么感觉，后来又做了什么？'],
  ['S6', '兴趣、活动经验与生活情境', 'S6-1', '兴趣领域', '最近你最喜欢了解或做什么？是什么地方让你觉得有意思？'],
  ['S6', '兴趣、活动经验与生活情境', 'S6-2', '活动与生活经验', '最近在家里、学校或外面参加过什么活动？你从里面发现了什么？'],
  ['S6', '兴趣、活动经验与生活情境', 'S6-3', '家庭学习支持情境', '最近遇到不会的事情时，你先做了什么？家里人怎样和你一起想办法？']
]

function toVariableObjects(subjectType) {
  const source = subjectType === 'teacher' ? TEACHER_VARIABLES : STUDENT_VARIABLES
  return source.map((item) => ({
    dimension_id: item[0],
    dimension_name: item[1],
    variable_id: item[2],
    variable_name: item[3],
    prompt_text: item[4],
    entry_type: subjectType === 'teacher' ? item[5] : 'student_continuous_record'
  }))
}

function timeValue(value) {
  const raw = value && value.$date ? value.$date : value
  const timestamp = raw instanceof Date ? raw.getTime() : new Date(raw || 0).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

function cstDate(value) {
  const timestamp = timeValue(value)
  if (!timestamp) return ''
  const date = new Date(timestamp + 8 * 60 * 60 * 1000)
  return date.toISOString().slice(0, 10)
}

function unique(values) {
  return [...new Set(values.map((item) => String(item || '').trim()).filter(Boolean))]
}

function normalizeAnalysis(doc) {
  const body = doc && doc.analysis && typeof doc.analysis === 'object' ? doc.analysis : doc || {}
  return {
    ...doc,
    relevance_status: body.relevance_status || '',
    evidence_sufficiency: body.evidence_sufficiency || '',
    context: body.context || '',
    uncertainty: body.uncertainty || ''
  }
}

function isConsistent(analysis, evidence, subjectId, framework) {
  if (analysis.subject_id && analysis.subject_id !== subjectId) return false
  if (analysis.framework && analysis.framework !== framework) return false
  if (analysis.variable_id && analysis.variable_id !== evidence.variable_id) return false
  return analysis.evidence_id === evidence.evidence_id
}

function isSupportive(analysis) {
  return (
    ['relevant', 'partially_relevant'].includes(analysis.relevance_status) &&
    ['usable', 'weak'].includes(analysis.evidence_sufficiency)
  )
}

async function loadAll(collection, where, max = 500) {
  const rows = []
  for (let offset = 0; offset < max; offset += 100) {
    const result = await db.collection(collection).where(where).skip(offset).limit(100).get()
    rows.push(...result.data)
    if (result.data.length < 100) break
  }
  return rows
}

function findModelVariable(model, variableId) {
  const dimensions = model && Array.isArray(model.dimensions) ? model.dimensions : []
  for (const dimension of dimensions) {
    const variable = (dimension.variables || []).find((item) => item.variable_id === variableId)
    if (variable) return variable
  }
  return null
}

function statusKey(subjectType, variable) {
  if (!variable) return 'insufficient'
  if (subjectType === 'teacher') return String(variable.confidence || 'insufficient')
  const map = {
    '证据不足': 'insufficient',
    '初步描述': 'low',
    '已有一定支持': 'medium',
    '较稳定': 'high'
  }
  return map[String(variable.current_status || '')] || 'insufficient'
}

function buildGuidanceItem(subjectType, variable, pairs, modelVariable) {
  const supportive = pairs.filter(({ analysis }) => isSupportive(analysis))
  const usableCount = supportive.filter(({ analysis }) => analysis.evidence_sufficiency === 'usable').length
  const weakCount = supportive.filter(({ analysis }) => analysis.evidence_sufficiency === 'weak').length
  const contexts = unique(supportive.map(({ analysis }) => analysis.context))
  const dates = unique(supportive.map(({ evidence }) => cstDate(evidence.created_at)))
  const sourceTypes = unique(supportive.map(({ evidence }) => evidence.source_type))
  const currentStatus = statusKey(subjectType, modelVariable)

  let gapType = 'cross_context_validation'
  let reasonText = '已有一定信息，下一步适合用不同时间或不同情境的真实例子继续验证。'
  let priority = 30

  if (supportive.length === 0) {
    gapType = 'no_supportive_evidence'
    reasonText = '这一方面目前还缺少能够形成描述的具体真实例子。'
    priority = 100
  } else if (usableCount === 0) {
    gapType = 'weak_only'
    reasonText = '已经有一些线索，但还需要更具体的经过、判断原因或结果。'
    priority = 85
  } else if (usableCount === 1) {
    gapType = 'single_usable_evidence'
    reasonText = '已有一个较清楚的例子，建议再补充另一次真实经历进行核对。'
    priority = 70
  } else if (contexts.length < 2 || dates.length < 2) {
    gapType = contexts.length < 2 ? 'single_context' : 'single_time_point'
    reasonText = contexts.length < 2
      ? '已有多条信息，但主要来自同一种情境，建议补充另一种情境。'
      : '已有多条信息，但时间跨度还不足，建议补充最近的新例子。'
    priority = 55
  }

  if (currentStatus === 'insufficient') priority += 12
  if (currentStatus === 'low') priority += 5
  if (currentStatus === 'high') priority -= 20

  return {
    dimension_id: variable.dimension_id,
    dimension_name: variable.dimension_name,
    variable_id: variable.variable_id,
    variable_name: variable.variable_name,
    current_status: currentStatus,
    priority,
    gap_type: gapType,
    reason_text: reasonText,
    prompt_text: variable.prompt_text,
    entry_type: variable.entry_type,
    supportive_evidence_count: supportive.length,
    supportive_usable_count: usableCount,
    supportive_weak_count: weakCount,
    context_count: contexts.length,
    time_point_count: dates.length,
    source_type_count: sourceTypes.length
  }
}

exports.main = async (event = {}) => {
  const openid = cloud.getWXContext().OPENID
  const requestedType = event.subject_type === 'student' ? 'student' : 'teacher'

  if (!openid) {
    return { success: false, code: 'NO_OPENID', message: '未获取到微信用户标识' }
  }

  try {
    const userResult = await db.collection('users').where({ openid }).limit(2).get()
    if (userResult.data.length !== 1) {
      return { success: false, code: 'USER_NOT_FOUND', message: '当前用户不存在' }
    }

    const user = userResult.data[0]
    let subjectId = ''
    let framework = ''

    if (requestedType === 'teacher') {
      if (user.role !== 'teacher') {
        return { success: false, code: 'TEACHER_GUIDANCE_FORBIDDEN', message: '当前账号不是教师身份' }
      }
      const mapResult = await db.collection('identity_map').where({
        user_id: user.user_id,
        identity_type: 'teacher'
      }).limit(2).get()
      if (mapResult.data.length !== 1) {
        return { success: false, code: 'TEACHER_SUBJECT_INVALID', message: '教师主体不存在或存在重复' }
      }
      subjectId = mapResult.data[0].subject_id
      framework = 'teacher_v1.0'
    } else {
      subjectId = String(event.subject_id || '').trim()
      if (!subjectId) {
        return { success: false, code: 'STUDENT_SUBJECT_ID_REQUIRED', message: '缺少学生研究主体编号' }
      }
      const [bindingResult, subjectResult] = await Promise.all([
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
        }).limit(2).get()
      ])
      const isResearcher = ['researcher', 'admin'].includes(user.role)
      if (subjectResult.data.length !== 1 || (!isResearcher && bindingResult.data.length !== 1)) {
        return { success: false, code: 'STUDENT_GUIDANCE_FORBIDDEN', message: '当前微信无权读取该学生的后续采集建议' }
      }
      framework = 'student_v1.0'
    }

    const [rawEvidence, rawAnalyses, activeResult] = await Promise.all([
      // 历史教师记录可能尚未冗余 subject_type / framework。
      // 先按主体读取，再兼容字段缺失并拒绝明确冲突的记录。
      loadAll('evidence', { subject_id: subjectId, status: 'active' }),
      loadAll('evidence_analysis', { subject_id: subjectId, status: 'active' }),
      db.collection('model_snapshots').where({
        subject_id: subjectId,
        subject_type: requestedType,
        framework,
        status: 'active'
      }).orderBy('created_at', 'desc').limit(2).get()
    ])

    const evidence = rawEvidence.filter((item) => (
      (!item.subject_type || item.subject_type === requestedType) &&
      (!item.framework || item.framework === framework)
    ))
    const analyses = rawAnalyses.filter((item) => (
      (!item.subject_type || item.subject_type === requestedType) &&
      (!item.framework || item.framework === framework)
    ))

    let snapshot = activeResult.data[0] || null
    if (!snapshot) {
      const draftResult = await db.collection('model_snapshots').where({
        subject_id: subjectId,
        subject_type: requestedType,
        framework,
        status: 'draft'
      }).orderBy('created_at', 'desc').limit(2).get()
      snapshot = draftResult.data[0] || null
    }

    const analysisByEvidence = new Map()
    for (const raw of analyses.sort((a, b) => (
      timeValue(b.updated_at || b.analyzed_at || b.created_at) -
      timeValue(a.updated_at || a.analyzed_at || a.created_at)
    ))) {
      if (!analysisByEvidence.has(raw.evidence_id)) {
        analysisByEvidence.set(raw.evidence_id, normalizeAnalysis(raw))
      }
    }

    const pairsByVariable = new Map()
    for (const item of evidence) {
      const analysis = analysisByEvidence.get(item.evidence_id)
      if (!analysis || !isConsistent(analysis, item, subjectId, framework)) continue
      if (!pairsByVariable.has(item.variable_id)) pairsByVariable.set(item.variable_id, [])
      pairsByVariable.get(item.variable_id).push({ evidence: item, analysis })
    }

    const variables = toVariableObjects(requestedType)
    const items = variables
      .map((variable) => buildGuidanceItem(
        requestedType,
        variable,
        pairsByVariable.get(variable.variable_id) || [],
        findModelVariable(snapshot && snapshot.model_data, variable.variable_id)
      ))
      .sort((a, b) => b.priority - a.priority || a.variable_id.localeCompare(b.variable_id))

    const requestedLimit = Number(event.limit || 3)
    const limit = Math.max(1, Math.min(3, Number.isFinite(requestedLimit) ? requestedLimit : 3))

    return {
      success: true,
      subject_id: subjectId,
      subject_type: requestedType,
      framework,
      guidance_version: '1.0',
      calculation_method: 'evidence_health_rules',
      model_status: snapshot ? snapshot.status : '',
      snapshot_id: snapshot ? snapshot.snapshot_id : '',
      evidence_count: evidence.length,
      analyzed_evidence_count: [...analysisByEvidence.keys()].length,
      guidance: items.slice(0, limit),
      message: '后续采集建议已根据当前证据与模型状态生成'
    }
  } catch (error) {
    console.error('getSubjectModelGuidance error:', error)
    return {
      success: false,
      code: 'GET_SUBJECT_MODEL_GUIDANCE_ERROR',
      message: '读取后续采集建议失败'
    }
  }
}
