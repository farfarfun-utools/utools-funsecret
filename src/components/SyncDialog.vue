<script setup lang="ts">
import { reactive, ref } from 'vue'
import type { SyncOptions } from '../env'

const emit = defineEmits<{
  sync: [payload: { direction: 'save' | 'load'; options: SyncOptions }]
}>()

const visible = ref(false)
const running = ref(false)
const error = ref('')

const form = reactive({
  direction: 'save' as 'save' | 'load',
  dbUrl: '',
  cipherKey: '',
})

function open() {
  error.value = ''
  running.value = false
  form.cipherKey = ''
  visible.value = true
}

function close() {
  visible.value = false
  form.cipherKey = ''
  error.value = ''
}

function submit() {
  error.value = ''
  running.value = true
  emit('sync', {
    direction: form.direction,
    options: {
      dbUrl: form.dbUrl.trim(),
      cipherKey: form.cipherKey.trim(),
    },
  })
}

function setResult(err?: string) {
  running.value = false
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
        <span>外部数据库同步</span>
        <button class="btn btn-ghost btn-xs" type="button" @click="close">✕</button>
      </div>

      <form class="dialog-body" @submit.prevent="submit">
        <div v-if="error" class="alert alert-danger">{{ error }}</div>

        <div class="field">
          <label class="field-label">同步方向</label>
          <div class="row-inline">
            <button
              type="button"
              class="btn"
              :class="{ 'btn-primary': form.direction === 'save' }"
              style="flex: 1;"
              @click="form.direction = 'save'"
            >
              保存到外部库（save）
            </button>
            <button
              type="button"
              class="btn"
              :class="{ 'btn-primary': form.direction === 'load' }"
              style="flex: 1;"
              @click="form.direction = 'load'"
            >
              从外部库加载（load）
            </button>
          </div>
        </div>

        <div class="field">
          <label class="field-label">
            <span>数据库 URL（可选）</span>
            <span class="field-hint">留空则自动使用 funsecret db url</span>
          </label>
          <input
            v-model="form.dbUrl"
            class="input"
            type="text"
            placeholder="postgresql://... / mysql+pymysql://... / sqlite:///backup.db"
          />
        </div>

        <div class="field">
          <label class="field-label">
            <span>外部库加密密钥 --cipher-key（可选）</span>
          </label>
          <input
            v-model="form.cipherKey"
            class="input"
            type="password"
            placeholder="32 字节 URL-safe Base64 Fernet 密钥"
            autocomplete="new-password"
          />
        </div>

        <div v-if="!form.cipherKey.trim()" class="alert alert-warn">
          未填写 <code>--cipher-key</code>：<code>save</code> 会以明文写入目标库，<code>load</code> 会按明文读取源库。同步到远端数据库时建议填写加密密钥。
        </div>

        <div class="dialog-footer" style="margin: 4px -16px -14px;">
          <button class="btn" type="button" @click="close">取消</button>
          <button class="btn btn-primary" type="submit" :disabled="running">
            {{ running ? '同步中...' : form.direction === 'save' ? '开始保存' : '开始加载' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
