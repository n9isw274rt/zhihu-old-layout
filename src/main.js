/*
原理（2026-11 实测）：
zhihu 服务端把 A/B 实验结果内联在 <script id="js-initialData" type="text/json"> 里：
  initialState.env.abV2.config.paramMap.wm_pc_Layout = { value: "1", abId: "PC_Layout_final1-3" }
前端读到 value==="1" 就渲染新版「T 形」布局（LeanAppHeaderBar + 左侧浮动图标栏），
否则渲染经典 AppHeader 布局。把 value 改成 "0" 即可。

时序（这才是本脚本的核心，别想当然）：
document-start 执行时 <script id="js-initialData"> 还不存在——它是解析器之后才插入的节点，
没有任何脚本能在它出现之前改它。所以这里分三步：
  1) 立刻用 CSS 把 SSR 已经吐出来的新版头部遮住（HTML 已经到达浏览器，只能遮，拦不住）；
  2) 用 MutationObserver 盯着解析过程，节点一出现就同步改值——这发生在解析期，
     早于所有 defer/async 脚本执行，因此不依赖「知乎恰好在 DOMContentLoaded 之后才读」；
  3) 等经典布局真的渲染出来再揭开，超时兜底。
DOMContentLoaded 只当兜底：万一观察路径没命中（比如元素被 innerHTML 批量插入），还能补一次。
若知乎改版导致 key 不存在，脚本不遮任何东西，页面保持原样。
*/

(function () {
  'use strict';

  var KEY = 'wm_pc_Layout';
  var HIDE_MAX_MS = 4000;      // 补丁失效时的兜底：别让用户一直看着空白头部
  var CLASSIC_WAIT_MS = 4000;

  var styleEl = null;
  var failTimer = null;
  var mo = null;
  var patched = false;
  var warned = false;

  /* ---------- 1. 遮住 SSR 出来的新版头部 ---------- */

  // 首屏 SSR 出来的是新版头部，先把它藏起来，避免约 0.5s 的布局闪烁。
  // 不能挂 class 到 <html>：React 会接管 html 的 class 属性并把它冲掉。
  function hideNew() {
    if (styleEl) return;
    var root = document.head || document.documentElement;
    if (!root) { setTimeout(hideNew, 1); return; }   // document-start 时可能还没有任何节点
    try {
      styleEl = document.createElement('style');
      styleEl.textContent =
        '.LeanAppHeaderBar,.GlobalSideBar{visibility:hidden !important}';
      root.appendChild(styleEl);
    } catch (e) {
      styleEl = null;
      return;
    }
    clearTimeout(failTimer);
    failTimer = setTimeout(unhide, HIDE_MAX_MS);
  }

  function unhide() {
    clearTimeout(failTimer);
    if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
    styleEl = null;
  }

  /* ---------- 2. 解析期就地改开关 ---------- */

  function patchEl(el) {
    try {
      var data = JSON.parse(el.textContent);
      var env = data && data.initialState && data.initialState.env;
      var pm = env && env.abV2 && env.abV2.config && env.abV2.config.paramMap;
      if (!pm || !pm[KEY]) return false;
      // 已经是非实验组就别白改一遍，省一次 JSON.stringify
      if (String(pm[KEY].value) === '1') {
        pm[KEY].value = '0';
        el.textContent = JSON.stringify(data);
      }
      return true;
    } catch (e) {
      // 解析期观察器可能在文本还没全部插进来时就被触发（长内联脚本会分片插入），
      // 这时 JSON.parse 必然失败，等下一次 mutation 重试即可，别刷屏。
      if (!warned) { warned = true; console.warn('[知乎旧版布局] 补丁失败：', e); }
      return false;
    }
  }

  function patchNow() {
    if (patched) return true;
    var el = document.getElementById('js-initialData');
    if (!el) return false;
    patched = patchEl(el);
    if (patched) stopWatch();
    return patched;
  }

  // 观察整棵 document（document-start 时 document 一定存在，documentElement 不一定）
  function startWatch() {
    if (mo) return;
    mo = new MutationObserver(function () { patchNow(); });
    mo.observe(document, { childList: true, subtree: true });
    patchNow();
  }

  function stopWatch() {
    if (mo) { mo.disconnect(); mo = null; }
  }

  /* ---------- 3. 等经典布局渲染出来再揭开 ---------- */

  function whenClassicRender() {
    if (document.querySelector('.AppHeader')) { unhide(); return; }
    var tries = 0;
    var maxTries = Math.ceil(CLASSIC_WAIT_MS / 50);
    var timer = setInterval(function () {
      tries++;
      if (document.querySelector('.AppHeader') || tries > maxTries) {
        clearInterval(timer);
        unhide();
      }
    }, 50);
  }

  /* ---------- 启动 ---------- */

  function onReady() {
    if (!patched) patchNow();       // 兜底：观察器没命中时再补一次
    stopWatch();                    // 之后不再需要盯解析过程
    if (!patched) { unhide(); return; }   // 没有这个开关（知乎改版）→ 立刻还原，不留空白
    whenClassicRender();
  }

  function start() {
    hideNew();
    startWatch();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onReady, true);
    } else {
      onReady();
    }
  }

  start();
})();
