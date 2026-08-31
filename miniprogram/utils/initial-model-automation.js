async function callCloud(name, data) {
  const response = await wx.cloud.callFunction({ name, data })
  return response && response.result ? response.result : null
}

async function analyzePendingTeacherInitialEvidence() {
  const analysis = await callCloud('analyzeTeacherEvidence', {
    action: 'analyze_pending_initial'
  })

  if (!analysis || analysis.success !== true) {
    const error = new Error(
      analysis && analysis.message
        ? analysis.message
        : '教师首次证据分析尚未完成'
    )
    error.code = analysis && analysis.code ? analysis.code : 'TEACHER_INITIAL_ANALYSIS_INCOMPLETE'
    throw error
  }

  return analysis
}

async function ensureTeacherInitialModel() {
  await analyzePendingTeacherInitialEvidence()

  const model = await callCloud('buildTeacherInitialModel', {
    preview_model: true
  })

  if (!model || model.success !== true) {
    const error = new Error(
      model && model.message
        ? model.message
        : '教师首次模型自动构建尚未完成'
    )
    error.code = model && model.code ? model.code : 'TEACHER_INITIAL_MODEL_INCOMPLETE'
    throw error
  }

  return model
}

async function ensureStudentInitialModel(subjectId) {
  const normalizedSubjectId = String(subjectId || '').trim()

  if (!normalizedSubjectId) {
    const error = new Error('缺少学生研究主体编号')
    error.code = 'STUDENT_SUBJECT_ID_REQUIRED'
    throw error
  }

  const analysis = await callCloud('analyzeStudentEvidence', {
    action: 'analyze_pending_initial',
    subject_id: normalizedSubjectId
  })

  if (!analysis || analysis.success !== true) {
    const error = new Error(
      analysis && analysis.message
        ? analysis.message
        : '学生首次证据分析尚未完成'
    )
    error.code = analysis && analysis.code ? analysis.code : 'STUDENT_INITIAL_ANALYSIS_INCOMPLETE'
    throw error
  }

  const model = await callCloud('buildStudentInitialModel', {
    subject_id: normalizedSubjectId
  })

  if (!model || model.success !== true) {
    const error = new Error(
      model && model.message
        ? model.message
        : '学生首次模型自动构建尚未完成'
    )
    error.code = model && model.code ? model.code : 'STUDENT_INITIAL_MODEL_INCOMPLETE'
    throw error
  }

  return model
}

module.exports = {
  analyzePendingTeacherInitialEvidence,
  ensureTeacherInitialModel,
  ensureStudentInitialModel
}
