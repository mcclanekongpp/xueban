Page({
  data: {
    subjectId: '',
    agreed: false,
    saving: false
  },

  onLoad(options) {
    const subjectId = String(options && options.subject_id || '').trim()
    this.setData({ subjectId })

    if (!subjectId) {
      wx.showToast({
        title: '未找到当前研究主体',
        icon: 'none'
      })
    }
  },

  onAgreementChange(event) {
    const values = event && event.detail && Array.isArray(event.detail.value)
      ? event.detail.value
      : []
    this.setData({ agreed: values.includes('agreed') })
  },

  disagree() {
    if (this.data.saving) return
    wx.navigateBack({ delta: 1 })
  },

  async agreeAndContinue() {
    if (!this.data.agreed || this.data.saving) return

    if (!this.data.subjectId) {
      wx.showToast({
        title: '未找到当前研究主体',
        icon: 'none'
      })
      return
    }

    this.setData({ saving: true })
    wx.showLoading({ title: '正在保存授权' })

    try {
      const response = await wx.cloud.callFunction({
        name: 'saveVoiceConsent',
        data: {
          subject_id: this.data.subjectId
        }
      })
      const result = response && response.result ? response.result : null

      if (!result || result.success !== true || result.has_consent !== true) {
        throw new Error((result && result.message) || '保存授权失败')
      }

      wx.showToast({ title: '授权已确认', icon: 'success' })
      setTimeout(() => wx.navigateBack({ delta: 1 }), 500)
    } catch (error) {
      console.error('saveVoiceConsent 调用失败：', error)
      wx.showToast({
        title: error.message || '保存授权失败，请重试',
        icon: 'none'
      })
    } finally {
      wx.hideLoading()
      this.setData({ saving: false })
    }
  }
})
