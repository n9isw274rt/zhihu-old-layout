# 知乎网页版 · 恢复旧版布局

Tampermonkey 用户脚本：把知乎网页版的「新版 T 形布局」回退成经典布局，
等价于 A/B 开关 `wm_pc_Layout` 的非实验组。只改本机渲染，不修改账号数据。

## 安装

https://raw.githubusercontent.com/n9isw274rt/zhihu-old-layout/dist/zhihu-old-layout.user.js

装一次即可，之后由 Tampermonkey 按 `@version` 自动更新。

## 原理

知乎把 A/B 实验结果内联在 HTML 里：

```html
<script id="js-initialData" type="text/json">
{"initialState":{"env":{"abV2":{"config":{"paramMap":{
  "wm_pc_Layout":{"value":"1","abId":"PC_Layout_final1-3"}}}}}}}
</script>
```

前端读到 `value === "1"` 就渲染新版布局（`LeanAppHeaderBar` + 左侧浮动图标栏 + 加宽内容区），
否则渲染经典布局（`AppHeader` + 双栏信息流）。把值改成 `"0"` 即可。

## 时序：难点全在这里

SSR 的 HTML 已经把新版布局画好了，而 JS 永远晚于 HTML，所以**没有任何办法"拦住"首次渲染**，
只能先冻住再放行。脚本分三层：

| 时机 | 动作 | 为什么必须这样 |
| --- | --- | --- |
| `document-start` | 给 `<html>` 打 inline `visibility:hidden !important` | 这是最早能生效的时机；不依赖 `<head>` 存在，也不用等样式表 |
| 解析期 | `MutationObserver` 盯到 `#js-initialData` 就改值 | 早于所有 `defer`/`async` 脚本执行，不依赖「知乎恰好在 DOMContentLoaded 之后才读」 |
| 经典布局到位 | 解冻 | `.AppHeader` 出现，或 `.LeanAppHeaderBar` 消失；3 秒上限 |

为什么不是「只遮新版头部」：新旧布局的差异不只是头部——左侧浮动图标栏、内容区宽度、
右侧栏内容全都变。只遮 `.LeanAppHeaderBar` 的话，用户仍会看到一帧新版的**内容排布**：

| 只遮头部（会闪） | 整页冻结（不闪） |
| --- | --- |
| 头部被遮住，但灰色内容区仍是新版排布 | 整页白屏，什么都不透出来 |

兜底逻辑：

- 3 秒还没等到经典布局 → 解冻，宁可闪一下也不让用户一直看白屏；
- `wm_pc_Layout` 这个 key 不存在（知乎改版）→ DOMContentLoaded 时立即解冻，画面保持原样；
- 解冻后仍保留一条只针对 `.LeanAppHeaderBar` 的常驻 CSS，防止客户端二次渲染把新版头部画回来。

## 代价与可调项

首次加载会短暂白屏，窗口 = SSR 到 React 渲染经典布局的耗时（本地 fixture 约 350 ms，
真站取决于知乎的 hydration 速度）。相关常量在 `src/main.js` 顶部：

```js
var FREEZE_MAX_MS = 3000;       // 冻住上限，嫌白得久就调小
var CLASSIC_POLL_MS = 32;       // 解冻轮询间隔（另有 rAF 更快的一路）
```

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
node scripts/build.mjs --version 1.1.0    # 指定版本
```

构建过程会强制校验，任何一条不过就非零退出：

- 元数据块必须在**第一行**、且全局只能有一份（被打包器吃掉头部是最常见的故障）
- `@version` 必须真的被注入成目标版本
- `@updateURL` / `@downloadURL` 必须是 https，`@downloadURL none` 会直接报错
- 写盘后回读，确认没有 BOM、第一行正确、文件不是空壳

## 发版

```bash
git tag v1.1.0
git push origin v1.1.0
```

CI 把 `@version` 覆盖成 tag 里的版本号（`v1.1.0` → `1.1.0`），再把 `dist/` 以
`force_orphan` 方式推到 `dist` 分支——该分支永远只有一个提交，不污染源码历史。

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

- **闪一下新版界面**：说明遮罩盖不全会解冻太早。先确认 `document-start` 是否真的生效
  （TM 设置里的注入模式），再看解冻条件是否被提前满足。
- **每次加载都白屏 3 秒**：`classicReady()` 一直没命中，多半是知乎又改了经典头部的
  class（`.AppHeader`）。此时应能看到新版头部也一直没出现，把 3 秒上限调小当临时缓解。
- **改了代码但没更新**：先看 `@version` 涨没涨；再用浏览器直接打开 `@updateURL`，
  确认拿到的是新版本（raw 有 5 分钟 CDN 缓存）。
- **TM 面板里检查更新失败**：多半是 raw 被墙或 404，改用 jsDelivr 或自建反代。
- **仓库必须是公开的**：私有仓库的 raw 链接需要 token，TM 带不上，等于没有自动更新。
- **构建产物头部被吃掉**：`build.mjs` 会拦住；若换了打包器（vite/rollup/esbuild），
  记得把 `src/header.js` 作为 banner 保留下来。
