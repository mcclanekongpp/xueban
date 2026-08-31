function formatDate(value) {
  const raw = value && value.$date ? value.$date : value
  const date = raw ? new Date(raw) : null
  if (!date || Number.isNaN(date.getTime())) return ''
  const pad = number => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

Page({
  data: {
    loading: true,
    errorMessage: '',
    filter: 'all',
    summary: null,
    allSubjects: [],
    subjects: []
  },

  onShow() {
    this.loadOverview()
  },

  async loadOverview() {
    this.setData({ loading: true, errorMessage: '' })

    try {
      const response = await wx.cloud.callFunction({
        name: 'getSubjectModelGuidance',
        data: { action: 'research_overview' }
      })
      const result = response && response.result ? response.result : null

      if (!result || result.success !== true) {
        throw new Error(result && result.message ? result.message : '读取主体模型构建总览失败')
      }

      const subjects = (Array.isArray(result.subjects) ? result.subjects : []).map(item => ({
        ...item,
        subject_type_name: item.subject_type === 'teacher' ? '教师' : '学生',
        display_name: item.research_alias || item.subject_id,
        class_text: Array.isArray(item.class_ids) && item.class_ids.length > 0
          ? item.class_ids.join('、')
          : '未关联班级',
        model_updated_text: formatDate(item.current_model && item.current_model.updated_at),
        model_version_text: item.current_model && item.current_model.has_model
          ? `v${item.current_model.model_version}`
          : '尚未生成',
        construction_percent: Number(item.construction_progress && item.construction_progress.overall_percent || 0),
        top_guidance: Array.isArray(item.guidance) ? item.guidance[0] || null : null
      }))

      this.setData({
        loading: false,
        summary: result.summary || null,
        allSubjects: subjects
      })
      this.applyFilter(this.data.filter, subjects)
    } catch (error) {
      console.error('读取研究者模型总览失败：', error)
      this.setData({
        loading: false,
        errorMessage: error.message || '读取主体模型构建总览失败',
        summary: null,
        allSubjects: [],
        subjects: []
      })
    }
  },

  changeFilter(event) {
    const filter = String(event.currentTarget.dataset.filter || 'all')
    this.setData({ filter })
    this.applyFilter(filter, this.data.allSubjects)
  },

  applyFilter(filter, source) {
    this.setData({
      subjects: filter === 'all'
        ? source
        : source.filter(item => item.subject_type === filter)
    })
  }
})
