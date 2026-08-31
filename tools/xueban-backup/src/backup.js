const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { runWechatTool, DEFAULT_WECHATIDE } = require('./wechatide')
const {
  commandExists,
  ensureDir,
  formatTimestamp,
  listFiles,
  readJson,
  runCommand,
  safeStoragePath,
  sha256File,
  writeJson
} = require('./utils')
const {
  checkIntegrity,
  createModelIndex,
  writeModelIndexes
} = require('./integrity')

const DEFAULT_APP_ID = 'wx962acbf120074da9'
const DEFAULT_ENV_ID = 'model-dev-d9gkoyaolb464c28d'
// WeChatIDE's read tool returns complete JSON, but very large single responses
// can exceed its transport envelope. Small pages keep nested model/evidence data
// intact without changing database semantics.
const PAGE_SIZE = 25

function loadRegistry(projectPath) {
  return readJson(
    path.join(projectPath, 'tools/xueban-backup/config/collections.json')
  )
}

function toolContext(options) {
  return {
    appId: options.appId || DEFAULT_APP_ID,
    envId: options.envId || DEFAULT_ENV_ID,
    projectPath: path.resolve(options.projectPath),
    wechatide: options.wechatide || DEFAULT_WECHATIDE,
    clientName: 'xueban-backup'
  }
}

function run(ctx, toolName, args, extra = {}) {
  return runWechatTool(toolName, args, {
    wechatide: ctx.wechatide,
    clientName: ctx.clientName,
    ...extra
  })
}

function preflight(ctx, options = {}) {
  if (!fs.existsSync(ctx.projectPath)) {
    throw new Error(`Project path does not exist: ${ctx.projectPath}`)
  }
  if (!fs.existsSync(ctx.wechatide)) {
    throw new Error(`WeChatIDE skill CLI does not exist: ${ctx.wechatide}`)
  }
  if (!commandExists('git')) throw new Error('git is required')
  if (!commandExists('tar')) throw new Error('tar is required')
  if (!commandExists('gpg')) throw new Error('gpg is required')

  const environment = run(ctx, 'cloud_env_list', [
    '--project', ctx.projectPath
  ])
  if (!Array.isArray(environment.list) || !environment.list.includes(ctx.envId)) {
    throw new Error(`Cloud environment is not available: ${ctx.envId}`)
  }
  if (environment.appid !== ctx.appId) {
    throw new Error(
      `AppID mismatch: project=${environment.appid}, requested=${ctx.appId}`
    )
  }

  if (options.outputDirectory) {
    const output = path.resolve(options.outputDirectory)
    const project = path.resolve(ctx.projectPath)
    const insideProject = output === project || output.startsWith(`${project}${path.sep}`)
    if (insideProject && !options.allowProjectOutput) {
      throw new Error(
        'Output is inside the Git worktree; pass --allow-project-output explicitly'
      )
    }
  }

  return {
    appid: environment.appid,
    environments: environment.list,
    node_version: process.version,
    platform: `${process.platform}-${process.arch}`
  }
}

function listCollections(ctx) {
  const collections = []
  let offset = 0
  let total = null

  do {
    const result = run(ctx, 'cloud_db_read_struct', [
      '--appid', ctx.appId,
      '--env', ctx.envId,
      '--action', 'listCollections',
      '--limit', '100',
      '--offset', String(offset)
    ])
    const page = Array.isArray(result.collections) ? result.collections : []
    collections.push(...page)
    total = result.pager && Number.isFinite(Number(result.pager.Total))
      ? Number(result.pager.Total)
      : collections.length
    offset += page.length
    if (page.length === 0) break
  } while (offset < total)

  return collections.sort((a, b) =>
    String(a.TableName).localeCompare(String(b.TableName))
  )
}

function readCollectionPage(ctx, collectionName, offset) {
  return run(ctx, 'cloud_db_read_doc', [
    '--appid', ctx.appId,
    '--env', ctx.envId,
    '--collection-name', collectionName,
    '--sort', '[{"key":"_id","direction":1}]',
    '--limit', String(PAGE_SIZE),
    '--offset', String(offset)
  ], { maxBuffer: 256 * 1024 * 1024 })
}

function classifyCollection(collectionName, registry) {
  if (registry.restricted.includes(collectionName)) return 'restricted'
  if (registry.research.includes(collectionName)) return 'research'
  return 'unknown'
}

function exportCollections(ctx, collectionMetadata, registry, databaseDirectory) {
  const allDocuments = {}
  const inventory = []

  for (let index = 0; index < collectionMetadata.length; index += 1) {
    const metadata = collectionMetadata[index]
    const collectionName = metadata.TableName
    const expectedCount = Number(metadata.Count || 0)
    const documents = []
    let offset = 0

    while (offset < expectedCount) {
      const result = readCollectionPage(ctx, collectionName, offset)
      const page = Array.isArray(result.data) ? result.data : []
      documents.push(...page)
      offset += page.length
      if (page.length === 0) break
    }

    const category = classifyCollection(collectionName, registry)
    const filePath = path.join(databaseDirectory, category, `${collectionName}.json`)
    const exportDocument = {
      schema_version: 'xueban_collection_export_v1.0',
      environment_id: ctx.envId,
      collection: collectionName,
      exported_at: new Date().toISOString(),
      expected_count: expectedCount,
      exported_count: documents.length,
      documents
    }
    writeJson(filePath, exportDocument)
    allDocuments[collectionName] = documents
    inventory.push({
      collection: collectionName,
      category,
      expected_count: expectedCount,
      exported_count: documents.length,
      source_size_bytes: Number(metadata.Size || 0),
      index_count: Number(metadata.IndexCount || 0),
      relative_path: path.relative(databaseDirectory, filePath)
    })
    console.log(
      `[database ${index + 1}/${collectionMetadata.length}] ${collectionName}: ${documents.length}`
    )
  }

  writeJson(path.join(databaseDirectory, 'inventory.json'), {
    schema_version: 'xueban_database_inventory_v1.0',
    generated_at: new Date().toISOString(),
    collection_count: inventory.length,
    document_count: inventory.reduce((sum, item) => sum + item.exported_count, 0),
    collections: inventory
  })

  return { allDocuments, inventory }
}

function listStorage(ctx, prefixes) {
  const byKey = new Map()
  const prefixReports = []

  for (const prefix of prefixes) {
    const result = run(ctx, 'cloud_query_storage', [
      '--appid', ctx.appId,
      '--env', ctx.envId,
      '--action', 'list',
      '--cloud-path', prefix
    ])
    const data = result.data || {}
    const files = Array.isArray(data.files) ? data.files : []
    for (const item of files) {
      const key = String(item.Key || '')
      if (key) byKey.set(key, item)
    }
    prefixReports.push({
      prefix,
      returned_count: files.length,
      reported_total_count: Number(data.totalCount || files.length)
    })
  }

  return {
    prefixes: prefixReports,
    files: [...byKey.values()].sort((a, b) =>
      String(a.Key).localeCompare(String(b.Key))
    )
  }
}

async function downloadStorage(ctx, listedStorage, storageDirectory) {
  const objectRoot = path.join(storageDirectory, 'objects')
  const completed = []

  for (let index = 0; index < listedStorage.files.length; index += 1) {
    const item = listedStorage.files[index]
    const key = String(item.Key)
    const target = safeStoragePath(objectRoot, key)
    const partial = `${target}.part`
    ensureDir(path.dirname(target))

    let lastError = null
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        if (fs.existsSync(partial)) fs.rmSync(partial, { force: true })
        run(ctx, 'cloud_manage_storage', [
          '--appid', ctx.appId,
          '--env', ctx.envId,
          '--action', 'download',
          '--cloud-path', key,
          '--local-path', partial
        ])
        const actualSize = fs.statSync(partial).size
        const expectedSize = Number(item.Size || 0)
        if (actualSize !== expectedSize) {
          throw new Error(`size mismatch: expected ${expectedSize}, got ${actualSize}`)
        }
        fs.renameSync(partial, target)
        const checksum = await sha256File(target)
        completed.push({
          key,
          size: actualSize,
          etag: item.ETag || null,
          last_modified: item.LastModified || null,
          storage_class: item.StorageClass || null,
          sha256: checksum,
          relative_path: path.relative(storageDirectory, target)
        })
        lastError = null
        break
      } catch (error) {
        lastError = error
        if (attempt < 3) {
          console.log(`[storage retry ${attempt}/3] ${key}`)
        }
      }
    }
    if (lastError) throw new Error(`Failed to download ${key}: ${lastError.message}`)

    console.log(`[storage ${index + 1}/${listedStorage.files.length}] ${key}`)
  }

  const inventory = {
    schema_version: 'xueban_storage_inventory_v1.0',
    generated_at: new Date().toISOString(),
    registered_prefixes: listedStorage.prefixes,
    object_count: completed.length,
    total_bytes: completed.reduce((sum, item) => sum + item.size, 0),
    files: completed
  }
  writeJson(path.join(storageDirectory, 'inventory.json'), inventory)
  fs.writeFileSync(
    path.join(storageDirectory, 'inventory.jsonl'),
    `${completed.map(item => JSON.stringify(item)).join('\n')}\n`,
    { mode: 0o600 }
  )
  return inventory
}

function collectFunctionMetadata(ctx, configurationDirectory) {
  const functionList = run(ctx, 'cloud_fn_list', [
    '--project', ctx.projectPath,
    '--env', ctx.envId
  ])
  const names = Array.isArray(functionList.list) ? functionList.list : []
  const details = []
  for (let index = 0; index < names.length; index += 10) {
    const batch = names.slice(index, index + 10)
    const result = run(ctx, 'cloud_fn_info', [
      '--project', ctx.projectPath,
      '--env', ctx.envId,
      '--names', batch.join(',')
    ])
    if (Array.isArray(result.list)) details.push(...result.list)
  }
  const output = {
    appid: ctx.appId,
    environment_id: ctx.envId,
    generated_at: new Date().toISOString(),
    function_count: names.length,
    functions: details
  }
  writeJson(path.join(configurationDirectory, 'cloudfunctions.json'), output)
  return output
}

function collectSource(ctx, sourceDirectory) {
  ensureDir(sourceDirectory)
  const gitCommit = runCommand('git', ['rev-parse', 'HEAD'], {
    cwd: ctx.projectPath
  }).stdout.trim()
  const gitBranch = runCommand('git', ['branch', '--show-current'], {
    cwd: ctx.projectPath
  }).stdout.trim()
  const gitStatus = runCommand('git', ['status', '--porcelain=v1'], {
    cwd: ctx.projectPath
  }).stdout
  const gitDiff = runCommand('git', ['diff', '--binary', 'HEAD'], {
    cwd: ctx.projectPath,
    maxBuffer: 256 * 1024 * 1024
  }).stdout

  fs.writeFileSync(path.join(sourceDirectory, 'git-status.txt'), gitStatus, {
    mode: 0o600
  })
  fs.writeFileSync(path.join(sourceDirectory, 'working-tree.patch'), gitDiff, {
    mode: 0o600
  })
  runCommand('git', [
    'bundle', 'create', path.join(sourceDirectory, 'xueban.bundle'), '--all'
  ], { cwd: ctx.projectPath })

  const metadata = {
    commit: gitCommit,
    branch: gitBranch,
    dirty: Boolean(gitStatus.trim()),
    captured_at: new Date().toISOString()
  }
  writeJson(path.join(sourceDirectory, 'git.json'), metadata)
  return metadata
}

function compareInventories(beforeCollections, afterCollections, beforeStorage, afterStorage) {
  const beforeCollectionMap = new Map(
    beforeCollections.map(item => [item.TableName, Number(item.Count || 0)])
  )
  const afterCollectionMap = new Map(
    afterCollections.map(item => [item.TableName, Number(item.Count || 0)])
  )
  const collectionChanges = []
  for (const name of new Set([...beforeCollectionMap.keys(), ...afterCollectionMap.keys()])) {
    const before = beforeCollectionMap.get(name)
    const after = afterCollectionMap.get(name)
    if (before !== after) collectionChanges.push({ collection: name, before, after })
  }

  const storageSignature = inventory => new Map(
    inventory.files.map(item => [String(item.Key), `${item.Size}|${item.ETag || ''}`])
  )
  const beforeFiles = storageSignature(beforeStorage)
  const afterFiles = storageSignature(afterStorage)
  const storageChanges = []
  for (const key of new Set([...beforeFiles.keys(), ...afterFiles.keys()])) {
    const before = beforeFiles.get(key)
    const after = afterFiles.get(key)
    if (before !== after) storageChanges.push({ key, before, after })
  }

  return {
    status: collectionChanges.length === 0 && storageChanges.length === 0
      ? 'consistent'
      : 'changed_during_backup',
    collection_changes: collectionChanges,
    storage_changes: storageChanges
  }
}

async function writeChecksums(backupRoot) {
  const checksumPath = path.join(backupRoot, 'checksums.sha256')
  const files = listFiles(backupRoot).filter(file => file !== checksumPath)
  const lines = []
  for (const file of files) {
    const checksum = await sha256File(file)
    lines.push(`${checksum}  ${path.relative(backupRoot, file)}`)
  }
  fs.writeFileSync(checksumPath, `${lines.join('\n')}\n`, { mode: 0o600 })
  return lines.length
}

function ensureSymmetricKey(keyFile, createKey) {
  const absolute = path.resolve(keyFile)
  if (fs.existsSync(absolute)) return absolute
  if (!createKey) throw new Error(`Backup key file does not exist: ${absolute}`)
  ensureDir(path.dirname(absolute))
  fs.writeFileSync(absolute, `${crypto.randomBytes(48).toString('base64')}\n`, {
    mode: 0o600,
    flag: 'wx'
  })
  fs.chmodSync(absolute, 0o600)
  return absolute
}

function encryptArchive(plainArchive, encryptedArchive, keyFile) {
  runCommand('gpg', [
    '--batch',
    '--yes',
    '--pinentry-mode', 'loopback',
    '--passphrase-file', keyFile,
    '--symmetric',
    '--cipher-algo', 'AES256',
    '--output', encryptedArchive,
    plainArchive
  ])
}

async function verifyExtractedRoot(backupRoot) {
  const checksumFile = path.join(backupRoot, 'checksums.sha256')
  if (!fs.existsSync(checksumFile)) throw new Error('checksums.sha256 is missing')
  const lines = fs.readFileSync(checksumFile, 'utf8').split('\n').filter(Boolean)
  const failures = []
  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{64})  (.+)$/)
    if (!match) {
      failures.push({ line, reason: 'invalid_checksum_line' })
      continue
    }
    const filePath = path.join(backupRoot, match[2])
    if (!fs.existsSync(filePath)) {
      failures.push({ path: match[2], reason: 'missing' })
      continue
    }
    const actual = await sha256File(filePath)
    if (actual !== match[1]) failures.push({ path: match[2], reason: 'mismatch' })
  }
  return { checked_files: lines.length, failures }
}

async function verifyArchive(options) {
  const archive = path.resolve(options.archive)
  const keyFile = path.resolve(options.keyFile)
  if (!fs.existsSync(archive)) throw new Error(`Archive not found: ${archive}`)
  if (!fs.existsSync(keyFile)) throw new Error(`Key file not found: ${keyFile}`)

  const verifyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xueban-verify-'))
  const plainArchive = path.join(verifyRoot, 'backup.tar.gz')
  const extractRoot = path.join(verifyRoot, 'extract')
  ensureDir(extractRoot)

  try {
    runCommand('gpg', [
      '--batch',
      '--yes',
      '--pinentry-mode', 'loopback',
      '--passphrase-file', keyFile,
      '--output', plainArchive,
      '--decrypt', archive
    ])
    runCommand('tar', ['-xzf', plainArchive, '-C', extractRoot])
    const entries = fs.readdirSync(extractRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
    if (entries.length !== 1) throw new Error('Archive root is invalid')
    const backupRoot = path.join(extractRoot, entries[0].name)
    const checksumResult = await verifyExtractedRoot(backupRoot)
    const manifest = readJson(path.join(backupRoot, 'backup-manifest.json'))
    const integrity = readJson(path.join(backupRoot, 'reports/integrity.json'))
    const issueCodeCounts = {}
    for (const issue of Array.isArray(integrity.issues) ? integrity.issues : []) {
      issueCodeCounts[issue.code] = (issueCodeCounts[issue.code] || 0) + 1
    }
    return {
      success: checksumResult.failures.length === 0,
      archive,
      backup_id: manifest.backup_id,
      checked_files: checksumResult.checked_files,
      failures: checksumResult.failures,
      integrity: {
        counts: integrity.counts,
        restorable: integrity.restorable,
        issue_code_counts: issueCodeCounts,
        storage: integrity.storage
      },
      manifest
    }
  } finally {
    fs.rmSync(verifyRoot, { recursive: true, force: true })
  }
}

async function createFullBackup(options) {
  const ctx = toolContext(options)
  const outputDirectory = path.resolve(options.outputDirectory)
  const keyFile = ensureSymmetricKey(options.keyFile, options.createKey)
  const startedAt = new Date()
  const timestamp = formatTimestamp(startedAt)
  const backupId = `BKP_${timestamp}`
  const rootName = `xueban-backup-${ctx.envId}-${timestamp}`
  const stageParent = fs.mkdtempSync(path.join(os.tmpdir(), 'xueban-backup-'))
  const backupRoot = path.join(stageParent, rootName)
  ensureDir(backupRoot)
  ensureDir(outputDirectory)

  try {
    console.log('[1/10] preflight')
  const preflightResult = preflight(ctx, {
    outputDirectory,
    allowProjectOutput: options.allowProjectOutput
  })
  const registry = loadRegistry(ctx.projectPath)

  console.log('[2/10] source inventory')
  const beforeCollections = listCollections(ctx)
  const beforeStorage = listStorage(ctx, registry.storage_prefixes)

  console.log('[3/10] database export')
  const databaseResult = exportCollections(
    ctx,
    beforeCollections,
    registry,
    path.join(backupRoot, 'database')
  )

  console.log('[4/10] cloud storage download')
  const storageInventory = await downloadStorage(
    ctx,
    beforeStorage,
    path.join(backupRoot, 'storage')
  )

  console.log('[5/10] model indexes and integrity')
  const modelIndex = createModelIndex(databaseResult.allDocuments)
  writeModelIndexes(path.join(backupRoot, 'models'), modelIndex)
  const integrity = checkIntegrity(databaseResult.allDocuments, storageInventory)
  writeJson(path.join(backupRoot, 'reports/integrity.json'), integrity)

  console.log('[6/10] source and cloud function metadata')
  const sourceMetadata = collectSource(ctx, path.join(backupRoot, 'source'))
  const functionMetadata = collectFunctionMetadata(
    ctx,
    path.join(backupRoot, 'configuration')
  )
  writeJson(path.join(backupRoot, 'configuration/environment.json'), {
    appid: ctx.appId,
    environment_id: ctx.envId,
    captured_at: new Date().toISOString(),
    preflight: preflightResult
  })
  writeJson(path.join(backupRoot, 'configuration/permissions.json'), {
    captured_at: new Date().toISOString(),
    status: 'not_exposed_by_current_read_cli',
    note: 'Collection and storage permission values require a separate authorized control-plane export.'
  })

  console.log('[7/10] consistency recheck')
  const afterCollections = listCollections(ctx)
  const afterStorage = listStorage(ctx, registry.storage_prefixes)
  const consistency = compareInventories(
    beforeCollections,
    afterCollections,
    beforeStorage,
    afterStorage
  )
  writeJson(path.join(backupRoot, 'reports/consistency.json'), consistency)
  writeJson(path.join(backupRoot, 'reports/privacy.json'), {
    classification: 'highly_sensitive_research_data',
    includes_minor_voice: true,
    includes_identity_linkage: true,
    encrypted_delivery_required: true,
    generated_at: new Date().toISOString()
  })

  const countMismatches = databaseResult.inventory.filter(
    item => item.expected_count !== item.exported_count
  )
  for (const mismatch of countMismatches) {
    integrity.issues.push({
      level: 'fatal',
      code: 'collection_export_count_mismatch',
      collection: mismatch.collection,
      expected: mismatch.expected_count,
      actual: mismatch.exported_count
    })
    integrity.counts.fatal_count += 1
  }
  integrity.restorable =
    integrity.counts.fatal_count === 0 && consistency.status === 'consistent'
  writeJson(path.join(backupRoot, 'reports/integrity.json'), integrity)

  const completedAt = new Date()
  const manifest = {
    schema_version: 'xueban_backup_v1.0',
    backup_id: backupId,
    environment_id: ctx.envId,
    appid: ctx.appId,
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    mode: 'full',
    consistency_status: consistency.status,
    restorable: integrity.restorable,
    git_commit: sourceMetadata.commit,
    git_dirty: sourceMetadata.dirty,
    database: {
      collection_count: databaseResult.inventory.length,
      document_count: databaseResult.inventory.reduce(
        (sum, item) => sum + item.exported_count,
        0
      )
    },
    storage: {
      registered_prefixes: registry.storage_prefixes,
      object_count: storageInventory.object_count,
      total_bytes: storageInventory.total_bytes
    },
    models: {
      snapshot_count: modelIndex.snapshot_count,
      draft_count: modelIndex.entries.filter(item => item.status === 'draft').length,
      active_count: modelIndex.entries.filter(item => item.status === 'active').length
    },
    cloudfunctions: {
      function_count: functionMetadata.function_count
    },
    integrity: integrity.counts,
    encryption: {
      enabled: true,
      method: 'gpg-symmetric-aes256',
      key_in_archive: false
    },
    integrity_report: 'reports/integrity.json'
  }
  writeJson(path.join(backupRoot, 'backup-manifest.json'), manifest)
  fs.writeFileSync(
    path.join(backupRoot, 'reports/summary.md'),
    `# Xueban Backup Summary\n\n` +
      `- Backup ID: ${backupId}\n` +
      `- Environment: ${ctx.envId}\n` +
      `- Collections: ${manifest.database.collection_count}\n` +
      `- Documents: ${manifest.database.document_count}\n` +
      `- Storage objects: ${manifest.storage.object_count}\n` +
      `- Storage bytes: ${manifest.storage.total_bytes}\n` +
      `- Model snapshots: ${manifest.models.snapshot_count}\n` +
      `- Fatal: ${integrity.counts.fatal_count}\n` +
      `- Warnings: ${integrity.counts.warning_count}\n` +
      `- Consistency: ${consistency.status}\n` +
      `- Restorable: ${manifest.restorable}\n`,
    { mode: 0o600 }
  )

  console.log('[8/10] checksums')
  await writeChecksums(backupRoot)

  console.log('[9/10] encrypted archive')
  const plainArchive = path.join(stageParent, `${rootName}.tar.gz`)
  const encryptedArchive = path.join(outputDirectory, `${rootName}.tar.gz.gpg`)
  runCommand('tar', ['-czf', plainArchive, '-C', stageParent, rootName])
  encryptArchive(plainArchive, encryptedArchive, keyFile)
  fs.chmodSync(encryptedArchive, 0o600)
  const archiveSha256 = await sha256File(encryptedArchive)

  console.log('[10/10] offline verification')
  const verification = await verifyArchive({
    archive: encryptedArchive,
    keyFile
  })
  if (!verification.success) {
    throw new Error(`Offline verification failed: ${JSON.stringify(verification.failures)}`)
  }

  const summary = {
    schema_version: 'xueban_backup_local_summary_v1.0',
    backup_id: backupId,
    archive: path.basename(encryptedArchive),
    archive_sha256: archiveSha256,
    archive_size_bytes: fs.statSync(encryptedArchive).size,
    key_file: path.relative(outputDirectory, keyFile),
    environment_id: ctx.envId,
    appid: ctx.appId,
    completed_at: completedAt.toISOString(),
    database: manifest.database,
    storage: manifest.storage,
    models: manifest.models,
    integrity: manifest.integrity,
    consistency_status: manifest.consistency_status,
    restorable: manifest.restorable,
    offline_verified: true
  }
  writeJson(path.join(outputDirectory, 'latest-backup.json'), summary)

    fs.rmSync(stageParent, { recursive: true, force: true })
    return { ...summary, archive_path: encryptedArchive, key_file_path: keyFile }
  } catch (error) {
    throw new Error(
      `${error.message}; plaintext staging directory retained for diagnosis: ${stageParent}`
    )
  }
}

function createInventory(options) {
  const ctx = toolContext(options)
  const preflightResult = preflight(ctx)
  const registry = loadRegistry(ctx.projectPath)
  const collections = listCollections(ctx)
  const storage = listStorage(ctx, registry.storage_prefixes)
  return {
    appid: ctx.appId,
    environment_id: ctx.envId,
    preflight: preflightResult,
    database: {
      collection_count: collections.length,
      document_count: collections.reduce(
        (sum, item) => sum + Number(item.Count || 0),
        0
      ),
      collections: collections.map(item => ({
        name: item.TableName,
        count: Number(item.Count || 0),
        size: Number(item.Size || 0)
      }))
    },
    storage: {
      registered_prefixes: registry.storage_prefixes,
      object_count: storage.files.length,
      total_bytes: storage.files.reduce(
        (sum, item) => sum + Number(item.Size || 0),
        0
      )
    }
  }
}

module.exports = {
  DEFAULT_APP_ID,
  DEFAULT_ENV_ID,
  createFullBackup,
  createInventory,
  verifyArchive
}
