#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PLUGIN_DIR="$ROOT_DIR/utools"
cd "$ROOT_DIR"

command -v node >/dev/null || { echo "error: Node.js is required" >&2; exit 1; }
command -v pnpm >/dev/null || { echo "error: pnpm is required (corepack enable)" >&2; exit 1; }

node -e '
const want = (require("./package.json").engines || {}).node || "";
const match = /^>=\s*(\d+)\.(\d+)\.(\d+)$/.exec(want.trim());
if (!match) {
  console.error(`error: package.json#engines.node 是「${want}」，本脚本只认 >=x.y.z 这种写法`);
  process.exit(2);
}
const need = match.slice(1).map(Number);
const have = process.versions.node.split(".").map(Number);
const diff = need.map((n, i) => have[i] - n).find((d) => d !== 0) || 0;
if (diff < 0) {
  console.error(`error: Node ${want} is required, found ${process.versions.node}`);
  process.exit(1);
}
'

pnpm install --frozen-lockfile

if [ "${SKIP_CHECKS:-0}" = "1" ]; then
  echo "SKIP_CHECKS=1: 跳过 lint / typecheck / test"
else
  pnpm lint
  pnpm typecheck
  pnpm test
fi

for file in "$PLUGIN_DIR"/*.js; do node --check "$file"; done
node -e "JSON.parse(require('fs').readFileSync('$PLUGIN_DIR/plugin.json', 'utf8'))"

node -e '
const fs = require("fs")
const path = require("path")
const [preloadPath, ...workflowPaths] = process.argv.slice(1)
const preload = fs.readFileSync(preloadPath, "utf8")
const required = [...preload.matchAll(/require\(.\.\/([\w.-]+).\)/g)].map(match => match[1])
const fail = message => { console.error(`error: ${message}`); process.exitCode = 1 }
for (const file of required) {
  if (!fs.existsSync(path.join(path.dirname(preloadPath), file))) fail(`preload.js require 了不存在的 ${file}`)
  const pattern = new RegExp(`(^|[\\s/])${file.replace(/\./g, "\\.")}(\\s|$)`, "m")
  for (const workflowPath of workflowPaths) {
    const workflow = fs.readFileSync(workflowPath, "utf8")
    const packsDirectory = /^\s+source:\s*utools\s*$/m.test(workflow)
    if (!packsDirectory && !pattern.test(workflow)) fail(`${path.basename(workflowPath)} 的打包配置没有包含 ${file}`)
  }
}
' "$PLUGIN_DIR/preload.js" .github/workflows/release.yml .github/workflows/ci.yml

node -e '
const fs = require("fs")
const read = file => fs.readFileSync(file, "utf8")
const plugin = JSON.parse(read(process.argv[1]))
const pkg = JSON.parse(read(process.argv[2]))
const changelog = read(process.argv[3])
const panel = read(process.argv[4]).match(/^export const PANEL_HEIGHT = (\d+)$/m)
const fail = message => { console.error(`error: ${message}`); process.exitCode = 1 }
if (plugin.version !== pkg.version) fail(`版本不一致: plugin.json ${plugin.version} vs package.json ${pkg.version}`)
if (!changelog.includes(`\n## ${pkg.version}\n`)) fail(`CHANGELOG.md 里没有 ${pkg.version} 这一节`)
if (!panel) fail("useFunSecret.ts 里找不到 PANEL_HEIGHT")
else if (Number(panel[1]) !== plugin.pluginSetting?.height) {
  fail(`面板高度不一致: plugin.json ${plugin.pluginSetting?.height} vs PANEL_HEIGHT ${panel[1]}`)
}
' "$PLUGIN_DIR/plugin.json" package.json CHANGELOG.md src/composables/useFunSecret.ts

rm -rf -- "$PLUGIN_DIR/dist"
pnpm build

test -f "$PLUGIN_DIR/dist/index.html"
test -f "$PLUGIN_DIR/preload.js"
test -f "$PLUGIN_DIR/cli.js"
test -f "$PLUGIN_DIR/logo.png"
test -f "$PLUGIN_DIR/search.png"
test ! -e "$PLUGIN_DIR/.git" || { echo "error: utools/ 内不应存在 .git" >&2; exit 1; }

echo "uTools plugin ready: $PLUGIN_DIR/plugin.json"
