import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { preview } from 'vite'
import { launch } from './cdp.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'docs/screenshots')
const plugin = JSON.parse(fs.readFileSync(path.join(root, 'utools/plugin.json'), 'utf8'))
fs.mkdirSync(out, { recursive: true })

const DEMO_SCRIPT = `(() => {
  const entries = [
    { path: ['openai', 'prod', 'api_key'], display_path: 'openai prod api_key', gmt_create: '2026-11-20 09:12:00', gmt_modified: '2026-11-26 18:30:12', expire_time: 9999999999 },
    { path: ['openai', 'dev', 'api_key'], display_path: 'openai dev api_key', gmt_create: '2026-11-21 11:05:00', gmt_modified: '2026-11-25 14:22:08', expire_time: 9999999999 },
    { path: ['postgres', 'prod', 'database_url'], display_path: 'postgres prod database_url', gmt_create: '2026-11-18 16:40:00', gmt_modified: '2026-11-27 10:15:44', expire_time: 9999999999 },
    { path: ['mysql', 'staging', 'root', 'password'], display_path: 'mysql staging root password', gmt_create: '2026-11-19 08:20:00', gmt_modified: '2026-11-24 20:11:30', expire_time: 9999999999 },
    { path: ['github', 'ci', 'deploy_token'], display_path: 'github ci deploy_token', gmt_create: '2026-11-27 15:00:00', gmt_modified: '2026-11-27 15:00:00', expire_time: Math.floor(Date.now() / 1000) + 18000 },
    { path: ['aws', 's3', 'prod', 'access_key_id'], display_path: 'aws s3 prod access_key_id', gmt_create: '2026-11-15 13:10:00', gmt_modified: '2026-11-22 17:45:00', expire_time: 9999999999 },
    { path: ['redis', 'prod', 'auth_password'], display_path: 'redis prod auth_password', gmt_create: '2026-11-16 14:30:00', gmt_modified: '2026-11-23 09:05:19', expire_time: 9999999999 },
  ];
  const values = {
    'openai/prod/api_key': 'sk-demo-xxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    'openai/dev/api_key': 'sk-demo-dev-yyyyyyyyyyyyyyyyyyyyyyyy',
    'postgres/prod/database_url': 'postgresql://demo_user:demo_pass@db.example.internal:5432/app',
    'mysql/staging/root/password': 'demo-staging-mysql-pass-9876',
    'github/ci/deploy_token': 'ghp_demoTokenForScreenshotsOnly000000',
    'aws/s3/prod/access_key_id': 'AKIADEMOEXAMPLEKEY01',
    'redis/prod/auth_password': 'demo-redis-secret-token',
  };
  window.utools = {
    setExpendHeight() {},
    copyText() { return true; },
    isDarkColors() { return false; },
  };
  window.funsecret = {
    onEnter() {},
    async detect() {
      return {
        found: true,
        path: '/usr/local/bin/funsecret',
        version: '2.0.1',
        supportsJson: true,
        supportsDelete: true,
        supportsStdin: true,
        error: null,
      };
    },
    async info() {
      return {
        backend: 'sqlite',
        database_url: 'sqlite:////Users/demo/.secret/.funsecret.db',
        database_file: '/Users/demo/.secret/.funsecret.db',
        secret_count: entries.length,
        cipher_key_configured: true,
        mysql_example_url: 'mysql+pymysql://username:password@127.0.0.1:3306/funsecret',
      };
    },
    async list() { return entries; },
    async read(_cfg, categories) { return values[categories.join('/')] || 'demo-secret-value'; },
    async write(_cfg, categories) { return { written: true, path: categories }; },
    async remove() { return true; },
    async clear() { return 0; },
    async sync(_cfg, direction) { return { action: direction, synced: entries.length }; },
    copySecret() {},
    chooseBinary() { return null; },
    chooseDirectory() { return null; },
  };
})();`

const server = await preview({
  root,
  build: { outDir: 'utools/dist' },
  preview: { host: '127.0.0.1', port: 0, open: false },
})

let browser
try {
  const baseUrl = server.resolvedUrls.local[0]
  browser = await launch({ url: 'about:blank' })
  const { session } = browser
  const errors = []
  const externalRequests = []

  session.on('Runtime.exceptionThrown', (event) => {
    errors.push(event.exceptionDetails.exception?.description ?? event.exceptionDetails.text)
  })
  session.on('Runtime.consoleAPICalled', ({ type, args }) => {
    if (type === 'error') {
      errors.push(args.map((a) => a.value ?? a.description ?? '').join(' '))
    }
  })
  session.on('Log.entryAdded', ({ entry }) => {
    if (entry.level === 'error') errors.push(entry.text)
  })
  session.on('Network.requestWillBeSent', ({ request }) => {
    if (/^https?:/.test(request.url) && new URL(request.url).hostname !== '127.0.0.1') {
      externalRequests.push(request.url)
    }
  })

  await session.send('Page.addScriptToEvaluateOnNewDocument', { source: DEMO_SCRIPT })
  await session.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-color-scheme', value: 'light' },
      { name: 'prefers-reduced-motion', value: 'reduce' },
    ],
  })

  async function setViewport(width, height = plugin.pluginSetting.height) {
    await session.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 2,
      mobile: false,
    })
  }

  async function raf(times = 2) {
    for (let i = 0; i < times; i += 1) {
      await session.evaluate('new Promise(resolve => requestAnimationFrame(resolve))')
    }
  }

  async function clickText(text, selector = 'button') {
    const ok = await session.evaluate(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((node) => node.textContent.trim() === ${JSON.stringify(text)});
      if (!el) return false;
      el.click();
      return true;
    })()`)
    assert.equal(ok, true, `找不到按钮: ${text}`)
    await raf(3)
  }

  async function capture(name) {
    await session.evaluate('document.fonts.ready')
    await raf(3)
    const overflow = await session.evaluate('document.documentElement.scrollWidth > window.innerWidth')
    assert.equal(overflow, false, `${name}: 出现横向溢出`)
    const { cssContentSize } = await session.send('Page.getLayoutMetrics')
    assert.ok(
      cssContentSize.height <= plugin.pluginSetting.height,
      `${name}: 页面高度超出 ${plugin.pluginSetting.height}px，实际 ${cssContentSize.height}px`,
    )
    const result = await session.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(result.data, 'base64'))
    process.stdout.write(`${name}.png (${cssContentSize.width} × ${cssContentSize.height})\n`)
  }

  await setViewport(800)
  await session.send('Page.navigate', { url: baseUrl })
  await session.waitForExpression('document.querySelectorAll(".secret-card").length === 7')
  await raf(3)

  // 1. Light mode home
  await capture('home')

  // 2. Add/Edit secret dialog
  await clickText('+ 新增')
  await session.waitForExpression('document.querySelector(".dialog-panel") !== null')
  await capture('editor')
  await clickText('取消')

  // 3. External DB sync dialog
  await clickText('同步')
  await session.waitForExpression('document.querySelector(".dialog-panel") !== null')
  await capture('sync')
  await clickText('取消')

  // 4. Dark mode with one secret revealed inline
  await session.evaluate('document.documentElement.dataset.theme = "dark"')
  await clickText('查看')
  await session.waitForExpression('document.querySelector(".reveal-box") !== null')
  await capture('dark')

  // Verify narrow mobile viewport (375px) has zero horizontal overflow
  await setViewport(375, plugin.pluginSetting.height)
  await raf(3)
  const narrowOverflow = await session.evaluate('document.documentElement.scrollWidth > window.innerWidth')
  assert.equal(narrowOverflow, false, '375px 窄屏出现横向溢出')

  assert.deepEqual(errors, [], '浏览器运行报错')
  assert.deepEqual(externalRequests, [], '不应请求任何外部网络资源')
  process.stdout.write('FunSecret 浏览器检查与 4 张截图全部通过。\n')
} finally {
  await browser?.close()
  await new Promise((resolve) => server.httpServer.close(resolve))
}
