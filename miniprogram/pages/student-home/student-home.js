Page({
  data: {
    loading: true,
    binding: null,
    student: null,
    organization: null,
    background: null,
    progress: null,
    collectionStatusText: '未开始',
    collectionCompleted: false,
    modelLoading: false,
    hasModel: false,
    modelStatus: '',
    modelStatusText: ''
  },

  onShow() {
    this.loadBinding()
  },

  async loadBinding() {
    this.setData({ loading: true })

    try {
      const res = await wx.cloud.callFunction({
        name: 'getMyStudentBindings',
        data: {}
      })
      const result = res && res.result ? res.result : null
      const bindings =
        result && result.success && Array.isArray(result.bindings)
          ? result.bindings
          : []

      if (bindings.length === 0) {
        wx.redirectTo({ url: '/pages/student-bind/student-bind' })
        return
      }

      const binding = bindings[0]
      getApp().globalData.currentStudentBinding = binding

      const subjectId = binding.student.subject_id
      const ensureRes = await wx.cloud.callFunction({
        name: 'ensureStudentBackground',
        data: { subject_id: subjectId }
      })
      const ensureResult = ensureRes && ensureRes.result ? ensureRes.result : null

      if (!ensureResult || ensureResult.success !== true) {
        throw new Error((ensureResult && ensureResult.message) || '学生背景准备失败')
      }

      const stateRes = await wx.cloud.callFunction({
        name: 'getNextStudentCollectionTask',
        data: { subject_id: subjectId, start: false }
      })
      const state = stateRes && stateRes.result ? stateRes.result : null

      if (!state || state.success !== true) {
        throw new Error((state && state.message) || '首次采集状态读取失败')
      }

      const progress = state.progress || {}
      const completed = state.collection_completed === true
      const completedTasks = Number(progress.completed_tasks || progress.completed_count || 0)
      const statusText = completed
        ? '已完成'
        : completedTasks > 0 || progress.status === 'in_progress'
          ? '进行中'
          : '未开始'

      this.setData({
        binding: {
          binding_id: binding.binding_id,
          status: binding.status
        },
        student: binding.student,
        organization: binding.organization || {},
        background: ensureResult.background || null,
        progress: {
          total_tasks: 17,
          completed_tasks: completedTasks,
          status: progress.status || 'not_started'
        },
        collectionStatusText: statusText,
        collectionCompleted: completed,
        loading: false
      })

      if (completed) {
        await this.loadModelState(subjectId)
      }
    } catch (error) {
      console.error('读取 Student Home 失败：', error)
      this.setData({ loading: false })
      wx.showToast({
        title: '读取学生信息失败',
        icon: 'none'
      })
    }
  },

  openCollection() {
    const subjectId = this.data.student && this.data.student.subject_id

    if (!subjectId || this.data.collectionCompleted) return

    wx.navigateTo({
      url: `/pages/student-collection/student-collection?subject_id=${encodeURIComponent(subjectId)}`
    })
  },

  async loadModelState(subjectId) {
    this.setData({ modelLoading: true })

    try {
      const res = await wx.cloud.callFunction({
        name: 'getStudentCurrentModel',
        data: { subject_id: subjectId }
      })
      const result = res && res.result ? res.result : null
      const hasModel = Boolean(result && result.success === true && result.has_model === true)

      this.setData({
        modelLoading: false,
        hasModel,
        modelStatus: hasModel ? result.model_status || '' : '',
        modelStatusText: hasModel
          ? result.model_status === 'draft'
            ? '待复核'
            : '已复核'
          : '结果生成中'
      })
    } catch (error) {
      console.error('读取学生首次建模结果状态失败：', error)
      this.setData({
        modelLoading: false,
        hasModel: false,
        modelStatus: '',
        modelStatusText: '结果生成中'
      })
    }
  },

  openModel() {
    const subjectId = this.data.student && this.data.student.subject_id

    if (!subjectId || !this.data.hasModel) return

    wx.navigateTo({
      url: `/pages/student-model/student-model?subject_id=${encodeURIComponent(subjectId)}`
    })
  },

  openContinuous() {
    const subjectId = this.data.student && this.data.student.subject_id

    if (!subjectId || !this.data.collectionCompleted) return

    wx.navigateTo({
      url: `/pages/student-continuous/student-continuous?subject_id=${encodeURIComponent(subjectId)}`
    })
  }
})
