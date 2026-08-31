const {
  drawModelProgressRadar
} = require('../../utils/model-progress-radar')

function normalizeTextList(value) {
  const values = Array.isArray(value) ? value : [value]
  const emptyValues = ['none', 'null', 'undefined', '无', '暂无', '目前无', '无不确定性']

  return Array.from(new Set(
    values
      .map(item => String(item || '').trim())
      .filter(item => item && !emptyValues.includes(item.toLowerCase()))
  ))
}

function getStatusKey(status) {
  const map = {
    '证据不足': 'insufficient',
    '初步描述': 'low',
    '已有一定支持': 'medium',
    '较稳定': 'high'
  }

  return map[String(status || '').trim()] || 'insufficient'
}

function formatDate(value) {
  const rawValue = value && value.$date ? value.$date : value
  const date = rawValue instanceof Date ? rawValue : new Date(rawValue)

  if (!rawValue || Number.isNaN(date.getTime())) return ''

  const pad = number => String(number).padStart(2, '0')
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`
}

function limitSummary(value, fallback) {
  const text = String(value || fallback || '').trim()
  return text.length <= 100 ? text : `${text.slice(0, 99)}…`
}

Page({
  data: {
    subjectId: '',
    loading: true,
    hasModel: false,
    errorMessage: '',
    snapshotId: '',
    modelVersion: '',
    modelStatus: '',
    modelStatusName: '',
    modelUpdatedAt: '',
    pageTitle: '首次建模结果',
    pageDescription: '',
    dimensions: [],
    cautions: [],
    overviewSummary: '',
    constructionProgressLoading: false,
    constructionProgressPercent: 0,
    constructionProgressDimensions: [],
    constructionProgressNote: ''
  },

  onLoad(options) {
    const binding = getApp().globalData.currentStudentBinding
    const subjectId = String(
      (options && options.subject_id) ||
      (binding && binding.student && binding.student.subject_id) ||
      ''
    ).trim()
    this.setData({ subjectId })
    this.loadModel(subjectId)
  },

  async loadModel(subjectId) {
    if (!subjectId) {
      this.setData({ loading: false, errorMessage: '未找到学生研究编号' })
      return
    }

    try {
      const res = await wx.cloud.callFunction({
        name: 'getStudentCurrentModel',
        data: { subject_id: subjectId }
      })
      const result = res && res.result ? res.result : null

      if (!result || result.success !== true || result.has_model !== true || !result.model) {
        this.setData({
          loading: false,
          hasModel: false,
          errorMessage: (result && result.message) || '首次建模结果正在生成中'
        })
        return
      }

      const modelStatus = result.model_status === 'draft' ? 'draft' : 'active'
      const dimensions = (Array.isArray(result.model.dimensions) ? result.model.dimensions : [])
        .map((dimension) => ({
          dimension_id: dimension.dimension_id,
          dimension_name: dimension.dimension_name,
          variables: (Array.isArray(dimension.variables) ? dimension.variables : []).map((variable) => ({
            ...variable,
            status_key: getStatusKey(variable.current_status),
            uncertainty: normalizeTextList(variable.uncertainty)
          }))
        }))

      this.setData({
        loading: false,
        hasModel: true,
        snapshotId: result.snapshot_id || '',
        modelVersion: result.model_version || '',
        modelStatus,
        modelStatusName: result.model_status_name || (modelStatus === 'draft' ? '自动构建待完成' : '已生效'),
        modelUpdatedAt: formatDate(result.updated_at || result.created_at),
        pageTitle: modelStatus === 'draft' ? '首次建模结果（生成中）' : '当前学生模型',
        pageDescription: '当前结果基于首次采集形成，后续仍可根据新的信息持续完善。',
        dimensions,
        cautions: Array.isArray(result.model.model_cautions) ? result.model.model_cautions : []
      })

      await this.loadConstructionProgress(subjectId, result.model)
    } catch (error) {
      console.error('读取 Student-M0 失败：', error)
      this.setData({ loading: false, hasModel: false, errorMessage: '读取 Student-M0 失败' })
    }
  },

  async loadConstructionProgress(subjectId, model) {
    const fallbackSummary =
      '认知经验、思维解题、自我调节、表达互动、动机情绪与兴趣情境均已纳入当前模型，具体覆盖程度见下方构建进展。'

    this.setData({
      constructionProgressLoading: true,
      overviewSummary: limitSummary(model && model.overview_summary, fallbackSummary)
    })

    try {
      const res = await wx.cloud.callFunction({
        name: 'getSubjectModelGuidance',
        data: {
          subject_id: subjectId,
          subject_type: 'student',
          limit: 1
        }
      })
      const result = res && res.result ? res.result : null
      const progress = result && result.success === true
        ? result.construction_progress
        : null

      if (!progress || !Array.isArray(progress.dimensions)) {
        throw new Error('学生模型构建进度返回无效')
      }

      const overviewSummary = model && model.overview_summary
        ? model.overview_summary
        : progress.summary_text

      this.setData({
        constructionProgressLoading: false,
        overviewSummary: limitSummary(overviewSummary, fallbackSummary),
        constructionProgressPercent: Number(progress.overall_percent || 0),
        constructionProgressDimensions: progress.dimensions,
        constructionProgressNote: progress.note || ''
      })

      drawModelProgressRadar(
        this,
        '#studentProgressRadar',
        progress.dimensions
      )
    } catch (error) {
      console.error('读取学生模型构建进度失败：', error)
      this.setData({
        constructionProgressLoading: false,
        constructionProgressPercent: 0,
        constructionProgressDimensions: [],
        constructionProgressNote: '构建进度暂未读取，不影响当前模型内容。'
      })
    }
  },

  refreshModel() {
    this.loadModel(this.data.subjectId)
  }
})
