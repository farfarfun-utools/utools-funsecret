<script setup lang="ts">
import { reactive, ref } from 'vue'

interface ConfirmOptions {
  title: string
  message: string
  confirmText?: string
  danger?: boolean
}

const visible = ref(false)
const state = reactive<ConfirmOptions>({
  title: '确认操作',
  message: '',
  confirmText: '确认',
  danger: false,
})

let resolver: ((ok: boolean) => void) | null = null

function ask(options: ConfirmOptions): Promise<boolean> {
  state.title = options.title
  state.message = options.message
  state.confirmText = options.confirmText || '确认'
  state.danger = Boolean(options.danger)
  visible.value = true
  return new Promise(resolve => {
    resolver = resolve
  })
}

function finish(ok: boolean) {
  visible.value = false
  const resolve = resolver
  resolver = null
  resolve?.(ok)
}

defineExpose({ ask })
</script>

<template>
  <div v-if="visible" class="dialog-backdrop" @click.self="finish(false)" @keydown.esc="finish(false)">
    <div class="dialog-panel" style="width: min(380px, 100%);" role="dialog" aria-modal="true">
      <div class="dialog-header">
        <span>{{ state.title }}</span>
        <button class="btn btn-ghost btn-xs" type="button" @click="finish(false)">✕</button>
      </div>
      <div class="dialog-body">
        <div style="line-height: 1.55;">{{ state.message }}</div>
      </div>
      <div class="dialog-footer">
        <button class="btn" type="button" @click="finish(false)">取消</button>
        <button
          class="btn"
          :class="state.danger ? 'btn-danger' : 'btn-primary'"
          type="button"
          @click="finish(true)"
        >
          {{ state.confirmText }}
        </button>
      </div>
    </div>
  </div>
</template>
