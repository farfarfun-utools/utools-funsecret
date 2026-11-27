import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import cli from '../utools/cli.js'

function findBuiltRustBinary(): string | null {
  const exe = process.platform === 'win32' ? 'funsecret.exe' : 'funsecret'
  const funsecretRepo = '/home/bingtao/workspace/github/farfarfun/funsecret'
  const candidates: string[] = []
  if (process.env.CARGO_TARGET_DIR) {
    candidates.push(path.join(process.env.CARGO_TARGET_DIR, 'release', exe))
    candidates.push(path.join(process.env.CARGO_TARGET_DIR, 'debug', exe))
  }
  try {
    const raw = execFileSync('cargo', ['metadata', '--no-deps', '--format-version', '1'], {
      cwd: funsecretRepo,
      encoding: 'utf8',
    })
    const targetDir = JSON.parse(raw).target_directory
    if (targetDir) {
      candidates.push(path.join(targetDir, 'release', exe))
      candidates.push(path.join(targetDir, 'debug', exe))
    }
  } catch { /* ignore */ }
  candidates.push(path.join(funsecretRepo, 'target', 'release', exe))
  candidates.push(path.join(funsecretRepo, 'target', 'debug', exe))
  return candidates.find(file => fs.existsSync(file)) || null
}

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('utools/cli.js', () => {
  it('parses legacy plain-text info and list outputs', () => {
    const parsedInfo = cli.parsePlainInfo([
      'backend: sqlite',
      'database_url: sqlite:////tmp/.funsecret.db',
      'database_file: /tmp/.funsecret.db',
      'secret_count: 3',
      'cipher_key_configured: yes',
    ].join('\n'))
    expect(parsedInfo.backend).toBe('sqlite')
    expect(parsedInfo.secret_count).toBe(3)
    expect(parsedInfo.cipher_key_configured).toBe(true)

    const parsedList = cli.parsePlainList('openai prod api_key\nmysql local root password\n')
    expect(parsedList.map((e: any) => e.path)).toEqual([
      ['openai', 'prod', 'api_key'],
      ['mysql', 'local', 'root', 'password'],
    ])
  })

  it('validates categories strictly', () => {
    expect(cli.validateCategories(['openai', 'prod', 'key'])).toEqual(['openai', 'prod', 'key'])
    expect(() => cli.validateCategories(['only_one'])).toThrow(/2 至 5/)
    expect(() => cli.validateCategories(['a--b', 'c'])).toThrow(/--/)
  })

  it('integrates end-to-end with the native Rust funsecret binary', async () => {
    const binaryPath = findBuiltRustBinary()
    if (!binaryPath) return

    const secretPath = fs.mkdtempSync(path.join(os.tmpdir(), 'utools-funsecret-test-'))
    tempDirs.push(secretPath)
    const config = { binaryPath, secretPath }

    const detected = await cli.detectCli(config)
    expect(detected.found).toBe(true)
    expect(detected.supportsJson).toBe(true)
    expect(detected.supportsDelete).toBe(true)
    expect(detected.supportsStdin).toBe(true)

    const secretValue = '-dash-prefixed\nsecond-line'
    await cli.writeSecret(config, ['openai', 'prod', 'api_key'], secretValue)

    const entries = await cli.listEntries(config)
    expect(entries).toHaveLength(1)
    expect(entries[0].path).toEqual(['openai', 'prod', 'api_key'])
    expect('value' in entries[0]).toBe(false)

    const readBack = await cli.readSecret(config, ['openai', 'prod', 'api_key'])
    expect(readBack).toBe(secretValue)

    const info = await cli.getInfo(config)
    expect(info.backend).toBe('sqlite')
    expect(info.secret_count).toBe(1)

    const backupDb = path.join(secretPath, 'backup.db')
    const syncRes = await cli.syncDatabase(config, 'save', { dbUrl: `sqlite:///${backupDb}` })
    expect(syncRes.synced).toBe(1)

    const deleted = await cli.deleteSecret(config, ['openai', 'prod', 'api_key'])
    expect(deleted).toBe(true)
    expect(await cli.listEntries(config)).toHaveLength(0)

    const loadRes = await cli.syncDatabase(config, 'load', { dbUrl: `sqlite:///${backupDb}` })
    expect(loadRes.synced).toBe(1)
    expect(await cli.readSecret(config, ['openai', 'prod', 'api_key'])).toBe(secretValue)

    const cleared = await cli.clearSecrets(config)
    expect(cleared).toBe(1)
    expect(await cli.listEntries(config)).toHaveLength(0)
  })
})
