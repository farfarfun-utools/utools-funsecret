<script setup lang="ts">
import { reactive, ref } from 'vue'
import type { CliDetectResult, FunSecretConfig, StoreInfo } from '../env'

const props = defineProps<{
  settings: FunSecretConfig
  cliStatus: CliDetectResult | null
  storeInfo: StoreInfo | null
}>()

const emit = defineEmits<{
  save: [next: FunSecretConfig]
  clearAll: []
}>()

const visible = ref(false)
const clearConfirmText = ref('')
const draft = reactive<FunSecretConfig>({
  binaryPath: '',
  secretPath: '',
  secretUrl: '',
  clipboardClearSeconds: 30,
  revealSeconds: 15,
  theme: 'system',
})

function open() {
  Object.assign(draft, props.settings)
  clearConfirmText.value = ''
  visible.value = true
}

function close() {
  visible.value = false
  clearConfirmText.value = ''
}

function pickBinary() {
  const picked = window.funsecret?.chooseBinary()
  if (picked) draft.binaryPath = picked
}

function pickDirectory() {
  const picked = window.funsecret?.chooseDirectory()
  if (picked) draft.secretPath = picked
}

function submit() {
  emit('save', { ...draft })
  close()
}

function triggerClearAll() {
  if (clearConfirmText.value.trim().toUpperCase() !== 'CLEAR') return
  emit('clearAll')
  close()
}

defineExpose({ open, close })
</script>

<template>
  <div v-if="visible" class="dialog-backdrop" @click.self="close" @keydown.esc="close">
    <div class="dialog-panel" role="dialog" aria-modal="true">
      <div class="dialog-header">
        <span>插件设置与存储状态</span>
        <button class="btn btn-ghost btn-xs" type="button" @click="close">✕</button>
      </div>

      <div class="dialog-body">
        <div v-if="storeInfo || cliStatus" class="info-grid">
          <span class="info-key">CLI 路径</span>
          <span class="info-val">{{ cliStatus?.path || '未检测到' }}</span>
          <span class="info-key">CLI 版本</span>
          <span class="info-val">
            {{ cliStatus?.version || '-' }}
            <span v-if="cliStatus?.found">
              ({{ cliStatus.supportsJson ? 'JSON' : '文本' }} / {{ cliStatus.supportsDelete ? '支持删除' : '旧版无删除' }})
            </span>
          </span>
          <template v-if="storeInfo">
            <span class="info-key">存储后端</span>
            <span class="info-val">{{ storeInfo.backend }} · {{ storeInfo.secret_count }} 条密钥</span>
            <span class="info-key">数据库位置</span>
            <span class="info-val">{{ storeInfo.database_file || storeInfo.database_url }}</span>
          </template>
        </div>

        <div class="field">
          <label class="field-label">
            <span>funsecret 可执行文件路径</span>
            <span class="field-hint">留空则自动探测 PATH 与常见目录</span>
          </label>
          <div class="row-inline">
            <input v-model="draft.binaryPath" class="input" type="text" placeholder="例如：~/.cargo/bin/funsecret 或 /usr/bin/funsecret" />
            <button class="btn" type="button" @click="pickBinary">选择</button>
          </div>
        </div>

        <div class="field">
          <label class="field-label">
            <span>FUN_SECRET_PATH（可选）</span>
            <span class="field-hint">覆盖默认主目录（实际存放在 &lt;目录&gt;/.secret）</span>
          </label>
          <div class="row-inline">
            <input v-model="draft.secretPath" class="input" type="text" placeholder="留空使用系统默认主目录" />
            <button class="btn" type="button" @click="pickDirectory">选择</button>
          </div>
        </div>

        <div class="field">
          <label class="field-label">FUN_SECRET_URL（可选）</label>
          <input v-model="draft.secretUrl" class="input" type="text" placeholder="留空使用本地 ~/.secret/.funsecret.db" />
        </div>

        <div class="row-inline">
          <div class="field" style="flex: 1;">
            <label class="field-label">剪贴板自动清空（秒）</label>
            <select v-model.number="draft.clipboardClearSeconds" class="select">
              <option :value="0">不自动清空</option>
              <option :value="15">15 秒</option>
              <option :value="30">30 秒</option>
              <option :value="60">60 秒</option>
            </select>
          </div>
          <div class="field" style="flex: 1;">
            <label class="field-label">明文查看自动隐藏（秒）</label>
            <select v-model.number="draft.revealSeconds" class="select">
              <option :value="10">10 秒</option>
              <option :value="15">15 秒</option>
              <option :value="30">30 秒</option>
            </select>
          </div>
          <div class="field" style="flex: 1;">
            <label class="field-label">主题</label>
            <select v-model="draft.theme" class="select">
              <option value="system">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </div>
        </div>

        <div class="alert alert-danger" style="display: flex; flex-direction: column; gap: 8px;">
          <div><strong>危险操作：清空本地全部密钥</strong>（执行 <code>funsecret clear --yes</code>，不可恢复）</div>
          <div class="row-inline">
            <input
              v-model="clearConfirmText"
              class="input"
              type="text"
              placeholder="输入 CLEAR 后点击清空"
            />
            <button
              class="btn btn-danger"
              type="button"
              :disabled="clearConfirmText.trim().toUpperCase() !== 'CLEAR'"
              @click="triggerClearAll"
            >
              清空全部
            </button>
          </div>
        </div>
      </div>

      <div class="dialog-footer">
        <button class="btn" type="button" @click="close">取消</button>
        <button class="btn btn-primary" type="button" @click="submit">保存设置</button>
      </div>
    </div>
  </div>
</template>
