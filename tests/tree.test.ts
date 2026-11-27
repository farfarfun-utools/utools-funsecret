import { describe, expect, it } from 'vitest'
import type { SecretEntry } from '../src/env'
import {
  buildCategoryGroups,
  filterEntries,
  formatExpiry,
  formatTimestamp,
  suggestLevelOptions,
  validatePathSegments,
} from '../src/lib/tree'

const sample: SecretEntry[] = [
  {
    path: ['openai', 'prod', 'api_key'],
    display_path: 'openai prod api_key',
    gmt_create: '2026-11-27 10:00:00.123456',
    gmt_modified: '2026-11-27 10:00:00.123456',
    expire_time: 9999999999,
  },
  {
    path: ['openai', 'dev', 'api_key'],
    display_path: 'openai dev api_key',
    gmt_create: null,
    gmt_modified: null,
    expire_time: 9999999999,
  },
  {
    path: ['mysql', 'local'],
    display_path: 'mysql local',
    gmt_create: null,
    gmt_modified: null,
    expire_time: 9999999999,
  },
]

describe('tree helpers', () => {
  it('groups entries by first and second category level', () => {
    const groups = buildCategoryGroups(sample)
    expect(groups).toEqual([
      { name: 'mysql', count: 1, children: [] },
      {
        name: 'openai',
        count: 2,
        children: [
          { name: 'dev', count: 1 },
          { name: 'prod', count: 1 },
        ],
      },
    ])
  })

  it('filters entries by category, subCategory, and multi-token keyword', () => {
    expect(filterEntries(sample, { category: 'openai' })).toHaveLength(2)
    expect(filterEntries(sample, { category: 'openai', subCategory: 'prod' })).toHaveLength(1)
    expect(filterEntries(sample, { keyword: 'openai key prod' }).map(e => e.path)).toEqual([
      ['openai', 'prod', 'api_key'],
    ])
  })

  it('suggests autocomplete options per level', () => {
    expect(suggestLevelOptions(sample, [], 0)).toEqual(['mysql', 'openai'])
    expect(suggestLevelOptions(sample, ['openai'], 1)).toEqual(['dev', 'prod'])
    expect(suggestLevelOptions(sample, ['openai', 'prod'], 2)).toEqual(['api_key'])
  })

  it('validates 2 to 5 path segments and rejects invalid delimiters', () => {
    expect(validatePathSegments([' app ', 'prod', '', '', ''])).toEqual(['app', 'prod'])
    expect(() => validatePathSegments(['only-one', '', '', '', ''])).toThrow(/2 至 5/)
    expect(() => validatePathSegments(['a', '', 'c', '', ''])).toThrow(/中间层级/)
    expect(() => validatePathSegments(['a--b', 'c', '', '', ''])).toThrow(/--/)
  })

  it('formats timestamps and expiry badges', () => {
    expect(formatTimestamp('2026-11-27 10:00:00.123456')).toBe('2026-11-27 10:00:00')
    expect(formatExpiry(9999999999, 1700000000).hasExpiry).toBe(false)
    expect(formatExpiry(1700001800, 1700000000)).toEqual({
      label: '30 分钟后过期',
      hasExpiry: true,
      isSoon: true,
    })
  })
})
