/**
 * Touch Defense Module — 移动端长按防御方案
 * ============================================
 * 目标：彻底消除 iOS Safari / Android Chrome 长按元素时的系统默认干扰，
 *       包括上下文菜单、文本选择、图片保存弹窗，同时不影响自定义 touch 交互。
 *
 * 架构设计：
 *   CSS 层 → 从渲染层面封死系统行为（touch-callout / user-select）
 *   JS  层 → 从事件层面拦截漏网之鱼（contextmenu / selectstart）
 *
 * 兼容性：iOS Safari 9+、Android Chrome 49+、Samsung Internet、UC Browser
 */

(function () {
  'use strict';

  // 防止重复注入
  if (window.__TOUCH_DEFENSE_INJECTED__) return;
  window.__TOUCH_DEFENSE_INJECTED__ = true;

  // =====================================================================
  //  常量 & 配置
  // =====================================================================

  const DEFENSE_STYLE_ID = 'css-inspector-touch-defense';

  /**
   * CSS 防御样式表
   * ---------------------------------------------------------------
   * 属性说明：
   *
   * -webkit-touch-callout: none
   *   → iOS Safari 专属。禁用长按弹出的系统菜单（"拷贝 / 查找 / 共享"）。
   *     这是 iOS 上唯一能从根源阻止 callout 弹窗的 CSS 属性。
   *     Android 不识别此属性，但写上不影响。
   *
   * -webkit-user-select: none  /  user-select: none
   *   → 禁用文本选择和放大镜效果。
   *     -webkit- 前缀确保在旧版 WebKit 内核浏览器中生效。
   *     标准属性 user-select 兼容新版 Chrome/Firefox。
   *
   * -webkit-tap-highlight-color: transparent
   *   → 消除 Android Chrome 点击时的蓝色/灰色半透明闪烁高亮。
   *     不会影响自定义的变色逻辑。
   *
   * touch-action: manipulation
   *   → 只允许 pan（滚动）和 pinch-zoom（缩放），
   *     告知浏览器不需要等待 300ms 来判断双击缩放，从而加速 touch 响应。
   *     不会阻止 touchstart / touchmove / touchend 的捕获。
   *
   * img 特殊处理：
   *   pointer-events: none（仅在检查模式激活时）
   *   → 使图片不响应任何指针事件，
   *     从根源阻止长按图片弹出"保存图片 / 识别二维码"的系统菜单。
   *   -webkit-user-drag: none
   *   → 禁止拖拽图片（WebKit 系浏览器）。
   */
  const DEFENSE_CSS = `
    /* === Touch Defense: 全局长按防御 === */
    *,
    *::before,
    *::after {
      -webkit-touch-callout: none !important;
      -webkit-user-select: none !important;
      -khtml-user-select: none !important;
      -moz-user-select: none !important;
      -ms-user-select: none !important;
      user-select: none !important;
    }

    /* === 消除 Android Chrome 点击高亮 === */
    body {
      -webkit-tap-highlight-color: transparent !important;
    }

    /* === 优化触摸响应，消除 300ms 延迟 === */
    html {
      touch-action: manipulation;
    }

    /* === 图片长按保护 === */
    img,
    svg,
    picture,
    video,
    canvas,
    [style*="background-image"] {
      -webkit-touch-callout: none !important;
      -webkit-user-select: none !important;
      user-select: none !important;
      -webkit-user-drag: none !important;
    }

    /* === 检查模式激活时，图片完全不响应指针 === */
    body.css-inspector-active img,
    body.css-inspector-active svg,
    body.css-inspector-active picture,
    body.css-inspector-active video,
    body.css-inspector-active canvas {
      pointer-events: none !important;
    }
  `;

  // =====================================================================
  //  CSS 层防御
  // =====================================================================

  /**
   * 注入防御样式表到页面 <head>
   * 使用 <style> 标签注入，确保优先级高于页面自身样式（!important）。
   */
  function injectDefenseStyles() {
    // 幂等：如果已经存在则跳过
    if (document.getElementById(DEFENSE_STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = DEFENSE_STYLE_ID;
    style.textContent = DEFENSE_CSS;

    // 优先插入到 <head> 尾部，确保最高优先级
    const head = document.head || document.documentElement;
    head.appendChild(style);
  }

  /**
   * 移除防御样式表（卸载时调用）
   */
  function removeDefenseStyles() {
    const style = document.getElementById(DEFENSE_STYLE_ID);
    if (style && style.parentNode) {
      style.parentNode.removeChild(style);
    }
  }

  // =====================================================================
  //  JS 层防御 — 事件拦截
  // =====================================================================

  /**
   * 为什么需要 { passive: false }？
   * ---------------------------------------------------------------
   * 从 Chrome 56 / Safari 11.1 开始，浏览器对 touchstart 和 touchmove
   * 事件默认假设监听器是 passive（被动）的——即不会调用 preventDefault()。
   *
   * 这个优化允许浏览器在 JS 处理事件的同时立即开始滚动合成（compositor
   * scrolling），提升滚动流畅度。但副作用是：如果你在 passive listener
   * 中调用 preventDefault()，浏览器会忽略它并抛出控制台警告：
   *
   *   "Unable to preventDefault inside passive event listener invocation."
   *
   * 对于 contextmenu 和 selectstart 事件，虽然它们不像 touch 事件那样
   * 被默认标记为 passive，但显式声明 { passive: false } 是一种**防御性编程**，
   * 确保在任何浏览器版本、任何 polyfill 环境下，preventDefault() 都能生效。
   *
   * 总结：
   *   passive: true  → "我保证不调 preventDefault()"  → 浏览器可以优化滚动
   *   passive: false → "我可能要调 preventDefault()"   → 浏览器必须等我处理完
   *
   * 我们对 contextmenu / selectstart 需要调用 preventDefault()，
   * 所以必须显式传 { passive: false }。
   */

  /** 存储所有已注册的防御监听器引用，便于卸载 */
  const registeredListeners = [];

  /**
   * 安全地添加可卸载的事件监听器
   * @param {EventTarget} target   监听目标
   * @param {string}      event    事件名
   * @param {Function}    handler  处理函数
   * @param {object}      options  addEventListener 选项
   */
  function addDefenseListener(target, event, handler, options) {
    target.addEventListener(event, handler, options);
    registeredListeners.push({ target, event, handler, options });
  }

  /**
   * 拦截 contextmenu 事件
   * ---------------------------------------------------------------
   * contextmenu 在移动端的触发场景：
   *   - iOS Safari：长按 ~500ms 后触发
   *   - Android Chrome：长按 ~800ms 后触发
   *
   * preventDefault() 会阻止系统上下文菜单弹出。
   * capture: true 确保在事件到达任何子元素之前就被拦截。
   */
  function blockContextMenu(e) {
    // 只在检查模式激活时阻止（通过检查 body class）
    if (!document.body.classList.contains('css-inspector-active')) return;

    e.preventDefault();
    e.stopPropagation();
    return false;
  }

  /**
   * 拦截 selectstart 事件
   * ---------------------------------------------------------------
   * selectstart 在用户开始选择文本时触发。
   * 移动端长按会先触发 selectstart → 开始选择 → 弹出放大镜/菜单。
   *
   * 在捕获阶段拦截它，就能从源头阻止文本选择链路启动。
   */
  function blockSelectStart(e) {
    if (!document.body.classList.contains('css-inspector-active')) return;

    e.preventDefault();
    e.stopPropagation();
    return false;
  }

  /**
   * 拦截 dragstart 事件（补充防御）
   * ---------------------------------------------------------------
   * 某些 Android 浏览器（如三星 Internet）在长按图片时会触发 dragstart。
   * 阻止它可以防止图片被拖拽出页面。
   */
  function blockDragStart(e) {
    if (!document.body.classList.contains('css-inspector-active')) return;

    // 只对媒体元素阻止拖拽
    const tag = e.target.tagName;
    if (tag === 'IMG' || tag === 'SVG' || tag === 'VIDEO' || tag === 'CANVAS') {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  /**
   * 注册所有 JS 层防御监听器
   */
  function attachDefenseListeners() {
    // ---- contextmenu：阻止长按弹出系统菜单 ----
    addDefenseListener(document, 'contextmenu', blockContextMenu, {
      capture: true,     // 捕获阶段拦截，优先于任何子元素
      passive: false     // 必须：允许 preventDefault() 生效
    });

    // ---- selectstart：阻止长按触发文本选择 ----
    addDefenseListener(document, 'selectstart', blockSelectStart, {
      capture: true,
      passive: false
    });

    // ---- dragstart：阻止图片拖拽（补充） ----
    addDefenseListener(document, 'dragstart', blockDragStart, {
      capture: true,
      passive: false
    });

    /**
     * 【交互保留声明】
     * ---------------------------------------------------------------
     * 以下事件 **不做任何拦截**，确保自定义变色逻辑正常运行：
     *
     *   ✅ touchstart  — 触摸开始（用于识别长按/点选目标元素）
     *   ✅ touchmove   — 触摸滑动（用于取消长按 / 滑动选择）
     *   ✅ touchend    — 触摸结束（用于确认选中 / 触发变色）
     *   ✅ click       — 点击（PC 端兼容）
     *   ✅ pointerdown / pointermove / pointerup — Pointer Events
     *
     * 本模块只拦截 contextmenu / selectstart / dragstart，
     * 这三个事件与 touch 系列事件在事件流中是独立的：
     *
     *   touchstart → touchend → click → (contextmenu 是独立的长按产物)
     *
     * 因此，阻止 contextmenu 不会影响 touch 事件链。
     */
  }

  /**
   * 移除所有 JS 层防御监听器（卸载时调用）
   */
  function detachDefenseListeners() {
    registeredListeners.forEach(({ target, event, handler, options }) => {
      target.removeEventListener(event, handler, options);
    });
    registeredListeners.length = 0;
  }

  // =====================================================================
  //  公共 API
  // =====================================================================

  /**
   * 激活防御（进入检查模式时调用）
   * 同时在 <body> 上添加标记 class，供 CSS 和 JS 判断状态。
   */
  function activate() {
    document.body.classList.add('css-inspector-active');
    injectDefenseStyles();
    attachDefenseListeners();
  }

  /**
   * 停用防御（退出检查模式时调用）
   * 移除所有注入的样式和监听器，还原页面原始行为。
   */
  function deactivate() {
    document.body.classList.remove('css-inspector-active');
    removeDefenseStyles();
    detachDefenseListeners();
  }

  /**
   * 销毁模块（完全卸载，清除所有痕迹）
   */
  function destroy() {
    deactivate();
    delete window.__TOUCH_DEFENSE_INJECTED__;
  }

  // =====================================================================
  //  挂载到全局（供 content_script.js 调用）
  // =====================================================================

  window.__TouchDefense__ = {
    activate,
    deactivate,
    destroy
  };

})();
