const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

const DIMENSIONS = [
  ['S1', '认知与已有经验', [['S1-1', '观察与信息提取'], ['S1-2', '已有经验与认知解释'], ['S1-3', '前概念与认知关联']]],
  ['S2', '思维与问题解决', [['S2-1', '比较与分类'], ['S2-2', '预测与解释'], ['S2-3', '证据与问题解决']]],
  ['S3', '学习与自我调节', [['S3-1', '任务专注与注意调节'], ['S3-2', '困难应对与策略调整'], ['S3-3', '自我监控与不确定性感知']]],
  ['S4', '表达与社会互动', [['S4-1', '表达与提问'], ['S4-2', '倾听与回应'], ['S4-3', '合作与观点调节']]],
  ['S5', '动机、情绪与自我效能', [['S5-1', '好奇与学习投入意愿'], ['S5-2', '学习自信与挫折反应']]],
  ['S6', '兴趣、活动经验与生活情境', [['S6-1', '兴趣领域'], ['S6-2', '活动与生活经验'], ['S6-3', '家庭学习支持情境']]]
].map(([dimensionId, dimensionName, variables]) => ({
  dimension_id: dimensionId,
  dimension_name: dimensionName,
  variables: variables.map(([variableId, variableName]) => ({
    variable_id: variableId,
    variable_name: variableName
  }))
}))

const VARIABLES = DIMENSIONS.flatMap((dimension) =>
  dimension.variables.map((variable) => ({
    dimension_id: dimension.dimension_id,
    dimension_name: dimension.dimension_name,
    ...variable
  }))
)

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36).toUpperCase()}_${Math.random()
    .toString(36)
    .slice(2, 7)
    .toUpperCase()}`
}

function uniqueStrings(values) {
  return [...new Set(values.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean))]
}

function isSupportive(analysis) {
  return (
    ['relevant', 'partially_relevant'].includes(analysis.relevance_status) &&
    ['usable', 'weak'].includes(analysis.evidence_sufficiency)
  )
}

exports.main = async (event = {}) => {
  const openid = cloud.getWXContext().OPENID
  const subjectId = String(event.subject_id || '').trim()

  if (!openid || !subjectId) {
    return {
      success: false,
      code: !openid ? 'NO_OPENID' : 'STUDENT_SUBJECT_ID_REQUIRED',
      message: !openid ? '未获取到微信用户标识' : '缺少学生研究主体编号'
    }
  }

  try {
    const userResult = await db.collection('users').where({ openid }).limit(2).get()
    const user = userResult.data.length === 1 ? userResult.data[0] : null

    if (!user) {
      return { success: false, code: 'USER_NOT_FOUND', message: '当前用户不存在' }
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

    if (subjectResult.data.length !== 1) {
      return {
        success: false,
        code: 'STUDENT_SUBJECT_NOT_ACTIVE',
        message: '学生研究主体不存在或已失效'
      }
    }

    const subject = subjectResult.data[0]
    const controlled =
      ['researcher', 'admin'].includes(user.role) ||
      (
        user.role === 'teacher' &&
        subject.is_test === true &&
        bindingResult.data.length === 1
      )

    if (!controlled) {
      return {
        success: false,
        code: 'BUILD_STUDENT_MODEL_FORBIDDEN',
        message: 'Student-M0 只能由受控研究流程构建'
      }
    }

    const [progressResult, backgroundResult, activeResult, draftResult] = await Promise.all([
      db.collection('collection_progress').where({
        subject_id: subjectId,
        subject_type: 'student',
        framework: 'student_v1.0',
        collection_phase: 'initial'
      }).limit(2).get(),
      db.collection('subject_background').where({
        subject_id: subjectId,
        subject_type: 'student',
        framework: 'student_v1.0',
        status: 'active'
      }).limit(2).get(),
      db.collection('model_snapshots').where({
        subject_id: subjectId,
        subject_type: 'student',
        framework: 'student_v1.0',
        snapshot_type: 'initial',
        status: 'active'
      }).limit(2).get(),
      db.collection('model_snapshots').where({
        subject_id: subjectId,
        subject_type: 'student',
        framework: 'student_v1.0',
        snapshot_type: 'initial',
        status: 'draft'
      }).orderBy('created_at', 'desc').limit(2).get()
    ])

    if (draftResult.data.length > 1 || activeResult.data.length > 1) {
      return {
        success: false,
        code: 'DUPLICATE_STUDENT_INITIAL_MODEL',
        message: '该学生存在重复初始模型快照'
      }
    }

    if (activeResult.data.length === 1) {
      const active = activeResult.data[0]
      return {
        success: true,
        already_active: true,
        draft: false,
        snapshot_id: active.snapshot_id,
        model: active.model_data
      }
    }

    if (draftResult.data.length === 1) {
      const draft = draftResult.data[0]
      return {
        success: true,
        reused_draft: true,
        draft: true,
        draft_snapshot_id: draft.snapshot_id,
        model: draft.model_data
      }
    }

    if (progressResult.data.length !== 1) {
      return {
        success: false,
        code: 'STUDENT_COLLECTION_PROGRESS_INVALID',
        message: '学生首次采集进度缺失或重复'
      }
    }

    const progress = progressResult.data[0]
    const completed = Number(progress.completed_tasks || progress.completed_count || 0)

    if (progress.status !== 'completed' || completed !== 17) {
      return {
        success: false,
        code: 'STUDENT_INITIAL_COLLECTION_INCOMPLETE',
        completed_tasks: completed,
        message: '学生17项首次采集尚未完成'
      }
    }

    if (backgroundResult.data.length !== 1) {
      return {
        success: false,
        code: 'STUDENT_BACKGROUND_INVALID',
        message: '学生 S0 缺失或重复'
      }
    }

    const evidenceResult = await db.collection('evidence').where({
      subject_id: subjectId,
      subject_type: 'student',
      framework: 'student_v1.0',
      source_type: 'initial_interview',
      status: 'active'
    }).limit(100).get()
    const analysisResult = await db.collection('evidence_analysis').where({
      subject_id: subjectId,
      subject_type: 'student',
      framework: 'student_v1.0',
      evidence_source: 'initial_interview',
      status: 'active'
    }).limit(100).get()

    const analysisByEvidence = new Map()
    for (const analysis of analysisResult.data) {
      if (analysisByEvidence.has(analysis.evidence_id)) {
        return {
          success: false,
          code: 'DUPLICATE_STUDENT_EVIDENCE_ANALYSIS',
          evidence_id: analysis.evidence_id,
          message: '学生证据存在重复有效分析'
        }
      }
      analysisByEvidence.set(analysis.evidence_id, analysis)
    }

    const evidenceByVariable = new Map(VARIABLES.map((item) => [item.variable_id, []]))
    for (const evidence of evidenceResult.data) {
      if (!evidenceByVariable.has(evidence.variable_id)) continue
      const analysis = analysisByEvidence.get(evidence.evidence_id)
      if (analysis) evidenceByVariable.get(evidence.variable_id).push({ evidence, analysis })
    }

    const dimensions = DIMENSIONS.map((dimension) => ({
      dimension_id: dimension.dimension_id,
      dimension_name: dimension.dimension_name,
      variables: dimension.variables.map((variable) => {
        const pairs = evidenceByVariable.get(variable.variable_id) || []
        const supportive = pairs.filter(({ analysis }) => isSupportive(analysis))
        const points = uniqueStrings(
          supportive.flatMap(({ analysis }) =>
            Array.isArray(analysis.extracted_points) ? analysis.extracted_points : []
          )
        )
        const contexts = uniqueStrings(supportive.map(({ analysis }) => analysis.context || ''))
        const uncertainty = uniqueStrings(
          supportive.map(({ analysis }) => analysis.uncertainty || '').concat(
            supportive.length > 0 ? ['当前仅来自首次采集，仍需后续真实活动和跨时间证据验证。'] : ['当前没有达到形成描述条件的有效证据。']
          )
        )
        const currentStatus = supportive.length > 0 ? '初步描述' : '证据不足'
        const currentDescription = points.length > 0
          ? points.join('；')
          : '当前证据不足，暂不形成学生特征描述。'

        return {
          variable_id: variable.variable_id,
          variable_name: variable.variable_name,
          current_status: currentStatus,
          current_description: currentDescription,
          current_state: currentDescription,
          evidence_ids: supportive.map(({ evidence }) => evidence.evidence_id),
          evidence_count: supportive.length,
          evidence_summary: supportive.map(({ evidence, analysis }) => ({
            evidence_id: evidence.evidence_id,
            analysis_id: analysis.analysis_id,
            relevance_status: analysis.relevance_status,
            evidence_sufficiency: analysis.evidence_sufficiency,
            extracted_points: Array.isArray(analysis.extracted_points) ? analysis.extracted_points : []
          })),
          contexts,
          uncertainty,
          updated_at: new Date()
        }
      })
    }))

    const supportivePairs = evidenceResult.data
      .map((evidence) => ({ evidence, analysis: analysisByEvidence.get(evidence.evidence_id) }))
      .filter(({ analysis }) => analysis && isSupportive(analysis))
    const modelData = {
      model_type: 'student_initial_model',
      framework: 'student_v1.0',
      model_version: '1.0',
      subject_id: subjectId,
      background: backgroundResult.data[0],
      dimensions,
      model_cautions: [
        '本模型是学生首次主体表征，不是测评、诊断、排名或能力总分。',
        '当前描述只依据已归档的学生原始表达及其正式 Evidence Analysis。',
        '单次首次采集不能形成稳定人格或永久特征，后续真实证据可以修正当前描述。'
      ]
    }
    const snapshotId = makeId('MS')
    const now = db.serverDate()
    const snapshot = {
      snapshot_id: snapshotId,
      subject_id: subjectId,
      subject_type: 'student',
      framework: 'student_v1.0',
      model_type: 'initial',
      snapshot_type: 'initial',
      version: '1.0',
      model_version: '1.0',
      source_type: 'initial_interview',
      background_id: backgroundResult.data[0].background_id,
      collection_progress_id: progress.progress_id,
      model_data: modelData,
      source_evidence_ids: supportivePairs.map(({ evidence }) => evidence.evidence_id),
      source_analysis_ids: supportivePairs.map(({ analysis }) => analysis.analysis_id),
      source_evidence_count: supportivePairs.length,
      generation_method: 'deterministic_analysis_synthesis',
      generation_protocol: 'student_initial_model_v1.0',
      status: 'draft',
      is_test: subject.is_test === true,
      created_at: now,
      updated_at: now
    }
    const addResult = await db.collection('model_snapshots').add({ data: snapshot })

    return {
      success: true,
      draft: true,
      reused_draft: false,
      draft_snapshot_id: snapshotId,
      database_id: addResult._id,
      subject_id: subjectId,
      variable_count: VARIABLES.length,
      model: modelData
    }
  } catch (error) {
    console.error('buildStudentInitialModel error:', error)
    return {
      success: false,
      code: 'BUILD_STUDENT_INITIAL_MODEL_ERROR',
      message: error.message || '构建 Student-M0 失败'
    }
  }
}
