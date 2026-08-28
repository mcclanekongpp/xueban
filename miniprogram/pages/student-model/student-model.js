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
    cautions: []
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
        modelStatusName: result.model_status_name || (modelStatus === 'draft' ? '待复核' : '已复核'),
        modelUpdatedAt: formatDate(result.updated_at || result.created_at),
        pageTitle: modelStatus === 'draft' ? '首次建模结果（待复核）' : '当前学生模型',
        pageDescription: '当前结果基于首次采集形成，后续仍可根据新的信息持续完善。',
        dimensions,
        cautions: Array.isArray(result.model.model_cautions) ? result.model.model_cautions : []
      })
    } catch (error) {
      console.error('读取 Student-M0 失败：', error)
      this.setData({ loading: false, hasModel: false, errorMessage: '读取 Student-M0 失败' })
    }
  },

  refreshModel() {
    this.loadModel(this.data.subjectId)
  }
})
