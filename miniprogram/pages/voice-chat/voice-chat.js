// pages/voice-chat/voice-chat.js

const recorderManager =
  wx.getRecorderManager()

const {
  analyzePendingTeacherInitialEvidence,
  ensureTeacherInitialModel
} = require('../../utils/initial-model-automation')

function decodeQueryValue(value) {
  try {
    return decodeURIComponent(String(value || ''))
  } catch (error) {
    return String(value || '')
  }
}

Page({

  data: {

    // ==================================================
    // 录音及处理状态
    // ==================================================

    isRecording: false,

    isUploading: false,

    isTranscribing: false,

    // 首次访谈：
    // 完成本题
    //
    // 持续记录：
    // 提交并分析当前记录
    isCompletingTask: false,


    // ==================================================
    // 当前录音
    // ==================================================

    audioTempFilePath: '',

    duration: 0,

    cloudFileId: '',


    // ==================================================
    // 当前记录类型
    //
    // initial_interview
    // teaching_reflection
    // student_observation
    // free_dialogue（仅兼容历史链接，教师首页已不再提供该入口）
    // ==================================================

    sessionType:
      'teaching_reflection',

    guidancePrompt: '',

    guidanceName: '',


    // ==================================================
    // 当前 Session
    // ==================================================

    sessionId: '',

    sessionReady: false,


    // ==================================================
    // 当前单条录音
    //
    // 持续记录提交时，
    // 必须明确知道提交的是哪一条 voice_record。
    // ==================================================

    currentVoiceId: '',


    // 最近一次 ASR 文本
    lastTranscript: '',


    // ==================================================
    // 首次预设采集专用
    // ==================================================

    currentTask: null,

    currentTaskId: '',

    currentVariableId: '',

    taskProgressPercent: 0,

    canCompleteTask: false,

    collectionCompleted: false
  },


  // ==================================================
  // 页面加载
  // ==================================================

  onLoad:
    async function (options) {

      const sessionType =
        options &&
        options.type
          ? options.type
          : 'teaching_reflection'


      this.setData({
        sessionType:
          sessionType,

        guidancePrompt:
          decodeQueryValue(options && options.guidance_prompt),

        guidanceName:
          decodeQueryValue(options && options.guidance_name)
      })


      console.log(
        '当前交流类型：',
        sessionType
      )


      // ==================================================
      // 清理上一次进入页面留下的录音监听器
      // ==================================================

      if (
        typeof recorderManager.offStart ===
        'function'
      ) {
        recorderManager.offStart()
      }


      if (
        typeof recorderManager.offStop ===
        'function'
      ) {
        recorderManager.offStop()
      }


      if (
        typeof recorderManager.offError ===
        'function'
      ) {
        recorderManager.offError()
      }


      // ==================================================
      // 根据模式准备 Session
      // ==================================================

      if (
        sessionType ===
        'initial_interview'
      ) {

        await this
          .prepareInitialInterview()

      } else {

        await this
          .createSession(
            sessionType
          )
      }


      // ==================================================
      // 注册录音开始
      // ==================================================

      recorderManager.onStart(
        () => {

          console.log(
            '录音开始'
          )


          this.setData({
            isRecording:
              true
          })
        }
      )


      // ==================================================
      // 注册录音结束
      // ==================================================

      recorderManager.onStop(
        (res) => {

          console.log(
            '录音结束：',
            res
          )


          const tempFilePath =
            res.tempFilePath


          const duration =
            res.duration


          this.setData({

            isRecording:
              false,

            audioTempFilePath:
              tempFilePath,

            duration:
              duration
          })


          console.log(
            '录音临时文件：',
            tempFilePath
          )


          console.log(
            '录音时长：',
            duration,
            'ms'
          )


          // ==================================================
          // 上传
          // → saveVoiceRecord
          // → ASR
          // ==================================================

          this.uploadVoice(
            tempFilePath,
            duration
          )
        }
      )


      // ==================================================
      // 注册录音错误
      // ==================================================

      recorderManager.onError(
        (err) => {

          console.error(
            '录音失败：',
            err
          )


          this.setData({
            isRecording:
              false
          })


          wx.showToast({
            title:
              '录音失败，请重试',

            icon:
              'none'
          })
        }
      )
    },


  // ==================================================
  // 教师首次建模：
  // 获取当前预设采集任务
  // ==================================================

  prepareInitialInterview:
    async function () {

      try {

        wx.showLoading({
          title:
            '正在加载任务'
        })


        const res =
          await wx.cloud
            .callFunction({

              name:
                'getNextTeacherCollectionTask',

              data: {}
            })


        console.log(
          'getNextTeacherCollectionTask 返回：',
          res.result
        )


        if (
          !res.result ||
          !res.result.success
        ) {

          throw new Error(
            (
              res.result &&
              res.result.message
            ) ||
            '获取当前采集任务失败'
          )
        }


        // ==================================================
        // 13项首次采集全部完成
        // ==================================================

        if (
          res.result
            .collection_completed
        ) {

          this.setData({

            collectionCompleted:
              true,

            currentTask:
              null,

            currentTaskId:
              '',

            currentVariableId:
              '',

            taskProgressPercent:
              100,

            sessionId:
              '',

            sessionReady:
              false,

            currentVoiceId:
              '',

            lastTranscript:
              '',

            canCompleteTask:
              false
          })


          try {
            await ensureTeacherInitialModel()
          } catch (modelError) {
            console.error('恢复教师首次模型自动构建失败：', modelError)
          }


          return
        }


        const task =
          res.result.task


        if (
          !task ||
          !task.task_id
        ) {

          throw new Error(
            '当前采集任务数据不完整'
          )
        }


        // ==================================================
        // 保存当前任务
        // ==================================================

        this.setData({

          currentTask:
            task,

          currentTaskId:
            task.task_id,

          currentVariableId:
            task.variable_id,

          taskProgressPercent:
            Math.min(
              100,
              Math.max(
                0,
                Number(task.task_order || 1) /
                  13 * 100
              )
            ),

          collectionCompleted:
            false,

          currentVoiceId:
            '',

          lastTranscript:
            '',

          canCompleteTask:
            false
        })


        console.log(
          '当前预设采集任务：',
          task.task_id,
          task.variable_id,
          task.title
        )


        // ==================================================
        // 创建或恢复当前任务 Session
        // ==================================================

        await this.createSession(
          'initial_interview',
          task.task_id
        )


      } catch (error) {

        console.error(
          '准备首次采集任务失败：',
          error
        )


        wx.showToast({

          title:
            error.message ||
            '任务加载失败',

          icon:
            'none'
        })


      } finally {

        wx.hideLoading()
      }
    },


  // ==================================================
  // 创建 / 恢复 Session
  // ==================================================

  createSession:
    async function (
      sessionType,
      taskId = ''
    ) {

      try {

        this.setData({
          sessionReady:
            false
        })


        wx.showLoading({
          title:
            '正在准备'
        })


        const requestData = {

          session_type:
            sessionType
        }


        // ==================================================
        // 首次访谈必须带 task_id
        // ==================================================

        if (
          sessionType ===
          'initial_interview'
        ) {

          requestData.task_id =
            taskId
        }


        const res =
          await wx.cloud
            .callFunction({

              name:
                'createSession',

              data:
                requestData
            })


        console.log(
          'createSession 云函数返回：',
          res.result
        )


        if (
          !res.result ||
          !res.result.success
        ) {

          throw new Error(
            (
              res.result &&
              res.result.message
            ) ||
            '会话创建失败'
          )
        }


        const session =
          res.result.session


        if (
          !session ||
          !session.session_id
        ) {

          throw new Error(
            '会话数据不完整'
          )
        }


        // ==================================================
        // 首次访谈：
        // 是否恢复了原有回答
        // ==================================================

        const hasExistingResponse =
          sessionType ===
            'initial_interview' &&
          res.result
            .has_existing_response ===
            true


        const recoveredTranscript =
          hasExistingResponse
            ? (
                res.result
                  .latest_transcript ||
                ''
              )
            : ''


        this.setData({

          sessionId:
            session.session_id,

          sessionReady:
            true,

          lastTranscript:
            recoveredTranscript,

          canCompleteTask:
            hasExistingResponse
        })


        console.log(
          '当前 session_id：',
          session.session_id
        )


        // ==================================================
        // 首次访谈调试信息
        // ==================================================

        if (
          sessionType ===
          'initial_interview'
        ) {

          console.log(
            '当前任务：',
            session.task_id,
            '→',
            session.target_variable
          )


          if (
            res.result
              .reused_session
          ) {

            console.log(
              '已复用原有 session'
            )
          }


          if (
            hasExistingResponse
          ) {

            console.log(
              '已恢复已有回答：',
              recoveredTranscript
            )
          }
        }


      } catch (error) {

        console.error(
          '调用 createSession 云函数失败：',
          error
        )


        wx.showToast({

          title:
            error.message ||
            '会话创建失败',

          icon:
            'none'
        })


      } finally {

        wx.hideLoading()
      }
    },


  // ==================================================
  // 开始录音
  // ==================================================

  startRecording:
    function () {

      // ==================================================
      // 首次采集已经完成
      // ==================================================

      if (
        this.data.collectionCompleted
      ) {
        return
      }


      // ==================================================
      // Session 尚未准备完成
      // ==================================================

      if (
        !this.data.sessionReady
      ) {

        wx.showToast({

          title:
            '交流正在准备，请稍候',

          icon:
            'none'
        })


        return
      }


      // ==================================================
      // 正在执行其他操作
      // ==================================================

      if (
        this.data.isRecording ||
        this.data.isUploading ||
        this.data.isTranscribing ||
        this.data.isCompletingTask
      ) {
        return
      }


      // ==================================================
      // 持续记录：
      //
      // 一次录音 → 一次提交。
      //
      // 当前录音已经完成 ASR 但尚未提交时，
      // 不允许下一次录音覆盖它。
      // ==================================================

      if (
        this.data.sessionType !==
          'initial_interview' &&
        this.data.currentVoiceId &&
        this.data.lastTranscript
      ) {

        wx.showToast({

          title:
            '请先提交当前记录',

          icon:
            'none'
        })


        return
      }


      const options = {

        duration:
          60000,

        sampleRate:
          16000,

        numberOfChannels:
          1,

        encodeBitRate:
          48000,

        format:
          'mp3'
      }


      console.log(
        '准备开始录音'
      )


      recorderManager.start(
        options
      )
    },


  // ==================================================
  // 停止录音
  // ==================================================

  stopRecording:
    function () {

      if (
        !this.data.isRecording
      ) {
        return
      }


      console.log(
        '准备结束录音'
      )


      recorderManager.stop()
    },


  // ==================================================
  // 上传录音
  //
  // 云存储
  // → messages
  // → voice_records
  // → ASR
  // ==================================================

  uploadVoice:
    async function (
      tempFilePath,
      duration
    ) {

      if (!tempFilePath) {
        return
      }


      if (
        !this.data.sessionId
      ) {

        wx.showToast({

          title:
            '当前会话无效',

          icon:
            'none'
        })


        return
      }


      this.setData({
        isUploading:
          true
      })


      wx.showLoading({
        title:
          '正在保存录音'
      })


      try {

        const app =
          getApp()


        const userId =
          app.globalData
            .currentUser &&
          app.globalData
            .currentUser
            .user_id
            ? app.globalData
                .currentUser
                .user_id
            : 'unknown'


        const timestamp =
          Date.now()


        const cloudPath =
          `voice/${userId}/${timestamp}.mp3`


        console.log(
          '开始上传录音：',
          cloudPath
        )


        // ==================================================
        // 1. 上传云存储
        // ==================================================

        const uploadRes =
          await wx.cloud
            .uploadFile({

              cloudPath:
                cloudPath,

              filePath:
                tempFilePath
            })


        console.log(
          '录音上传成功：',
          uploadRes
        )


        const fileId =
          uploadRes.fileID


        if (!fileId) {

          throw new Error(
            '录音上传后未取得 fileID'
          )
        }


        this.setData({
          cloudFileId:
            fileId
        })


        // ==================================================
        // 2. 保存 messages + voice_records
        // ==================================================

        const recordRes =
          await wx.cloud
            .callFunction({

              name:
                'saveVoiceRecord',

              data: {

                file_id:
                  fileId,

                duration_ms:
                  duration,

                session_id:
                  this.data.sessionId
              }
            })


        console.log(
          'saveVoiceRecord 云函数返回：',
          recordRes.result
        )


        if (
          !recordRes.result ||
          !recordRes.result.success
        ) {

          throw new Error(
            (
              recordRes.result &&
              recordRes.result.message
            ) ||
            '录音记录保存失败'
          )
        }


        const voiceRecord =
          recordRes.result
            .voice_record


        console.log(
          'voice_records 写入成功：',
          voiceRecord
        )


        if (
          !voiceRecord ||
          !voiceRecord.voice_id
        ) {

          throw new Error(
            '录音记录缺少 voice_id'
          )
        }


        // ==================================================
        // 保存当前这一次录音的 voice_id
        //
        // 持续记录提交时只向后台提供 voice_id。
        // ==================================================

        this.setData({

          currentVoiceId:
            voiceRecord.voice_id,

          isUploading:
            false
        })


        console.log(
          '当前待提交 voice_id：',
          voiceRecord.voice_id
        )


        // ==================================================
        // 3. ASR
        // ==================================================

        await this.transcribeVoice(
          voiceRecord.voice_id
        )


      } catch (error) {

        console.error(
          '录音处理流程失败：',
          error
        )


        this.setData({

          isUploading:
            false,

          isTranscribing:
            false
        })


        wx.showToast({

          title:
            error.message ||
            '录音处理失败',

          icon:
            'none'
        })


      } finally {

        wx.hideLoading()
      }
    },


  // ==================================================
  // ASR 语音识别
  // ==================================================

  transcribeVoice:
    async function (
      voiceId
    ) {

      if (!voiceId) {
        return
      }


      this.setData({
        isTranscribing:
          true
      })


      wx.showLoading({
        title:
          '正在识别语音'
      })


      try {

        console.log(
          '开始调用 transcribeVoice：',
          voiceId
        )


        const asrRes =
          await wx.cloud
            .callFunction({

              name:
                'transcribeVoice',

              data: {
                voice_id:
                  voiceId
              }
            })


        console.log(
          'transcribeVoice 云函数返回：',
          asrRes.result
        )


        if (
          !asrRes.result ||
          !asrRes.result.success
        ) {

          throw new Error(
            (
              asrRes.result &&
              asrRes.result.message
            ) ||
            '语音识别失败'
          )
        }


        const transcript =
          asrRes.result
            .transcript ||
          ''


        const hasTranscript =
          transcript
            .trim()
            .length > 0


        this.setData({

          lastTranscript:
            transcript,

          // ==================================================
          // 首次访谈：
          // 有有效回答才能完成本题
          // ==================================================

          canCompleteTask:
            this.data.sessionType ===
              'initial_interview' &&
            hasTranscript
        })


        console.log(
          '语音识别成功：',
          transcript
        )


        wx.showToast({

          title:
            '语音识别成功',

          icon:
            'success'
        })


      } catch (error) {

        console.error(
          '语音识别失败：',
          error
        )


        wx.showToast({

          title:
            error.message ||
            '语音识别失败',

          icon:
            'none'
        })


      } finally {

        wx.hideLoading()


        this.setData({
          isTranscribing:
            false
        })
      }
    },


  // ==================================================
  // 首次访谈：
  // 完成本题
  // ==================================================

  completeCurrentTask:
    async function () {

      if (
        this.data.sessionType !==
        'initial_interview'
      ) {
        return
      }


      if (
        !this.data.canCompleteTask
      ) {

        wx.showToast({

          title:
            '请先完成本题回答',

          icon:
            'none'
        })


        return
      }


      if (
        !this.data.sessionId ||
        this.data.isCompletingTask
      ) {
        return
      }


      this.setData({
        isCompletingTask:
          true
      })


      try {

        const res =
          await wx.cloud
            .callFunction({

              name:
                'completeTeacherCollectionTask',

              data: {
                session_id:
                  this.data.sessionId
              }
            })


        console.log(
          'completeTeacherCollectionTask 返回：',
          res.result
        )


        if (
          !res.result ||
          !res.result.success
        ) {

          throw new Error(
            (
              res.result &&
              res.result.message
            ) ||
            '任务提交失败'
          )
        }


        // ==================================================
        // 13项全部完成
        // ==================================================

        if (
          res.result
            .collection_completed
        ) {

          this.setData({

            collectionCompleted:
              true,

            currentTask:
              null,

            currentTaskId:
              '',

            currentVariableId:
              '',

            taskProgressPercent:
              100,

            sessionId:
              '',

            sessionReady:
              false,

            currentVoiceId:
              '',

            lastTranscript:
              '',

            canCompleteTask:
              false
          })


          let modelReady = false

          try {
            wx.showLoading({
              title: '正在构建模型',
              mask: true
            })
            await ensureTeacherInitialModel()
            modelReady = true
          } catch (modelError) {
            // 首次采集与原始证据已经提交完成。AI 暂时失败时不回滚，
            // Teacher Home 会再次幂等补分析、补建模。
            console.error('教师首次模型自动构建待重试：', modelError)
          } finally {
            wx.hideLoading()
          }


          wx.showToast({

            title:
              modelReady
                ? '首次模型已自动生成'
                : '采集完成，模型生成中',

            icon:
              modelReady ? 'success' : 'none'
          })


          return
        }


        // 当前任务 Evidence 在进入下一题前完成正式分析。失败不丢失
        // 任务、Voice 或 Evidence；后续页面会自动补分析。
        try {
          await analyzePendingTeacherInitialEvidence()
        } catch (analysisError) {
          console.error('教师首次 Evidence 分析待重试：', analysisError)
        }


        // ==================================================
        // 下一题
        // ==================================================

        const nextTask =
          res.result.next_task


        if (
          !nextTask ||
          !nextTask.task_id
        ) {

          throw new Error(
            '没有取得下一项任务'
          )
        }


        this.setData({

          currentTask:
            nextTask,

          currentTaskId:
            nextTask.task_id,

          currentVariableId:
            nextTask.variable_id,

          taskProgressPercent:
            Math.min(
              100,
              Math.max(
                0,
                Number(nextTask.task_order || 1) /
                  13 * 100
              )
            ),

          sessionId:
            '',

          sessionReady:
            false,

          currentVoiceId:
            '',

          lastTranscript:
            '',

          cloudFileId:
            '',

          audioTempFilePath:
            '',

          duration:
            0,

          canCompleteTask:
            false
        })


        console.log(
          '进入下一项任务：',
          nextTask.task_id,
          nextTask.variable_id,
          nextTask.title
        )


        // ==================================================
        // 创建或恢复下一项任务 Session
        // ==================================================

        await this.createSession(
          'initial_interview',
          nextTask.task_id
        )


        wx.showToast({

          title:
            '已进入下一题',

          icon:
            'success'
        })


      } catch (error) {

        console.error(
          '完成当前任务失败：',
          error
        )


        wx.showToast({

          title:
            error.message ||
            '任务提交失败',

          icon:
            'none'
        })


      } finally {

        this.setData({
          isCompletingTask:
            false
        })
      }
    },


  // ==================================================
  // 持续记录：
  //
  // 一次录音
  // → 一次提交
  // → 自动变量路由
  // → 生成 evidence
  // → 自动正式证据分析
  // ==================================================

  completeContinuousRecord:
    async function () {

      // ==================================================
      // 1. 首次访谈不走这里
      // ==================================================

      if (
        this.data.sessionType ===
        'initial_interview'
      ) {
        return
      }


      if (
        this.data.isCompletingTask
      ) {
        return
      }


      const voiceId =
        this.data.currentVoiceId


      const transcript =
        typeof this.data
          .lastTranscript ===
          'string'
          ? this.data
              .lastTranscript
              .trim()
          : ''


      if (
        !voiceId ||
        !transcript
      ) {

        wx.showToast({

          title:
            '请先完成一段录音',

          icon:
            'none'
        })


        return
      }


      this.setData({
        isCompletingTask:
          true
      })


      wx.showLoading({

        title:
          '正在提交记录',

        mask:
          true
      })


      try {

        // ==================================================
        // 2. 提交当前这一条语音
        //
        // voice
        // → AI变量路由
        // → 生成 1～N 条 evidence
        // ==================================================

        const submitRes =
          await wx.cloud
            .callFunction({

              name:
                'analyzeTeacherEvidence',

              data: {

                action:
                  'route_continuous',

                // 前端只提交 voice_id；主体与会话由云端校验。
                voice_id:
                  voiceId
              }
            })


        console.log(
          '教师持续记录路由返回：',
          submitRes.result
        )


        if (
          !submitRes.result ||
          !submitRes.result.success
        ) {

          throw new Error(
            (
              submitRes.result &&
              submitRes.result.message
            ) ||
            '记录提交失败'
          )
        }


        const evidenceList =
          Array.isArray(
            submitRes.result.evidence
          )
            ? submitRes.result.evidence
            : []


        // ==================================================
        // 3. 原始记录已经提交完成
        //
        // 即使后续 AI 正式证据分析偶尔失败，
        // 也不影响：
        //
        // 音频
        // ASR
        // message
        // voice_record
        // evidence
        //
        // 已经保存。
        // ==================================================

        this.setData({

          currentVoiceId:
            '',

          lastTranscript:
            '',

          cloudFileId:
            '',

          audioTempFilePath:
            '',

          duration:
            0
        })


        // ==================================================
        // 4. 当前记录没有匹配到任何变量
        //
        // 不强行制造 evidence。
        // 原始记录仍然已经保存。
        // ==================================================

        if (
          evidenceList.length === 0
        ) {

          wx.hideLoading()


          console.log(
            '当前记录没有明确变量关联：',
            submitRes.result
              .no_match_reason ||
            ''
          )


          wx.showToast({

            title:
              '记录已保存',

            icon:
              'success'
          })


          return
        }


        // ==================================================
        // 5. 自动进行正式证据分析
        //
        // 同一段教师记录可能生成：
        //
        // T2-2 evidence
        // T3-2 evidence
        // T5-2 evidence
        //
        // 分别独立分析。
        //
        // 云函数内按最多3条并发批量处理，仍保持每条 Evidence
        // 独立分析与独立落库，避免多变量命中时串行累加等待。
        // ==================================================

        wx.showLoading({

          title:
            '正在分析记录',

          mask:
            true
        })


        const evidenceIds =
          evidenceList
            .map(item =>
              item && item.evidence_id
                ? item.evidence_id
                : ''
            )
            .filter(Boolean)


        const batchRes =
          await wx.cloud
            .callFunction({

              name:
                'analyzeTeacherEvidence',

              data: {

                action:
                  'analyze_batch',

                evidence_ids:
                  evidenceIds
              }
            })


        const batchResult =
          batchRes && batchRes.result
            ? batchRes.result
            : null


        const analysisResults =
          batchResult &&
          Array.isArray(batchResult.results)
            ? batchResult.results
            : []


        const successCount =
          batchResult
            ? Number(batchResult.saved_count || 0)
            : 0


        const failedCount =
          batchResult
            ? Number(batchResult.failed_count || 0)
            : evidenceIds.length


        // Analysis 成功后幂等刷新 Evidence Profile / Gap /
        // Contradiction / Stagnation / Model Change Candidate；达到统一自动
        // 更新门槛时由云端创建并激活新 snapshot。证据不足或存在矛盾时
        // 只积累证据，不改变当前模型。
        if (successCount > 0) {
          // Profile / Gap / Candidate 是分析完成后的异步派生层，
          // 不阻塞用户看到提交成功；失败后可由下一次 refresh 幂等补建。
          wx.cloud
            .callFunction({
                  name:
                    'advanceSubjectModel',
                  data: {
                    action:
                      'refresh',
                    compact_result:
                      true,
                    subject_type:
                      'teacher'
                  }
                })
            .then((healthRes) => {
              const result =
                healthRes && healthRes.result
                  ? healthRes.result
                  : {}


              console.log(
                '教师证据健康层刷新：',
                {
                  success:
                    result.success === true,
                  profile_count:
                    Number(result.profile_count || 0),
                  candidate_count:
                    Number(result.model_change_candidate_count || 0),
                  automatic_update_status:
                    result.automatic_update && result.automatic_update.status
                      ? result.automatic_update.status
                      : ''
                }
              )
            })
            .catch((healthError) => {
              console.warn(
                '教师证据健康层待重试：',
                healthError
              )
            })
        }


        // ==================================================
        // 6. 调试日志
        //
        // 当前开发阶段先保留。
        // ==================================================

        console.log(
          '本次持续记录变量关联：',
          evidenceList
        )


        console.log(
          '本次持续记录正式分析结果：',
          analysisResults
        )


        console.log(
          '本次持续记录分析统计：',
          {

            evidence_count:
              evidenceList.length,

            success_count:
              successCount,

            failed_count:
              failedCount
          }
        )


        wx.hideLoading()


        // ==================================================
        // 7. 用户反馈
        //
        // 原始记录已经保存，
        // 分析失败不等同于记录失败。
        // ==================================================

        if (
          failedCount === 0
        ) {

          wx.showToast({

            title:
              '记录已提交',

            icon:
              'success'
          })


        } else {

          wx.showToast({

            title:
              '记录已保存，分析待补充',

            icon:
              'none'
          })
        }


      } catch (error) {

        wx.hideLoading()


        console.error(
          '提交持续记录失败：',
          error
        )


        wx.showToast({

          title:
            error.message ||
            '记录提交失败',

          icon:
            'none'
        })


      } finally {

        this.setData({
          isCompletingTask:
            false
        })
      }
    }

})
