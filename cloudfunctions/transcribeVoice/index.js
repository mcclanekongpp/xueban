// 云函数入口文件
const cloud = require('wx-server-sdk')
const tencentcloud = require('tencentcloud-sdk-nodejs-asr')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 腾讯云 ASR Client
const AsrClient = tencentcloud.asr.v20190614.Client

// 腾讯一句话识别按编码后的媒体真实时长执行 60 秒限制。近 60 秒的
// 微信 MP3 可能包含约 0.1 秒编码填充，因此统一把识别副本控制在
// 59 秒以内；原始云文件始终保持不变。
const SENTENCE_SAFE_DURATION_MS = 59000
const PROACTIVE_SAFE_COPY_THRESHOLD_MS = 59000
const MAX_INLINE_AUDIO_BYTES = 3 * 1024 * 1024

function isSentenceDurationLimitError(error) {
  const message = String(error && error.message ? error.message : error || '')
    .toLowerCase()

  return (
    message.includes('audio duration') &&
    message.includes('longer than 60 seconds')
  )
}

function readId3v2Size(buffer) {
  if (
    buffer.length < 10 ||
    buffer[0] !== 0x49 ||
    buffer[1] !== 0x44 ||
    buffer[2] !== 0x33
  ) {
    return 0
  }

  return 10 +
    ((buffer[6] & 0x7f) << 21) +
    ((buffer[7] & 0x7f) << 14) +
    ((buffer[8] & 0x7f) << 7) +
    (buffer[9] & 0x7f)
}

function parseMp3Frames(buffer) {
  const mpeg1Bitrates = [
    0, 32, 40, 48, 56, 64, 80, 96,
    112, 128, 160, 192, 224, 256, 320, 0
  ]
  const mpeg2Bitrates = [
    0, 8, 16, 24, 32, 40, 48, 56,
    64, 80, 96, 112, 128, 144, 160, 0
  ]
  const sampleRates = {
    3: [44100, 48000, 32000],
    2: [22050, 24000, 16000],
    0: [11025, 12000, 8000]
  }
  const frames = []
  let offset = readId3v2Size(buffer)

  while (offset + 4 <= buffer.length) {
    const b0 = buffer[offset]
    const b1 = buffer[offset + 1]
    const b2 = buffer[offset + 2]

    if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) {
      if (frames.length > 0) break
      offset += 1
      continue
    }

    const versionBits = (b1 >> 3) & 0x03
    const layerBits = (b1 >> 1) & 0x03
    const bitrateIndex = (b2 >> 4) & 0x0f
    const sampleRateIndex = (b2 >> 2) & 0x03
    const padding = (b2 >> 1) & 0x01

    // 微信录音为 MPEG Layer III。versionBits=1、layerBits!=1 或保留采样率
    // 都不是可安全裁切的有效帧头。
    if (
      versionBits === 1 ||
      layerBits !== 1 ||
      sampleRateIndex === 3
    ) {
      if (frames.length > 0) break
      offset += 1
      continue
    }

    const bitrateTable = versionBits === 3
      ? mpeg1Bitrates
      : mpeg2Bitrates
    const bitrate = bitrateTable[bitrateIndex] * 1000
    const sampleRate = sampleRates[versionBits][sampleRateIndex]

    if (!bitrate || !sampleRate) break

    const frameLength = Math.floor(
      (versionBits === 3 ? 144 : 72) * bitrate / sampleRate
    ) + padding
    const samplesPerFrame = versionBits === 3 ? 1152 : 576

    if (frameLength <= 4 || offset + frameLength > buffer.length) break

    frames.push({
      end: offset + frameLength,
      duration_ms: samplesPerFrame / sampleRate * 1000
    })
    offset += frameLength
  }

  return frames
}

function createSentenceSafeMp3(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('无法读取已保存的录音文件')
  }

  if (buffer.length > MAX_INLINE_AUDIO_BYTES) {
    throw new Error('已保存录音超过语音识别文件大小限制')
  }

  const frames = parseMp3Frames(buffer)

  if (frames.length === 0) {
    throw new Error('无法解析已保存录音的 MP3 帧')
  }

  let keepCount = frames.length
  let durationMs = frames.reduce(
    (sum, frame) => sum + frame.duration_ms,
    0
  )

  while (keepCount > 1 && durationMs > SENTENCE_SAFE_DURATION_MS) {
    keepCount -= 1
    durationMs -= frames[keepCount].duration_ms
  }

  const trimmed = buffer.subarray(0, frames[keepCount - 1].end)

  return {
    buffer: trimmed,
    duration_ms: Math.round(durationMs),
    original_bytes: buffer.length,
    trimmed_bytes: buffer.length - trimmed.length,
    frame_count: keepCount
  }
}

// 云函数入口函数
exports.main = async (event, context) => {
  const startedAt = Date.now()
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

    // 10. 获取短时签名下载 URL。
    // 腾讯云一句话识别官方推荐 COS URL 方式，服务端可直接下载，
    // 避免云函数先下载完整 MP3、再 Base64 编码并二次上传造成的
    // 内存复制与网络等待。URL 只在云函数内部传给 ASR，不返回前端。
    const urlStartedAt = Date.now()
    const tempUrlResult = await cloud.getTempFileURL({
      fileList: [voiceRecord.file_id]
    })
    const tempFile = tempUrlResult && Array.isArray(tempUrlResult.fileList)
      ? tempUrlResult.fileList[0]
      : null
    const tempFileURL = tempFile && tempFile.tempFileURL
      ? String(tempFile.tempFileURL).trim()
      : ''

    if (!tempFileURL || (tempFile.code && tempFile.code !== 'SUCCESS')) {
      throw new Error('无法取得录音文件的短时识别地址')
    }

    const tempUrlMs = Date.now() - urlStartedAt

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

    // 12. 一句话识别参数。正常短录音继续走低延迟接口；少数录音虽然
    // 前端报告不足 60 秒，但 MP3 编码后会增加几十毫秒，腾讯一句话
    // 识别会按真实媒体时长拒绝。此时原始云文件保持不变，识别请求改用
    // 去掉编码尾部填充帧的内存副本。
    const params = {
      // 我们当前录音设置为 16kHz 中文普通话
      EngSerViceType: '16k_zh',

      // 由腾讯 ASR 通过短时签名 URL 直接读取 CloudBase 云存储文件。
      SourceType: 0,

      // 当前录音格式
      VoiceFormat: 'mp3',

      Url: tempFileURL,

      // 暂时不需要词级时间戳
      WordInfo: 0
    }

    console.log('开始调用腾讯云 ASR：', {
      voice_id: voiceId,
      format: 'mp3',
      engine: '16k_zh',
      source_type: 'cloud_storage_url'
    })

    // 14. 调用腾讯云 ASR。微信 MP3 编码会在真实语音尾部附加少量
    // 编码填充。数据库报告达到 59 秒的录音直接使用内存安全副本，
    // 不再先发起一次必然有风险的 URL 识别；更短录音若仍命中接口的
    // 60 秒限制，也会进入同一兜底。原始云文件保持完全不变。
    const asrStartedAt = Date.now()
    let asrMode = 'sentence'
    let asrRequestId = ''
    let asrAudioDuration = null
    let asrTrimmedBytes = 0
    let asrTrimmedDurationMs = null
    let transcript = ''

    const recognizeSafeCopy = async (reason) => {
      asrMode = 'sentence_trimmed_copy'
      console.warn('一句话识别使用 59 秒内存安全副本：', {
        voice_id: voiceId,
        duration_ms: voiceRecord.duration_ms || null,
        reason
      })

      const downloadResult = await cloud.downloadFile({
        fileID: voiceRecord.file_id
      })
      const safeAudio = createSentenceSafeMp3(downloadResult.fileContent)
      const trimmedResult = await client.SentenceRecognition({
        EngSerViceType: '16k_zh',
        SourceType: 1,
        VoiceFormat: 'mp3',
        Data: safeAudio.buffer.toString('base64'),
        DataLen: safeAudio.buffer.length,
        WordInfo: 0
      })

      asrRequestId = trimmedResult.RequestId || ''
      asrAudioDuration = trimmedResult.AudioDuration == null
        ? null
        : Number(trimmedResult.AudioDuration)
      asrTrimmedBytes = safeAudio.trimmed_bytes
      asrTrimmedDurationMs = safeAudio.duration_ms
      transcript = typeof trimmedResult.Result === 'string'
        ? trimmedResult.Result.trim()
        : ''
    }

    const reportedDurationMs = Number(voiceRecord.duration_ms || 0)
    const useProactiveSafeCopy =
      Number.isFinite(reportedDurationMs) &&
      reportedDurationMs >= PROACTIVE_SAFE_COPY_THRESHOLD_MS

    if (useProactiveSafeCopy) {
      await recognizeSafeCopy('reported_duration_near_limit')
    } else {
      try {
        const sentenceResult = await client.SentenceRecognition(params)

        asrRequestId = sentenceResult.RequestId || ''
        asrAudioDuration = sentenceResult.AudioDuration == null
          ? null
          : Number(sentenceResult.AudioDuration)
        transcript = typeof sentenceResult.Result === 'string'
          ? sentenceResult.Result.trim()
          : ''
      } catch (sentenceError) {
        if (!isSentenceDurationLimitError(sentenceError)) throw sentenceError
        await recognizeSafeCopy(
          sentenceError.message || 'asr_duration_limit'
        )
      }
    }

    const asrMs = Date.now() - asrStartedAt
    const totalMs = Date.now() - startedAt

    console.log('腾讯云 ASR 返回：', {
      voice_id: voiceId,
      mode: asrMode,
      request_id: asrRequestId,
      trimmed_bytes: asrTrimmedBytes,
      audio_duration: asrAudioDuration
    })

    if (!transcript) {
      const noSpeechError = new Error('语音识别未返回有效文字')
      noSpeechError.code = 'ASR_NO_SPEECH'
      throw noSpeechError
    }

    // 15. 更新 voice_records
    await db.collection('voice_records')
      .doc(voiceRecord._id)
      .update({
        data: {
          transcript: transcript,
          asr_status: 'success',
          asr_mode: asrMode,
          asr_request_id: asrRequestId,
          asr_audio_duration: asrAudioDuration,
          asr_trimmed_bytes: asrTrimmedBytes,
          asr_trimmed_duration_ms: asrTrimmedDurationMs,
          asr_source_type: asrMode === 'sentence'
            ? 'cloud_storage_url'
            : 'inline_trimmed_copy',
          asr_temp_url_ms: tempUrlMs,
          asr_request_ms: asrMs,
          asr_total_ms: totalMs,
          asr_error: '',
          asr_failure_code: '',
          asr_retake_required: false,
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
        mode: asrMode,
        request_id: asrRequestId,
        audio_duration: asrAudioDuration,
        trimmed_bytes: asrTrimmedBytes,
        trimmed_duration_ms: asrTrimmedDurationMs,
        source_type: asrMode === 'sentence'
          ? 'cloud_storage_url'
          : 'inline_trimmed_copy'
      },

      performance_ms: {
        temp_url: tempUrlMs,
        asr_request: asrMs,
        total: totalMs
      }
    }

  } catch (error) {
    console.error('transcribeVoice error:', error)
    const durationLimitFailure = isSentenceDurationLimitError(error)
    const noSpeechFailure = error && error.code === 'ASR_NO_SPEECH'
    const retakeRequired = durationLimitFailure || noSpeechFailure
    const failureCode = durationLimitFailure
      ? 'ASR_DURATION_LIMIT'
      : (noSpeechFailure ? 'ASR_NO_SPEECH' : 'ASR_ERROR')
    const failureMessage = durationLimitFailure
      ? '录音超过语音识别时长限制，请重新录制，单次请控制在59秒以内'
      : (noSpeechFailure
          ? '没有识别到清晰语音，请检查麦克风后重新录制'
          : (error.message || '语音识别失败'))

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
                asr_error: error.message || '语音识别失败',
                asr_failure_code: failureCode,
                asr_retake_required: retakeRequired,
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
      code: failureCode,
      message: failureMessage,
      retake_required: retakeRequired,
      processing_ms: Date.now() - startedAt
    }
  }
}
