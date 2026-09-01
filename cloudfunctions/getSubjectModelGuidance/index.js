const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const { authorizeStudentOperator } = require('./student-operator-auth')

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

const DIMENSION_SHORT_NAMES = {
  T1: '目标取向',
  T2: '学生理解',
  T3: '教学策略',
  T4: '互动关系',
  T5: '专业反思',
  S1: '认知经验',
  S2: '思维解题',
  S3: '自我调节',
  S4: '表达互动',
  S5: '动机情绪',
  S6: '兴趣情境'
}

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
    const baseQuery = db.collection(collection)
    const query = where && Object.keys(where).length > 0
      ? baseQuery.where(where)
      : baseQuery
    const result = await query.skip(offset).limit(100).get()
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

// 构建进度只描述模型证据底座的覆盖和持续积累，不评价主体水平。
// supportive 仍使用正式 Evidence Analysis 门槛；进度计算绝不改变
// relevance / sufficiency / confidence 或模型采纳规则。
function buildVariableProgress(variable, evidence, pairs) {
  const supportive = pairs.filter(({ analysis }) => isSupportive(analysis))
  const contexts = unique(supportive.map(({ analysis }) => analysis.context))
  const dates = unique(supportive.map(({ evidence: item }) => cstDate(item.created_at)))
  const sourceTypes = unique(supportive.map(({ evidence: item }) => item.source_type))

  const components = {
    collected: evidence.length > 0 ? 20 : 0,
    analyzed: pairs.length > 0 ? 20 : 0,
    supportive_foundation: supportive.length > 0 ? 30 : 0,
    repeated_support: supportive.length >= 2 ? 15 : 0,
    cross_time: dates.length >= 2 ? 10 : 0,
    context_or_source_breadth: contexts.length >= 2 || sourceTypes.length >= 2 ? 5 : 0
  }
  const progressPercent = Object.values(components).reduce((sum, value) => sum + value, 0)

  return {
    dimension_id: variable.dimension_id,
    dimension_name: variable.dimension_name,
    variable_id: variable.variable_id,
    variable_name: variable.variable_name,
    progress_percent: progressPercent,
    evidence_count: evidence.length,
    analyzed_evidence_count: pairs.length,
    supportive_evidence_count: supportive.length,
    time_point_count: dates.length,
    context_count: contexts.length,
    source_type_count: sourceTypes.length,
    components
  }
}

function progressBand(percent) {
  if (percent >= 90) return '覆盖较充分'
  if (percent >= 70) return '已有基础'
  if (percent >= 40) return '正在补充'
  if (percent > 0) return '刚开始'
  return '待采集'
}

function buildConstructionProgress(variables, evidenceByVariable, pairsByVariable) {
  const variableProgress = variables.map((variable) => buildVariableProgress(
    variable,
    evidenceByVariable.get(variable.variable_id) || [],
    pairsByVariable.get(variable.variable_id) || []
  ))
  const dimensionOrder = unique(variables.map((item) => item.dimension_id))
  const dimensions = dimensionOrder.map((dimensionId) => {
    const items = variableProgress.filter((item) => item.dimension_id === dimensionId)
    const percent = items.length > 0
      ? Math.round(items.reduce((sum, item) => sum + item.progress_percent, 0) / items.length)
      : 0

    return {
      dimension_id: dimensionId,
      dimension_name: items[0] ? items[0].dimension_name : '',
      display_name: DIMENSION_SHORT_NAMES[dimensionId] || dimensionId,
      progress_percent: percent,
      variable_count: items.length,
      collected_variable_count: items.filter((item) => item.evidence_count > 0).length,
      supportive_variable_count: items.filter((item) => item.supportive_evidence_count > 0).length
    }
  })
  const overallPercent = variableProgress.length > 0
    ? Math.round(variableProgress.reduce((sum, item) => sum + item.progress_percent, 0) / variableProgress.length)
    : 0
  const summaryText = dimensions
    .map((item) => `${item.display_name}${progressBand(item.progress_percent)}`)
    .join('；') + '。'

  return {
    index_name: '模型构建进度',
    index_version: '1.0',
    is_quality_score: false,
    overall_percent: overallPercent,
    variable_count: variableProgress.length,
    collected_variable_count: variableProgress.filter((item) => item.evidence_count > 0).length,
    analyzed_variable_count: variableProgress.filter((item) => item.analyzed_evidence_count > 0).length,
    supportive_variable_count: variableProgress.filter((item) => item.supportive_evidence_count > 0).length,
    dimensions,
    variables: variableProgress,
    summary_text: summaryText,
    formula: {
      collected: 20,
      analyzed: 20,
      supportive_foundation: 30,
      repeated_support: 15,
      cross_time: 10,
      context_or_source_breadth: 5
    },
    note: '仅表示证据覆盖与持续积累进度，不代表能力、水平、质量或模型结论置信度。'
  }
}

function latestByCreatedAt(items) {
  return [...items].sort((a, b) => (
    timeValue(b.updated_at || b.created_at) -
    timeValue(a.updated_at || a.created_at)
  ))[0] || null
}

async function buildResearchOverview(event, user) {
  if (!['researcher', 'admin'].includes(user.role)) {
    return {
      success: false,
      code: 'RESEARCH_MODEL_OVERVIEW_FORBIDDEN',
      message: '只有 researcher / admin 可以查看跨主体模型构建总览'
    }
  }

  const requestedType = ['teacher', 'student'].includes(event.subject_type)
    ? event.subject_type
    : ''
  const requestedSchoolId = String(event.school_id || '').trim()
  const requestedClassId = String(event.class_id || '').trim()
  const [subjects, progressRows, snapshots, evidenceRows, analysisRows, memberships, classes] = await Promise.all([
    loadAll('subjects', { status: 'active' }, 1000),
    loadAll('collection_progress', {}, 1000),
    loadAll('model_snapshots', { status: 'active' }, 1000),
    loadAll('evidence', { status: 'active' }, 2000),
    loadAll('evidence_analysis', { status: 'active' }, 2000),
    loadAll('class_memberships', { status: 'active' }, 1000),
    loadAll('classes', { status: 'active' }, 1000)
  ])

  const schoolByClass = new Map(classes.map(item => [item.class_id, item.school_id || '']))

  const membershipsBySubject = new Map()
  for (const membership of memberships) {
    if (!membershipsBySubject.has(membership.subject_id)) {
      membershipsBySubject.set(membership.subject_id, [])
    }
    membershipsBySubject.get(membership.subject_id).push(membership)
  }

  const latestAnalysisByEvidence = new Map()
  for (const raw of [...analysisRows].sort((a, b) => (
    timeValue(b.updated_at || b.analyzed_at || b.created_at) -
    timeValue(a.updated_at || a.analyzed_at || a.created_at)
  ))) {
    if (raw.evidence_id && !latestAnalysisByEvidence.has(raw.evidence_id)) {
      latestAnalysisByEvidence.set(raw.evidence_id, normalizeAnalysis(raw))
    }
  }

  const rows = []

  for (const subject of subjects) {
    const subjectType = subject.subject_type
    const framework = subject.model_framework || subject.framework || ''

    if (!['teacher', 'student'].includes(subjectType)) continue
    if (requestedType && subjectType !== requestedType) continue
    if (
      (subjectType === 'teacher' && framework !== 'teacher_v1.0') ||
      (subjectType === 'student' && framework !== 'student_v1.0')
    ) continue

    const subjectMemberships = membershipsBySubject.get(subject.subject_id) || []
    if (requestedClassId && !subjectMemberships.some(item => item.class_id === requestedClassId)) {
      continue
    }
    if (requestedSchoolId && !subjectMemberships.some(item => (
      (item.school_id || schoolByClass.get(item.class_id) || '') === requestedSchoolId
    ))) {
      continue
    }

    const subjectEvidence = evidenceRows.filter(item => (
      item.subject_id === subject.subject_id &&
      (!item.subject_type || item.subject_type === subjectType) &&
      (!item.framework || item.framework === framework)
    ))
    const evidenceByVariable = new Map()
    const pairsByVariable = new Map()

    for (const evidence of subjectEvidence) {
      if (!evidenceByVariable.has(evidence.variable_id)) {
        evidenceByVariable.set(evidence.variable_id, [])
      }
      evidenceByVariable.get(evidence.variable_id).push(evidence)

      const analysis = latestAnalysisByEvidence.get(evidence.evidence_id)
      if (!analysis || !isConsistent(analysis, evidence, subject.subject_id, framework)) continue
      if (!pairsByVariable.has(evidence.variable_id)) {
        pairsByVariable.set(evidence.variable_id, [])
      }
      pairsByVariable.get(evidence.variable_id).push({ evidence, analysis })
    }

    const variables = toVariableObjects(subjectType)
    const constructionProgress = buildConstructionProgress(
      variables,
      evidenceByVariable,
      pairsByVariable
    )
    const subjectSnapshots = snapshots.filter(item => (
      item.subject_id === subject.subject_id &&
      (!item.subject_type || item.subject_type === subjectType) &&
      (!item.framework || item.framework === framework)
    ))
    const snapshot = latestByCreatedAt(subjectSnapshots)
    const initialProgress = latestByCreatedAt(progressRows.filter(item => (
      item.subject_id === subject.subject_id &&
      (!item.subject_type || item.subject_type === subjectType) &&
      (!item.framework || item.framework === framework) &&
      (!item.collection_phase || item.collection_phase === 'initial')
    )))
    const guidance = variables
      .map(variable => buildGuidanceItem(
        subjectType,
        variable,
        pairsByVariable.get(variable.variable_id) || [],
        findModelVariable(snapshot && snapshot.model_data, variable.variable_id)
      ))
      .sort((a, b) => b.priority - a.priority || a.variable_id.localeCompare(b.variable_id))
      .slice(0, 3)
      .map(item => ({
        dimension_id: item.dimension_id,
        dimension_name: item.dimension_name,
        variable_id: item.variable_id,
        variable_name: item.variable_name,
        gap_type: item.gap_type,
        reason_text: item.reason_text,
        prompt_text: item.prompt_text,
        priority: item.priority
      }))
    const completedCount = Number(
      initialProgress && (initialProgress.completed_tasks || initialProgress.completed_count) || 0
    )
    const totalTasks = subjectType === 'teacher' ? 13 : 17

    rows.push({
      subject_id: subject.subject_id,
      subject_type: subjectType,
      framework,
      research_alias: String(subject.research_alias || '').trim(),
      is_test: subject.is_test === true,
      class_ids: unique(subjectMemberships.map(item => item.class_id)),
      school_ids: unique(subjectMemberships.map(item => (
        item.school_id || schoolByClass.get(item.class_id) || ''
      ))),
      initial_collection: {
        status: initialProgress ? initialProgress.status || 'not_started' : 'not_started',
        completed_count: completedCount,
        total_tasks: totalTasks,
        completed: Boolean(initialProgress && initialProgress.status === 'completed' && completedCount === totalTasks)
      },
      current_model: snapshot
        ? {
          has_model: true,
          snapshot_id: snapshot.snapshot_id || '',
          snapshot_type: snapshot.snapshot_type || snapshot.model_type || '',
          model_version: snapshot.model_version || snapshot.version || '',
          status: snapshot.status || '',
          activation_mode: snapshot.activation_mode || '',
          updated_at: snapshot.updated_at || snapshot.created_at || null
        }
        : {
          has_model: false,
          snapshot_id: '',
          snapshot_type: '',
          model_version: '',
          status: '',
          activation_mode: '',
          updated_at: null
        },
      construction_progress: constructionProgress,
      gap_variable_count: constructionProgress.variables.filter(item => item.supportive_evidence_count === 0).length,
      guidance
    })
  }

  rows.sort((a, b) => (
    a.subject_type.localeCompare(b.subject_type) ||
    String(a.research_alias || a.subject_id).localeCompare(String(b.research_alias || b.subject_id))
  ))

  return {
    success: true,
    action: 'research_overview',
    access_scope: 'researcher_admin_only',
    generated_at: new Date().toISOString(),
    summary: {
      subject_count: rows.length,
      teacher_count: rows.filter(item => item.subject_type === 'teacher').length,
      student_count: rows.filter(item => item.subject_type === 'student').length,
      initial_collection_completed_count: rows.filter(item => item.initial_collection.completed).length,
      active_model_count: rows.filter(item => item.current_model.has_model).length
    },
    subjects: rows,
    note: '构建进度只表示固定维度的证据覆盖与持续积累，不评价教师或学生。'
  }
}

exports.main = async (event = {}) => {
  const openid = cloud.getWXContext().OPENID
  const requestedType = (
    event.subject_type === 'student' ||
    event.framework === 'student_v1.0'
  ) ? 'student' : 'teacher'

  if (!openid) {
    return { success: false, code: 'NO_OPENID', message: '未获取到微信用户标识' }
  }

  try {
    const userResult = await db.collection('users').where({ openid }).limit(2).get()
    if (userResult.data.length !== 1) {
      return { success: false, code: 'USER_NOT_FOUND', message: '当前用户不存在' }
    }

    const user = userResult.data[0]

    if (event.action === 'research_overview') {
      return await buildResearchOverview(event, user)
    }

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
      const authorization = await authorizeStudentOperator({
        db,
        openid,
        subjectId,
        allowResearcher: true
      })
      if (!authorization.authorized) {
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

    const evidenceByVariable = new Map()
    const pairsByVariable = new Map()
    for (const item of evidence) {
      if (!evidenceByVariable.has(item.variable_id)) evidenceByVariable.set(item.variable_id, [])
      evidenceByVariable.get(item.variable_id).push(item)
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
    const constructionProgress = buildConstructionProgress(
      variables,
      evidenceByVariable,
      pairsByVariable
    )

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
      construction_progress: constructionProgress,
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
