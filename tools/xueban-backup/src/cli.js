#!/usr/bin/env node

const path = require('path')
const {
  DEFAULT_APP_ID,
  DEFAULT_ENV_ID,
  createFullBackup,
  createInventory,
  verifyArchive
} = require('./backup')

function parseArguments(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!argument.startsWith('--')) continue
    const key = argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      options[key] = true
    } else {
      options[key] = next
      index += 1
    }
  }
  return options
}

function usage() {
  console.log(`Usage:
  node src/cli.js inventory [--project <path>] [--env <id>] [--appid <id>]
  node src/cli.js backup --output <path> --key-file <path> [--create-key] [--allow-project-output]
  node src/cli.js verify --archive <path> --key-file <path>
`)
}

async function main() {
  const command = process.argv[2]
  const flags = parseArguments(process.argv.slice(3))
  const defaultProject = path.resolve(__dirname, '../../..')
  const common = {
    projectPath: flags.project || defaultProject,
    appId: flags.appid || DEFAULT_APP_ID,
    envId: flags.env || DEFAULT_ENV_ID,
    wechatide: flags.wechatide
  }

  if (command === 'inventory') {
    console.log(JSON.stringify(createInventory(common), null, 2))
    return
  }

  if (command === 'backup') {
    if (!flags.output || !flags.keyFile) {
      throw new Error('backup requires --output and --key-file')
    }
    const result = await createFullBackup({
      ...common,
      outputDirectory: flags.output,
      keyFile: flags.keyFile,
      createKey: flags.createKey === true,
      allowProjectOutput: flags.allowProjectOutput === true
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }

  if (command === 'verify') {
    if (!flags.archive || !flags.keyFile) {
      throw new Error('verify requires --archive and --key-file')
    }
    const result = await verifyArchive({
      archive: flags.archive,
      keyFile: flags.keyFile
    })
    console.log(JSON.stringify(result, null, 2))
    if (!result.success) process.exitCode = 2
    return
  }

  usage()
  process.exitCode = 1
}

main().catch(error => {
  console.error(`Backup tool failed: ${error.message}`)
  process.exitCode = 1
})
