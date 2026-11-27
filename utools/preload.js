const cli = require('./cli.js')

const CONFIG_STORAGE_KEY = 'funsecret_settings_v1'
const enterQueue = []
let enterHandler = null

// 仅在内存缓存分类路径列表（绝不缓存任何密钥明文值），用于 uTools 同步的 mainPush 搜索。
let cachedEntries = []
let lastRefreshAt = 0
let refreshPromise = null
let clipboardClearTimer = null
let lastCopiedValue = null

function loadConfig() {
  try {
    const saved = utools.dbStorage?.getItem?.(CONFIG_STORAGE_KEY)
    if (saved && typeof saved === 'object') return saved
  } catch { /* ignore */ }
  return {}
}

function refreshPathCache(force = false) {
  const now = Date.now()
  if (!force && now - lastRefreshAt < 10000 && cachedEntries.length > 0) {
    return Promise.resolve(cachedEntries)
  }
  if (refreshPromise) return refreshPromise
  const config = loadConfig()
  refreshPromise = cli.listEntries(config)
    .then(entries => {
      cachedEntries = Array.isArray(entries) ? entries : []
      lastRefreshAt = Date.now()
      return cachedEntries
    })
    .catch(() => cachedEntries)
    .finally(() => {
      refreshPromise = null
    })
  return refreshPromise
}

function scheduleClipboardClear(copiedValue, seconds) {
  if (clipboardClearTimer) {
    clearTimeout(clipboardClearTimer)
    clipboardClearTimer = null
  }
  lastCopiedValue = copiedValue
  const ttl = Number(seconds)
  if (!Number.isFinite(ttl) || ttl <= 0) return

  clipboardClearTimer = setTimeout(() => {
    clipboardClearTimer = null
    try {
      const { clipboard } = require('electron')
      if (clipboard.readText() === lastCopiedValue) {
        clipboard.writeText('')
      }
    } catch { /* ignore outside Electron */ }
    lastCopiedValue = null
  }, ttl * 1000)
  clipboardClearTimer.unref?.()
}

function matchEntries(entries, keyword) {
  const q = String(keyword || '').trim().toLowerCase()
  const tokens = q ? q.split(/\s+/).filter(Boolean) : []
  return entries.filter(entry => {
    const joined = (entry.display_path || (entry.path || []).join(' ')).toLowerCase()
    return tokens.every(token => joined.includes(token))
  })
}

utools.onPluginEnter(action => {
  void refreshPathCache(true)
  if (enterHandler) enterHandler(action)
  else enterQueue.push(action)
})

// 主搜索框快捷检索：仅展示路径，选中后按需调用 funsecret read 并复制到剪贴板。
utools.onMainPush?.(
  action => {
    const keyword = String(action?.payload || '').trim()
    void refreshPathCache(false)
    if (!cachedEntries.length) return []
    const matched = matchEntries(cachedEntries, keyword).slice(0, 8)
    return matched.map(entry => ({
      icon: 'logo.png',
      text: entry.path.join(' / '),
      title: entry.gmt_modified ? `更新于 ${entry.gmt_modified} · 回车复制密钥` : '回车按需读取并复制密钥',
      path: entry.path,
    }))
  },
  action => {
    const segments = action?.option?.path
    if (!Array.isArray(segments) || segments.length < 2) return false
    const config = loadConfig()
    cli.readSecret(config, segments)
      .then(value => {
        utools.copyText(value)
        scheduleClipboardClear(value, config.clipboardClearSeconds ?? 30)
        utools.showNotification?.(`已复制 ${segments.join(' / ')}`)
      })
      .catch(err => {
        utools.showNotification?.(`读取失败：${err.message}`)
      })
    return false
  },
)

// AI / MCP 只读路径检索工具：严格遵循规范，绝不返回任何密钥明文值。
utools.registerTool?.('list_secret_paths', async params => {
  const keyword = typeof params?.keyword === 'string' ? params.keyword.trim() : ''
  const entries = await refreshPathCache(true)
  const matched = matchEntries(entries, keyword).slice(0, 50)
  return {
    total: entries.length,
    returned: matched.length,
    items: matched.map(entry => ({
      path: entry.path,
      displayPath: entry.display_path || entry.path.join(' '),
      updatedAt: entry.gmt_modified || null,
    })),
  }
})

window.funsecret = {
  onEnter(callback) {
    enterHandler = callback
    while (enterQueue.length) callback(enterQueue.shift())
  },
  detect(config) {
    return cli.detectCli(config)
  },
  info(config) {
    return cli.getInfo(config)
  },
  async list(config) {
    const entries = await cli.listEntries(config)
    cachedEntries = entries
    lastRefreshAt = Date.now()
    return entries
  },
  read(config, categories) {
    return cli.readSecret(config, categories)
  },
  async write(config, categories, value, expire) {
    const res = await cli.writeSecret(config, categories, value, expire)
    void refreshPathCache(true)
    return res
  },
  async remove(config, categories) {
    const ok = await cli.deleteSecret(config, categories)
    void refreshPathCache(true)
    return ok
  },
  async clear(config) {
    const count = await cli.clearSecrets(config)
    cachedEntries = []
    lastRefreshAt = Date.now()
    return count
  },
  async sync(config, direction, options) {
    const res = await cli.syncDatabase(config, direction, options)
    void refreshPathCache(true)
    return res
  },
  copySecret(value, clearSeconds) {
    utools.copyText(value)
    scheduleClipboardClear(value, clearSeconds)
  },
  chooseBinary() {
    const result = utools.showOpenDialog({
      title: '选择 funsecret 可执行文件',
      properties: ['openFile'],
    })
    return result?.[0] || null
  },
  chooseDirectory() {
    const result = utools.showOpenDialog({
      title: '选择 FUN_SECRET_PATH 目录',
      properties: ['openDirectory'],
    })
    return result?.[0] || null
  },
}
