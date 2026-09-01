Page({
  data: {
    bindCode: '',
    submitting: false,
    checkingExisting: true
  },

  onLoad() {
    this.checkExistingBinding()
  },

  async checkExistingBinding() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getMySubjectBindings',
        data: { subject_type: 'teacher' }
      })
      const result = res && res.result ? res.result : null
      const bindings = result && result.success && Array.isArray(result.bindings)
        ? result.bindings
        : []

      if (bindings.length > 0) {
        const binding = bindings[0]
        const app = getApp()
        app.globalData.currentTeacherBinding = binding
        app.globalData.currentSubject = binding.teacher || binding.subject
        wx.reLaunch({ url: '/pages/teacher-home/teacher-home' })
      }
    } catch (error) {
      console.error('检查已有教师绑定失败：', error)
    } finally {
      this.setData({ checkingExisting: false })
    }
  },

  onBindCodeInput(event) {
    this.setData({ bindCode: event.detail.value })
  },

  async submitBinding() {
    if (this.data.submitting || this.data.checkingExisting) return

    const bindCode = this.data.bindCode.trim()
    if (!bindCode) {
      wx.showToast({ title: '请输入教师绑定码', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    wx.showLoading({ title: '正在验证' })

    try {
      const res = await wx.cloud.callFunction({
        name: 'bindSubjectByCode',
        data: {
          subject_type: 'teacher',
          bind_code: bindCode
        }
      })
      const result = res && res.result ? res.result : null

      if (!result || result.success !== true) {
        wx.hideLoading()
        wx.showToast({
          title: result && result.message || '绑定失败，请重试',
          icon: 'none',
          duration: 2500
        })
        return
      }

      wx.hideLoading()
      const app = getApp()
      const teacher = result.teacher || result.subject
      app.globalData.currentTeacherBinding = {
        binding_id: result.binding.binding_id,
        status: result.binding.status,
        teacher,
        subject: teacher
      }
      app.globalData.currentSubject = teacher
      if (app.globalData.currentUser) app.globalData.currentUser.role = 'teacher'

      wx.showToast({ title: '绑定成功', icon: 'success' })
      wx.reLaunch({ url: '/pages/teacher-home/teacher-home' })
    } catch (error) {
      console.error('bindSubjectByCode 教师绑定失败：', error)
      wx.hideLoading()
      wx.showToast({ title: '绑定失败，请重试', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  }
})
