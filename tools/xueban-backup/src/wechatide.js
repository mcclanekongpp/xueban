const { spawnSync } = require('child_process')

const DEFAULT_WECHATIDE =
  '/Applications/wechatwebdevtools.app/Contents/MacOS/wechatide'

function parseToolOutput(stdout, toolName) {
  const text = String(stdout || '').trim()
  const start = text.indexOf('{')

  if (start < 0) {
    throw new Error(`${toolName} did not return JSON`)
  }

  let payload
  try {
    payload = JSON.parse(text.slice(start))
  } catch (error) {
    throw new Error(`${toolName} returned invalid JSON: ${error.message}`)
  }

  if (!payload.ok) {
    throw new Error(`${toolName} failed: ${JSON.stringify(payload.result)}`)
  }

  if (typeof payload.result === 'string') {
    throw new Error(`${toolName} failed: ${payload.result}`)
  }

  if (payload.result && payload.result.success === false) {
    throw new Error(
      `${toolName} failed: ${payload.result.message || JSON.stringify(payload.result)}`
    )
  }

  return payload.result
}

function runWechatTool(toolName, args, options = {}) {
  const executable = options.wechatide || DEFAULT_WECHATIDE
  const clientName = options.clientName || 'xueban-backup'
  const result = spawnSync(
    executable,
    ['-c', clientName, toolName, ...args],
    {
      encoding: 'utf8',
      maxBuffer: options.maxBuffer || 128 * 1024 * 1024,
      env: process.env
    }
  )

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    const stderr = String(result.stderr || '').slice(-2000)
    throw new Error(`${toolName} exited with ${result.status}: ${stderr}`)
  }

  return parseToolOutput(result.stdout, toolName)
}

module.exports = {
  DEFAULT_WECHATIDE,
  runWechatTool
}
