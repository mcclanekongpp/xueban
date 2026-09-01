const recorderManager = wx.getRecorderManager()
const {
  ensureStudentInitialModel
} = require('../../utils/initial-model-automation')
const {
  checkVoiceConsent,
  requireVoiceConsent
} = require('../../utils/voice-consent')

Page({
  data: {
    subjectId: '',
    loading: true,
    currentTask: null,
    taskProgressPercent: 0,
    progress: null,
    sessionId: '',
    isRecording: false,
    isUploading: false,
    isTranscribing: false,
    asrFailed: false,
    isSubmitting: false,
    lastTranscript: '',
    currentVoiceId: '',
    canSubmit: false,
    collectionCompleted: false,
    voiceConsentGranted: false,
    checkingVoiceConsent: false
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
    await this.refreshVoiceConsent()
  },

  async onShow() {
    if (this.data.subjectId) await this.refreshVoiceConsent()
  },

  onUnload() {
    if (typeof recorderManager.offStart === 'function') recorderManager.offStart()
    if (typeof recorderManager.offStop === 'function') recorderManager.offStop()
    if (typeof recorderManager.offError === 'function') recorderManager.offError()
  },

  async refreshVoiceConsent() {
    if (!this.data.subjectId || this.data.checkingVoiceConsent) return false

    this.setData({ checkingVoiceConsent: true })
    const result = await checkVoiceConsent(this.data.subjectId)
    const granted = result.success && result.hasConsent
    this.setData({
      checkingVoiceConsent: false,
      voiceConsentGranted: granted
    })
    return granted
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
          taskProgressPercent: 100,
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
        taskProgressPercent: Math.min(
          100,
          Math.max(0, Number(result.task.task_order || 1) / 17 * 100)
        ),
        progress: result.progress,
        sessionId: sessionResult.session.session_id,
        lastTranscript: restored,
        canSubmit: Boolean(restored),
        currentVoiceId: '',
        asrFailed: false
      })
    } catch (error) {
      console.error('准备学生任务失败：', error)
      this.setData({ loading: false })
      wx.showToast({ title: error.message || '准备任务失败', icon: 'none' })
    }
  },

  async startRecording() {
    if (
      this.data.loading ||
      this.data.isRecording ||
      this.data.isUploading ||
      this.data.isTranscribing ||
      this.data.isSubmitting ||
      this.data.collectionCompleted ||
      this.data.checkingVoiceConsent
    ) return

    if (!this.data.voiceConsentGranted) {
      this.setData({ checkingVoiceConsent: true })
      const granted = await requireVoiceConsent(this.data.subjectId)
      this.setData({
        checkingVoiceConsent: false,
        voiceConsentGranted: granted
      })

      if (granted) {
        wx.showToast({ title: '授权已确认，请再次按住说话', icon: 'none' })
      }
      return
    }

    if (this.data.currentVoiceId) {
      wx.showToast({
        title: this.data.asrFailed
          ? '录音已保存，请先重新识别'
          : '请先提交当前回答',
        icon: 'none'
      })
      return
    }

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
        currentVoiceId: record.voice_record.voice_id
      })
      await this.transcribeCurrentVoice()
    } catch (error) {
      console.error('学生录音处理失败：', error)
      this.setData({ isUploading: false, isTranscribing: false })
      wx.showToast({ title: error.message || '录音处理失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  async transcribeCurrentVoice() {
    const voiceId = this.data.currentVoiceId

    if (!voiceId || this.data.isTranscribing) return

    this.setData({
      isTranscribing: true,
      asrFailed: false,
      canSubmit: false
    })
    wx.showLoading({ title: '正在整理回答' })

    try {
      const asrRes = await wx.cloud.callFunction({
        name: 'transcribeVoice',
        data: { voice_id: voiceId }
      })
      const asr = asrRes && asrRes.result ? asrRes.result : null
      const transcript = String(asr && asr.transcript ? asr.transcript : '').trim()

      if (!asr || asr.success !== true || !transcript) {
        throw new Error((asr && asr.message) || '没有识别到有效回答')
      }

      this.setData({
        isTranscribing: false,
        asrFailed: false,
        lastTranscript: transcript,
        canSubmit: true
      })
      wx.showToast({ title: '回答已保存，请确认后提交', icon: 'success' })
    } catch (error) {
      console.error('学生语音识别失败：', error)
      // Voice / Message 已经保存；只标记识别待重试，不清除 currentVoiceId。
      this.setData({
        isTranscribing: false,
        asrFailed: true,
        canSubmit: false
      })
      wx.showToast({ title: '录音已保存，请重新识别', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  retryTranscription() {
    this.transcribeCurrentVoice()
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
          taskProgressPercent: 100,
          progress: completed.progress,
          canSubmit: false,
          asrFailed: false
        })
        let modelReady = false

        try {
          wx.showLoading({ title: '正在构建模型', mask: true })
          await ensureStudentInitialModel(this.data.subjectId)
          modelReady = true
        } catch (modelError) {
          // 已完成的采集、语音、Evidence 与 Analysis 不回滚；
          // Student Home 会再次幂等补建模。
          console.error('学生首次模型自动构建待重试：', modelError)
        } finally {
          wx.hideLoading()
        }

        wx.showToast({
          title: modelReady ? '首次模型已自动生成' : '采集完成，模型生成中',
          icon: modelReady ? 'success' : 'none'
        })
        return
      }

      this.setData({
        isSubmitting: false,
        sessionId: '',
        lastTranscript: '',
        currentVoiceId: '',
        canSubmit: false,
        asrFailed: false
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
