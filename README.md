# 知乎网页版 · 恢复旧版布局

Tampermonkey 用户脚本。把知乎网页版首页 / 关注 / 热榜的「新版 T 形布局」回退成经典布局，
等价于 A/B 开关 `wm_pc_Layout` 的非实验组。只改本机渲染，不修改账号数据。

## 安装

https://raw.githubusercontent.com/n9isw274rt/zhihu-old-layout/dist/zhihu-old-layout.user.js

装一次即可，之后 Tampermonkey 会自己按 `@version` 检查更新。

## 目录结构

```
src/header.js                  元数据块，__REPO__ 由构建脚本替换
src/main.js                    脚本主体（不含元数据）
scripts/build.mjs              拼接 + 校验 + 生成 dist/
.github/workflows/release.yml  打 tag → 构建 → 推 dist 分支 → 建 Release
dist/                          构建产物，git 不跟踪，只存在于 dist 分支
```

## 本地构建

```bash
node scripts/build.mjs                    # 版本取 src/header.js 的 @version
node scripts/build.mjs --version 1.0.1    # 指定版本
```

构建过程会强制校验，任何一条不过就非零退出：

- 元数据块必须在**第一行**、且全局只能有一份（被打包器吃掉头部是最常见的故障）
- `@version` 必须真的被注入成目标版本
- `@updateURL` / `@downloadURL` 必须是 https，`@downloadURL none` 会直接报错
- 写盘后回读，确认没有 BOM、第一行正确、文件不是空壳

## 发版

```bash
git tag v1.0.1
git push origin v1.0.1
```

CI 把 `@version` 覆盖成 tag 里的版本号（`v1.0.1` → `1.0.1`），再把 `dist/` 以
`force_orphan` 方式推到 `dist` 分支——`dist` 分支永远只有一个提交，不污染源码历史。

两条铁律：

1. **版本只能变大**。Tampermonkey 不会降级安装，回滚只能发一个更大的版本号。
2. **`@name` / `@namespace` 永远别改**。改了就变成另一个脚本，老用户永远收不到更新。

急着手动重发也可以：`workflow_dispatch` 里填版本号跑一次。

## 自动更新是怎么生效的

Tampermonkey 拉 `@updateURL` → 解析返回文本里的元数据块 → 比较 `@version` →
比本地大就从 `@downloadURL` 下载覆盖。它不跑代码，所以 `@updateURL` 指向
`xxx.meta.js`（只含头部）也完全可以，本项目两者都产出了。

检查间隔在 TM 设置里可调（最短 6 小时一档）且带随机延迟，所以「发版后立刻看到更新」
不现实；要立刻验证就去 TM 面板点该脚本的「检查更新」。

## 换托管地址

只改 `src/header.js` 里 `@updateURL` / `@downloadURL` 两行。可选方案：

| 方案 | 地址形态 | 时效 | 说明 |
| --- | --- | --- | --- |
| raw + 分支（当前） | `raw.githubusercontent.com/<repo>/dist/x.user.js` | CDN 缓存约 5 分钟 | 最简单，国内偶尔拉不动 |
| jsDelivr | `cdn.jsdelivr.net/gh/<repo>@dist/x.user.js` | 分支缓存约 12 小时 | 国内通常更通；发版后 `curl https://purge.jsdelivr.net/gh/<repo>@dist/x.user.js` 立刻刷新。**别用 @tag，tag 永久缓存** |
| 自建反代 + 自定义域名 | 你自己的域名 | 你说了算 | 国内最稳，也不会把发码通道交给第三方 |

`@updateURL` 就是代码分发通道，别指向公共 ghproxy 之类的服务——它随时会挂，
更糟的是它可以给你推任意代码。

## 排错

- **改了代码但没更新**：先看 `@version` 涨没涨；再用浏览器直接打开 `@updateURL`，
  确认拿到的就是新版本（注意 raw 有 5 分钟 CDN 缓存）。
- **TM 面板里版本号变红/检查失败**：多半是 raw 被墙或 404，翻墙后重试，或改用 jsDelivr。
- **仓库必须是公开的**：私有仓库的 raw 链接需要 token，TM 带不上，等于没有自动更新。
- **构建产物头部被吃掉**：`build.mjs` 会拦住，但如果你换了打包器（vite/rollup/esbuild），
  记得把 `src/header.js` 作为 banner 或 `preserveComments` 保留下来。
