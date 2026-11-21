/*
原理（2026-11 实测）：
zhihu 服务端把 A/B 实验结果内联在 <script id="js-initialData" type="text/json"> 里：
  initialState.env.abV2.config.paramMap.wm_pc_Layout = { value: "1", abId: "PC_Layout_final1-3" }
前端在 DOMContentLoaded 时 JSON.parse 这段文本，value==="1" 就渲染新版「T 形」布局
（LeanAppHeaderBar + 左侧浮动图标栏），否则渲染经典 AppHeader 布局。
脚本在页面解析完成后、知乎脚本读取之前把 value 改成 "0"。
若知乎改版导致 key 不存在，脚本不会隐藏任何东西，页面保持原样。
*/

(function () {
  'use strict';

  var KEY = 'wm_pc_Layout';
  var HIDE_MAX_MS = 4000;            // 超时兜底：万一补丁没生效就恢复原样
  var styleEl = null;
  var failTimer = null;

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

  function patchInitialData() {
    try {
      var el = document.getElementById('js-initialData');
      if (!el) return false;
      var data = JSON.parse(el.textContent);
      var env = data && data.initialState && data.initialState.env;
      var pm = env && env.abV2 && env.abV2.config && env.abV2.config.paramMap;
      if (!pm || !pm[KEY]) return false;
      if (String(pm[KEY].value) === '1') {
        pm[KEY].value = '0';
        el.textContent = JSON.stringify(data);
      }
      return true;
    } catch (e) {
      console.warn('[知乎旧版布局] 补丁失败：', e);
      return false;
    }
  }

  function whenClassicRender() {
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (document.querySelector('.AppHeader') || tries > 80) {
        clearInterval(timer);
        unhide();
      }
    }, 50);
  }

  function start() {
    hideNew();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        if (patchInitialData()) whenClassicRender();
        else unhide();
      }, true);
    } else {
      if (patchInitialData()) whenClassicRender();
      else unhide();
    }
  }

  start();
})();
