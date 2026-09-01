Page({
  data: { bindCode: '', submitting: false, loading: true, accesses: [] },

  onShow() {
    this.loadAccesses()
  },

  onBindCodeInput(event) {
    this.setData({ bindCode: event.detail.value })
  },

  async loadAccesses() {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'getMyTeacherStudentCollectionAccesses',
        data: {}
      })
      const result = res && res.result ? res.result : null
      if (!result || result.success !== true) {
        throw new Error((result && result.message) || '读取已关联学生失败')
      }
      this.setData({
        loading: false,
        accesses: Array.isArray(result.accesses) ? result.accesses : []
      })
    } catch (error) {
      console.error('读取教师学生采集权限失败：', error)
      this.setData({ loading: false })
      wx.showToast({ title: error.message || '读取失败', icon: 'none' })
    }
  },

  async authorizeStudent() {
    if (this.data.submitting) return
    const bindCode = String(this.data.bindCode || '').trim()
    if (!bindCode) {
      wx.showToast({ title: '请输入学生绑定码', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    wx.showLoading({ title: '正在确认学生' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'authorizeTeacherStudentCollectionByCode',
        data: { bind_code: bindCode }
      })
      const result = res && res.result ? res.result : null
      if (!result || result.success !== true) {
        throw new Error((result && result.message) || '确认学生失败')
      }
      this.setData({ bindCode: '' })
      wx.hideLoading()
      wx.showToast({ title: result.idempotent ? '已关联该学生' : '关联成功', icon: 'success' })
      await this.loadAccesses()
    } catch (error) {
      console.error('确认学生绑定码失败：', error)
      wx.hideLoading()
      wx.showToast({ title: error.message || '确认失败', icon: 'none', duration: 2500 })
    } finally {
      this.setData({ submitting: false })
    }
  },

  subjectIdFromEvent(event) {
    return String(event.currentTarget.dataset.subjectId || '').trim()
  },

  openCollection(event) {
    const subjectId = this.subjectIdFromEvent(event)
    if (subjectId) wx.navigateTo({ url: `/pages/student-collection/student-collection?subject_id=${encodeURIComponent(subjectId)}` })
  },

  openModel(event) {
    const subjectId = this.subjectIdFromEvent(event)
    if (subjectId) wx.navigateTo({ url: `/pages/student-model/student-model?subject_id=${encodeURIComponent(subjectId)}` })
  },

  openContinuous(event) {
    const subjectId = this.subjectIdFromEvent(event)
    if (subjectId) wx.navigateTo({ url: `/pages/student-continuous/student-continuous?subject_id=${encodeURIComponent(subjectId)}` })
  }
})
