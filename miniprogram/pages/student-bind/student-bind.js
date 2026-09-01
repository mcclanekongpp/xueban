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
        data: { subject_type: 'student' }
      })
      const result = res && res.result ? res.result : null
      const bindings =
        result && result.success && Array.isArray(result.bindings)
          ? result.bindings
          : []

      if (bindings.length > 0) {
        getApp().globalData.currentStudentBinding = bindings[0]
        wx.redirectTo({ url: '/pages/student-home/student-home' })
      }
    } catch (error) {
      console.error('检查已有学生绑定失败：', error)
    } finally {
      this.setData({ checkingExisting: false })
    }
  },

  onBindCodeInput(event) {
    this.setData({ bindCode: event.detail.value })
  },

  async submitBinding() {
    if (this.data.submitting || this.data.checkingExisting) {
      return
    }

    const bindCode = this.data.bindCode.trim()

    if (!bindCode) {
      wx.showToast({
        title: '请输入学生绑定码',
        icon: 'none'
      })
      return
    }

    this.setData({ submitting: true })
    wx.showLoading({ title: '正在验证' })

    try {
      const res = await wx.cloud.callFunction({
        name: 'bindSubjectByCode',
        data: {
          subject_type: 'student',
          bind_code: bindCode
        }
      })
      const result = res && res.result ? res.result : null

      if (!result || result.success !== true) {
        wx.hideLoading()
        wx.showToast({
          title: (result && result.message) || '绑定失败，请重试',
          icon: 'none',
          duration: 2500
        })
        return
      }

      wx.hideLoading()
      getApp().globalData.currentStudentBinding = {
        binding_id: result.binding.binding_id,
        status: result.binding.status,
        student: result.student
      }

      wx.showToast({ title: '绑定成功', icon: 'success' })
      wx.redirectTo({ url: '/pages/student-home/student-home' })
    } catch (error) {
      console.error('bindSubjectByCode 学生绑定失败：', error)
      wx.hideLoading()
      wx.showToast({
        title: '绑定失败，请重试',
        icon: 'none'
      })
    } finally {
      this.setData({ submitting: false })
    }
  }
})
