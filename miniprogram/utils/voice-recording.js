const RECORDING_MAX_DURATION_MS = 59000
const HARD_DURATION_LIMIT_MS = 60000

function createVoiceRecorderOptions() {
  return {
    // 腾讯一句话识别按编码后的媒体时长执行 60 秒上限。微信 MP3 会在
    // 录音尾部产生少量编码填充，因此正式入口统一在 59 秒自动停止，
    // 为编码时长留出安全余量。
    duration: RECORDING_MAX_DURATION_MS,
    sampleRate: 16000,
    numberOfChannels: 1,
    encodeBitRate: 48000,
    format: 'mp3'
  }
}

function validateVoiceRecordingResult(result) {
  const tempFilePath = String(result && result.tempFilePath || '').trim()
  const duration = Number(result && result.duration)

  if (!tempFilePath || !Number.isFinite(duration) || duration <= 0) {
    return {
      valid: false,
      code: 'INVALID_RECORDING',
      message: '没有取得有效录音，请重新录制'
    }
  }

  if (duration > HARD_DURATION_LIMIT_MS) {
    return {
      valid: false,
      code: 'RECORDING_TOO_LONG',
      message: '单次录音不能超过60秒，请重新录制'
    }
  }

  return {
    valid: true,
    tempFilePath,
    duration
  }
}

module.exports = {
  RECORDING_MAX_DURATION_MS,
  HARD_DURATION_LIMIT_MS,
  createVoiceRecorderOptions,
  validateVoiceRecordingResult
}
