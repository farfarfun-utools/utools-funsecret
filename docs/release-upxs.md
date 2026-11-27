# FunSecret `.upxs` 打包与发布说明

本项目通过 GitHub Actions（[.github/workflows/release.yml](../.github/workflows/release.yml)）在推送形如 `v0.1.0` 的标签时自动完成：

1. 校验 `package.json`、`utools/plugin.json` 与标签版本一致；
2. 执行 `sh build.sh`（ESLint、Vue/TypeScript 类型检查、Vitest 单元测试、Vite 构建生成 `utools/dist/index.html`）；
3. 校验 `identity.json` 中的官方 `pluginId` 已填写，并使用组织密钥打包签名 `.upxs`；
4. 上传 `.upxs` 与 `SHA256SUMS` 至 GitHub Release。

## 发布步骤

1. 在 uTools 开发者工具中创建插件并将官方 `pluginId` 填入 [identity.json](../identity.json)；
2. 同步更新 `package.json`、`utools/plugin.json` 与 `CHANGELOG.md` 版本；
3. 推送版本标签触发发布工作流：

```bash
git tag v0.1.0
git push origin v0.1.0
```
