const recorderManager = wx.getRecorderManager()

function decodeQueryValue(value) {
  try {
    return decodeURIComponent(String(value || ''))
  } catch (error) {
    return String(value || '')
  }
}

Page({
  data: {
    subjectId: '',
    loading: true,
    sessionId: '',
    isRecording: false,
    isUploading: false,
    isTranscribing: false,
    isSubmitting: false,
    asrFailed: false,
    currentVoiceId: '',
    lastTranscript: '',
    canSubmit: false,
    guidancePrompt: ''
  },

  async onLoad(options) {
    const binding = getApp().globalData.currentStudentBinding
    const subjectId = String(
      (options && options.subject_id) ||
      (binding && binding.student && binding.student.subject_id) ||
      ''
    ).trim()

    this.setData({
      subjectId,
      guidancePrompt: decodeQueryValue(options && options.guidance_prompt)
    })
    this.bindRecorderEvents()
    await this.prepareSession()
  },

  onUnload() {
    if (this.data.isRecording) recorderManager.stop()
    if (typeof recorderManager.offStart === 'function') recorderManager.offStart()
    if (typeof recorderManager.offStop === 'function') recorderManager.offStop()
    if (typeof recorderManager.offError === 'function') recorderManager.offError()
  },

  bindRecorderEvents() {
    if (typeof recorderManager.offStart === 'function') recorderManager.offStart()
    if (typeof recorderManager.offStop === 'function') recorderManager.offStop()
    if (typeof recorderManager.offError === 'function') recorderManager.offError()

    recorderManager.onStart(() => this.setData({ isRecording: true }))
    recorderManager.onError((error) => {
      console.error('学生持续录音失败：', error)
      this.setData({ isRecording: false })
      wx.showToast({ title: '录音失败，请重试', icon: 'none' })
    })
    recorderManager.onStop((result) => {
      this.setData({ isRecording: false })
      this.processRecording(result)
    })
  },

  async prepareSession() {
    if (!this.data.subjectId) {
      this.setData({ loading: false })
      wx.showToast({ title: '未找到学生研究编号', icon: 'none' })
      return
    }

    try {
      const res = await wx.cloud.callFunction({
        name: 'createSession',
        data: {
          subject_id: this.data.subjectId,
          subject_type: 'student',
          session_type: 'student_continuous_record'
        }
      })
      const result = res && res.result ? res.result : null

      if (!result || result.success !== true || !result.session) {
        throw new Error((result && result.message) || '暂时无法开始')
      }

      this.setData({
        loading: false,
        sessionId: result.session.session_id
      })
    } catch (error) {
      console.error('创建学生持续采集会话失败：', error)
      this.setData({ loading: false })
      wx.showToast({ title: error.message || '暂时无法开始', icon: 'none' })
    }
  },

  startRecording() {
    if (
      this.data.loading ||
      !this.data.sessionId ||
      this.data.isRecording ||
      this.data.isUploading ||
      this.data.isTranscribing ||
      this.data.isSubmitting
    ) return

    recorderManager.start({
      duration: 60000,
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 48000,
      format: 'mp3'
    })
  },

  stopRecording() {
    if (this.data.isRecording) recorderManager.stop()
  },

  async processRecording(result) {
    const tempFilePath = result && result.tempFilePath
    const duration = Number(result && result.duration)

    if (!tempFilePath || !duration) {
      wx.showToast({ title: '没有取得有效录音', icon: 'none' })
      return
    }

    this.setData({
      isUploading: true,
      canSubmit: false,
      asrFailed: false,
      lastTranscript: '',
      currentVoiceId: ''
    })
    wx.showLoading({ title: '正在保存' })

    try {
      const user = getApp().globalData.currentUser
      const userId = user && user.user_id ? user.user_id : ''

      if (!userId) throw new Error('当前登录信息尚未准备好')

      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: `voice/${userId}/${Date.now()}.mp3`,
        filePath: tempFilePath
      })
      const saveRes = await wx.cloud.callFunction({
        name: 'saveVoiceRecord',
        data: {
          file_id: uploadRes.fileID,
          duration_ms: duration,
          session_id: this.data.sessionId
        }
      })
      const saved = saveRes && saveRes.result ? saveRes.result : null

      if (!saved || saved.success !== true || !saved.voice_record) {
        throw new Error((saved && saved.message) || '保存录音失败')
      }

      this.setData({
        isUploading: false,
        currentVoiceId: saved.voice_record.voice_id
      })
      await this.transcribeCurrentVoice()
    } catch (error) {
      console.error('保存学生持续录音失败：', error)
      this.setData({ isUploading: false, isTranscribing: false })
      wx.showToast({ title: error.message || '保存失败，请重试', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  async transcribeCurrentVoice() {
    const voiceId = this.data.currentVoiceId

    if (!voiceId || this.data.isTranscribing) return

    this.setData({ isTranscribing: true, asrFailed: false, canSubmit: false })
    wx.showLoading({ title: '正在整理' })

    try {
      const res = await wx.cloud.callFunction({
        name: 'transcribeVoice',
        data: { voice_id: voiceId }
      })
      const result = res && res.result ? res.result : null
      const transcript = String(result && result.transcript ? result.transcript : '').trim()

      if (!result || result.success !== true || !transcript) {
        throw new Error((result && result.message) || '没有识别到有效内容')
      }

      this.setData({
        isTranscribing: false,
        asrFailed: false,
        lastTranscript: transcript,
        canSubmit: true
      })
      wx.showToast({ title: '已经听清楚啦', icon: 'success' })
    } catch (error) {
      console.error('学生持续语音识别失败：', error)
      // voice_records 和 messages 已经保存，只保留失败状态并允许重试。
      this.setData({
        isTranscribing: false,
        asrFailed: true,
        canSubmit: false
      })
      wx.showToast({ title: '暂时没听清，可以重试', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  retryTranscription() {
    this.transcribeCurrentVoice()
  },

  async submitContinuous() {
    if (!this.data.canSubmit || !this.data.currentVoiceId || this.data.isSubmitting) return

    this.setData({ isSubmitting: true })
    wx.showLoading({ title: '正在保存分享' })

    try {
      const routeRes = await wx.cloud.callFunction({
        name: 'analyzeStudentEvidence',
        data: {
          action: 'route_continuous',
          voice_id: this.data.currentVoiceId
        }
      })
      const routed = routeRes && routeRes.result ? routeRes.result : null

      if (!routed || routed.success !== true) {
        throw new Error((routed && routed.message) || '这段分享暂时无法提交')
      }

      const evidence = Array.isArray(routed.evidence) ? routed.evidence : []

      // 提示问题只负责开启对话；实际归类完全以语音转写内容的路由结果为准。
      console.log('学生持续内容路由完成：', {
        continuous_record_id: routed.continuous_record_id || '',
        matched_count: evidence.length
      })

      if (evidence.length > 0) {
        const analysisRes = await wx.cloud.callFunction({
          name: 'analyzeStudentEvidence',
          data: {
            action: 'analyze_batch',
            evidence_ids: evidence.map((item) => item.evidence_id)
          }
        })
        const analysis = analysisRes && analysisRes.result ? analysisRes.result : null

        console.log('学生持续 Evidence 批量分析完成：', analysis)

        if (!analysis || analysis.success !== true || analysis.failed_count !== 0) {
          throw new Error((analysis && analysis.message) || '内容分析尚未完成，请稍后重试')
        }

        // Evidence / Analysis 已经安全落库后刷新证据健康层。达到统一
        // 自动更新门槛时由云端创建并激活新 snapshot；未达门槛或存在
        // 矛盾时只写 Profile / Gap / Candidate，不修改 active Student-M0。
        // 证据健康层在分析落库后异步刷新，不阻塞用户看到“已保存”。
        // 请求已经发出后页面返回不会改变 Voice / Message / Analysis 状态；
        // 失败时下一次提交或研究端 refresh 仍可幂等补建。
        wx.cloud.callFunction({
            name: 'advanceSubjectModel',
            data: {
              action: 'refresh',
              compact_result: true,
              subject_type: 'student',
              subject_id: this.data.subjectId
            }
          })
          .then((healthRes) => {
            const result = healthRes && healthRes.result ? healthRes.result : {}
            console.log('学生证据健康层刷新：', {
              success: result.success === true,
              profile_count: Number(result.profile_count || 0),
              candidate_count: Number(result.model_change_candidate_count || 0),
              automatic_update_status: result.automatic_update && result.automatic_update.status
                ? result.automatic_update.status
                : ''
            })
          })
          .catch((healthError) => {
            console.warn('学生证据健康层待重试：', healthError)
          })
      }

      this.setData({
        isSubmitting: false,
        canSubmit: false,
        currentVoiceId: '',
        lastTranscript: '',
        asrFailed: false
      })
      wx.showToast({
        title: evidence.length > 0 ? '分享已保存并整理' : '分享已安全保存',
        icon: 'success'
      })
      wx.navigateBack()
    } catch (error) {
      console.error('提交学生持续语音失败：', error)
      // 路由或分析失败时不清除当前 voice_id / transcript，可再次提交。
      this.setData({ isSubmitting: false })
      wx.showToast({ title: error.message || '提交失败，请重试', icon: 'none', duration: 2500 })
    } finally {
      wx.hideLoading()
    }
  }
})
