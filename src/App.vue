<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import SecretDialog from './components/SecretDialog.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import SyncDialog from './components/SyncDialog.vue'
import { PANEL_HEIGHT, useFunSecret } from './composables/useFunSecret'
import type { FunSecretConfig, SecretEntry, SyncOptions } from './env'
import { entryKey, formatExpiry, formatPath, formatTimestamp } from './lib/tree'
import logoUrl from '../utools/logo.png'

const secret = useFunSecret()
const {
  settings,
  cliStatus,
  storeInfo,
  entries,
  categoryGroups,
  filteredEntries,
  loading,
  busyKey,
  search,
  selectedCategory,
  selectedSubCategory,
  activeIndex,
  revealed,
  toast,
} = secret

const searchInput = ref<HTMLInputElement | null>(null)
const secretDialog = ref<InstanceType<typeof SecretDialog> | null>(null)
const syncDialog = ref<InstanceType<typeof SyncDialog> | null>(null)
const settingsDialog = ref<InstanceType<typeof SettingsDialog> | null>(null)
const confirmDialog = ref<InstanceType<typeof ConfirmDialog> | null>(null)

function openAdd() {
  secretDialog.value?.open({ defaultCategory: selectedCategory.value || '' })
}

async function openEdit(entry: SecretEntry) {
  try {
    const value = await secret.readForEdit(entry)
    secretDialog.value?.open({ path: entry.path, value })
  } catch (err: any) {
    secret.showToast(err?.message || '读取待编辑密钥失败', true)
  }
}

async function handleSaveSecret(payload: {
  path: string[]
  value: string
  expire: number | null
  originalPath: string[] | null
}) {
  try {
    await secret.saveEntry(payload.path, payload.value, payload.expire, payload.originalPath)
    secretDialog.value?.setResult()
  } catch (err: any) {
    secretDialog.value?.setResult(err?.message || '保存失败')
  }
}

async function handleDelete(entry: SecretEntry) {
  const ok = await confirmDialog.value?.ask({
    title: '删除密钥',
    message: `确定永久删除「${formatPath(entry.path)}」吗？删除后无法恢复。`,
    confirmText: '确认删除',
    danger: true,
  })
  if (ok) {
    await secret.deleteEntry(entry)
  }
}

async function handleSync(payload: { direction: 'save' | 'load'; options: SyncOptions }) {
  try {
    await secret.syncDb(payload.direction, payload.options)
    syncDialog.value?.setResult()
  } catch (err: any) {
    syncDialog.value?.setResult(err?.message || '同步失败')
  }
}

async function handleSaveSettings(next: FunSecretConfig) {
  await secret.updateSettings(next)
}

async function handleClearAll() {
  try {
    await secret.clearAll()
  } catch (err: any) {
    secret.showToast(err?.message || '清空失败', true)
  }
}

function handlePickBinaryFromBanner() {
  const picked = window.funsecret?.chooseBinary()
  if (picked) {
    void secret.updateSettings({ ...settings, binaryPath: picked })
  }
}

function onGlobalKeydown(event: KeyboardEvent) {
  const tag = (event.target as HTMLElement | null)?.tagName
  const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
  if (event.key === '/' && !inInput) {
    event.preventDefault()
    searchInput.value?.focus()
    return
  }
  if (inInput && event.target !== searchInput.value) return
  const list = filteredEntries.value
  if (!list.length) return

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    activeIndex.value = (activeIndex.value + 1) % list.length
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    activeIndex.value = (activeIndex.value - 1 + list.length) % list.length
  } else if (event.key === 'Enter' && document.activeElement === searchInput.value) {
    event.preventDefault()
    const target = list[activeIndex.value]
    if (target) void secret.copyEntry(target)
  }
}

onMounted(() => {
  window.utools?.setExpendHeight?.(PANEL_HEIGHT)
  window.addEventListener('keydown', onGlobalKeydown)
  window.funsecret?.onEnter(action => {
    void secret.refresh().then(() => {
      if (action?.code === 'add-secret') {
        openAdd()
      }
    })
  })
  void secret.refresh()
  searchInput.value?.focus()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
})
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <img :src="logoUrl" alt="FunSecret" class="brand-logo" />
        <span class="brand-title">密藏随行</span>
      </div>

      <div class="search-wrap">
        <input
          ref="searchInput"
          v-model="search"
          class="search-input"
          type="text"
          placeholder="搜索密钥路径（↑↓ 选择，Enter 复制，/ 聚焦）"
        />
        <button v-if="search" class="search-clear" type="button" @click="search = ''">✕</button>
      </div>

      <div class="toolbar-actions">
        <button class="btn btn-primary" type="button" :disabled="!cliStatus?.found" @click="openAdd">
          + 新增
        </button>
        <button class="btn" type="button" :disabled="!cliStatus?.found" @click="syncDialog?.open()">
          同步
        </button>
        <button class="btn" type="button" :disabled="loading" @click="secret.refresh()">
          {{ loading ? '...' : '刷新' }}
        </button>
        <button class="btn" type="button" @click="settingsDialog?.open()">
          设置
        </button>
      </div>
    </header>

    <div class="workspace">
      <aside class="sidebar">
        <div class="sidebar-list">
          <button
            class="nav-item"
            :class="{ active: !selectedCategory }"
            type="button"
            @click="secret.selectCategory('', '')"
          >
            <span class="nav-label">全部密钥</span>
            <span class="nav-count">{{ entries.length }}</span>
          </button>

          <template v-for="group in categoryGroups" :key="group.name">
            <button
              class="nav-item"
              :class="{ active: selectedCategory === group.name && !selectedSubCategory }"
              type="button"
              @click="secret.selectCategory(group.name, '')"
            >
              <span class="nav-label">{{ group.name }}</span>
              <span class="nav-count">{{ group.count }}</span>
            </button>

            <template v-if="selectedCategory === group.name && group.children.length > 0">
              <button
                v-for="child in group.children"
                :key="child.name"
                class="nav-item nav-sub"
                :class="{ active: selectedSubCategory === child.name }"
                type="button"
                @click="secret.selectCategory(group.name, child.name)"
              >
                <span class="nav-label">{{ child.name }}</span>
                <span class="nav-count">{{ child.count }}</span>
              </button>
            </template>
          </template>
        </div>

        <div class="sidebar-footer">
          <div class="status-pill">
            <span class="status-dot" :class="{ offline: !cliStatus?.found }" />
            <span>{{ cliStatus?.found ? `funsecret ${cliStatus.version || ''}` : 'CLI 未连接' }}</span>
          </div>
          <div v-if="storeInfo">
            {{ storeInfo.backend.toUpperCase() }} · {{ storeInfo.secret_count }} 条
          </div>
        </div>
      </aside>

      <main class="main-pane">
        <!-- 未检测到 funsecret CLI -->
        <div v-if="cliStatus && !cliStatus.found" class="empty-state">
          <div class="empty-title">未检测到 funsecret 命令行工具</div>
          <div>{{ cliStatus.error || '请先安装原生 funsecret CLI 或在设置中手动指定路径。' }}</div>
          <pre class="code-block"># 通过 Cargo 安装原生 Rust 版 funsecret CLI
cargo install funsecret

# 或从 GitHub Releases 下载静态二进制放入 PATH</pre>
          <div class="row-inline">
            <button class="btn btn-primary" type="button" @click="handlePickBinaryFromBanner">
              选择可执行文件
            </button>
            <button class="btn" type="button" @click="secret.refresh()">重新检测</button>
            <button class="btn" type="button" @click="settingsDialog?.open()">打开设置</button>
          </div>
        </div>

        <!-- 列表为空 -->
        <div v-else-if="!loading && filteredEntries.length === 0" class="empty-state">
          <div class="empty-title">{{ search ? '没有匹配的密钥路径' : '当前还没有保存任何密钥' }}</div>
          <div v-if="!search">点击右上角「+ 新增」即可按 2–5 级分类写入本地加密密钥库。</div>
          <button v-if="!search" class="btn btn-primary" type="button" @click="openAdd">
            + 写入第一条密钥
          </button>
        </div>

        <!-- 密钥列表 -->
        <div v-else class="list-scroll">
          <article
            v-for="(entry, index) in filteredEntries"
            :key="entryKey(entry.path)"
            class="secret-card"
            :class="{ focused: index === activeIndex }"
            @mouseenter="activeIndex = index"
          >
            <div class="secret-row">
              <div class="secret-meta" title="点击复制密钥" @click="secret.copyEntry(entry)">
                <div class="path-crumbs">
                  <template v-for="(seg, idx) in entry.path" :key="idx">
                    <span v-if="idx > 0" class="crumb-sep">/</span>
                    <span class="crumb" :class="{ leaf: idx === entry.path.length - 1 }">{{ seg }}</span>
                  </template>
                </div>
                <div class="sub-meta">
                  <span v-if="entry.gmt_modified">更新于 {{ formatTimestamp(entry.gmt_modified) }}</span>
                  <span
                    v-if="formatExpiry(entry.expire_time).hasExpiry"
                    class="badge"
                    :class="{ warn: formatExpiry(entry.expire_time).isSoon }"
                  >
                    {{ formatExpiry(entry.expire_time).label }}
                  </span>
                </div>
              </div>

              <div class="card-actions">
                <button
                  class="btn btn-primary btn-xs"
                  type="button"
                  :disabled="busyKey === entryKey(entry.path)"
                  @click="secret.copyEntry(entry)"
                >
                  复制
                </button>
                <button
                  class="btn btn-xs"
                  type="button"
                  :disabled="busyKey === entryKey(entry.path)"
                  @click="secret.toggleReveal(entry)"
                >
                  {{ entryKey(entry.path) in revealed ? '隐藏' : '查看' }}
                </button>
                <button
                  class="btn btn-xs"
                  type="button"
                  :disabled="busyKey === entryKey(entry.path)"
                  @click="openEdit(entry)"
                >
                  编辑
                </button>
                <button
                  v-if="cliStatus?.supportsDelete"
                  class="btn btn-danger btn-xs"
                  type="button"
                  :disabled="busyKey === entryKey(entry.path)"
                  @click="handleDelete(entry)"
                >
                  删除
                </button>
              </div>
            </div>

            <div v-if="entryKey(entry.path) in revealed" class="reveal-box">
              {{ revealed[entryKey(entry.path)] }}
            </div>
          </article>
        </div>
      </main>
    </div>

    <SecretDialog
      ref="secretDialog"
      :entries="entries"
      :supports-stdin="Boolean(cliStatus?.supportsStdin)"
      @save="handleSaveSecret"
    />
    <SyncDialog ref="syncDialog" @sync="handleSync" />
    <SettingsDialog
      ref="settingsDialog"
      :settings="settings"
      :cli-status="cliStatus"
      :store-info="storeInfo"
      @save="handleSaveSettings"
      @clear-all="handleClearAll"
    />
    <ConfirmDialog ref="confirmDialog" />

    <div v-if="toast.visible" class="toast" :class="{ error: toast.error }">
      {{ toast.message }}
    </div>
  </div>
</template>
