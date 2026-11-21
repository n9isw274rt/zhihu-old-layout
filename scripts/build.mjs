#!/usr/bin/env node
/**
 * 构建油猴脚本：
 *   src/header.js（元数据块，含 __REPO__ / @version 占位）
 * + src/main.js（脚本主体）
 *   → dist/zhihu-old-layout.user.js   完整脚本（给 @downloadURL / 安装用）
 *   → dist/zhihu-old-layout.meta.js   只有元数据块（给 @updateURL 用，省流量）
 *
 * 用法：
 *   node scripts/build.mjs                    # 版本取 src/header.js 里的 @version
 *   node scripts/build.mjs --version 1.0.1    # 显式指定（本地发版）
 *   US_REPO=user/repo node scripts/build.mjs  # 覆盖 package.json 的 repository
 *
 * 在 GitHub Actions 里：
 *   - 版本号自动取 tag（v1.0.1 → 1.0.1）
 *   - __REPO__ 没被替换（还是 OWNER/REPO）会直接失败，防止发布出坏链接
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const SLUG = 'zhihu-old-layout';
const DIST = join(ROOT, 'dist');
const IS_CI = process.env.CI === 'true' || !!process.env.GITHUB_ACTIONS;

const fail = (msg) => {
  console.error(`\n\x1b[31m✗ ${msg}\x1b[0m\n`);
  process.exit(1);
};
const warn = (msg) => console.warn(`\x1b[33m⚠ ${msg}\x1b[0m`);

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

/* ---------- repo / owner ---------- */

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
let repo = arg('repo') || process.env.US_REPO || String(pkg.repository ?? '').replace(/^github:/, '');

if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
  fail(`package.json 的 repository 不是 owner/repo 形式：${JSON.stringify(repo)}`);
}
if (/OWNER|REPO_NAME/i.test(repo)) {
  if (IS_CI) fail(`repository 还是占位符（${repo}），CI 里拒绝发布，先改成真实的 owner/repo`);
  warn(`repository 还是占位符（${repo}），产物里的更新链接不可用`);
}

/* ---------- 版本号 ---------- */

const headerSrc = readFileSync(join(ROOT, 'src/header.js'), 'utf8');
const headerVersion = /^\/\/ @version\s+(\S+)/m.exec(headerSrc)?.[1];

let version = arg('version');
if (!version && process.env.GITHUB_REF_NAME) {
  version = process.env.GITHUB_REF_NAME.replace(/^refs\/tags\//, '').replace(/^v/, '');
}
version ??= headerVersion;

if (!version) fail('拿不到版本号：src/header.js 里写 @version，或用 --version 指定');
// Tampermonkey 按点分数字比较：1.0.10 > 1.0.9，所以别用日期以外的花样
if (!/^\d+(\.\d+){0,3}(-[0-9A-Za-z.-]+)?$/.test(version)) {
  fail(`版本号格式不合法：${version}（建议 1.2.3 或 1.2.3.4，只加不减）`);
}
if (headerVersion && version === headerVersion && !arg('version')) {
  warn(`版本号仍是 ${version}：如果之前已经发布过这个版本，用户不会收到更新（TM 只认更大的版本）`);
}

/* ---------- 拼装 ---------- */

const norm = (s) => s.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

let header = norm(headerSrc);
if (!header.startsWith('// ==UserScript==')) fail('src/header.js 的第一行必须是 // ==UserScript==');
if (!/^\/\/ ==\/UserScript==$/m.test(header)) fail('src/header.js 缺少结束行 // ==/UserScript==');

header = header
  .replaceAll('__REPO__', repo)
  .replace(/^\/\/ @version\s+.*$/m, `// @version      ${version}`)
  .trimEnd()
  .concat('\n');

const body = norm(readFileSync(join(ROOT, 'src/main.js'), 'utf8'));
if (/==UserScript==|==\/UserScript==/.test(body)) {
  fail('src/main.js 里出现了 ==UserScript==，元数据块只能有一份（否则 TM 解析会错位）');
}

/* ---------- 元数据校验 ---------- */

const meta = new Map();
for (const line of header.split('\n')) {
  const m = /^\/\/ @(\S+)\s+(.*)$/.exec(line);
  if (!m) continue;
  const [, key, val] = m;
  meta.set(key, meta.has(key) ? [].concat(meta.get(key), val.trim()) : val.trim());
}

for (const key of ['name', 'namespace', 'version', 'match', 'updateURL', 'downloadURL']) {
  if (!meta.has(key)) fail(`元数据缺少 @${key}`);
}
if (meta.get('version') !== version) fail(`@version 注入失败：${meta.get('version')} !== ${version}`);
if (meta.get('downloadURL') === 'none') fail('@downloadURL none 会关闭自动更新');

for (const key of ['updateURL', 'downloadURL', 'namespace', 'homepageURL', 'supportURL']) {
  const raw = meta.get(key);
  if (!raw) continue;
  let url;
  try {
    url = new URL([].concat(raw)[0]);
  } catch {
    fail(`@${key} 不是合法 URL：${raw}`);
  }
  if (url.protocol !== 'https:') fail(`@${key} 必须用 https：${url.href}`);
  // 只有更新通道必须是直链；namespace/homepage/support 本来就是给人看的页面
  if (key.endsWith('URL') && key !== 'homepageURL' && key !== 'supportURL'
      && url.hostname === 'github.com' && !/\/(raw|releases)\//.test(url.pathname)) {
    warn(`@${key} 指向 github.com 页面而不是直链，TM 拉到的是 HTML：${url.href}`);
  }
  if (url.hostname.endsWith('github.io')) {
    warn(`@${key} 用了 GitHub Pages，CDN 缓存比 raw 更久，发版后可能要等一会儿`);
  }
  if (url.hostname.includes('jsdelivr') && /@v?\d+(\.\d+)*\//.test(url.pathname)) {
    warn(`@${key} 的 jsDelivr 链接用了 tag，tag 是永久缓存，等于永不更新；请换成分支名`);
  }
}

/* ---------- 产出 ---------- */

const out = `${header}\n${body.trimEnd()}\n`;

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

const files = [
  [`${SLUG}.user.js`, out],
  [`${SLUG}.meta.js`, header],
];
for (const [name, content] of files) {
  writeFileSync(join(DIST, name), content, 'utf8');
  // 回读一次，确保真的落盘、没有 BOM、第一行正确
  const back = readFileSync(join(DIST, name), 'utf8');
  if (back.charCodeAt(0) === 0xfeff) fail(`${name} 带 BOM，TM 会识别不到元数据`);
  if (!back.startsWith('// ==UserScript==')) fail(`${name} 第一行不是 // ==UserScript==`);
  if (back.length < 200) fail(`${name} 只有 ${back.length} 字节，明显不对`);
  if ((back.match(/==UserScript==/g) ?? []).length !== 1) fail(`${name} 里元数据块不止一个`);
}

/* ---------- 报告 ---------- */

const url = meta.get('downloadURL');
const update = meta.get('updateURL');
console.log('');
console.log(`  \x1b[32m✓\x1b[0m v${version}  →  ${repo}`);
console.log(`    dist/${SLUG}.user.js  \x1b[2m${Buffer.byteLength(out)} B\x1b[0m`);
console.log(`    dist/${SLUG}.meta.js  \x1b[2m${Buffer.byteLength(header)} B\x1b[0m`);
console.log('');
console.log(`    安装     \x1b[36m${[].concat(url)[0]}\x1b[0m`);
if ([].concat(update)[0] !== [].concat(url)[0]) {
  console.log(`    更新检查 \x1b[36m${[].concat(update)[0]}\x1b[0m`);
}
console.log('');
