const CONSENT_PAGE = '/pages/voice-consent/voice-consent'

function normalizeSubjectId(subjectId) {
  return String(subjectId || '').trim()
}

async function checkVoiceConsent(subjectId) {
  const normalizedSubjectId = normalizeSubjectId(subjectId)

  if (!normalizedSubjectId) {
    return {
      success: false,
      hasConsent: false,
      message: '未找到当前研究主体'
    }
  }

  try {
    const response = await wx.cloud.callFunction({
      name: 'checkVoiceConsent',
      data: {
        subject_id: normalizedSubjectId
      }
    })
    const result = response && response.result ? response.result : null

    if (!result || result.success !== true) {
      return {
        success: false,
        hasConsent: false,
        message: (result && result.message) || '暂时无法核验录音授权'
      }
    }

    return {
      success: true,
      hasConsent: result.has_consent === true,
      message: ''
    }
  } catch (error) {
    console.error('checkVoiceConsent 调用失败：', error)
    return {
      success: false,
      hasConsent: false,
      message: '暂时无法核验录音授权'
    }
  }
}

async function requireVoiceConsent(subjectId) {
  const normalizedSubjectId = normalizeSubjectId(subjectId)
  const result = await checkVoiceConsent(normalizedSubjectId)

  if (!result.success) {
    wx.showToast({
      title: result.message,
      icon: 'none'
    })
    return false
  }

  if (result.hasConsent) return true

  wx.navigateTo({
    url: `${CONSENT_PAGE}?subject_id=${encodeURIComponent(normalizedSubjectId)}`
  })
  return false
}

module.exports = {
  checkVoiceConsent,
  requireVoiceConsent
}
