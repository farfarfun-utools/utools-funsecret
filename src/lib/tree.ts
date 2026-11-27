import type { SecretEntry } from '../env'

export interface CategoryGroup {
  name: string
  count: number
  children: Array<{ name: string; count: number }>
}

export function entryKey(path: string[]): string {
  return path.join('\u0000')
}

export function formatPath(path: string[]): string {
  return path.join(' / ')
}

export function buildCategoryGroups(entries: SecretEntry[]): CategoryGroup[] {
  const map = new Map<string, { count: number; children: Map<string, number> }>()

  for (const entry of entries) {
    const first = entry.path[0]
    if (!first) continue
    let group = map.get(first)
    if (!group) {
      group = { count: 0, children: new Map() }
      map.set(first, group)
    }
    group.count += 1
    const second = entry.path[1]
    if (second && entry.path.length > 2) {
      group.children.set(second, (group.children.get(second) || 0) + 1)
    }
  }

  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, data]) => ({
      name,
      count: data.count,
      children: [...data.children.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([childName, count]) => ({ name: childName, count })),
    }))
}

export function filterEntries(
  entries: SecretEntry[],
  { category = '', subCategory = '', keyword = '' }: { category?: string; subCategory?: string; keyword?: string },
): SecretEntry[] {
  const tokens = keyword.trim().toLowerCase().split(/\s+/).filter(Boolean)

  return entries.filter(entry => {
    if (category && entry.path[0] !== category) return false
    if (subCategory && entry.path[1] !== subCategory) return false
    if (!tokens.length) return true
    const haystack = entry.path.join(' ').toLowerCase()
    return tokens.every(token => haystack.includes(token))
  })
}

export function suggestLevelOptions(
  entries: SecretEntry[],
  prefix: string[],
  levelIndex: number,
): string[] {
  const set = new Set<string>()
  const normalizedPrefix = prefix.slice(0, levelIndex).map(p => p.trim())

  for (const entry of entries) {
    if (entry.path.length <= levelIndex) continue
    let matches = true
    for (let i = 0; i < levelIndex; i += 1) {
      if (normalizedPrefix[i] && entry.path[i] !== normalizedPrefix[i]) {
        matches = false
        break
      }
    }
    if (matches) {
      set.add(entry.path[levelIndex])
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}

export function validatePathSegments(rawSegments: string[]): string[] {
  const trimmed = rawSegments.map(s => s.trim())
  let lastNonEmpty = -1
  for (let i = trimmed.length - 1; i >= 0; i -= 1) {
    if (trimmed[i]) {
      lastNonEmpty = i
      break
    }
  }
  const active = trimmed.slice(0, lastNonEmpty + 1)
  if (active.length < 2 || active.length > 5) {
    throw new Error('请填写 2 至 5 级分类路径（例如：openai / prod / api_key）')
  }
  for (let i = 0; i < active.length; i += 1) {
    const part = active[i]
    if (!part) throw new Error(`第 ${i + 1} 级分类不能为空（中间层级不可留空）`)
    if (part.includes('--')) throw new Error('分类路径不能包含 "--"')
    if (/[\r\n\0]/.test(part)) throw new Error('分类路径不能包含换行符')
  }
  return active
}

export function formatTimestamp(value: string | null): string {
  if (!value) return ''
  const trimmed = value.trim()
  const dot = trimmed.indexOf('.')
  return dot > 0 ? trimmed.slice(0, dot) : trimmed
}

export function formatExpiry(expireTime: number, nowSecs = Math.floor(Date.now() / 1000)): {
  label: string
  hasExpiry: boolean
  isSoon: boolean
} {
  if (!Number.isFinite(expireTime) || expireTime <= 0 || expireTime > nowSecs + 365 * 5 * 86400) {
    return { label: '长期有效', hasExpiry: false, isSoon: false }
  }
  const remaining = expireTime - nowSecs
  if (remaining <= 0) {
    return { label: '已过期', hasExpiry: true, isSoon: true }
  }
  if (remaining < 3600) {
    return { label: `${Math.max(1, Math.ceil(remaining / 60))} 分钟后过期`, hasExpiry: true, isSoon: true }
  }
  if (remaining < 86400) {
    return { label: `${Math.ceil(remaining / 3600)} 小时后过期`, hasExpiry: true, isSoon: remaining < 6 * 3600 }
  }
  return { label: `${Math.ceil(remaining / 86400)} 天后过期`, hasExpiry: true, isSoon: remaining < 3 * 86400 }
}

export function generateRandomSecret(length = 24): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*_-'
  const bytes = new Uint8Array(length)
  globalThis.crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < length; i += 1) {
    out += alphabet[bytes[i] % alphabet.length]
  }
  return out
}
