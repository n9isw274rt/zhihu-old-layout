// ==UserScript==
// @name         知乎网页版 · 恢复旧版布局（PC Layout 回退）
// @namespace    https://github.com/n9isw274rt/zhihu-old-layout
// @version      1.1.0
// @description  把知乎网页版首页 / 关注 / 热榜的「新版 T 形布局」回退成经典布局（等价于 A/B 开关 wm_pc_Layout 的非实验组）。仅改本机渲染，不修改账号数据。
// @author       n9isw274rt
// @match        https://www.zhihu.com/*
// @run-at       document-start
// @grant        none
// @homepageURL  https://github.com/n9isw274rt/zhihu-old-layout
// @supportURL   https://github.com/n9isw274rt/zhihu-old-layout/issues
// @updateURL    https://raw.githubusercontent.com/n9isw274rt/zhihu-old-layout/dist/zhihu-old-layout.user.js
// @downloadURL  https://raw.githubusercontent.com/n9isw274rt/zhihu-old-layout/dist/zhihu-old-layout.user.js
// ==/UserScript==

/*
原理（2026-11 实测）：
zhihu 服务端把 A/B 实验结果内联在 <script id="js-initialData" type="text/json"> 里：
  initialState.env.abV2.config.paramMap.wm_pc_Layout = { value: "1", abId: "PC_Layout_final1-3" }
前端读到 value==="1" 就渲染新版「T 形」布局（LeanAppHeaderBar + 左侧浮动图标栏 + 加宽内容区），
否则渲染经典 AppHeader 布局。把 value 改成 "0" 即可。

为什么必须"冻整页"而不是只遮头部：
SSR 的 HTML 已经把新版布局画好了，且新版和旧版的差异不止头部——内容区宽度、右侧栏、左侧
浮动图标栏一起变。只遮 .LeanAppHeaderBar 的话，用户仍会看到一帧"新版排布"，就是那个闪一下。

时序（三层，缺一不可）：
  1) document-start 立刻把 <html> 冻住（inline visibility:hidden），任何一帧都不给看；
  2) MutationObserver 盯解析过程，<script id="js-initialData"> 一插入就改值——早于所有
     defer/async 脚本执行，所以不依赖"知乎恰好在 DOMContentLoaded 之后才读"；
  3) 等 .AppHeader（经典头部）真的出现，再解冻；超时兜底，绝不让页面一直白着。
另外留一条只针对 .LeanAppHeaderBar 的常驻 CSS，防的是客户端二次渲染把新版头部又画出来。

若知乎改版导致 key 不存在：DOMContentLoaded 时立刻解冻，页面保持原样，不留白屏。
*/

(function () {
  'use strict';

  var KEY = 'wm_pc_Layout';
  var FREEZE_MAX_MS = 3000;    // 冻住的上限：超过就放行，宁可闪一下也不让用户看白屏
  var CLASSIC_POLL_MS = 32;

  var maskEl = null;
  var frozen = false;
  var freezeTimer = null;
  var mo = null;
  var patched = false;
  var warned = false;

  /* ---------- 1. 冻住整页 ---------- */

  // 用 inline style + important：不依赖 <head> 存在，也不用等样式表加载
  function freeze() {
    if (frozen) return true;
    var de = document.documentElement;
    if (!de) {
      // <html> 还没被解析器创建：等它一出现立刻冻（MutationObserver 走微任务，比 setTimeout 早）
      var boot = new MutationObserver(function () {
        if (freeze()) boot.disconnect();
      });
      boot.observe(document, { childList: true, subtree: true });
      return false;
    }
    de.style.setProperty('visibility', 'hidden', 'important');
    frozen = true;
    freezeTimer = setTimeout(unfreeze, FREEZE_MAX_MS);
    return true;
  }

  function unfreeze() {
    clearTimeout(freezeTimer);
    if (!frozen) return;
    var de = document.documentElement;
    if (de) de.style.removeProperty('visibility');
    frozen = false;
  }

  /* ---------- 2. 常驻遮罩：只针对新版头部 ---------- */

  // 解冻之后如果客户端又把新版头部画出来（二次渲染/接口回填），这一条兜住。
  // 只保留 .LeanAppHeaderBar：它是新版独有的，不会误伤经典布局。
  function installMask() {
    if (maskEl) return;
    var root = document.head || document.documentElement;
    if (!root) { setTimeout(installMask, 1); return; }
    try {
      maskEl = document.createElement('style');
      maskEl.textContent = '.LeanAppHeaderBar{visibility:hidden !important}';
      root.appendChild(maskEl);
    } catch (e) {
      maskEl = null;
    }
  }

  /* ---------- 3. 解析期就地改开关 ---------- */

  function patchEl(el) {
    try {
      var data = JSON.parse(el.textContent);
      var env = data && data.initialState && data.initialState.env;
      var pm = env && env.abV2 && env.abV2.config && env.abV2.config.paramMap;
      if (!pm || !pm[KEY]) return false;
      if (String(pm[KEY].value) === '1') {   // 已经是非实验组就别白改一遍
        pm[KEY].value = '0';
        el.textContent = JSON.stringify(data);
      }
      return true;
    } catch (e) {
      // 长内联脚本会分片插入，文本没插全时 JSON.parse 必然失败，等下次 mutation 重试即可
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

  // 观察整棵 document：document-start 时 document 一定在，documentElement 不一定
  function startWatch() {
    if (mo) return;
    mo = new MutationObserver(function () { patchNow(); });
    mo.observe(document, { childList: true, subtree: true });
    patchNow();   // 万一注入时已经解析过了
  }

  function stopWatch() {
    if (mo) { mo.disconnect(); mo = null; }
  }

  /* ---------- 4. 经典布局到位才解冻 ---------- */

  // 解冻条件（在 DCL 之后才判定，此时 SSR 结构已经稳定）：
  //   a) 经典头部 .AppHeader 出现；或
  //   b) 新版头部 .LeanAppHeaderBar 已经不在 DOM 里（说明本页本来就不是新版布局，
  //      或 React 已经把它换掉了）—— 避免在没有经典头部的页面上白白冻满 3 秒。
  function classicReady() {
    return !!document.querySelector('.AppHeader') || !document.querySelector('.LeanAppHeaderBar');
  }

  function pollClassic() {
    var done = false;
    function check() {
      if (done) return true;
      if (classicReady()) { done = true; unfreeze(); return true; }
      return false;
    }
    if (check()) return;
    // rAF 最早（下一帧），setInterval 兜住 rAF 被节流的情况（后台标签页）
    (function tick() {
      if (check()) return;
      requestAnimationFrame(tick);
    })();
    var iv = setInterval(function () {
      if (check()) clearInterval(iv);
    }, CLASSIC_POLL_MS);
  }

  /* ---------- 启动 ---------- */

  function onReady() {
    if (!patched) patchNow();       // 兜底：观察器没命中时再补一次
    stopWatch();
    if (!patched) { unfreeze(); return; }   // 开关不存在（知乎改版）→ 立刻放行，不留白屏
    pollClassic();
  }

  function start() {
    freeze();
    installMask();
    startWatch();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onReady, true);
    } else {
      onReady();
    }
  }

  start();
})();
