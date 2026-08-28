Page({
  data: {
    enteringTeacher: false,
    enteringStudent: false
  },

  // 教师 Subject 必须先由研究团队线下登记；前端只读取已有绑定或进入绑定页。
  async openTeacherCollection() {
    if (this.data.enteringTeacher) return

    this.setData({ enteringTeacher: true })
    wx.showLoading({ title: '正在进入' })

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
      } else if (result && result.success) {
        wx.navigateTo({ url: '/pages/teacher-bind/teacher-bind' })
      } else {
        wx.showToast({ title: result && result.message || '暂时无法进入', icon: 'none' })
      }
    } catch (error) {
      console.error('进入教师采集失败：', error)
      wx.showToast({ title: '暂时无法进入', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ enteringTeacher: false })
    }
  },

  // 学生是独立研究主体；当前微信仅作为已绑定家长的采集终端。
  async openStudentCollection() {
    if (this.data.enteringStudent) return

    this.setData({ enteringStudent: true })
    wx.showLoading({ title: '正在进入' })

    try {
      const res = await wx.cloud.callFunction({
        name: 'getMySubjectBindings',
        data: { subject_type: 'student' }
      })
      const result = res && res.result ? res.result : null
      const bindings = result && result.success && Array.isArray(result.bindings)
        ? result.bindings
        : []

      if (bindings.length > 0) {
        getApp().globalData.currentStudentBinding = bindings[0]
        wx.navigateTo({ url: '/pages/student-home/student-home' })
      } else if (result && result.success) {
        wx.navigateTo({ url: '/pages/student-bind/student-bind' })
      } else {
        wx.showToast({ title: result && result.message || '暂时无法进入', icon: 'none' })
      }
    } catch (error) {
      console.error('进入学生采集失败：', error)
      wx.showToast({ title: '暂时无法进入', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ enteringStudent: false })
    }
  }
})
