/**
 * Content Script - 页面注入脚本
 * 负责元素选择、高亮、CSS 修改应用和与 panel 通信
 */

(function() {
  'use strict';

  // 防止重复注入
  if (window.__CSS_INSPECTOR_INJECTED__) {
    return;
  }
  window.__CSS_INSPECTOR_INJECTED__ = true;

  // === 状态管理 ===
  const state = {
    isPickingMode: false,
    selectedElement: null,
    hoveredElement: null,
    modifications: new Map(), // 存储修改历史: element -> {selector, changes: []}
    highlightOverlay: null,
    selectedOverlay: null,
    spacingOverlays: [], // 间距显示层
    spacingDebounceTimer: null,
    hoverDebounceTimer: null // 蓝框悬停延时定时器
  };

  // === 创建高亮覆盖层 ===
  function createOverlay(type) {
    const overlay = document.createElement('div');
    overlay.className = `css-inspector-overlay css-inspector-${type}`;
    overlay.style.cssText = `
      position: absolute;
      pointer-events: none;
      z-index: 2147483647;
      box-sizing: border-box;
      ${type === 'hover' ? 'border: 3px solid #4A90E2;' : 'border: 3px solid #FF6B35;'}
      ${type === 'hover' ? 'background: rgba(74, 144, 226, 0.15);' : 'background: rgba(255, 107, 53, 0.2);'}
      transition: all 0.15s ease;
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  // === 更新覆盖层位置 ===
  function updateOverlay(overlay, element) {
    if (!overlay || !element) return;
    
    const rect = element.getBoundingClientRect();
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;
    
    overlay.style.top = `${rect.top + scrollY}px`;
    overlay.style.left = `${rect.left + scrollX}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
  }

  // === 隐藏覆盖层 ===
  function hideOverlay(overlay) {
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  // === 显示覆盖层 ===
  function showOverlay(overlay) {
    if (overlay) {
      overlay.style.display = 'block';
    }
  }

  // === 创建间距标签 ===
  function createSpacingLabel(distance, x, y, direction) {
    const label = document.createElement('div');
    label.className = 'css-inspector-spacing-label';
    label.style.cssText = `
      position: absolute;
      left: ${x}px;
      top: ${y}px;
      background: #FF6B35;
      color: white;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 11px;
      font-family: Monaco, monospace;
      font-weight: bold;
      pointer-events: none;
      z-index: 2147483646;
      white-space: nowrap;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
    `;
    label.textContent = `${Math.round(distance)}px`;
    document.body.appendChild(label);
    return label;
  }

  // === 创建间距线条 ===
  function createSpacingLine(x1, y1, x2, y2, isHorizontal) {
    const line = document.createElement('div');
    line.className = 'css-inspector-spacing-line';
    
    const length = isHorizontal ? Math.abs(x2 - x1) : Math.abs(y2 - y1);
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    
    line.style.cssText = `
      position: absolute;
      left: ${left}px;
      top: ${top}px;
      ${isHorizontal ? `width: ${length}px; height: 1px;` : `width: 1px; height: ${length}px;`}
      background: #FF6B35;
      pointer-events: none;
      z-index: 2147483646;
    `;
    
    // 添加箭头端点
    const arrow1 = document.createElement('div');
    arrow1.style.cssText = `
      position: absolute;
      ${isHorizontal ? 'left: 0; top: -2px; width: 1px; height: 5px;' : 'left: -2px; top: 0; width: 5px; height: 1px;'}
      background: #FF6B35;
    `;
    
    const arrow2 = document.createElement('div');
    arrow2.style.cssText = `
      position: absolute;
      ${isHorizontal ? `left: ${length}px; top: -2px; width: 1px; height: 5px;` : `left: -2px; top: ${length}px; width: 5px; height: 1px;`}
      background: #FF6B35;
    `;
    
    line.appendChild(arrow1);
    line.appendChild(arrow2);
    document.body.appendChild(line);
    return line;
  }

  // === 清除所有间距显示 ===
  function clearSpacingOverlays() {
    state.spacingOverlays.forEach(overlay => {
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    });
    state.spacingOverlays = [];
  }

  // === 获取相邻元素 ===
  function getAdjacentElements(element) {
    const rect = element.getBoundingClientRect();
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;
    
    const allElements = Array.from(document.querySelectorAll('body *')).filter(el => {
      // 过滤掉自己、覆盖层和不可见元素
      if (el === element) return false;
      if (el.classList.contains('css-inspector-overlay')) return false;
      if (el.classList.contains('css-inspector-spacing-label')) return false;
      if (el.classList.contains('css-inspector-spacing-line')) return false;
      if (el.contains(element)) return false; // 过滤父元素
      if (element.contains(el)) return false; // 过滤子元素
      
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (style.opacity === '0') return false;
      
      return true;
    });
    
    const result = { top: null, right: null, bottom: null, left: null };
    let minDistances = { top: Infinity, right: Infinity, bottom: Infinity, left: Infinity };
    
    allElements.forEach(el => {
      const elRect = el.getBoundingClientRect();
      
      // 检查是否在同一水平或垂直线上（有重叠）
      const horizontalOverlap = !(elRect.right < rect.left || elRect.left > rect.right);
      const verticalOverlap = !(elRect.bottom < rect.top || elRect.top > rect.bottom);
      
      // 上方元素
      if (elRect.bottom <= rect.top && horizontalOverlap) {
        const distance = rect.top - elRect.bottom;
        if (distance < minDistances.top) {
          minDistances.top = distance;
          result.top = { element: el, distance, rect: elRect };
        }
      }
      
      // 下方元素
      if (elRect.top >= rect.bottom && horizontalOverlap) {
        const distance = elRect.top - rect.bottom;
        if (distance < minDistances.bottom) {
          minDistances.bottom = distance;
          result.bottom = { element: el, distance, rect: elRect };
        }
      }
      
      // 左侧元素
      if (elRect.right <= rect.left && verticalOverlap) {
        const distance = rect.left - elRect.right;
        if (distance < minDistances.left) {
          minDistances.left = distance;
          result.left = { element: el, distance, rect: elRect };
        }
      }
      
      // 右侧元素
      if (elRect.left >= rect.right && verticalOverlap) {
        const distance = elRect.left - rect.right;
        if (distance < minDistances.right) {
          minDistances.right = distance;
          result.right = { element: el, distance, rect: elRect };
        }
      }
    });
    
    return result;
  }

  // === 显示两个元素之间的间距 ===
  function showSpacingInfo(selectedElement, hoveredElement) {
    clearSpacingOverlays();
    
    if (!selectedElement || !hoveredElement || selectedElement === hoveredElement) return;
    
    const selectedRect = selectedElement.getBoundingClientRect();
    const hoveredRect = hoveredElement.getBoundingClientRect();
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;
    
    // 判断是否嵌套：蓝框完全在橙框内部
    const hoveredInsideSelected = 
      hoveredRect.left >= selectedRect.left &&
      hoveredRect.right <= selectedRect.right &&
      hoveredRect.top >= selectedRect.top &&
      hoveredRect.bottom <= selectedRect.bottom;
    
    // 判断是否嵌套：橙框完全在蓝框内部
    const selectedInsideHovered = 
      selectedRect.left >= hoveredRect.left &&
      selectedRect.right <= hoveredRect.right &&
      selectedRect.top >= hoveredRect.top &&
      selectedRect.bottom <= hoveredRect.bottom;
    
    if (hoveredInsideSelected) {
      // 蓝框在橙框内部 - 显示到橙框四边的距离
      const topDistance = Math.round(hoveredRect.top - selectedRect.top);
      const bottomDistance = Math.round(selectedRect.bottom - hoveredRect.bottom);
      const leftDistance = Math.round(hoveredRect.left - selectedRect.left);
      const rightDistance = Math.round(selectedRect.right - hoveredRect.right);
      
      // 上边距
      if (topDistance > 1) {
        const midX = scrollX + (hoveredRect.left + hoveredRect.right) / 2;
        const y1 = scrollY + selectedRect.top;
        const y2 = scrollY + hoveredRect.top;
        const line = createSpacingLine(midX, y1, midX, y2, false);
        const label = createSpacingLabel(topDistance, midX - 15, (y1 + y2) / 2 - 8, 'vertical');
        state.spacingOverlays.push(line, label);
      }
      
      // 下边距
      if (bottomDistance > 1) {
        const midX = scrollX + (hoveredRect.left + hoveredRect.right) / 2;
        const y1 = scrollY + hoveredRect.bottom;
        const y2 = scrollY + selectedRect.bottom;
        const line = createSpacingLine(midX, y1, midX, y2, false);
        const label = createSpacingLabel(bottomDistance, midX - 15, (y1 + y2) / 2 - 8, 'vertical');
        state.spacingOverlays.push(line, label);
      }
      
      // 左边距
      if (leftDistance > 1) {
        const midY = scrollY + (hoveredRect.top + hoveredRect.bottom) / 2;
        const x1 = scrollX + selectedRect.left;
        const x2 = scrollX + hoveredRect.left;
        const line = createSpacingLine(x1, midY, x2, midY, true);
        const label = createSpacingLabel(leftDistance, (x1 + x2) / 2 - 15, midY - 18, 'horizontal');
        state.spacingOverlays.push(line, label);
      }
      
      // 右边距
      if (rightDistance > 1) {
        const midY = scrollY + (hoveredRect.top + hoveredRect.bottom) / 2;
        const x1 = scrollX + hoveredRect.right;
        const x2 = scrollX + selectedRect.right;
        const line = createSpacingLine(x1, midY, x2, midY, true);
        const label = createSpacingLabel(rightDistance, (x1 + x2) / 2 - 15, midY - 18, 'horizontal');
        state.spacingOverlays.push(line, label);
      }
      return;
    }
    
    if (selectedInsideHovered) {
      // 橙框在蓝框内部 - 显示到蓝框四边的距离
      const topDistance = Math.round(selectedRect.top - hoveredRect.top);
      const bottomDistance = Math.round(hoveredRect.bottom - selectedRect.bottom);
      const leftDistance = Math.round(selectedRect.left - hoveredRect.left);
      const rightDistance = Math.round(hoveredRect.right - selectedRect.right);
      
      // 上边距
      if (topDistance > 1) {
        const midX = scrollX + (selectedRect.left + selectedRect.right) / 2;
        const y1 = scrollY + hoveredRect.top;
        const y2 = scrollY + selectedRect.top;
        const line = createSpacingLine(midX, y1, midX, y2, false);
        const label = createSpacingLabel(topDistance, midX - 15, (y1 + y2) / 2 - 8, 'vertical');
        state.spacingOverlays.push(line, label);
      }
      
      // 下边距
      if (bottomDistance > 1) {
        const midX = scrollX + (selectedRect.left + selectedRect.right) / 2;
        const y1 = scrollY + selectedRect.bottom;
        const y2 = scrollY + hoveredRect.bottom;
        const line = createSpacingLine(midX, y1, midX, y2, false);
        const label = createSpacingLabel(bottomDistance, midX - 15, (y1 + y2) / 2 - 8, 'vertical');
        state.spacingOverlays.push(line, label);
      }
      
      // 左边距
      if (leftDistance > 1) {
        const midY = scrollY + (selectedRect.top + selectedRect.bottom) / 2;
        const x1 = scrollX + hoveredRect.left;
        const x2 = scrollX + selectedRect.left;
        const line = createSpacingLine(x1, midY, x2, midY, true);
        const label = createSpacingLabel(leftDistance, (x1 + x2) / 2 - 15, midY - 18, 'horizontal');
        state.spacingOverlays.push(line, label);
      }
      
      // 右边距
      if (rightDistance > 1) {
        const midY = scrollY + (selectedRect.top + selectedRect.bottom) / 2;
        const x1 = scrollX + selectedRect.right;
        const x2 = scrollX + hoveredRect.right;
        const line = createSpacingLine(x1, midY, x2, midY, true);
        const label = createSpacingLabel(rightDistance, (x1 + x2) / 2 - 15, midY - 18, 'horizontal');
        state.spacingOverlays.push(line, label);
      }
      return;
    }
    
    // 非嵌套情况 - 显示外部间距
    // 计算水平和垂直重叠
    const horizontalOverlap = !(selectedRect.right < hoveredRect.left || selectedRect.left > hoveredRect.right);
    const verticalOverlap = !(selectedRect.bottom < hoveredRect.top || selectedRect.top > hoveredRect.bottom);
    
    // 垂直间距（上下）
    if (horizontalOverlap) {
      // 蓝色在橙色上方
      if (hoveredRect.bottom <= selectedRect.top) {
        const distance = Math.round(selectedRect.top - hoveredRect.bottom);
        if (distance > 0) {
          const midX = scrollX + Math.max(selectedRect.left, hoveredRect.left) + 
                      (Math.min(selectedRect.right, hoveredRect.right) - Math.max(selectedRect.left, hoveredRect.left)) / 2;
          const y1 = scrollY + hoveredRect.bottom;
          const y2 = scrollY + selectedRect.top;
          const line = createSpacingLine(midX, y1, midX, y2, false);
          const label = createSpacingLabel(distance, midX - 15, (y1 + y2) / 2 - 8, 'vertical');
          state.spacingOverlays.push(line, label);
        }
      }
      // 蓝色在橙色下方
      else if (hoveredRect.top >= selectedRect.bottom) {
        const distance = Math.round(hoveredRect.top - selectedRect.bottom);
        if (distance > 0) {
          const midX = scrollX + Math.max(selectedRect.left, hoveredRect.left) + 
                      (Math.min(selectedRect.right, hoveredRect.right) - Math.max(selectedRect.left, hoveredRect.left)) / 2;
          const y1 = scrollY + selectedRect.bottom;
          const y2 = scrollY + hoveredRect.top;
          const line = createSpacingLine(midX, y1, midX, y2, false);
          const label = createSpacingLabel(distance, midX - 15, (y1 + y2) / 2 - 8, 'vertical');
          state.spacingOverlays.push(line, label);
        }
      }
    }
    
    // 水平间距（左右）
    if (verticalOverlap) {
      // 蓝色在橙色左侧
      if (hoveredRect.right <= selectedRect.left) {
        const distance = Math.round(selectedRect.left - hoveredRect.right);
        if (distance > 0) {
          const midY = scrollY + Math.max(selectedRect.top, hoveredRect.top) + 
                      (Math.min(selectedRect.bottom, hoveredRect.bottom) - Math.max(selectedRect.top, hoveredRect.top)) / 2;
          const x1 = scrollX + hoveredRect.right;
          const x2 = scrollX + selectedRect.left;
          const line = createSpacingLine(x1, midY, x2, midY, true);
          const label = createSpacingLabel(distance, (x1 + x2) / 2 - 15, midY - 18, 'horizontal');
          state.spacingOverlays.push(line, label);
        }
      }
      // 蓝色在橙色右侧
      else if (hoveredRect.left >= selectedRect.right) {
        const distance = Math.round(hoveredRect.left - selectedRect.right);
        if (distance > 0) {
          const midY = scrollY + Math.max(selectedRect.top, hoveredRect.top) + 
                      (Math.min(selectedRect.bottom, hoveredRect.bottom) - Math.max(selectedRect.top, hoveredRect.top)) / 2;
          const x1 = scrollX + selectedRect.right;
          const x2 = scrollX + hoveredRect.left;
          const line = createSpacingLine(x1, midY, x2, midY, true);
          const label = createSpacingLabel(distance, (x1 + x2) / 2 - 15, midY - 18, 'horizontal');
          state.spacingOverlays.push(line, label);
        }
      }
    }
  }

  // === 生成唯一选择器 ===
  function generateSelector(element) {
    if (!element || element === document.body) return 'body';
    if (element === document.documentElement) return 'html';

    // 优先使用 ID
    if (element.id) {
      const id = CSS.escape(element.id);
      return `#${id}`;
    }

    // 构建路径
    const path = [];
    let current = element;

    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();

      // 添加类名（最多3个）
      if (current.classList.length > 0) {
        const classes = Array.from(current.classList)
          .slice(0, 3)
          .map(c => `.${CSS.escape(c)}`)
          .join('');
        selector += classes;
      }

      // 添加 nth-child 以确保唯一性
      if (current.parentElement) {
        const siblings = Array.from(current.parentElement.children);
        const index = siblings.indexOf(current) + 1;
        const sameTagSiblings = siblings.filter(s => s.tagName === current.tagName);
        
        if (sameTagSiblings.length > 1) {
          selector += `:nth-child(${index})`;
        }
      }

      path.unshift(selector);
      current = current.parentElement;
    }

    return path.join(' > ');
  }

  // === 获取计算样式 ===
  function getComputedStyles(element) {
    const computed = window.getComputedStyle(element);
    const styles = {};
    
    // 常用的 CSS 属性
    const importantProps = [
      // Box Model
      'width', 'height', 'margin', 'padding', 'border',
      'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
      'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
      'border-width', 'border-style', 'border-color', 'border-radius',
      
      // Position & Display
      'display', 'position', 'top', 'right', 'bottom', 'left',
      'float', 'clear', 'z-index', 'overflow', 'overflow-x', 'overflow-y',
      
      // Flexbox
      'flex', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items',
      'align-content', 'flex-grow', 'flex-shrink', 'flex-basis',
      
      // Grid
      'grid-template-columns', 'grid-template-rows', 'grid-gap', 'gap',
      
      // Typography
      'font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
      'text-align', 'text-decoration', 'text-transform', 'letter-spacing',
      'word-spacing', 'white-space', 'color',
      
      // Background
      'background', 'background-color', 'background-image', 'background-size',
      'background-position', 'background-repeat',
      
      // Effects
      'opacity', 'box-shadow', 'text-shadow', 'transform', 'transition',
      'animation', 'filter', 'cursor', 'visibility'
    ];

    importantProps.forEach(prop => {
      const value = computed.getPropertyValue(prop);
      if (value) {
        styles[prop] = value;
      }
    });

    return styles;
  }

  // === 获取 Box Model 信息 ===
  function getBoxModel(element) {
    const computed = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    return {
      content: {
        width: parseFloat(computed.width),
        height: parseFloat(computed.height)
      },
      padding: {
        top: parseFloat(computed.paddingTop),
        right: parseFloat(computed.paddingRight),
        bottom: parseFloat(computed.paddingBottom),
        left: parseFloat(computed.paddingLeft)
      },
      border: {
        top: parseFloat(computed.borderTopWidth),
        right: parseFloat(computed.borderRightWidth),
        bottom: parseFloat(computed.borderBottomWidth),
        left: parseFloat(computed.borderLeftWidth)
      },
      margin: {
        top: parseFloat(computed.marginTop),
        right: parseFloat(computed.marginRight),
        bottom: parseFloat(computed.marginBottom),
        left: parseFloat(computed.marginLeft)
      }
    };
  }

  // === 获取元素信息 ===
  function getElementInfo(element) {
    if (!element) return null;

    return {
      tagName: element.tagName.toLowerCase(),
      id: element.id || '',
      classes: Array.from(element.classList),
      selector: generateSelector(element),
      computedStyles: getComputedStyles(element),
      boxModel: getBoxModel(element),
      inlineStyles: element.style.cssText
    };
  }

  // === 鼠标移动处理 ===
  function handleMouseMove(e) {
    if (!state.isPickingMode) return;

    // 忽略我们自己创建的覆盖层
    let target = e.target;
    if (target.classList && (target.classList.contains('css-inspector-overlay') ||
        target.classList.contains('css-inspector-spacing-label') ||
        target.classList.contains('css-inspector-spacing-line'))) {
      return;
    }

    // 过滤掉body和html元素，避免鼠标移出窗口时选中它们
    if (target === document.body || target === document.documentElement) {
      // 清除之前的悬停延时定时器
      if (state.hoverDebounceTimer) {
        clearTimeout(state.hoverDebounceTimer);
      }
      return;
    }

    // 只有鼠标移动到新元素时才处理
    if (state.hoveredElement !== target) {
      // 清除之前的悬停延时定时器
      if (state.hoverDebounceTimer) {
        clearTimeout(state.hoverDebounceTimer);
      }
      
      // 只有在当前元素上停留满150ms，蓝框才会移动过来
      state.hoverDebounceTimer = setTimeout(() => {
        // 更新悬停元素
        state.hoveredElement = target;
        
        if (!state.highlightOverlay) {
          state.highlightOverlay = createOverlay('hover');
        }
        
        showOverlay(state.highlightOverlay);
        updateOverlay(state.highlightOverlay, target);
        
        // 清除之前的间距防抖计时器
        if (state.spacingDebounceTimer) {
          clearTimeout(state.spacingDebounceTimer);
        }
        
        // 清除旧的间距显示
        clearSpacingOverlays();
        
        // 只有在已选中元素时，才显示间距（鼠标停止 300ms 后）
        if (state.selectedElement) {
          state.spacingDebounceTimer = setTimeout(() => {
            showSpacingInfo(state.selectedElement, target);
          }, 300);
        }
      }, 33); // 停留50ms后才移动蓝框
    }
  }

  // === 点击处理 ===
  function handleClick(e) {
    if (!state.isPickingMode) return;

    e.preventDefault();
    e.stopPropagation();

    let target = e.target;
    if (target.classList && (target.classList.contains('css-inspector-overlay') ||
        target.classList.contains('css-inspector-spacing-label') ||
        target.classList.contains('css-inspector-spacing-line'))) {
      return;
    }

    // 选中元素
    state.selectedElement = target;

    // 创建或更新选中覆盖层
    if (!state.selectedOverlay) {
      state.selectedOverlay = createOverlay('selected');
    }
    
    showOverlay(state.selectedOverlay);
    updateOverlay(state.selectedOverlay, target);

    // 隐藏 hover 覆盖层
    hideOverlay(state.highlightOverlay);
    
    // 清除防抖计时器
    if (state.spacingDebounceTimer) {
      clearTimeout(state.spacingDebounceTimer);
      state.spacingDebounceTimer = null;
    }
    
    if (state.hoverDebounceTimer) {
      clearTimeout(state.hoverDebounceTimer);
      state.hoverDebounceTimer = null;
    }
    
    // 清除间距显示（选中元素后，需要悬停其他元素才会显示间距）
    clearSpacingOverlays();

    // 获取元素信息并发送到 panel
    const elementInfo = getElementInfo(target);
    sendToPanel('elementSelected', elementInfo);

    // 不再自动停止选择模式，允许连续选择
    // stopPickingMode();
  }

  // === 启动选择模式 ===
  function startPickingMode() {
    state.isPickingMode = true;
    document.body.style.cursor = 'crosshair';
    
    document.addEventListener('mousemove', handleMouseMove, true);
    document.addEventListener('click', handleClick, true);

    // 激活移动端长按防御（禁用上下文菜单 / 文本选择 / 图片保存）
    if (window.__TouchDefense__) {
      window.__TouchDefense__.activate();
    }
  }

  // === 停止选择模式 ===
  function stopPickingMode() {
    state.isPickingMode = false;
    document.body.style.cursor = '';
    
    document.removeEventListener('mousemove', handleMouseMove, true);
    document.removeEventListener('click', handleClick, true);

    // 停用移动端长按防御（还原页面原始行为）
    if (window.__TouchDefense__) {
      window.__TouchDefense__.deactivate();
    }
    
    // 隐藏蓝色悬停框
    hideOverlay(state.highlightOverlay);
    
    // 隐藏橙色选中框
    hideOverlay(state.selectedOverlay);
    
    // 清除间距显示
    clearSpacingOverlays();
    
    // 清除所有防抖计时器
    if (state.spacingDebounceTimer) {
      clearTimeout(state.spacingDebounceTimer);
      state.spacingDebounceTimer = null;
    }
    
    if (state.hoverDebounceTimer) {
      clearTimeout(state.hoverDebounceTimer);
      state.hoverDebounceTimer = null;
    }
    
    // 清除元素引用
    state.hoveredElement = null;
    state.selectedElement = null;
  }

  // === 应用样式修改 ===
  function applyStyleChange(selector, property, value) {
    try {
      // 找到对应的元素
      const element = state.selectedElement || document.querySelector(selector);
      if (!element) {
        return { success: false, error: 'Element not found' };
      }

      // 应用样式
      if (value === null || value === '') {
        element.style.removeProperty(property);
      } else {
        element.style.setProperty(property, value, 'important');
      }

      // 记录修改
      if (!state.modifications.has(element)) {
        state.modifications.set(element, {
          selector: generateSelector(element),
          changes: []
        });
      }

      const mod = state.modifications.get(element);
      const existingChange = mod.changes.find(c => c.property === property);
      
      if (existingChange) {
        existingChange.value = value;
        existingChange.timestamp = Date.now();
      } else {
        mod.changes.push({
          property,
          value,
          timestamp: Date.now()
        });
      }

      // 更新选中覆盖层（样式可能改变了尺寸）
      if (state.selectedElement === element) {
        updateOverlay(state.selectedOverlay, element);
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // === 清除所有修改 ===
  function clearAllChanges() {
    state.modifications.forEach((mod, element) => {
      mod.changes.forEach(change => {
        element.style.removeProperty(change.property);
      });
    });
    
    state.modifications.clear();
    
    return { success: true };
  }

  // === 导出修改为 CSS ===
  function exportChanges() {
    const cssRules = [];
    
    state.modifications.forEach((mod, element) => {
      if (mod.changes.length === 0) return;
      
      const selector = mod.selector;
      const declarations = mod.changes
        .filter(c => c.value !== null && c.value !== '')
        .map(c => `  ${c.property}: ${c.value};`)
        .join('\n');
      
      if (declarations) {
        cssRules.push(`${selector} {\n${declarations}\n}`);
      }
    });
    
    return cssRules.join('\n\n');
  }

  // === 发送消息到 panel ===
  function sendToPanel(action, data) {
    chrome.runtime.sendMessage({
      action: 'forwardToPanel',
      data: { action, data }
    }).catch(err => {
      console.error('Failed to send message to panel:', err);
    });
  }

  // === 监听来自 panel 的消息 ===
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    try {
      switch (request.action || request.type) {
        case 'ping':
          sendResponse({ success: true });
          break;

        case 'startPicking':
          startPickingMode();
          sendResponse({ success: true });
          break;

        case 'stopPicking':
          stopPickingMode();
          sendResponse({ success: true });
          break;
        
        case 'cleanup':
          stopPickingMode();
          sendResponse({ success: true });
          break;

        case 'applyStyle':
          const result = applyStyleChange(
            request.selector,
            request.property,
            request.value
          );
          sendResponse(result);
          break;

        case 'clearChanges':
          sendResponse(clearAllChanges());
          break;

        case 'exportChanges':
          sendResponse({ css: exportChanges() });
          break;

        case 'getSelectedElement':
          if (state.selectedElement) {
            sendResponse({ 
              success: true, 
              data: getElementInfo(state.selectedElement) 
            });
          } else {
            sendResponse({ success: false, error: 'No element selected' });
          }
          break;

        case 'refreshElement':
          if (state.selectedElement) {
            sendToPanel('elementSelected', getElementInfo(state.selectedElement));
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'No element selected' });
          }
          break;

        default:
          sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }

    return true; // 保持消息通道开放
  });

  // === 监听窗口大小变化，更新覆盖层 ===
  window.addEventListener('resize', () => {
    if (state.selectedElement) {
      updateOverlay(state.selectedOverlay, state.selectedElement);
    }
    if (state.hoveredElement && state.isPickingMode) {
      updateOverlay(state.highlightOverlay, state.hoveredElement);
    }
    // 窗口大小变化时重新计算间距
    if (state.selectedElement && state.hoveredElement && state.isPickingMode) {
      clearSpacingOverlays();
      showSpacingInfo(state.selectedElement, state.hoveredElement);
    }
  });

  // === 监听滚动，更新覆盖层 ===
  window.addEventListener('scroll', () => {
    if (state.selectedElement) {
      updateOverlay(state.selectedOverlay, state.selectedElement);
    }
    if (state.hoveredElement && state.isPickingMode) {
      updateOverlay(state.highlightOverlay, state.hoveredElement);
    }
    // 滚动时重新计算间距
    if (state.selectedElement && state.hoveredElement && state.isPickingMode) {
      clearSpacingOverlays();
      showSpacingInfo(state.selectedElement, state.hoveredElement);
    }
  }, true);
})();
