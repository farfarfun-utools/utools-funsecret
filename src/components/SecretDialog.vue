<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import type { SecretEntry } from '../env'
import { generateRandomSecret, suggestLevelOptions, validatePathSegments } from '../lib/tree'

const props = defineProps<{
  entries: SecretEntry[]
  supportsStdin: boolean
}>()

const emit = defineEmits<{
  save: [payload: { path: string[]; value: string; expire: number | null; originalPath: string[] | null }]
}>()

const visible = ref(false)
const saving = ref(false)
const error = ref('')
const showValue = ref(false)
const multiline = ref(false)
const originalPath = ref<string[] | null>(null)

const form = reactive({
  cates: ['', '', '', '', ''],
  value: '',
  expirePreset: 'never',
  customExpire: '',
})

const isEdit = computed(() => originalPath.value !== null)

const suggestions = computed(() =>
  [0, 1, 2, 3, 4].map(level => suggestLevelOptions(props.entries, form.cates, level)),
)

function open(init?: { path?: string[]; value?: string; defaultCategory?: string }) {
  error.value = ''
  saving.value = false
  showValue.value = false
  if (init?.path && init.path.length >= 2) {
    originalPath.value = [...init.path]
    form.cates = [0, 1, 2, 3, 4].map(i => init.path?.[i] || '')
    form.value = init.value || ''
    multiline.value = form.value.includes('\n')
  } else {
    originalPath.value = null
    form.cates = [init?.defaultCategory || '', '', '', '', '']
    form.value = ''
    multiline.value = false
  }
  form.expirePreset = 'never'
  form.customExpire = ''
  visible.value = true
}

function close() {
  visible.value = false
  form.value = ''
  error.value = ''
}

function fillRandom() {
  form.value = generateRandomSecret(24)
  showValue.value = true
}

function computeExpire(): number | null {
  if (form.expirePreset === 'never') return null
  if (form.expirePreset === 'custom') {
    const parsed = Number.parseInt(form.customExpire.trim(), 10)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error('自定义过期秒数必须是正整数')
    }
    return parsed
  }
  return Number.parseInt(form.expirePreset, 10)
}

function submit() {
  error.value = ''
  try {
    const path = validatePathSegments(form.cates)
    if (!form.value) {
      throw new Error('密钥值不能为空')
    }
    const expire = computeExpire()
    saving.value = true
    emit('save', { path, value: form.value, expire, originalPath: originalPath.value })
  } catch (err: any) {
    error.value = err?.message || '表单校验失败'
    saving.value = false
  }
}

function setResult(err?: string) {
  saving.value = false
  if (err) {
    error.value = err
  } else {
    close()
  }
}

defineExpose({ open, close, setResult })
</script>

<template>
  <div v-if="visible" class="dialog-backdrop" @click.self="close" @keydown.esc="close">
    <div class="dialog-panel" role="dialog" aria-modal="true">
      <div class="dialog-header">
        <span>{{ isEdit ? '编辑密钥' : '新增密钥' }}</span>
        <button class="btn btn-ghost btn-xs" type="button" @click="close">✕</button>
      </div>

      <form class="dialog-body" @submit.prevent="submit">
        <div v-if="error" class="alert alert-danger">{{ error }}</div>

        <div class="field">
          <div class="field-label">
            <span>分类路径（2–5 级）</span>
            <span class="field-hint">示例：openai / prod / api_key</span>
          </div>
          <div class="path-grid">
            <template v-for="idx in 5" :key="idx">
              <input
                v-model="form.cates[idx - 1]"
                class="input"
                type="text"
                :list="`cate-list-${idx}`"
                :placeholder="idx <= 2 ? `分类 ${idx} *` : `分类 ${idx}（可选）`"
                autocomplete="off"
              />
              <datalist :id="`cate-list-${idx}`">
                <option v-for="opt in suggestions[idx - 1]" :key="opt" :value="opt" />
              </datalist>
            </template>
          </div>
        </div>

        <div class="field">
          <div class="field-label">
            <span>密钥值</span>
            <div class="row-inline">
              <button class="btn btn-ghost btn-xs" type="button" @click="fillRandom">随机生成</button>
              <button class="btn btn-ghost btn-xs" type="button" @click="multiline = !multiline">
                {{ multiline ? '单行' : '多行' }}
              </button>
              <button v-if="!multiline" class="btn btn-ghost btn-xs" type="button" @click="showValue = !showValue">
                {{ showValue ? '隐藏' : '明文' }}
              </button>
            </div>
          </div>
          <textarea
            v-if="multiline"
            v-model="form.value"
            class="textarea"
            placeholder="输入多行密钥、证书或 JSON 凭据..."
          />
          <input
            v-else
            v-model="form.value"
            class="input"
            :type="showValue ? 'text' : 'password'"
            placeholder="输入密钥值（通过 stdin 安全传递，不进入命令行参数）"
            autocomplete="new-password"
          />
        </div>

        <div v-if="supportsStdin" class="field">
          <label class="field-label">有效期</label>
          <div class="row-inline">
            <select v-model="form.expirePreset" class="select">
              <option value="never">长期有效</option>
              <option value="3600">1 小时</option>
              <option value="86400">24 小时</option>
              <option value="604800">7 天</option>
              <option value="2592000">30 天</option>
              <option value="custom">自定义秒数</option>
            </select>
            <input
              v-if="form.expirePreset === 'custom'"
              v-model="form.customExpire"
              class="input"
              type="number"
              min="1"
              placeholder="秒数"
            />
          </div>
        </div>

        <div class="dialog-footer" style="margin: 4px -16px -14px;">
          <button class="btn" type="button" @click="close">取消</button>
          <button class="btn btn-primary" type="submit" :disabled="saving">
            {{ saving ? '保存中...' : '保存' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
