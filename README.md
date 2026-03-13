# StyleProbe

> 一款面向开发者与设计师的 Chrome 扩展，让你像用 Figma 一样在真实页面上
> 查看、测量和实时编辑任意元素的 CSS 样式——完整支持桌面端与移动端。

![StyleProbe Demo](https://i.imgur.com/c1ou3JU.png)

---

## ✨ 核心功能

| 功能 | 描述 |
|------|------|
| 🎯 **元素拾取** | 移动端 / 桌面端均可点选元素，蓝框悬停预览，橙框锁定选中 |
| 📐 **间距测量** | 类 Figma 红线标注，实时显示任意两元素之间的像素距离 |
| 🎨 **实时样式编辑** | 直接在 Side Panel 修改 CSS 值，Enter / 失焦立即生效 |
| 📦 **Box Model 可视化** | 一键查看 content / padding / border / margin 完整盒模型 |
| 🔍 **样式过滤** | 关键词搜索，快速定位目标 CSS 属性 |
| 📋 **选择器复制** | 自动生成最优选择器，一键复制到剪贴板 |
| 📱 **移动端防御** | 彻底拦截长按系统菜单、文本选择、图片保存弹窗，保障移动端调试体验 |
| 🔄 **无损调试** | 所有修改仅在当前会话有效，关闭即还原，不影响线上页面 |

---

## 📦 安装

### 1. 克隆项目

```bash
git clone https://github.com/lessten1211/css-inspector.git
cd css-inspector
```

### 2. 在 Chrome 中加载

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角的 **「开发者模式」**
3. 点击 **「加载已解压的扩展程序」**
4. 选择项目根目录 `css-inspector/`
5. 工具栏出现 StyleProbe 图标，安装完成 ✅

---

## 🚀 使用方法

### 基本流程

```
点击工具栏图标 → 打开 Side Panel → 点击 "Start Picking"
→ 鼠标悬停（蓝框预览）→ 点击锁定（橙框选中）
→ 在 Panel 中查看 / 编辑样式 → 点击 "Stop Picking" 退出
```

### 桌面端

1. **打开扩展**：点击工具栏 StyleProbe 图标，Side Panel 在右侧打开
2. **拾取元素**：点击 **Start Picking**，鼠标悬停出现蓝框，点击锁定为橙框
3. **查看间距**：选中元素后悬停其他元素，停留 300ms 后显示红线间距标注
4. **编辑样式**：直接修改 Panel 中的属性值，按 `Enter` 或失焦即时生效
5. **过滤属性**：在 *Filter properties...* 输入框键入关键词快速定位
6. **退出模式**：点击 **Stop Picking** 或关闭 Panel，所有高亮标注自动清除

### 移动端（iOS Safari / Android Chrome）

> 移动端已内置长按防御，调试时不会触发系统菜单、文本选择或图片保存弹窗。

1. 在 Chrome DevTools **Device Mode** 或真实移动设备上打开目标页面
2. 正常点击 **Start Picking** 进入拾取模式
3. **单击**元素即可选中——长按不会再弹出系统干扰菜单
4. 其余操作与桌面端一致

---

## 🗂️ 项目结构

```
css-inspector/
├── manifest.json                         # Manifest V3 扩展配置
├── service_worker.js                     # 后台脚本（消息中转、生命周期管理）
├── content_script.js                     # 内容脚本（元素拾取、高亮、样式应用）
├── panel.html                            # Side Panel 页面
├── panel.js                              # Side Panel 交互逻辑
├── panel.css                             # Side Panel 样式
├── test.html                             # 本地调试用测试页面
├── icons/                                # 扩展图标（16 / 48 / 128px）
├── core/                                 # 核心公共逻辑
├── modules/                              # 功能子模块
├── utils/                                # 工具函数
├── tabs/                                 # 标签页相关处理
└── features/
    ├── component-detector/               # 组件识别（含框架映射表 mappings/）
    ├── figma-exporter/                   # Figma 格式导出
    └── mobile-adapter/
        └── touch-defense.js             # 📱 移动端长按防御模块
```

---

## 🔧 技术架构

### 通信机制

```
┌─────────────┐   chrome.runtime.sendMessage   ┌──────────────────┐
│  Side Panel │ ─────────────────────────────► │  Service Worker  │
│  (panel.js) │ ◄───────────────────────────── │(service_worker.js│
└─────────────┘   forwardToPanel / response    └────────┬─────────┘
                                                        │ chrome.tabs.sendMessage
                                               ┌────────▼─────────┐
                                               │  Content Script  │
                                               │(content_script.js│
                                               └──────────────────┘
```

### Manifest V3

采用最新 Chrome Extension Manifest V3 标准，Service Worker 取代持久化后台页，更安全、更省资源。

### 📱 移动端防御（Touch Defense）

`features/mobile-adapter/touch-defense.js` 在检查模式激活期间提供双层防御：

| 层级 | 手段 | 解决的问题 |
|------|------|-----------|
| **CSS 层** | `-webkit-touch-callout: none` | iOS 长按系统菜单 |
| **CSS 层** | `user-select: none`（全前缀） | 文本选择 + 放大镜 |
| **CSS 层** | `-webkit-tap-highlight-color: transparent` | Android 点击蓝色闪烁 |
| **CSS 层** | `pointer-events: none`（仅图片） | 图片「保存 / 识别二维码」菜单 |
| **JS 层** | `contextmenu` 事件拦截（`passive: false`） | 长按上下文菜单 |
| **JS 层** | `selectstart` 事件拦截（`passive: false`） | 文本选择链路 |
| **JS 层** | `dragstart` 事件拦截 | 三星等浏览器图片拖拽 |

> ⚠️ `touchstart` / `touchmove` / `touchend` **不做任何拦截**，自定义变色逻辑完全不受影响。

---

## 🌐 兼容性

| 环境 | 状态 |
|------|------|
| Chrome 88+（桌面） | ✅ 完全支持 |
| Edge 88+（Chromium 内核） | ✅ 完全支持 |
| Chrome for Android | ✅ 支持（含移动端防御） |
| iOS Safari（通过 WebKit） | ✅ 支持（含 `-webkit-` 前缀） |
| Firefox / Safari 桌面版 | ⚠️ 不支持（Manifest V3 兼容性差异） |

---

## 🔒 安全性

- ✅ **零网络请求**：不向任何外部服务器发送数据
- ✅ **无远程依赖**：不引入任何 CDN 脚本或第三方库
- ✅ **最小权限**：仅申请 `activeTab`、`scripting`、`storage`、`sidePanel`
- ✅ **会话隔离**：所有修改仅在当前标签页当前会话有效，刷新即还原

---

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

```bash
# 1. Fork 并克隆
git clone https://github.com/<your-name>/css-inspector.git

# 2. 创建特性分支
git checkout -b feature/your-feature

# 3. 提交更改
git commit -m 'feat: add your feature'

# 4. 推送并发起 Pull Request
git push origin feature/your-feature
```

### 联系方式

- **微信**：Lessten56
- **GitHub**：[@lessten1211](https://github.com/lessten1211)
- **项目地址**：[github.com/lessten1211/css-inspector](https://github.com/lessten1211/css-inspector)

---

## 📄 许可证

MIT License — Copyright © 2026 Lessten

---

**享受 CSS 调试的乐趣！** 🎨✨  
如果这个项目对你有帮助，欢迎给个 ⭐️ Star！
