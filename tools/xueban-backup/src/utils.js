const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath))
  const temporary = `${filePath}.tmp-${process.pid}`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600
  })
  fs.renameSync(temporary, filePath)
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    const output = {}
    for (const key of Object.keys(value).sort()) {
      output[key] = canonicalize(value[key])
    }
    return output
  }
  return value
}

function canonicalSha256(value) {
  return sha256Buffer(Buffer.from(JSON.stringify(canonicalize(value))))
}

function listFiles(rootDirectory) {
  const output = []

  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(absolute)
      if (entry.isFile()) output.push(absolute)
    }
  }

  visit(rootDirectory)
  return output.sort()
}

function safeStoragePath(root, cloudPath) {
  const normalized = path.posix.normalize(String(cloudPath || ''))
  if (
    !normalized ||
    normalized === '.' ||
    normalized.startsWith('../') ||
    normalized.startsWith('/')
  ) {
    throw new Error(`Unsafe cloud path: ${cloudPath}`)
  }
  const absolute = path.resolve(root, ...normalized.split('/'))
  const rootPrefix = `${path.resolve(root)}${path.sep}`
  if (!absolute.startsWith(rootPrefix)) {
    throw new Error(`Cloud path escapes backup root: ${cloudPath}`)
  }
  return absolute
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: options.encoding === undefined ? 'utf8' : options.encoding,
    cwd: options.cwd,
    env: options.env || process.env,
    maxBuffer: options.maxBuffer || 128 * 1024 * 1024,
    stdio: options.stdio
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `${command} exited with ${result.status}: ${String(result.stderr || '').slice(-2000)}`
    )
  }
  return result
}

function commandExists(command) {
  const result = spawnSync('/usr/bin/which', [command], { encoding: 'utf8' })
  return result.status === 0
}

function formatTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-').replace('Z', 'Z')
}

module.exports = {
  canonicalSha256,
  commandExists,
  ensureDir,
  formatTimestamp,
  listFiles,
  readJson,
  runCommand,
  safeStoragePath,
  sha256File,
  writeJson
}
