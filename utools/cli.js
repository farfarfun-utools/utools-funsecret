const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const DEFAULT_TIMEOUT_MS = 15000
const SYNC_TIMEOUT_MS = 60000
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024

function isExecutable(filePath) {
  if (!filePath || typeof filePath !== 'string') return false
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) return false
    if (process.platform === 'win32') return true
    fs.accessSync(filePath, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

function candidatePaths(env = process.env) {
  const binName = process.platform === 'win32' ? 'funsecret.exe' : 'funsecret'
  const home = env.HOME || env.USERPROFILE || os.homedir()
  const pathEnv = env.PATH || env.Path || ''
  const pathDirs = pathEnv.split(path.delimiter).filter(Boolean)

  const extraDirs = process.platform === 'win32'
    ? [
        path.join(home, '.cargo', 'bin'),
        path.join(home, '.local', 'bin'),
        env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Programs', 'funsecret') : '',
      ]
    : [
        path.join(home, '.cargo', 'bin'),
        path.join(home, '.local', 'bin'),
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/bin',
        path.join(home, 'opt', 'py312', 'bin'),
        path.join(home, '.pyenv', 'shims'),
      ]

  const seen = new Set()
  const result = []
  for (const dir of [...pathDirs, ...extraDirs]) {
    if (!dir) continue
    const full = path.join(dir, binName)
    if (!seen.has(full)) {
      seen.add(full)
      result.push(full)
    }
  }
  return result
}

function resolveBinary(customPath, env = process.env) {
  const trimmed = typeof customPath === 'string' ? customPath.trim() : ''
  if (trimmed) {
    const resolved = path.resolve(trimmed)
    if (isExecutable(resolved)) {
      return { found: true, path: resolved, source: 'custom' }
    }
    return { found: false, path: null, source: 'custom', error: `指定的 funsecret 可执行文件不可用：${resolved}` }
  }

  for (const candidate of candidatePaths(env)) {
    if (isExecutable(candidate)) {
      return { found: true, path: candidate, source: 'auto' }
    }
  }
  return { found: false, path: null, source: 'auto', error: '未在系统路径中找到 funsecret 命令' }
}

function buildEnv(config = {}, baseEnv = process.env) {
  const env = { ...baseEnv }
  if (!env.HOME && env.USERPROFILE) {
    env.HOME = env.USERPROFILE
  }
  if (config.secretPath && typeof config.secretPath === 'string' && config.secretPath.trim()) {
    env.FUN_SECRET_PATH = config.secretPath.trim()
  }
  if (config.secretUrl && typeof config.secretUrl === 'string' && config.secretUrl.trim()) {
    env.FUN_SECRET_URL = config.secretUrl.trim()
  }
  return env
}

function validateCategories(categories) {
  if (!Array.isArray(categories) || categories.length < 2 || categories.length > 5) {
    throw new Error('分类路径必须包含 2 至 5 级')
  }
  const normalized = categories.map(part => (typeof part === 'string' ? part.trim() : ''))
  for (const part of normalized) {
    if (!part) throw new Error('分类路径片段不能为空')
    if (part.includes('--')) throw new Error('分类路径片段不能包含 "--"')
    if (/[\r\n\0]/.test(part)) throw new Error('分类路径片段不能包含换行符或空字符')
  }
  return normalized
}

function runCli(binaryPath, args, { env = process.env, stdin = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, {
      shell: false,
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const stdoutChunks = []
    const stderrChunks = []
    let totalBytes = 0
    let finished = false

    const timer = setTimeout(() => {
      if (finished) return
      finished = true
      try { child.kill('SIGKILL') } catch { /* ignore */ }
      reject(new Error(`执行 funsecret 超时（>${Math.round(timeoutMs / 1000)}s）`))
    }, timeoutMs)

    child.stdout.on('data', chunk => {
      totalBytes += chunk.length
      if (totalBytes <= MAX_OUTPUT_BYTES) stdoutChunks.push(chunk)
    })

    child.stderr.on('data', chunk => {
      totalBytes += chunk.length
      if (totalBytes <= MAX_OUTPUT_BYTES) stderrChunks.push(chunk)
    })

    child.once('error', err => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      reject(new Error(`无法启动 funsecret：${err.message}`))
    })

    child.once('close', code => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      resolve({
        code: typeof code === 'number' ? code : 1,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      })
    })

    if (stdin !== null && stdin !== undefined) {
      child.stdin.end(String(stdin), 'utf8')
    } else {
      child.stdin.end()
    }
  })
}

function parsePlainInfo(stdout) {
  const map = {}
  for (const rawLine of stdout.split(/\r?\n/)) {
    const idx = rawLine.indexOf(':')
    if (idx <= 0) continue
    const key = rawLine.slice(0, idx).trim()
    const value = rawLine.slice(idx + 1).trim()
    map[key] = value
  }
  return {
    backend: map.backend || 'unknown',
    database_url: map.database_url || '',
    database_file: map.database_file || null,
    secret_count: Number.parseInt(map.secret_count || '0', 10) || 0,
    cipher_key_configured: map.cipher_key_configured === 'yes' || map.cipher_key_configured === 'true',
    mysql_example_url: map.mysql_example_url || '',
  }
}

function parsePlainList(stdout) {
  const entries = []
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const segments = line.split(/\s+/).filter(Boolean)
    if (segments.length < 2) continue
    entries.push({
      path: segments,
      display_path: segments.join(' '),
      gmt_create: null,
      gmt_modified: null,
      expire_time: 9999999999,
    })
  }
  return entries
}

function extractErrorMessage(result, fallback) {
  const errText = (result.stderr || result.stdout || '').trim()
  if (!errText) return fallback
  return errText.replace(/^error:\s*/i, '').split(/\r?\n/)[0]
}

async function detectCli(config = {}) {
  const resolved = resolveBinary(config.binaryPath)
  if (!resolved.found || !resolved.path) {
    return {
      found: false,
      path: null,
      version: null,
      supportsJson: false,
      supportsDelete: false,
      supportsStdin: false,
      error: resolved.error || '未找到 funsecret 命令',
    }
  }

  const env = buildEnv(config)
  let version = null
  try {
    const verRes = await runCli(resolved.path, ['--version'], { env, timeoutMs: 5000 })
    if (verRes.code === 0) {
      const m = verRes.stdout.trim().match(/funsecret\s+([^\s]+)/i)
      version = m ? m[1] : verRes.stdout.trim()
    }
  } catch { /* ignore */ }

  let helpText = ''
  try {
    const helpRes = await runCli(resolved.path, ['--help'], { env, timeoutMs: 5000 })
    helpText = `${helpRes.stdout}\n${helpRes.stderr}`
  } catch { /* ignore */ }

  let writeHelp = ''
  try {
    const writeRes = await runCli(resolved.path, ['write', '--help'], { env, timeoutMs: 5000 })
    writeHelp = `${writeRes.stdout}\n${writeRes.stderr}`
  } catch { /* ignore */ }

  const supportsDelete = /\bdelete\b/i.test(helpText)
  const supportsStdin = /--stdin/i.test(writeHelp)
  const supportsJson = /--json/i.test(writeHelp)

  return {
    found: true,
    path: resolved.path,
    version,
    supportsJson,
    supportsDelete,
    supportsStdin,
    error: null,
  }
}

async function getInfo(config = {}) {
  const resolved = resolveBinary(config.binaryPath)
  if (!resolved.found || !resolved.path) throw new Error(resolved.error)
  const env = buildEnv(config)

  const jsonRes = await runCli(resolved.path, ['info', '--json'], { env })
  if (jsonRes.code === 0) {
    try {
      return JSON.parse(jsonRes.stdout)
    } catch { /* fallback to plain */ }
  }

  const plainRes = await runCli(resolved.path, ['info'], { env })
  if (plainRes.code !== 0) {
    throw new Error(extractErrorMessage(plainRes, '读取 funsecret 存储信息失败'))
  }
  return parsePlainInfo(plainRes.stdout)
}

async function listEntries(config = {}) {
  const resolved = resolveBinary(config.binaryPath)
  if (!resolved.found || !resolved.path) throw new Error(resolved.error)
  const env = buildEnv(config)

  const jsonRes = await runCli(resolved.path, ['list', '--json'], { env })
  if (jsonRes.code === 0) {
    try {
      const parsed = JSON.parse(jsonRes.stdout)
      if (Array.isArray(parsed)) return parsed
    } catch { /* fallback */ }
  }

  const plainRes = await runCli(resolved.path, ['list'], { env })
  if (plainRes.code !== 0) {
    throw new Error(extractErrorMessage(plainRes, '列出密钥路径失败'))
  }
  return parsePlainList(plainRes.stdout)
}

async function readSecret(config = {}, categories) {
  const normalized = validateCategories(categories)
  const resolved = resolveBinary(config.binaryPath)
  if (!resolved.found || !resolved.path) throw new Error(resolved.error)
  const env = buildEnv(config)

  const jsonRes = await runCli(resolved.path, ['read', '--json', '--', ...normalized], { env })
  if (jsonRes.code === 0) {
    try {
      const parsed = JSON.parse(jsonRes.stdout)
      if (typeof parsed?.value === 'string') return parsed.value
    } catch { /* fallback */ }
  }

  const plainRes = await runCli(resolved.path, ['read', '--', ...normalized], { env })
  if (plainRes.code !== 0) {
    throw new Error(extractErrorMessage(plainRes, '未找到对应密钥'))
  }
  return plainRes.stdout.replace(/\r?\n$/, '')
}

async function writeSecret(config = {}, categories, value, expire = null) {
  const normalized = validateCategories(categories)
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('密钥值不能为空')
  }
  const resolved = resolveBinary(config.binaryPath)
  if (!resolved.found || !resolved.path) throw new Error(resolved.error)
  const env = buildEnv(config)

  const stdinArgs = ['write', '--stdin', '--json']
  if (expire !== null && expire !== undefined && Number.isFinite(Number(expire)) && Number(expire) > 0) {
    stdinArgs.push('--expire', String(Math.floor(Number(expire))))
  }
  stdinArgs.push('--', ...normalized)

  const res = await runCli(resolved.path, stdinArgs, { env, stdin: value })
  if (res.code === 0) return { written: true, path: normalized }

  // 兼容未支持 --stdin 的旧版 CLI
  if (res.code === 2 && /--stdin|--json|no such option|unexpected argument/i.test(res.stderr)) {
    const fallback = await runCli(resolved.path, ['write', '--', value, ...normalized], { env })
    if (fallback.code !== 0) {
      throw new Error(extractErrorMessage(fallback, '写入密钥失败'))
    }
    return { written: true, path: normalized }
  }

  throw new Error(extractErrorMessage(res, '写入密钥失败'))
}

async function deleteSecret(config = {}, categories) {
  const normalized = validateCategories(categories)
  const resolved = resolveBinary(config.binaryPath)
  if (!resolved.found || !resolved.path) throw new Error(resolved.error)
  const env = buildEnv(config)

  const res = await runCli(resolved.path, ['delete', '--json', '--', ...normalized], { env })
  if (res.code === 0) return true
  if (res.code === 2 && /unrecognized|no such command/i.test(res.stderr)) {
    throw new Error('当前 funsecret 版本不支持单条删除，请升级到 Rust 原生版 funsecret')
  }
  throw new Error(extractErrorMessage(res, '删除密钥失败或记录不存在'))
}

async function clearSecrets(config = {}) {
  const resolved = resolveBinary(config.binaryPath)
  if (!resolved.found || !resolved.path) throw new Error(resolved.error)
  const env = buildEnv(config)

  const res = await runCli(resolved.path, ['clear', '--yes', '--json'], { env })
  if (res.code === 0) {
    try {
      const parsed = JSON.parse(res.stdout)
      if (typeof parsed?.cleared === 'number') return parsed.cleared
    } catch { /* ignore */ }
    return 0
  }

  const fallback = await runCli(resolved.path, ['clear', '--yes'], { env })
  if (fallback.code !== 0) {
    throw new Error(extractErrorMessage(fallback, '清空密钥库失败'))
  }
  return 0
}

async function syncDatabase(config = {}, direction, { dbUrl = '', cipherKey = '' } = {}) {
  if (direction !== 'save' && direction !== 'load') {
    throw new Error('同步方向必须是 save 或 load')
  }
  const resolved = resolveBinary(config.binaryPath)
  if (!resolved.found || !resolved.path) throw new Error(resolved.error)
  const env = buildEnv(config)

  const args = [direction, '--json']
  if (cipherKey && typeof cipherKey === 'string' && cipherKey.trim()) {
    args.push('--cipher-key', cipherKey.trim())
  }
  if (dbUrl && typeof dbUrl === 'string' && dbUrl.trim()) {
    args.push(dbUrl.trim())
  }

  const res = await runCli(resolved.path, args, { env, timeoutMs: SYNC_TIMEOUT_MS })
  if (res.code === 0) {
    try {
      return JSON.parse(res.stdout)
    } catch {
      return { action: direction }
    }
  }

  if (res.code === 2 && /--json|no such option/i.test(res.stderr)) {
    const legacyArgs = [direction]
    if (cipherKey && cipherKey.trim()) legacyArgs.push('--cipher-key', cipherKey.trim())
    if (dbUrl && dbUrl.trim()) legacyArgs.push(dbUrl.trim())
    const fallback = await runCli(resolved.path, legacyArgs, { env, timeoutMs: SYNC_TIMEOUT_MS })
    if (fallback.code !== 0) {
      throw new Error(extractErrorMessage(fallback, `数据库 ${direction} 同步失败`))
    }
    return { action: direction }
  }

  throw new Error(extractErrorMessage(res, `数据库 ${direction} 同步失败`))
}

module.exports = {
  buildEnv,
  candidatePaths,
  clearSecrets,
  deleteSecret,
  detectCli,
  getInfo,
  listEntries,
  parsePlainInfo,
  parsePlainList,
  readSecret,
  resolveBinary,
  runCli,
  syncDatabase,
  validateCategories,
  writeSecret,
}
