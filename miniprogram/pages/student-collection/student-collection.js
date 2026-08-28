const recorderManager = wx.getRecorderManager()

Page({
  data: {
    subjectId: '',
    loading: true,
    currentTask: null,
    progress: null,
    sessionId: '',
    isRecording: false,
    isUploading: false,
    isTranscribing: false,
    isSubmitting: false,
    lastTranscript: '',
    currentVoiceId: '',
    canSubmit: false,
    collectionCompleted: false
  },

  async onLoad(options) {
    const binding = getApp().globalData.currentStudentBinding
    const subjectId = String(
      (options && options.subject_id) ||
      (binding && binding.student && binding.student.subject_id) ||
      ''
    ).trim()

    this.setData({ subjectId })
    this.bindRecorderEvents()
    await this.prepareTask()
  },

  onUnload() {
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
      console.error('学生录音失败：', error)
      this.setData({ isRecording: false })
      wx.showToast({ title: '录音失败，请重试', icon: 'none' })
    })
    recorderManager.onStop((result) => {
      this.setData({ isRecording: false })
      this.processRecording(result)
    })
  },

  async prepareTask() {
    if (!this.data.subjectId) {
      wx.showToast({ title: '未找到学生研究编号', icon: 'none' })
      return
    }

    this.setData({ loading: true })

    try {
      const taskRes = await wx.cloud.callFunction({
        name: 'getNextStudentCollectionTask',
        data: { subject_id: this.data.subjectId, start: true }
      })
      const result = taskRes && taskRes.result ? taskRes.result : null

      if (!result || result.success !== true) {
        throw new Error((result && result.message) || '读取任务失败')
      }

      if (result.collection_completed) {
        this.setData({
          loading: false,
          collectionCompleted: true,
          currentTask: null,
          progress: result.progress
        })
        return
      }

      const sessionRes = await wx.cloud.callFunction({
        name: 'createSession',
        data: {
          subject_id: this.data.subjectId,
          subject_type: 'student',
          session_type: 'initial_interview',
          task_id: result.task.task_id
        }
      })
      const sessionResult = sessionRes && sessionRes.result ? sessionRes.result : null

      if (!sessionResult || sessionResult.success !== true) {
        throw new Error((sessionResult && sessionResult.message) || '创建采集会话失败')
      }

      const restored = String(sessionResult.latest_transcript || '').trim()
      this.setData({
        loading: false,
        collectionCompleted: false,
        currentTask: result.task,
        progress: result.progress,
        sessionId: sessionResult.session.session_id,
        lastTranscript: restored,
        canSubmit: Boolean(restored),
        currentVoiceId: ''
      })
    } catch (error) {
      console.error('准备学生任务失败：', error)
      this.setData({ loading: false })
      wx.showToast({ title: error.message || '准备任务失败', icon: 'none' })
    }
  },

  startRecording() {
    if (
      this.data.loading ||
      this.data.isRecording ||
      this.data.isUploading ||
      this.data.isTranscribing ||
      this.data.isSubmitting ||
      this.data.collectionCompleted
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

    this.setData({ isUploading: true, canSubmit: false })
    wx.showLoading({ title: '正在保存回答' })

    try {
      const user = getApp().globalData.currentUser
      const userId = user && user.user_id ? user.user_id : ''

      if (!userId) throw new Error('当前登录信息尚未准备好')

      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: `voice/${userId}/${Date.now()}.mp3`,
        filePath: tempFilePath
      })
      const recordRes = await wx.cloud.callFunction({
        name: 'saveVoiceRecord',
        data: {
          file_id: uploadRes.fileID,
          duration_ms: duration,
          session_id: this.data.sessionId
        }
      })
      const record = recordRes && recordRes.result ? recordRes.result : null

      if (!record || record.success !== true) {
        throw new Error((record && record.message) || '保存录音失败')
      }

      this.setData({
        isUploading: false,
        isTranscribing: true,
        currentVoiceId: record.voice_record.voice_id
      })
      wx.showLoading({ title: '正在整理回答' })

      const asrRes = await wx.cloud.callFunction({
        name: 'transcribeVoice',
        data: { voice_id: record.voice_record.voice_id }
      })
      const asr = asrRes && asrRes.result ? asrRes.result : null

      if (!asr || asr.success !== true || !String(asr.transcript || '').trim()) {
        throw new Error((asr && asr.message) || '没有识别到有效回答')
      }

      this.setData({
        isTranscribing: false,
        lastTranscript: String(asr.transcript).trim(),
        canSubmit: true
      })
      wx.showToast({ title: '回答已保存', icon: 'success' })
    } catch (error) {
      console.error('学生录音处理失败：', error)
      this.setData({ isUploading: false, isTranscribing: false })
      wx.showToast({ title: error.message || '录音处理失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  async submitTask() {
    if (!this.data.canSubmit || this.data.isSubmitting) return

    this.setData({ isSubmitting: true })
    wx.showLoading({ title: '正在提交' })

    try {
      const evidenceRes = await wx.cloud.callFunction({
        name: 'createStudentTaskEvidence',
        data: { session_id: this.data.sessionId }
      })
      const evidenceResult = evidenceRes && evidenceRes.result ? evidenceRes.result : null

      if (!evidenceResult || evidenceResult.success !== true) {
        throw new Error((evidenceResult && evidenceResult.message) || '保存回答失败')
      }

      const evidence = Array.isArray(evidenceResult.evidence) ? evidenceResult.evidence : []

      for (const item of evidence) {
        const analysisRes = await wx.cloud.callFunction({
          name: 'analyzeStudentEvidence',
          data: { evidence_id: item.evidence_id, save_analysis: true }
        })
        const analysis = analysisRes && analysisRes.result ? analysisRes.result : null

        if (!analysis || analysis.success !== true || analysis.saved !== true) {
          throw new Error((analysis && analysis.message) || '回答整理未完成，请稍后重试')
        }
      }

      const completeRes = await wx.cloud.callFunction({
        name: 'completeStudentCollectionTask',
        data: { session_id: this.data.sessionId }
      })
      const completed = completeRes && completeRes.result ? completeRes.result : null

      if (!completed || completed.success !== true) {
        throw new Error((completed && completed.message) || '当前任务提交失败')
      }

      if (completed.collection_completed) {
        this.setData({
          isSubmitting: false,
          collectionCompleted: true,
          currentTask: null,
          progress: completed.progress,
          canSubmit: false
        })
        wx.showToast({ title: '本次采集已完成', icon: 'success' })
        return
      }

      this.setData({
        isSubmitting: false,
        sessionId: '',
        lastTranscript: '',
        currentVoiceId: '',
        canSubmit: false
      })
      await this.prepareTask()
    } catch (error) {
      console.error('提交学生任务失败：', error)
      this.setData({ isSubmitting: false })
      wx.showToast({ title: error.message || '提交失败，请重试', icon: 'none', duration: 2500 })
    } finally {
      wx.hideLoading()
    }
  },

  backHome() {
    wx.navigateBack()
  }
})
