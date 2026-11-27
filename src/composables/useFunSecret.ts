import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import type { CliDetectResult, FunSecretConfig, SecretEntry, StoreInfo, SyncOptions } from '../env'
import { buildCategoryGroups, entryKey, filterEntries, formatPath } from '../lib/tree'

export const PANEL_HEIGHT = 580
const SETTINGS_KEY = 'funsecret_settings_v1'

export const DEFAULT_CONFIG: FunSecretConfig = {
  binaryPath: '',
  secretPath: '',
  secretUrl: '',
  clipboardClearSeconds: 30,
  revealSeconds: 15,
  theme: 'system',
}

function loadSettings(): FunSecretConfig {
  try {
    const raw = window.utools?.dbStorage?.getItem(SETTINGS_KEY)
    if (raw && typeof raw === 'object') {
      return { ...DEFAULT_CONFIG, ...raw }
    }
    const local = globalThis.localStorage?.getItem(SETTINGS_KEY)
    if (local) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(local) }
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_CONFIG }
}

function saveSettings(config: FunSecretConfig): void {
  const payload: FunSecretConfig = {
    binaryPath: config.binaryPath.trim(),
    secretPath: config.secretPath.trim(),
    secretUrl: config.secretUrl.trim(),
    clipboardClearSeconds: Number(config.clipboardClearSeconds) || 0,
    revealSeconds: Math.max(3, Number(config.revealSeconds) || 15),
    theme: config.theme,
  }
  try {
    if (window.utools?.dbStorage) {
      window.utools.dbStorage.setItem(SETTINGS_KEY, payload)
    } else {
      globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(payload))
    }
  } catch { /* ignore */ }
}

export function applyTheme(theme: FunSecretConfig['theme']): void {
  const root = document.documentElement
  if (theme === 'dark' || theme === 'light') {
    root.dataset.theme = theme
  } else if (window.utools?.isDarkColors) {
    root.dataset.theme = window.utools.isDarkColors() ? 'dark' : 'light'
  } else {
    delete root.dataset.theme
  }
}

export function useFunSecret() {
  const settings = reactive<FunSecretConfig>(loadSettings())
  const cliStatus = ref<CliDetectResult | null>(null)
  const storeInfo = ref<StoreInfo | null>(null)
  const entries = ref<SecretEntry[]>([])
  const loading = ref(false)
  const busyKey = ref('')
  const errorMessage = ref('')

  const search = ref('')
  const selectedCategory = ref('')
  const selectedSubCategory = ref('')
  const activeIndex = ref(0)

  const revealed = reactive<Record<string, string>>({})
  const revealTimers = new Map<string, ReturnType<typeof setTimeout>>()

  const toast = reactive({
    visible: false,
    message: '',
    error: false,
  })
  let toastTimer: ReturnType<typeof setTimeout> | null = null

  function showToast(message: string, isError = false) {
    toast.message = message
    toast.error = isError
    toast.visible = true
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => {
      toast.visible = false
    }, isError ? 3600 : 2200)
  }

  function clearRevealed(key?: string) {
    if (key) {
      delete revealed[key]
      const timer = revealTimers.get(key)
      if (timer) {
        clearTimeout(timer)
        revealTimers.delete(key)
      }
      return
    }
    for (const timer of revealTimers.values()) clearTimeout(timer)
    revealTimers.clear()
    for (const k of Object.keys(revealed)) delete revealed[k]
  }

  const categoryGroups = computed(() => buildCategoryGroups(entries.value))
  const filteredEntries = computed(() =>
    filterEntries(entries.value, {
      category: selectedCategory.value,
      subCategory: selectedSubCategory.value,
      keyword: search.value,
    }),
  )

  watch([search, selectedCategory, selectedSubCategory], () => {
    activeIndex.value = 0
  })

  watch(
    () => settings.theme,
    value => applyTheme(value),
    { immediate: true },
  )

  async function refresh() {
    const bridge = window.funsecret
    if (!bridge) {
      cliStatus.value = {
        found: false,
        path: null,
        version: null,
        supportsJson: false,
        supportsDelete: false,
        supportsStdin: false,
        error: '当前运行在浏览器预览模式，未接入 uTools Preload 宿主环境',
      }
      return
    }

    loading.value = true
    errorMessage.value = ''
    try {
      const detected = await bridge.detect({ ...settings })
      cliStatus.value = detected
      if (!detected.found) {
        storeInfo.value = null
        entries.value = []
        return
      }
      const [infoRes, listRes] = await Promise.all([
        bridge.info({ ...settings }),
        bridge.list({ ...settings }),
      ])
      storeInfo.value = infoRes
      entries.value = listRes
      if (selectedCategory.value && !listRes.some(item => item.path[0] === selectedCategory.value)) {
        selectedCategory.value = ''
        selectedSubCategory.value = ''
      }
    } catch (err: any) {
      errorMessage.value = err?.message || '读取 funsecret 数据失败'
      showToast(errorMessage.value, true)
    } finally {
      loading.value = false
    }
  }

  async function copyEntry(entry: SecretEntry) {
    const bridge = window.funsecret
    if (!bridge) return
    const key = entryKey(entry.path)
    busyKey.value = key
    try {
      const value = await bridge.read({ ...settings }, entry.path)
      bridge.copySecret(value, settings.clipboardClearSeconds)
      const clearTip = settings.clipboardClearSeconds > 0
        ? `（${settings.clipboardClearSeconds}s 后自动清空）`
        : ''
      showToast(`已复制 ${formatPath(entry.path)}${clearTip}`)
    } catch (err: any) {
      showToast(err?.message || '读取密钥失败', true)
    } finally {
      busyKey.value = ''
    }
  }

  async function toggleReveal(entry: SecretEntry) {
    const key = entryKey(entry.path)
    if (key in revealed) {
      clearRevealed(key)
      return
    }
    const bridge = window.funsecret
    if (!bridge) return
    busyKey.value = key
    try {
      const value = await bridge.read({ ...settings }, entry.path)
      revealed[key] = value
      const timer = setTimeout(() => {
        clearRevealed(key)
      }, settings.revealSeconds * 1000)
      revealTimers.set(key, timer)
    } catch (err: any) {
      showToast(err?.message || '读取密钥失败', true)
    } finally {
      busyKey.value = ''
    }
  }

  async function readForEdit(entry: SecretEntry): Promise<string> {
    const bridge = window.funsecret
    if (!bridge) throw new Error('未连接到 funsecret Preload')
    return bridge.read({ ...settings }, entry.path)
  }

  async function saveEntry(
    path: string[],
    value: string,
    expire: number | null = null,
    originalPath: string[] | null = null,
  ) {
    const bridge = window.funsecret
    if (!bridge) throw new Error('未连接到 funsecret Preload')
    await bridge.write({ ...settings }, path, value, expire)

    // 如果用户修改了路径且 CLI 支持 delete，删除旧路径完成重命名
    if (
      originalPath &&
      entryKey(originalPath) !== entryKey(path) &&
      cliStatus.value?.supportsDelete
    ) {
      try {
        await bridge.remove({ ...settings }, originalPath)
      } catch { /* 旧路径可能已不存在 */ }
    }
    clearRevealed()
    await refresh()
    showToast(`已保存 ${formatPath(path)}`)
  }

  async function deleteEntry(entry: SecretEntry) {
    const bridge = window.funsecret
    if (!bridge) return
    const key = entryKey(entry.path)
    busyKey.value = key
    try {
      await bridge.remove({ ...settings }, entry.path)
      clearRevealed(key)
      await refresh()
      showToast(`已删除 ${formatPath(entry.path)}`)
    } catch (err: any) {
      showToast(err?.message || '删除密钥失败', true)
    } finally {
      busyKey.value = ''
    }
  }

  async function syncDb(direction: 'save' | 'load', options: SyncOptions) {
    const bridge = window.funsecret
    if (!bridge) throw new Error('未连接到 funsecret Preload')
    const result = await bridge.sync({ ...settings }, direction, options)
    await refresh()
    const actionLabel = direction === 'save' ? '保存到远端数据库' : '从远端数据库加载'
    const countText = typeof result?.synced === 'number' ? `（${result.synced} 条）` : ''
    showToast(`${actionLabel}完成${countText}`)
    return result
  }

  async function clearAll() {
    const bridge = window.funsecret
    if (!bridge) throw new Error('未连接到 funsecret Preload')
    const count = await bridge.clear({ ...settings })
    clearRevealed()
    await refresh()
    showToast(count > 0 ? `已清空 ${count} 条密钥` : '已清空当前密钥库')
  }

  async function updateSettings(next: FunSecretConfig) {
    Object.assign(settings, next)
    saveSettings(settings)
    applyTheme(settings.theme)
    await refresh()
    showToast('设置已保存')
  }

  function selectCategory(cat: string, sub = '') {
    selectedCategory.value = cat
    selectedSubCategory.value = sub
  }

  onBeforeUnmount(() => {
    clearRevealed()
    if (toastTimer) clearTimeout(toastTimer)
  })

  return {
    settings,
    cliStatus,
    storeInfo,
    entries,
    categoryGroups,
    filteredEntries,
    loading,
    busyKey,
    errorMessage,
    search,
    selectedCategory,
    selectedSubCategory,
    activeIndex,
    revealed,
    toast,
    showToast,
    clearRevealed,
    refresh,
    copyEntry,
    toggleReveal,
    readForEdit,
    saveEntry,
    deleteEntry,
    syncDb,
    clearAll,
    updateSettings,
    selectCategory,
  }
}
