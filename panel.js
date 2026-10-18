/**
 * Panel Script - Side Panel UI 逻辑
 * 处理用户交互、与 content script 通信、显示元素信息
 */

(function() {
  'use strict';
  
  console.log('=== Panel.js IIFE started ===');

  // === 状态管理 ===
  console.log('Step 1: Defining state...');
  const state = {
    currentElement: null,
    isPicking: false,
    modifications: [],
    activeTab: null
  };
  console.log('Step 2: State defined');

  // === DOM 元素引用（将在 init 中初始化）===
  console.log('Step 3: Declaring elements...');
  let elements = {};
  console.log('Step 4: Elements declared');

  // === 工具函数 ===
  console.log('Step 5: Defining functions...');
  
  // 显示状态消息
  function showStatus(message, type = 'info', duration = 3000) {
    elements.statusMessage.textContent = message;
    elements.statusMessage.className = `status-message ${type}`;
    
    if (duration > 0) {
      setTimeout(() => {
        elements.statusMessage.textContent = '';
        elements.statusMessage.className = 'status-message';
      }, duration);
    }
  }

  // 获取活动标签页
  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0];
  }

  // 确保 content script 已加载
  async function ensureContentScript(tabId) {
    try {
      console.log('Checking if content script is loaded for tab:', tabId);
      // 尝试 ping content script
      await chrome.tabs.sendMessage(tabId, { action: 'ping' });
      console.log('Content script already loaded');
      return true;
    } catch (error) {
      console.log('Content script not loaded, injecting...');
      // Content script 未加载，手动注入
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['probe.js', 'features/mobile-adapter/touch-defense.js', 'content_script.js']
        });
        // 等待一小段时间让 content script 初始化
        await new Promise(resolve => setTimeout(resolve, 200));
        console.log('Content script injected successfully');
        return true;
      } catch (injectError) {
        console.error('Failed to inject content script:', injectError);
        return false;
      }
    }
  }

  // 发送消息到 content script
  async function sendToContent(action, data = {}) {
    try {
      const tab = await getActiveTab();
      if (!tab) {
        throw new Error('No active tab');
      }

      // 确保 content script 已加载
      const isReady = await ensureContentScript(tab.id);
      if (!isReady) {
        throw new Error('Failed to load content script');
      }

      const message = { action, ...data };
      return await chrome.tabs.sendMessage(tab.id, message);
    } catch (error) {
      console.error('Failed to send message to content script:', error);
      showStatus(`连接失败，请刷新页面后重试`, 'error');
      return { success: false, error: error.message };
    }
  }

  // === 选择模式 ===
  
  async function togglePickingMode() {
    console.log('togglePickingMode called, current state:', state.isPicking);
    if (state.isPicking) {
      // 停止选择
      const response = await sendToContent('stopPicking');
      console.log('stopPicking response:', response);
      if (response?.success) {
        state.isPicking = false;
        elements.pickButton.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M3 2l10 6-4 1-1 4-5-11z"/>
          </svg>
          Start Picking
        `;
        elements.pickButton.classList.remove('active');
        showStatus('Stopped picking mode', 'info');
      }
    } else {
      // 开始选择
      console.log('Starting picking mode...');
      const response = await sendToContent('startPicking');
      console.log('startPicking response:', response);
      if (response?.success) {
        state.isPicking = true;
        elements.pickButton.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="2"/>
          </svg>
          Stop Picking
        `;
        elements.pickButton.classList.add('active');
        showStatus('点击页面元素进行选择，可连续选择多个元素', 'info', 0);
      }
    }
  }

  // === 显示元素信息 ===
  
  function displayElementInfo(elementData) {
    console.log('displayElementInfo called with:', elementData);
    if (!elementData) return;

    state.currentElement = elementData;

    // 隐藏空状态，显示所有卡片
    elements.emptyState.classList.add('hidden');
    elements.elementCard.classList.remove('hidden');
    elements.boxModelCard.classList.remove('hidden');
    elements.elementPropsCard.classList.remove('hidden');
    elements.textPropsCard.classList.remove('hidden');
    elements.colorsCard.classList.remove('hidden');

    // 元素标签
    elements.elementTagLabel.textContent = elementData.tagName.toUpperCase();
    elements.elementTagName.textContent = elementData.tagName;
    
    // ID
    if (elementData.id) {
      elements.elementId.textContent = '#' + elementData.id;
      elements.elementIdRow.style.display = 'flex';
    } else {
      elements.elementIdRow.style.display = 'none';
    }
    
    // Classes
    if (elementData.classes.length > 0) {
      elements.elementClasses.textContent = '.' + elementData.classes.join(', .');
      elements.elementClassRow.style.display = 'flex';
    } else {
      elements.elementClassRow.style.display = 'none';
    }
    
    // Selector
    elements.elementSelector.textContent = elementData.selector;

    // Element Properties
    const styles = elementData.computedStyles;
    elements.elemWidth.value = styles.width || '';
    elements.elemHeight.value = styles.height || '';
    elements.elemDisplay.value = styles.display || '';
    elements.elemPosition.value = styles.position || '';

    // Text Properties
    // 兼容不同的属性命名方式
    elements.fontFamily.value = styles['font-family'] || styles.fontFamily || '';
    elements.fontSize.value = styles['font-size'] || styles.fontSize || '';
    elements.lineHeight.value = styles['line-height'] || styles.lineHeight || '';
    elements.fontWeight.value = styles['font-weight'] || styles.fontWeight || '';
    
    const color = styles.color || '#000000';
    const colorHex = rgbToHex(color) || color;
    elements.textColor.value = color;
    elements.textColorBox.style.backgroundColor = color;
    elements.textColor2.value = color;
    elements.textColorBox2.style.backgroundColor = color;
    if (elements.textColorPicker && colorHex.startsWith('#')) {
      elements.textColorPicker.value = colorHex;
    }
    if (elements.textColorPicker2 && colorHex.startsWith('#')) {
      elements.textColorPicker2.value = colorHex;
    }

    // Colors
    const bgColor = styles['background-color'] || 'transparent';
    const bgColorHex = rgbToHex(bgColor) || bgColor;
    elements.bgColor.value = bgColor;
    elements.bgColorBox.style.backgroundColor = bgColor;
    if (elements.bgColorPicker && bgColorHex.startsWith('#')) {
      elements.bgColorPicker.value = bgColorHex;
    }
    
    // 检查是否有渐变背景
    const background = styles.background || '';
    if (background.includes('gradient')) {
      elements.bgColor.value = background;
      elements.bgColorBox.style.background = background;
      handleGradientValue(background);
    } else if (bgColor.includes('gradient')) {
      elements.bgColorBox.style.background = bgColor;
      handleGradientValue(bgColor);
    } else {
      hideGradientPickers();
    }

    // Box Model
    displayBoxModel(elementData.boxModel);

    // 显示提示消息
    showStatus('✏️ Click on any value to edit CSS properties', 'info', 4000);
  }

  // === 显示 Box Model ===
  
  function displayBoxModel(box) {
    if (!box) return;

    elements.marginTop.textContent = (box.margin.top || 0).toFixed(0);
    elements.marginRight.textContent = (box.margin.right || 0).toFixed(0);
    elements.marginBottom.textContent = (box.margin.bottom || 0).toFixed(0);
    elements.marginLeft.textContent = (box.margin.left || 0).toFixed(0);

    elements.borderTop.textContent = (box.border.top || 0).toFixed(0);
    elements.borderRight.textContent = (box.border.right || 0).toFixed(0);
    elements.borderBottom.textContent = (box.border.bottom || 0).toFixed(0);
    elements.borderLeft.textContent = (box.border.left || 0).toFixed(0);

    elements.paddingTop.textContent = (box.padding.top || 0).toFixed(0);
    elements.paddingRight.textContent = (box.padding.right || 0).toFixed(0);
    elements.paddingBottom.textContent = (box.padding.bottom || 0).toFixed(0);
    elements.paddingLeft.textContent = (box.padding.left || 0).toFixed(0);

    const width = (box.content.width || 0).toFixed(0);
    const height = (box.content.height || 0).toFixed(0);
    elements.contentSize.textContent = `${width} × ${height}`;
  }

  // === 处理属性输入修改 ===
  
  async function handlePropInputChange(event) {
    const input = event.target;
    const property = input.dataset.property;
    const value = input.value;
    
    if (!property || !state.currentElement) {
      return;
    }

    // 应用样式
    const response = await sendToContent('applyStyle', {
      selector: state.currentElement.selector,
      property,
      value
    });

    if (response?.success) {
      showStatus(`✓ Applied: ${property} = ${value}`, 'success', 2000);
      
      // 更新 color box 和 color picker 如果是颜色相关属性
      if (property === 'color') {
        const hexColor = rgbToHex(value) || value;
        elements.textColorBox.style.backgroundColor = value;
        elements.textColorBox2.style.backgroundColor = value;
        if (elements.textColorPicker && hexColor.startsWith('#')) {
          elements.textColorPicker.value = hexColor;
        }
        if (elements.textColorPicker2 && hexColor.startsWith('#')) {
          elements.textColorPicker2.value = hexColor;
        }
      } else if (property === 'background-color') {
        const hexColor = rgbToHex(value) || value;
        elements.bgColorBox.style.backgroundColor = value;
        if (elements.bgColorPicker && hexColor.startsWith('#')) {
          elements.bgColorPicker.value = hexColor;
        }
        // 检查是否是渐变
        if (value.includes('gradient')) {
          handleGradientValue(value);
        } else {
          hideGradientPickers();
        }
      }
    } else {
      showStatus(`✗ Failed to apply: ${response?.error || 'Unknown error'}`, 'error');
    }
  }

  // === 颜色格式转换 ===
  
  function rgbToHex(color) {
    if (!color || color === 'transparent') return '#ffffff';
    
    // 如果已经是 hex 格式
    if (color.startsWith('#')) {
      return color.length === 7 ? color : color + 'ff';
    }
    
    // 解析 rgb/rgba
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
    if (match) {
      const r = parseInt(match[1]);
      const g = parseInt(match[2]);
      const b = parseInt(match[3]);
      return '#' + [r, g, b].map(x => {
        const hex = x.toString(16);
        return hex.length === 1 ? '0' + hex : hex;
      }).join('');
    }
    
    return null;
  }

  // === 处理渐变值 ===
  
  function handleGradientValue(gradientValue) {
    if (!elements.bgGradientPickers) return;
    
    // 解析渐变字符串，提取颜色
    const colors = parseGradientColors(gradientValue);
    
    if (colors.length > 0) {
      // 显示渐变调色板容器
      elements.bgGradientPickers.classList.remove('hidden');
      elements.bgGradientPickers.innerHTML = '';
      
      // 为每个颜色创建紧凑的调色板
      colors.forEach((colorInfo, index) => {
        const item = document.createElement('div');
        item.className = 'gradient-color-item';
        item.title = `Gradient color ${index + 1}: ${colorInfo.color}`;
        
        const label = document.createElement('span');
        label.className = 'gradient-color-label';
        label.textContent = `${index + 1}`;
        
        const picker = document.createElement('input');
        picker.type = 'color';
        picker.className = 'gradient-color-picker';
        picker.value = rgbToHex(colorInfo.color) || '#ffffff';
        picker.dataset.index = index;
        picker.dataset.originalGradient = gradientValue;
        
        // 调色板改变事件
        picker.addEventListener('input', async (e) => {
          const newColor = e.target.value;
          
          // 更新渐变字符串
          const originalGradient = e.target.dataset.originalGradient;
          const colorIndex = parseInt(e.target.dataset.index);
          const newGradient = updateGradientColor(originalGradient, colorIndex, newColor);
          
          // 应用新的渐变
          elements.bgColor.value = newGradient;
          const response = await sendToContent('applyStyle', {
            selector: state.currentElement.selector,
            property: 'background',
            value: newGradient
          });
          
          if (response?.success) {
            showStatus(`✓ Gradient color ${colorIndex + 1} updated`, 'success', 1500);
            elements.bgColorBox.style.background = newGradient;
            // 更新所有 picker 的 dataset
            const allPickers = elements.bgGradientPickers.querySelectorAll('.gradient-color-picker');
            allPickers.forEach(p => {
              p.dataset.originalGradient = newGradient;
            });
          }
        });
        
        item.appendChild(label);
        item.appendChild(picker);
        elements.bgGradientPickers.appendChild(item);
      });
    } else {
      hideGradientPickers();
    }
  }

  // === 隐藏渐变调色板 ===
  
  function hideGradientPickers() {
    if (elements.bgGradientPickers) {
      elements.bgGradientPickers.classList.add('hidden');
      elements.bgGradientPickers.innerHTML = '';
    }
  }

  // === 解析渐变颜色 ===
  
  function parseGradientColors(gradient) {
    const colors = [];
    
    // 匹配各种颜色格式
    const colorRegex = /(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)|[a-z]+)/gi;
    
    let match;
    while ((match = colorRegex.exec(gradient)) !== null) {
      const color = match[0];
      // 过滤掉方向关键词
      if (!['linear', 'radial', 'conic', 'to', 'top', 'bottom', 'left', 'right', 'deg', 'grad', 'turn'].includes(color.toLowerCase())) {
        colors.push({
          color: color,
          position: match.index
        });
      }
    }
    
    return colors;
  }

  // === 更新渐变中的某个颜色 ===
  
  function updateGradientColor(gradient, colorIndex, newColor) {
    const colors = parseGradientColors(gradient);
    if (colorIndex >= colors.length) return gradient;
    
    const targetColor = colors[colorIndex];
    const startPos = targetColor.position;
    const endPos = startPos + targetColor.color.length;
    
    return gradient.substring(0, startPos) + newColor + gradient.substring(endPos);
  }

  // === 调色板改变事件处理 ===
  
  async function handleColorPickerChange(picker, textInput, colorBox, property) {
    const color = picker.value;
    
    if (textInput) {
      textInput.value = color;
    }
    
    if (colorBox) {
      colorBox.style.backgroundColor = color;
    }
    
    // 触发属性更改
    if (state.currentElement) {
      const response = await sendToContent('applyStyle', {
        selector: state.currentElement.selector,
        property,
        value: color
      });
      
      if (response?.success) {
        showStatus(`✓ Applied: ${property} = ${color}`, 'success', 1500);
      }
    }
    
    // 隐藏渐变调色板（因为现在是纯色）
    hideGradientPickers();
  }

  // === 复制选择器 ===
  
  function copySelector() {
    const selector = elements.elementSelector.textContent;
    navigator.clipboard.writeText(selector).then(() => {
      showStatus('选择器已复制', 'success');
    }).catch(err => {
      showStatus('复制失败', 'error');
    });
  }

  // === 轮询元素数据 ===
  
  function pollForElementData() {
    let lastTimestamp = 0;
    
    setInterval(async () => {
      const tab = await getActiveTab();
      if (!tab) return;
      const key = `selection:${tab.id}`;
      const stored = (await chrome.storage.session.get(key))[key];
      const result = { latestElementData: stored?.data, timestamp: stored?.timestamp };
      if (state.activeTab !== tab.id) {
        state.activeTab = tab.id; state.currentElement = null; state.isPicking = false; lastTimestamp = 0;
        elements.emptyState.classList.remove('hidden');
        for (const card of document.querySelectorAll('.info-card')) card.classList.add('hidden');
        elements.pickButton.textContent = 'Start Picking';
      }
      
      if (result.latestElementData && result.timestamp > lastTimestamp) {
        lastTimestamp = result.timestamp;
        console.log('New element data received:', result.latestElementData);
        
        const data = result.latestElementData;
        if (data.action === 'elementSelected') {
          displayElementInfo(data.data);
        }
      }
    }, 500);
  }

  // === 事件监听器 ===
  
  function setupEventListeners() {
    console.log('=== Setting up event listeners ===');
    
    // Picking 按钮
    if (elements.pickButton) {
      console.log('✅ Adding click listener to pickButton');
      elements.pickButton.addEventListener('click', () => {
        console.log('🎯 Pick button CLICKED!');
        togglePickingMode();
      });
    } else {
      console.error('❌ pickButton element not found in setupEventListeners!');
    }
    
    // 复制选择器
    if (elements.copySelector) {
      elements.copySelector.addEventListener('click', copySelector);
      console.log('copySelector listener added');
    }
    
    // 所有 prop-input 的事件监听
    const propInputs = document.querySelectorAll('.prop-input');
    console.log('Found', propInputs.length, 'prop-input elements');
    propInputs.forEach(input => {
      input.addEventListener('blur', handlePropInputChange);
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          input.blur();
        }
      });
    });
    
    // color-box 点击触发调色板
    if (elements.textColorBox && elements.textColorPicker) {
      elements.textColorBox.addEventListener('click', () => {
        elements.textColorPicker.click();
      });
      elements.textColorPicker.addEventListener('input', (e) => {
        handleColorPickerChange(e.target, elements.textColor, elements.textColorBox, 'color');
      });
    }
    
    if (elements.textColorBox2 && elements.textColorPicker2) {
      elements.textColorBox2.addEventListener('click', () => {
        elements.textColorPicker2.click();
      });
      elements.textColorPicker2.addEventListener('input', (e) => {
        handleColorPickerChange(e.target, elements.textColor2, elements.textColorBox2, 'color');
      });
    }
    
    if (elements.bgColorBox && elements.bgColorPicker) {
      elements.bgColorBox.addEventListener('click', () => {
        elements.bgColorPicker.click();
      });
      elements.bgColorPicker.addEventListener('input', (e) => {
        handleColorPickerChange(e.target, elements.bgColor, elements.bgColorBox, 'background-color');
      });
    }
    
    console.log('Event listeners setup complete');
  }

  // === 初始化 ===
  
  function init() {
    console.log('=== StyleProbe panel init() called ===');
    
    // 初始化所有 DOM 元素引用
    elements = {
      pickButton: document.getElementById('pickButton'),
      
      // Cards
      emptyState: document.getElementById('emptyState'),
      elementCard: document.getElementById('elementCard'),
      boxModelCard: document.getElementById('boxModelCard'),
      elementPropsCard: document.getElementById('elementPropsCard'),
      textPropsCard: document.getElementById('textPropsCard'),
      colorsCard: document.getElementById('colorsCard'),
      
      // Element Info
      elementTagLabel: document.getElementById('elementTagLabel'),
      elementTagName: document.getElementById('elementTagName'),
      elementId: document.getElementById('elementId'),
      elementIdRow: document.getElementById('elementIdRow'),
      elementClasses: document.getElementById('elementClasses'),
      elementClassRow: document.getElementById('elementClassRow'),
      elementSelector: document.getElementById('elementSelector'),
      copySelector: document.getElementById('copySelector'),
      
      // Element Properties
      elemWidth: document.getElementById('elemWidth'),
      elemHeight: document.getElementById('elemHeight'),
      elemDisplay: document.getElementById('elemDisplay'),
      elemPosition: document.getElementById('elemPosition'),
      
      // Text Properties
      fontFamily: document.getElementById('fontFamily'),
      fontSize: document.getElementById('fontSize'),
      lineHeight: document.getElementById('lineHeight'),
      fontWeight: document.getElementById('fontWeight'),
      textColor: document.getElementById('textColor'),
      textColorBox: document.getElementById('textColorBox'),
      textColorPicker: document.getElementById('textColorPicker'),
      
      // Colors
      bgColor: document.getElementById('bgColor'),
      bgColorBox: document.getElementById('bgColorBox'),
      bgColorPicker: document.getElementById('bgColorPicker'),
      bgGradientPickers: document.getElementById('bgGradientPickers'),
      textColor2: document.getElementById('textColor2'),
      textColorBox2: document.getElementById('textColorBox2'),
      textColorPicker2: document.getElementById('textColorPicker2'),
      
      // Box Model
      marginTop: document.getElementById('marginTop'),
      marginRight: document.getElementById('marginRight'),
      marginBottom: document.getElementById('marginBottom'),
      marginLeft: document.getElementById('marginLeft'),
      borderTop: document.getElementById('borderTop'),
      borderRight: document.getElementById('borderRight'),
      borderBottom: document.getElementById('borderBottom'),
      borderLeft: document.getElementById('borderLeft'),
      paddingTop: document.getElementById('paddingTop'),
      paddingRight: document.getElementById('paddingRight'),
      paddingBottom: document.getElementById('paddingBottom'),
      paddingLeft: document.getElementById('paddingLeft'),
      contentSize: document.getElementById('contentSize'),
      
      // Status
      statusMessage: document.getElementById('statusMessage')
    };
    
    console.log('pickButton element:', elements.pickButton);
    
    if (!elements.pickButton) {
      console.error('❌ Critical error: pickButton not found!');
      const statusEl = document.getElementById('statusMessage');
      if (statusEl) {
        statusEl.textContent = '❌ 错误：pickButton 未找到';
        statusEl.style.display = 'block';
        statusEl.style.background = 'red';
        statusEl.style.color = 'white';
      }
      return;
    }
    
    console.log('✅ pickButton found, setting up listeners...');
    setupEventListeners();
    pollForElementData();
    
    showStatus('🎯 Click "Start Picking" to select an element on the page', 'info', 5000);
    
    // 监听窗口关闭事件，清理页面上的覆盖层
    window.addEventListener('beforeunload', async () => {
      try {
        const tab = await getActiveTab();
        if (tab) {
          chrome.tabs.sendMessage(tab.id, { 
            type: 'cleanup'
          }).catch(() => {
            // 忽略错误，tab 可能已经关闭
          });
        }
      } catch (error) {
        console.log('Cleanup on beforeunload:', error);
      }
    });
    
    // 监听 visibilitychange 事件，当 panel 隐藏时也清理
    document.addEventListener('visibilitychange', async () => {
      if (document.hidden) {
        try {
          const tab = await getActiveTab();
          if (tab) {
            chrome.tabs.sendMessage(tab.id, { 
              type: 'cleanup'
            }).catch(() => {
              // 忽略错误
            });
          }
        } catch (error) {
          console.log('Cleanup on visibility change:', error);
        }
      }
    });
  }

  // 页面加载完成后初始化
  console.log('=== IIFE: Checking document readyState:', document.readyState);
  if (document.readyState === 'loading') {
    console.log('=== IIFE: Adding DOMContentLoaded listener');
    document.addEventListener('DOMContentLoaded', init);
  } else {
    console.log('=== IIFE: DOM already loaded, calling init()');
    init();
  }
  
  console.log('=== IIFE: End of IIFE execution ===');
})();
