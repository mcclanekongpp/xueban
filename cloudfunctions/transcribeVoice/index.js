// 云函数入口文件
const cloud = require('wx-server-sdk')
const tencentcloud = require('tencentcloud-sdk-nodejs-asr')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 腾讯云 ASR Client
const AsrClient = tencentcloud.asr.v20190614.Client

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  const voiceId = event.voice_id

  // 1. 检查微信身份
  if (!openid) {
    return {
      success: false,
      code: 'NO_OPENID',
      message: '未获取到微信用户标识'
    }
  }

  // 2. 检查 voice_id
  if (!voiceId || typeof voiceId !== 'string') {
    return {
      success: false,
      code: 'INVALID_VOICE_ID',
      message: '录音编号无效'
    }
  }

  try {
    // 3. 检查 ASR 环境变量
    const secretId = process.env.ASR_SECRET_ID
    const secretKey = process.env.ASR_SECRET_KEY

    if (!secretId || !secretKey) {
      return {
        success: false,
        code: 'ASR_CONFIG_MISSING',
        message: '语音识别服务尚未正确配置'
      }
    }

    // 4. 根据 OPENID 查询当前用户
    const userResult = await db.collection('users')
      .where({
        openid: openid
      })
      .limit(1)
      .get()

    if (userResult.data.length === 0) {
      return {
        success: false,
        code: 'USER_NOT_FOUND',
        message: '用户不存在，请先登录'
      }
    }

    const user = userResult.data[0]

    // 5. 查询当前用户自己的录音记录
    const voiceResult = await db.collection('voice_records')
      .where({
        voice_id: voiceId,
        user_id: user.user_id
      })
      .limit(1)
      .get()

    if (voiceResult.data.length === 0) {
      return {
        success: false,
        code: 'VOICE_NOT_FOUND',
        message: '未找到当前录音记录'
      }
    }

    const voiceRecord = voiceResult.data[0]

    // 6. 如果之前已经识别成功，直接返回，避免重复计费和重复识别
    if (
      voiceRecord.asr_status === 'success' &&
      voiceRecord.transcript
    ) {
      return {
        success: true,
        already_transcribed: true,
        voice_id: voiceRecord.voice_id,
        message_id: voiceRecord.message_id,
        transcript: voiceRecord.transcript
      }
    }

    // 7. 检查必要关联
    if (!voiceRecord.message_id) {
      return {
        success: false,
        code: 'MESSAGE_NOT_FOUND',
        message: '录音尚未关联消息'
      }
    }

    if (!voiceRecord.file_id) {
      return {
        success: false,
        code: 'FILE_NOT_FOUND',
        message: '录音文件不存在'
      }
    }

    // 8. 校验对应 message 是否真实存在
    const messageResult = await db.collection('messages')
      .where({
        message_id: voiceRecord.message_id,
        session_id: voiceRecord.session_id,
        subject_id: voiceRecord.subject_id
      })
      .limit(1)
      .get()

    if (messageResult.data.length === 0) {
      return {
        success: false,
        code: 'MESSAGE_RECORD_NOT_FOUND',
        message: '未找到对应消息记录'
      }
    }

    // 9. 标记为识别中
    await db.collection('voice_records')
      .doc(voiceRecord._id)
      .update({
        data: {
          asr_status: 'processing',
          updated_at: db.serverDate()
        }
      })

    // 10. 从 CloudBase 云存储读取 MP3 文件
    const downloadResult = await cloud.downloadFile({
      fileID: voiceRecord.file_id
    })

    const audioBuffer = downloadResult.fileContent

    if (!audioBuffer || !audioBuffer.length) {
      throw new Error('录音文件内容为空')
    }

    // 一句话识别目前单文件不能超过 3MB
    if (audioBuffer.length > 3 * 1024 * 1024) {
      throw new Error('录音文件超过语音识别大小限制')
    }

    console.log('录音文件已读取：', {
      voice_id: voiceId,
      bytes: audioBuffer.length
    })

    // 11. 转成 Base64
    const audioBase64 = audioBuffer.toString('base64')

    // 12. 初始化腾讯云 ASR 客户端
    const client = new AsrClient({
      credential: {
        secretId: secretId,
        secretKey: secretKey
      },

      // 一句话识别接口本身不依赖具体地域
      region: '',

      profile: {
        signMethod: 'TC3-HMAC-SHA256',

        httpProfile: {
          endpoint: 'asr.tencentcloudapi.com',
          reqMethod: 'POST',
          reqTimeout: 20
        }
      }
    })

    // 13. 一句话识别参数
    const params = {
      // 我们当前录音设置为 16kHz 中文普通话
      EngSerViceType: '16k_zh',

      // 直接上传音频数据
      SourceType: 1,

      // 当前录音格式
      VoiceFormat: 'mp3',

      // Base64 音频
      Data: audioBase64,

      // 注意：这里是 Base64 编码前的原始字节长度
      DataLen: audioBuffer.length,

      // 暂时不需要词级时间戳
      WordInfo: 0
    }

    console.log('开始调用腾讯云 ASR：', {
      voice_id: voiceId,
      format: 'mp3',
      engine: '16k_zh',
      data_length: audioBuffer.length
    })

    // 14. 调用腾讯云一句话识别
    const asrResult = await client.SentenceRecognition(params)

    console.log('腾讯云 ASR 返回：', {
      voice_id: voiceId,
      request_id: asrResult.RequestId,
      audio_duration: asrResult.AudioDuration
    })

    const transcript =
      typeof asrResult.Result === 'string'
        ? asrResult.Result.trim()
        : ''

    if (!transcript) {
      throw new Error('语音识别未返回有效文字')
    }

    // 15. 更新 voice_records
    await db.collection('voice_records')
      .doc(voiceRecord._id)
      .update({
        data: {
          transcript: transcript,
          asr_status: 'success',
          asr_request_id: asrResult.RequestId || '',
          asr_audio_duration: asrResult.AudioDuration || null,
          asr_error: '',
          updated_at: db.serverDate()
        }
      })

    // 16. 将同样的识别文字写入 messages.content
    const message = messageResult.data[0]

    await db.collection('messages')
      .doc(message._id)
      .update({
        data: {
          content: transcript,
          updated_at: db.serverDate()
        }
      })

    console.log('语音转写完成：', {
      voice_id: voiceId,
      message_id: voiceRecord.message_id,
      transcript: transcript
    })

    return {
      success: true,
      already_transcribed: false,

      voice_id: voiceId,
      message_id: voiceRecord.message_id,
      session_id: voiceRecord.session_id,
      subject_id: voiceRecord.subject_id,

      transcript: transcript,

      asr: {
        status: 'success',
        request_id: asrResult.RequestId || '',
        audio_duration: asrResult.AudioDuration || null
      }
    }

  } catch (error) {
    console.error('transcribeVoice error:', error)

    // 如果能够找到该录音，则尽量把失败状态记录下来
    try {
      const userResult = await db.collection('users')
        .where({
          openid: openid
        })
        .limit(1)
        .get()

      if (userResult.data.length > 0) {
        const user = userResult.data[0]

        const voiceResult = await db.collection('voice_records')
          .where({
            voice_id: voiceId,
            user_id: user.user_id
          })
          .limit(1)
          .get()

        if (voiceResult.data.length > 0) {
          const voiceRecord = voiceResult.data[0]

          await db.collection('voice_records')
            .doc(voiceRecord._id)
            .update({
              data: {
                asr_status: 'failed',
                asr_error:
                  error.message ||
                  '语音识别失败',
                updated_at: db.serverDate()
              }
            })
        }
      }
    } catch (updateError) {
      console.error(
        '更新 ASR 失败状态时发生错误：',
        updateError
      )
    }

    return {
      success: false,
      code: 'ASR_ERROR',
      message: error.message || '语音识别失败'
    }
  }
}