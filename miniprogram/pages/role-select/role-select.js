// pages/role-select/role-select.js

Page({
  data: {
    submitting: false,
    enteringStudent: false
  },

  // 学生是独立研究主体，此入口不会把当前微信用户设为 student。
  openStudentCollection: async function () {
    if (this.data.enteringStudent) {
      return
    }

    this.setData({ enteringStudent: true })
    wx.showLoading({ title: '正在进入' })

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

      if (bindings.length > 0) {
        getApp().globalData.currentStudentBinding = bindings[0]
        wx.navigateTo({ url: '/pages/student-home/student-home' })
      } else if (result && result.success) {
        wx.navigateTo({ url: '/pages/student-bind/student-bind' })
      } else {
        wx.showToast({
          title: (result && result.message) || '暂时无法进入',
          icon: 'none'
        })
      }
    } catch (error) {
      console.error('进入学生采集失败：', error)
      wx.showToast({ title: '暂时无法进入', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ enteringStudent: false })
    }
  },

  // 选择身份
  selectRole: function (event) {
    const role = event.currentTarget.dataset.role

    if (this.data.submitting) {
      return
    }

    const roleName =
      role === 'teacher'
        ? '教师'
        : role === 'guardian'
          ? '监护人'
          : ''

    if (!roleName) {
      wx.showToast({
        title: '身份信息有误',
        icon: 'none'
      })
      return
    }

    // 身份设置后暂不允许用户自行修改，所以先确认
    wx.showModal({
      title: '确认身份',
      content: `确认选择“${roleName}”身份吗？`,
      confirmText: '确认',
      cancelText: '取消',
      success: (modalRes) => {
        if (!modalRes.confirm) {
          return
        }

        this.saveRole(role, roleName)
      }
    })
  },

  // 调用云函数保存身份
  saveRole: async function (role, roleName) {
    this.setData({
      submitting: true
    })

    wx.showLoading({
      title: '正在设置'
    })

    try {
      const res = await wx.cloud.callFunction({
        name: 'setUserRole',
        data: {
          role: role
        }
      })

      console.log('setUserRole 云函数返回：', res.result)

      if (res.result && res.result.success) {
        // 同步更新 app.js 中保存的当前用户信息
        const app = getApp()

        if (app.globalData.currentUser) {
          app.globalData.currentUser.role = role
        } else {
          app.globalData.currentUser = res.result.user
        }

        console.log('身份设置成功：', role)

        if (role === 'teacher') {
          wx.showLoading({ title: '正在进入教师首页' })

          const subject = await app.ensureTeacherSubject()

          if (!subject || subject.status !== 'active') {
            throw new Error('教师主体读取失败，请重试')
          }

          wx.hideLoading()

          wx.reLaunch({
            url: '/pages/teacher-home/teacher-home'
          })
          return
        }

        wx.hideLoading()

        wx.showToast({
          title: `已设置为${roleName}`,
          icon: 'success'
        })

      } else {
        wx.hideLoading()

        wx.showToast({
          title:
            (res.result && res.result.message) ||
            '身份设置失败',
          icon: 'none'
        })

        console.error('身份设置失败：', res.result)
      }

    } catch (error) {
      wx.hideLoading()

      console.error('调用 setUserRole 云函数失败：', error)

      wx.showToast({
        title: '身份设置失败，请重试',
        icon: 'none'
      })

    } finally {
      this.setData({
        submitting: false
      })
    }
  }
})
