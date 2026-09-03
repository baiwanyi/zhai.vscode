# 宅桌面 (Zhai Desktop) — 浏览器扩展完整设计方案

**版本**：1.0
**日期**：2026-05-30
**说明**：基于现有 `extensions/` 目录改造，从纯新标签页升级为网页采集工具

---

## 1. 概述

### 1.1 当前状态

现有浏览器扩展仅实现了一个简单的**新标签页覆盖**（`chrome_url_overrides.newtab`），展示时钟+搜索框+硬编码快捷方式。功能单一，与后端系统无交互。

### 1.2 目标用户场景

| 场景             | 描述                                                   | 对应需求 |
|------------------|--------------------------------------------------------|----------|
| **截图笔记**     | 浏览网页看到有价值内容，截图+OCR识别，编辑后保存为笔记 | 需求 2   |
| **选中文本收藏** | 选中网页段落，右键一键保存到笔记系统                   | 需求 3   |
| **整页采集**     | 自动识别网页正文，转为 Markdown，保存为笔记            | 需求 4   |
| **新标签页**     | 打开新标签页显示本地 Dashboard（localhost:3006）       | 需求 1   |

### 1.3 所有数据流向

```
浏览器网页 → 扩展采集 → [编辑/确认] → POST /api/notebook/create → notebook.db
```

所有采集内容最终都保存到**笔记模块**（Notebook），利用已有的 `notes` 表和 `POST /api/notebook/create` 接口。

---

## 2. 扩展架构总览

### 2.1 文件清单（改造后）

```
extensions/
├── icons/                       # 扩展图标（已存在）
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── manifest.json                # ★ 改造：添加权限、后台脚本、内容脚本等
├── index.html                   # ★ 改造：iframe 嵌入 localhost:3006
├── style.css                    # ★ 改造：新标签页样式
├── background.js                # ★ 新增：后台 Service Worker
├── content-script.js            # ★ 新增：内容脚本（选区交互）
├── screenshot-panel.html        # ★ 新增：截图编辑弹窗页面
├── screenshot-panel.css         # ★ 新增：截图编辑样式
├── screenshot-panel.js          # ★ 新增：截图编辑逻辑
└── lib/                         # ★ 新增：外部库
    └── tesseract.min.js         # 可选：Tesseract.js OCR 引擎
```

### 2.2 扩展组件通信架构

```
┌──────────────────────────────────────────────────────────────────┐
│                    Browser Extension Process                      │
│                                                                   │
│  ┌─────────────────────┐       ┌─────────────────────────────┐   │
│  │   background.js     │◄─────►│   content-script.js        │   │
│  │   (Service Worker)  │       │   (注入每个页面)           │   │
│  │                     │       │                             │   │
│  │  - 快捷键监听       │       │  - 监听选区变化            │   │
│  │  - 右键菜单管理     │       │  - 响应截图请求            │   │
│  │  - 消息路由         │       │  - 获取选中文本            │   │
│  │  - API 调用         │       │  - 读取 DOM 正文           │   │
│  │  - 截图触发         │       └─────────────────────────────┘   │
│  └──────────┬──────────┘                                         │
│             │                                                     │
│             ▼                                                     │
│  ┌─────────────────────┐       ┌─────────────────────────────┐   │
│  │  index.html         │       │  screenshot-panel.html      │   │
│  │  (新标签页)         │       │  (截图编辑弹窗)            │   │
│  │                     │       │                             │   │
│  │  iframe →           │       │  - OCR 文字展示            │   │
│  │  localhost:3006     │       │  - 文本编辑框              │   │
│  └─────────────────────┘       │  - 确认/取消按钮           │   │
│                                └─────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
         │                           │
         │     fetch API calls       │
         ▼                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Express Backend (localhost:3006)               │
│                                                                   │
│  POST /api/notebook/create     → 创建笔记                        │
│  POST /api/notebook/update     → 更新笔记                        │
│  GET  /api/reader/content      → 页面内容转 Markdown (可选)      │
└──────────────────────────────────────────────────────────────────┘
```

### 2.3 权限清单（manifest.json 新增）

| 权限                 | 用途                                       |
|----------------------|--------------------------------------------|
| `"activeTab"`        | 获取当前标签页截图和 URL/标题              |
| `"contextMenus"`     | 注册右键菜单                               |
| `"storage"`          | 存储扩展设置（服务器地址、快捷键等）       |
| `"scripting"`        | 注入 content script                        |
| `"tabs"`             | 标签页信息查询                             |
| `"host_permissions"` | `"http://localhost:3006/*"` 本地服务器访问 |
| `"commands"`         | 快捷键 `Ctrl+Shift+S` 触发截图             |

---

## 3. 需求 1：新标签页加载本地 Dashboard

### 3.1 实现方式

**方案**：新标签页 `index.html` 通过 `<iframe>` 嵌入 `http://localhost:3006`

```html
<!-- extensions/index.html (改造后) -->
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>宅桌面</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="app">
    <iframe
      id="dashboard-frame"
      src="http://localhost:3006"
      frameborder="0"
      sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
    ></iframe>
  </div>
  <!-- 当 localhost:3006 不可用时的降级显示 -->
  <div id="offline-overlay" class="hidden">
    <div class="offline-content">
      <div class="offline-icon">🔌</div>
      <h2>本地服务未运行</h2>
      <p>请启动宅桌面服务器后刷新页面</p>
      <button onclick="location.reload()">重试</button>
    </div>
  </div>
  <script src="script.js"></script>
</body>
</html>
```

### 3.2 离线检测逻辑

```javascript
// extensions/script.js (新增)
const iframe = document.getElementById('dashboard-frame')
const overlay = document.getElementById('offline-overlay')

// 心跳检测：每 10 秒检测服务器是否在线
async function checkServer() {
  try {
    const res = await fetch('http://localhost:3006/health', { signal: AbortSignal.timeout(3000) })
    if (res.ok) {
      overlay.classList.add('hidden')
      iframe.classList.remove('hidden')
    }
  } catch {
    overlay.classList.remove('hidden')
    iframe.classList.add('hidden')
  }
}

iframe.onerror = () => {
  overlay.classList.remove('hidden')
  iframe.classList.add('hidden')
}

setInterval(checkServer, 10000)
checkServer()
```

### 3.3 CSS 样式

```css
/* extensions/style.css (改造) */
* { margin: 0; padding: 0; box-sizing: border-box; }

html, body {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #0f172a;
}

#app {
  width: 100%;
  height: 100%;
}

#dashboard-frame {
  width: 100%;
  height: 100%;
  border: none;
}

/* 离线降级 */
#offline-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0f172a;
  color: #e2e8f0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

/* ... 更多样式 ... */
```

### 3.4 manifest 配置

```json
{
  "manifest_version": 3,
  "name": "宅桌面 - 网页采集器",
  "version": "2.0.0",
  "description": "网页内容采集，截图识别，右键收藏，一键保存到宅桌面笔记系统",
  "chrome_url_overrides": {
    "newtab": "index.html"
  },
  "permissions": [
    "activeTab",
    "contextMenus",
    "storage",
    "scripting",
    "tabs"
  ],
  "host_permissions": [
    "http://localhost:3006/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content-script.js"],
      "run_at": "document_idle"
    }
  ],
  "commands": {
    "capture-screenshot": {
      "suggested_key": {
        "default": "Ctrl+Shift+S",
        "mac": "Command+Shift+S"
      },
      "description": "截图文字识别"
    },
    "capture-page": {
      "suggested_key": {
        "default": "Ctrl+Shift+P",
        "mac": "Command+Shift+P"
      },
      "description": "采集整页正文"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

---

## 4. 需求 2：截图文字识别并保存

### 4.1 完整流程

```
用户按下 Ctrl+Shift+S
  ↓
background.js 接收 commands 事件
  ↓
chrome.tabs.captureVisibleTab() 截取当前窗口截图
  ↓
打开 screenshot-panel.html 弹窗，base64 传入
  ↓
screenshot-panel.js 加载图片到 Canvas
  ↓
用户可拖拽选择截图区域（裁剪框）
  ↓
确认区域后，调用 Tesseract.js OCR 识别文字
  ↓
识别结果展示在文本编辑框（contenteditable div）
  ↓
用户可以编辑/修改/删除错误文字
  ↓
用户点击"保存"按钮
  ↓
构造 payload：{ title, content, url, pageTitle, createdAt }
  ↓
POST http://localhost:3006/api/notebook/create
  ↓
保存成功 → 关闭弹窗 → 显示 toast 通知
```

### 4.2 后台脚本（background.js）核心逻辑

```javascript
// extensions/background.js

// ========== 配置 ==========
const SERVER_BASE = 'http://localhost:3006'

// ========== 快捷键监听 ==========
chrome.commands.onCommand.addListener((command) => {
  switch (command) {
    case 'capture-screenshot':
      triggerScreenshot()
      break
    case 'capture-page':
      triggerPageCapture()
      break
  }
})

// ========== 截图触发 ==========
async function triggerScreenshot() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab) return

    // 获取可见区域截图
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })

    // 存到 storage 供弹窗页面读取（弹窗无法直接接收参数）
    await chrome.storage.local.set({
      screenshotData: dataUrl,
      pageUrl: tab.url,
      pageTitle: tab.title,
    })

    // 打开截图编辑弹窗
    await chrome.windows.create({
      url: 'screenshot-panel.html',
      type: 'popup',
      width: 900,
      height: 700,
      focused: true,
    })
  } catch (err) {
    console.error('截图失败:', err)
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: '截图失败',
      message: err.message || '请检查权限设置',
    })
  }
}

// ========== 右键菜单初始化 ==========
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'save-selection',
    title: '保存选中文本到笔记',
    contexts: ['selection'],
  })
  chrome.contextMenus.create({
    id: 'capture-page',
    title: '采集整页内容到笔记',
    contexts: ['page'],
  })
})

// ========== 右键菜单响应 ==========
chrome.contextMenus.onClicked.addListener((info, tab) => {
  switch (info.menuItemId) {
    case 'save-selection':
      saveSelectedText(info.selectionText, tab)
      break
    case 'capture-page':
      // 向 content-script 发送消息，获取页面正文
      chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_CONTENT' })
      break
  }
})

// ========== 保存选中文本 ==========
async function saveSelectedText(text, tab) {
  if (!text || !text.trim()) return

  const note = {
    title: `网页摘录 - ${tab.title || '未知页面'}`,
    content: `> 来源：[${tab.title}](${tab.url})\n\n${text}`,
    sourceId: `ext_selection_${Date.now()}`,
    format: 'markdown',
  }

  try {
    const res = await fetch(`${SERVER_BASE}/api/notebook/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(note),
    })
    if (res.ok) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: '保存成功',
        message: `已保存选中文本到笔记：${tab.title}`,
      })
    }
  } catch (err) {
    console.error('保存失败:', err)
  }
}

// ========== 内容脚本消息处理 ==========
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PAGE_CONTENT_MARKDOWN') {
    savePageContent(message.markdown, message.title, sender.tab)
  }
})

// ========== 整页采集保存 ==========
async function savePageContent(markdown, title, tab) {
  const note = {
    title: `网页全文 - ${title || tab?.title || '未知页面'}`,
    content: `> 来源：[${tab?.title}](${tab?.url})\n\n---\n\n${markdown}`,
    sourceId: `ext_page_${Date.now()}`,
    format: 'markdown',
  }

  try {
    const res = await fetch(`${SERVER_BASE}/api/notebook/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(note),
    })
    if (res.ok) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: '采集完成',
        message: `已保存页面内容到笔记：${title || tab?.title || ''}`,
      })
    }
  } catch (err) {
    console.error('保存页面内容失败:', err)
  }
}

// ========== 从截图编辑弹窗接收保存请求 ==========
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SAVE_SCREENSHOT_NOTE') {
    saveScreenshotNote(message.note)
    sendResponse({ success: true })
  }
})

async function saveScreenshotNote(note) {
  try {
    const res = await fetch(`${SERVER_BASE}/api/notebook/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: note.title,
        content: note.content,
        sourceId: `ext_screenshot_${Date.now()}`,
        format: 'markdown',
      }),
    })
    if (res.ok) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: '保存成功',
        message: `截图笔记已保存：${note.title}`,
      })
    }
  } catch (err) {
    console.error('保存截图笔记失败:', err)
  }
}
```

### 4.3 截图编辑弹窗（screenshot-panel.html）

```html
<!-- extensions/screenshot-panel.html -->
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>截图编辑</title>
  <link rel="stylesheet" href="screenshot-panel.css">
</head>
<body>
  <div class="panel">
    <!-- 顶部工具栏 -->
    <div class="toolbar">
      <div class="toolbar-left">
        <span class="title">📷 截图文字识别</span>
      </div>
      <div class="toolbar-right">
        <span id="page-info" class="page-info"></span>
        <button class="btn btn-primary" id="btn-save" disabled>保存到笔记</button>
        <button class="btn btn-secondary" id="btn-cancel">取消</button>
      </div>
    </div>

    <!-- 主内容：双栏布局 -->
    <div class="main-content">
      <!-- 左侧：截图区域 -->
      <div class="screenshot-area">
        <div class="canvas-wrapper">
          <canvas id="screenshot-canvas"></canvas>
          <!-- 裁剪选框（鼠标拖拽） -->
          <div id="crop-box" class="crop-box"></div>
        </div>
        <div class="canvas-tips">
          拖拽选择识别区域 · 滚轮缩放
        </div>
      </div>

      <!-- 右侧：文字编辑区 -->
      <div class="text-area">
        <div class="text-header">
          <span>识别结果（可编辑）</span>
          <button class="btn btn-ghost" id="btn-ocr">🔄 重新识别</button>
        </div>
        <div
          id="ocr-text"
          class="ocr-text"
          contenteditable="true"
          placeholder="点击此处编辑识别结果..."
        ></div>
        <div class="text-footer">
          <span id="char-count">0 字</span>
        </div>
      </div>
    </div>
  </div>

  <script src="lib/tesseract.min.js"></script>
  <script src="screenshot-panel.js"></script>
</body>
</html>
```

### 4.4 截图编辑逻辑（screenshot-panel.js）

```javascript
// extensions/screenshot-panel.js

const canvas = document.getElementById('screenshot-canvas')
const ctx = canvas.getContext('2d')
const cropBox = document.getElementById('crop-box')
const ocrText = document.getElementById('ocr-text')
const btnSave = document.getElementById('btn-save')
const btnCancel = document.getElementById('btn-cancel')
const btnOcr = document.getElementById('btn-ocr')
const charCount = document.getElementById('char-count')
const pageInfo = document.getElementById('page-info')

let screenshotData = null
let pageUrl = ''
let pageTitle = ''
let isCropping = false
let cropStart = { x: 0, y: 0 }
let cropEnd = { x: 0, y: 0 }

// ========== 初始化 ==========
async function init() {
  // 从 storage 读取截图数据
  const data = await chrome.storage.local.get([
    'screenshotData',
    'pageUrl',
    'pageTitle',
  ])

  screenshotData = data.screenshotData
  pageUrl = data.pageUrl || ''
  pageTitle = data.pageTitle || ''

  if (!screenshotData) {
    ocrText.textContent = '未获取到截图数据，请重试'
    return
  }

  pageInfo.textContent = `📄 ${pageTitle || '未知页面'}`

  // 加载图片到 Canvas
  const img = new Image()
  img.onload = () => {
    canvas.width = img.width
    canvas.height = img.height
    ctx.drawImage(img, 0, 0)

    // 默认全选
    cropStart = { x: 0, y: 0 }
    cropEnd = { x: img.width, y: img.height }
    updateCropBox()

    // 自动 OCR 识别
    performOcr()
  }
  img.src = screenshotData
}

// ========== 裁剪选框交互 ==========
canvas.addEventListener('mousedown', (e) => {
  isCropping = true
  const rect = canvas.getBoundingClientRect()
  cropStart.x = e.clientX - rect.left
  cropStart.y = e.clientY - rect.top
})

canvas.addEventListener('mousemove', (e) => {
  if (!isCropping) return
  const rect = canvas.getBoundingClientRect()
  cropEnd.x = Math.min(Math.max(e.clientX - rect.left, 0), canvas.width)
  cropEnd.y = Math.min(Math.max(e.clientY - rect.top, 0), canvas.height)
  updateCropBox()
})

canvas.addEventListener('mouseup', () => {
  if (isCropping) {
    isCropping = false
    // 裁剪后重新 OCR
    performOcr()
  }
})

function updateCropBox() {
  const x = Math.min(cropStart.x, cropEnd.x)
  const y = Math.min(cropStart.y, cropEnd.y)
  const w = Math.abs(cropEnd.x - cropStart.x)
  const h = Math.abs(cropEnd.y - cropStart.y)

  cropBox.style.left = `${x}px`
  cropBox.style.top = `${y}px`
  cropBox.style.width = `${w}px`
  cropBox.style.height = `${h}px`
  cropBox.style.display = w > 0 && h > 0 ? 'block' : 'none'
}

// ========== OCR 识别 ==========
async function performOcr() {
  btnOcr.disabled = true
  btnOcr.textContent = '⏳ 识别中...'
  ocrText.textContent = '正在识别文字，请稍候...'

  try {
    // 截取裁剪区域的图片数据
    const x = Math.min(cropStart.x, cropEnd.x)
    const y = Math.min(cropStart.y, cropEnd.y)
    const w = Math.abs(cropEnd.x - cropStart.x) || canvas.width
    const h = Math.abs(cropEnd.y - cropStart.y) || canvas.height
    const imageData = ctx.getImageData(x, y, w, h)

    // 使用 OffscreenCanvas 提取裁剪区域
    const offCanvas = new OffscreenCanvas(w, h)
    const offCtx = offCanvas.getContext('2d')
    offCtx.putImageData(imageData, 0, 0)
    const blob = await offCanvas.convertToBlob({ type: 'image/png' })
    const url = URL.createObjectURL(blob)

    // Tesseract.js OCR
    const result = await Tesseract.recognize(url, 'chi_sim+eng', {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          btnOcr.textContent = `⏳ 识别中 ${Math.round(m.progress * 100)}%`
        }
      },
    })

    // 显示识别结果
    ocrText.textContent = result.data.text || '未识别到文字'
    updateCharCount()
    btnSave.disabled = false

    URL.revokeObjectURL(url)
  } catch (err) {
    console.error('OCR 识别失败:', err)
    ocrText.textContent = '识别失败，请手动输入文字\n\n' + err.message
  } finally {
    btnOcr.disabled = false
    btnOcr.textContent = '🔄 重新识别'
  }
}

// ========== 编辑区域监听 ==========
ocrText.addEventListener('input', updateCharCount)

function updateCharCount() {
  const text = ocrText.textContent || ''
  const count = text.replace(/\s/g, '').length
  charCount.textContent = `${count} 字`
  btnSave.disabled = !text.trim()
}

// ========== 保存 ==========
btnSave.addEventListener('click', async () => {
  const content = ocrText.textContent || ''
  if (!content.trim()) return

  const note = {
    title: `截图识别 - ${pageTitle || '未知页面'}`,
    content: `> 来源：[${pageTitle}](${pageUrl})\n> 识别时间：${new Date().toLocaleString()}\n\n${content}`,
  }

  // 发送给 background.js 保存
  chrome.runtime.sendMessage({ type: 'SAVE_SCREENSHOT_NOTE', note }, (res) => {
    if (res && res.success) {
      window.close()
    }
  })
})

btnCancel.addEventListener('click', () => window.close())
btnOcr.addEventListener('click', performOcr)

// ========== 启动 ==========
init()
```

### 4.5 OCR 引擎选择

| 方案                         | 优点                           | 缺点                                 | 推荐                     |
|------------------------------|--------------------------------|--------------------------------------|--------------------------|
| **Tesseract.js**（浏览器端） | 无需外部 API，完全离线，隐私好 | 识别速度慢（1-3秒），中文准确率 ~85% | ✅ 默认方案               |
| **百度 OCR API**             | 识别准确率高（~98%），速度快   | 需要 API Key，联网要求               | 备选（配置在扩展设置中） |
| **服务端 OCR**（后端集成）   | 统一管理，可选 PaddleOCR       | 增加后端依赖                         | 二期可加                 |

**实施建议**：初始实现使用 Tesseract.js（`chi_sim+eng` 语言包），扩展设置中提供可切换为百度 OCR API 的选项。

### 4.6 截图编辑弹窗 CSS

```css
/* extensions/screenshot-panel.css 关键样式片段 */
.panel {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #1e293b;
  color: #e2e8f0;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  background: #0f172a;
  border-bottom: 1px solid #334155;
}

.main-content {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.screenshot-area {
  flex: 1;
  position: relative;
  overflow: auto;
  background: #0f172a;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.canvas-wrapper {
  position: relative;
  display: inline-block;
}

.crop-box {
  position: absolute;
  border: 2px dashed #3b82f6;
  background: rgba(59, 130, 246, 0.1);
  pointer-events: none;
  z-index: 10;
}

.text-area {
  width: 380px;
  border-left: 1px solid #334155;
  display: flex;
  flex-direction: column;
}

.ocr-text {
  flex: 1;
  padding: 16px;
  font-size: 14px;
  line-height: 1.6;
  color: #e2e8f0;
  background: #1e293b;
  border: none;
  outline: none;
  overflow-y: auto;
  white-space: pre-wrap;
}

.ocr-text:empty::before {
  content: attr(placeholder);
  color: #64748b;
}

.btn-primary {
  background: #3b82f6;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

---

## 5. 需求 3：选中文本右键菜单保存

### 5.1 实现流程

```
用户在网页中选中一段文字
  ↓
右键菜单自动出现"保存选中文本到笔记"
  ↓
点击菜单项 → background.js 的 contextMenus.onClicked 触发
  ↓
background.js 调用 saveSelectedText(selectionText, tab)
  ↓
构造笔记内容（加来源标记）
  ↓
POST /api/notebook/create
  ↓
提示保存成功/失败
```

### 5.2 Content Script 辅助（可选增强）

```javascript
// extensions/content-script.js
// 注入到页面中，用于辅助功能

// ========== 页面内容提取（供整页采集使用） ==========
// 监听 background 发来的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'GET_PAGE_CONTENT':
      extractPageContent()
      break
  }
})

/**
 * 使用 Readability 算法提取网页正文
 * 如果没有 Readability 库，用简易启发式提取
 */
function extractPageContent() {
  let content = ''

  // 尝试 1: 使用 <article> 标签
  const article = document.querySelector('article')
  if (article) {
    content = article.innerHTML
  }

  // 尝试 2: 使用主流内容容器的常见 class/id 选择器
  if (!content) {
    const selectors = [
      '.post-content', '.entry-content', '.article-content',
      '.content', '#content', '.main-content',
      '[role="main"]',
    ]
    for (const sel of selectors) {
      const el = document.querySelector(sel)
      if (el && el.textContent.trim().length > 200) {
        content = el.innerHTML
        break
      }
    }
  }

  // 尝试 3: 取 <body> 中文本最多的块级元素
  if (!content) {
    content = findMainContent()
  }

  // 发送回 background
  chrome.runtime.sendMessage({
    type: 'PAGE_CONTENT_MARKDOWN',
    markdown: htmlToMarkdown(content || document.body.innerHTML),
    title: document.title,
  })
}

/**
 * 简易启发式：找出 body 中文本内容最多的块级容器
 */
function findMainContent() {
  const blocks = document.querySelectorAll('p, div, section, main')
  let maxLen = 0
  let best = ''
  for (const block of blocks) {
    const text = block.innerText?.trim() || ''
    if (text.length > maxLen) {
      maxLen = text.length
      best = block.innerHTML
    }
  }
  return best
}

/**
 * HTML → Markdown 转换（简易版）
 * 生产环境建议使用 turndown 库
 */
function htmlToMarkdown(html) {
  // 简易实现：提取文本+保留链接
  const div = document.createElement('div')
  div.innerHTML = html

  // 移除脚本/样式
  div.querySelectorAll('script, style, nav, header, footer, aside').forEach(el => el.remove())

  // 提取纯文本段落
  const paragraphs = []
  div.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre').forEach(el => {
    const tag = el.tagName.toLowerCase()
    const text = el.textContent.trim()
    if (!text) return

    switch (tag) {
      case 'h1': paragraphs.push(`# ${text}`); break
      case 'h2': paragraphs.push(`## ${text}`); break
      case 'h3': paragraphs.push(`### ${text}`); break
      case 'h4': paragraphs.push(`#### ${text}`); break
      case 'h5': paragraphs.push(`##### ${text}`); break
      case 'h6': paragraphs.push(`###### ${text}`); break
      case 'li': paragraphs.push(`- ${text}`); break
      case 'blockquote': paragraphs.push(`> ${text}`); break
      case 'pre': paragraphs.push('```\n' + text + '\n```'); break
      default: paragraphs.push(text)
    }
  })

  return paragraphs.join('\n\n')
}
```

> **注意**：生产环境中建议使用完整的 [Turndown](https://github.com/mixmark-io/turndown) 库（~12KB gzip）替代简易 htmlToMarkdown，以获得更好的 Markdown 转换质量。可将 Turndown 打包到 content-script 中。

### 5.3 右键菜单注册

已在 `background.js` 的 `chrome.runtime.onInstalled` 中完成：

```javascript
chrome.contextMenus.create({
  id: 'save-selection',
  title: '保存选中文本到笔记',
  contexts: ['selection'],
})
```

**保存的笔记格式**：

```markdown
> 来源：[页面标题](页面URL)
> 保存时间：2026-05-30 03:01

选中文本内容...
```

---

## 6. 需求 4：自动识别网页主体内容并采集

### 6.1 两种触发方式

| 方式         | 触发                           | 说明                             |
|--------------|--------------------------------|----------------------------------|
| **快捷键**   | `Ctrl+Shift+P`                 | 立即采集当前页面                 |
| **右键菜单** | 右键 → "采集整页内容到笔记"    | 手动触发采集                     |
| **自动弹窗** | 用户停留页面 > 15 秒（可配置） | 可选：右下角浮窗提示"采集此页？" |

### 6.2 内容提取策略

```
页面 HTML
  │
  ├── 策略 1: <article> 标签（优先）
  │   └── 提取 article.innerHTML
  │
  ├── 策略 2: 常见内容容器选择器
  │   ├── .post-content, .article-content
  │   ├── #content, .content
  │   ├── [role="main"]
  │   └── .entry-content
  │
  ├── 策略 3: @mozilla/readability（推荐）
  │   └── 使用 Readability.js 算法（与 Firefox 阅读模式相同）
  │
  └── 策略 4: 启发式（备选）
      └── 找出 body 中文本最多的块级容器
```

### 6.3 Readability 集成方案

**推荐方案**：在 content-script 中集成 [@mozilla/readability](https://github.com/mozilla/readability) 库。

```javascript
// extensions/content-script.js (增强版)

// Readability 库（约 15KB gzip，可打包在扩展中）
import { Readability } from './lib/readability.js'

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'GET_PAGE_CONTENT':
      extractWithReadability()
      break
  }
})

function extractWithReadability() {
  // 克隆 document 避免干扰页面
  const docClone = document.cloneNode(true)
  const reader = new Readability(docClone)
  const article = reader.parse()

  if (article && article.textContent && article.textContent.trim().length > 100) {
    // 成功提取
    chrome.runtime.sendMessage({
      type: 'PAGE_CONTENT_MARKDOWN',
      markdown: htmlToMarkdown(article.content),
      title: article.title || document.title,
    })
  } else {
    // Readability 失败，使用启发式备选
    extractPageContent()
  }
}
```

### 6.4 保存格式

```markdown
> 来源：[页面标题](页面URL)
> 采集时间：2026-05-30 03:01

---

## 页面一级标题

正文内容（Markdown 格式）

### 小节标题

段落文字...

- 列表项 1
- 列表项 2

> 引用内容
```

---

## 7. 后端新增 API

当前已存在 `POST /api/notebook/create` 用于创建笔记，扩展可直接使用。但为支持扩展场景，建议新增一个**专用端点**方便扩展调用。

### 7.1 扩展专用端点（推荐新增）

```typescript
// modules/Extension/extension.route.ts
// 挂载到 /api/extension

// POST /api/extension/save
// Body:
interface SaveFromExtension {
    type: 'screenshot' | 'selection' | 'page'
    title: string
    content: string          // Markdown 格式的正文
    sourceUrl: string        // 来源页面 URL
    sourceTitle: string      // 来源页面标题
    collectedAt: string      // 采集时间 ISO 字符串
}

// Response:
interface SaveResponse {
    success: true
    noteId: number
}
```

### 7.2 复用现有笔记 API

如果不想新增路由，扩展直接调用已有接口：

```javascript
// 保存笔记（扩展通用格式）
POST /api/notebook/create
{
    "title": "截图识别 - 页面标题",
    "content": "> 来源：[标题](URL)\n> 时间：...\n\n正文内容",
    "format": "markdown",
    "sourceId": "ext_screenshot_1717000000000"  // 唯一去重ID
}
```

---

## 8. 扩展设置页面

### 8.1 设置项（存储于 chrome.storage.sync）

| 设置键              | 类型                   | 默认值                  | 说明                             |
|---------------------|------------------------|-------------------------|----------------------------------|
| `serverUrl`         | string                 | `http://localhost:3006` | 宅桌面服务器地址                 |
| `ocrEngine`         | 'tesseract' \| 'baidu' | `tesseract`             | OCR 引擎选择                     |
| `baiduApiKey`       | string                 | `''`                    | 百度 OCR API Key                 |
| `baiduSecretKey`    | string                 | `''`                    | 百度 OCR Secret Key              |
| `autoCaptureDelay`  | number                 | `15`                    | 自动弹窗采集延迟（秒），0 为关闭 |
| `defaultNotebookId` | number \| null         | `null`                  | 默认保存到的笔记本 ID            |

### 8.2 设置页面（options.html）

通过 `chrome.runtime.openOptionsPage()` 打开，或在扩展弹窗中提供设置入口。

```
┌────────────────────────────────────┐
│  ⚙️ 宅桌面扩展设置                   │
│                                      │
│  🔗 服务器地址                        │
│  [http://localhost:3006           ]  │
│                                      │
│  🖼️ OCR 引擎                         │
│  ○ Tesseract.js (本地)               │
│  ○ 百度 OCR API (需配置密钥)         │
│                                      │
│  ⏱️ 自动采集延迟                      │
│  [15] 秒（0=关闭）                   │
│                                      │
│  📁 默认笔记本:                      │
│  [未指定 ▼]                         │
│                                      │
│  ┌────────────────────┐             │
│  │      保存设置       │             │
│  └────────────────────┘             │
└────────────────────────────────────┘
```

---

## 9. 数据流与存储格式

### 9.1 笔记存储格式统一规范

所有扩展采集的笔记统一遵循以下格式：

```markdown
> 来源：[页面标题](页面URL)
> 采集方式：截图识别 / 选中文本 / 整页采集
> 采集时间：2026-05-30 03:01:00

---

正文内容（Markdown 格式）
```

### 9.2 sourceId 生成规则

```typescript
// 用于去重和溯源
const SOURCE_PREFIX = {
    screenshot: 'ext_screenshot',
    selection:  'ext_selection',
    page:       'ext_page',
}

const sourceId = `${SOURCE_PREFIX[type]}_${Date.now()}`
```

### 9.3 数据库笔记记录示例

```json
{
    "id": 123,
    "title": "整页采集 - React 官方文档",
    "notebookId": null,
    "format": "markdown",
    "sourceId": "ext_page_1717000000000",
    "content": "> 来源：[React 官方文档](https://react.dev)\n> 采集方式：整页采集\n> 采集时间：2026-05-30 03:01\n\n---\n\n# React 入门指南\n...",
    "summary": null,
    "isSticky": false,
    "createdAt": "2026-05-30 03:01:00",
    "updatedAt": "2026-05-30 03:01:00"
}
```

---

## 10. 错误处理与状态反馈

### 10.1 通知机制

使用 `chrome.notifications` 向用户反馈操作结果：

| 场景             | 通知标题   | 通知内容                                | 类型  |
|------------------|------------|-----------------------------------------|-------|
| 截图保存成功     | ✅ 保存成功 | 截图笔记已保存：xxx                     | basic |
| 选中文本保存成功 | ✅ 保存成功 | 已保存选中文本到笔记                    | basic |
| 整页采集成功     | ✅ 采集完成 | 已保存页面内容到笔记                    | basic |
| 服务器未运行     | ❌ 保存失败 | 无法连接到宅桌面服务器 (localhost:3006) | basic |
| 截图失败         | ❌ 截图失败 | 错误描述                                | basic |

### 10.2 离线检测

- 新标签页：实时检测服务器状态，离线时显示降级页面
- 后台脚本：每次保存前尝试连接，失败时弹出通知
- 心跳检测：每 30 秒检测一次 `/health` 端点

---

## 11. 快捷键一览

| 快捷键         | 功能                     | 注册方式        |
|----------------|--------------------------|-----------------|
| `Ctrl+Shift+S` | 截图文字识别（当前窗口） | chrome.commands |
| `Ctrl+Shift+P` | 采集整页内容             | chrome.commands |
| 右键菜单       | 保存选中文本 / 采集整页  | contextMenus    |

---

## 12. 文件变更清单

| 操作       | 文件                                        | 说明                                              |
|------------|---------------------------------------------|---------------------------------------------------|
| 🟢 改造     | `extensions/manifest.json`                  | 升级为完整扩展，添加权限/脚本/命令                |
| 🟢 改造     | `extensions/index.html`                     | 从独立新标签页改为 iframe 嵌入 Dashboard          |
| 🟢 改造     | `extensions/style.css`                      | 改为全屏布局+离线降级样式                         |
| 🟢 改造     | `extensions/script.js`                      | 添加 iframe 管理、离线检测、与后台通信            |
| 🟢 新增     | `extensions/background.js`                  | Service Worker：快捷键/右键菜单/API 调用/消息路由 |
| 🟢 新增     | `extensions/content-script.js`              | 内容脚本：页面内容提取、HTML→Markdown             |
| 🟢 新增     | `extensions/screenshot-panel.html`          | 截图编辑弹窗页面                                  |
| 🟢 新增     | `extensions/screenshot-panel.css`           | 截图编辑弹窗样式                                  |
| 🟢 新增     | `extensions/screenshot-panel.js`            | 截图编辑逻辑：裁剪/OCR/编辑/保存                  |
| 🟢 新增     | `extensions/options.html`                   | 扩展设置页面（可选）                              |
| 🟢 新增     | `extensions/options.js`                     | 扩展设置逻辑（可选）                              |
| 🟢 新增     | `extensions/lib/readability.js`             | @mozilla/readability 库（页面内容提取）           |
| 🟢 新增     | `extensions/lib/turndown.js`                | Turndown 库（HTML→Markdown 转换）                 |
| 🔵 可选新增 | `modules/Extension/extension.route.ts`      | 扩展专用后端 API                                  |
| 🔵 可选新增 | `modules/Extension/extension.controller.ts` | 扩展专用控制器                                    |

---

## 13. 实现顺序建议

| 阶段    | 任务                                                | 工时     | 产出物                 |
|---------|-----------------------------------------------------|----------|------------------------|
| **P1**  | manifest.json 改造 + 权限配置                       | 0.5h     | 升级后的 manifest.json |
| **P2**  | background.js 基本框架（快捷键/右键菜单/消息路由）  | 2h       | 可响应的后台脚本       |
| **P3**  | 右键菜单保存选中文本                                | 1h       | 右键→保存 完整链路     |
| **P4**  | content-script.js + Readability + Turndown 整页采集 | 3h       | 整页采集完整链路       |
| **P5**  | 新标签页改造（iframe + 离线检测）                   | 1h       | 新标签页显示 Dashboard |
| **P6**  | 截图编辑弹窗 + 裁剪交互                             | 3h       | 截图界面 UI            |
| **P7**  | Tesseract.js OCR 集成 + 编辑保存                    | 3h       | 截图识别完整链路       |
| **P8**  | 错误处理 + 通知机制 + 离线检测完善                  | 1.5h     | 用户反馈系统           |
| **P9**  | 扩展设置页面                                        | 1h       | options 页面           |
| **P10** | 后端专用 API（可选）                                | 1h       | Extension 模块         |
|         | **合计**                                            | **~17h** |                        |

---

## 14. 技术风险与注意事项

| 风险                   | 说明                                          | 缓解措施                                         |
|------------------------|-----------------------------------------------|--------------------------------------------------|
| **CSP 限制**           | 部分网站 CSP 可能阻止 content-script 注入     | Manifest V3 的 content_scripts 不受页面 CSP 限制 |
| **Tesseract.js 体积**  | 语言包 ~3MB，加载较慢                         | 初始只用 `chi_sim+eng`；提供百度 OCR 备选        |
| **large screenshot**   | 4K 屏幕截图可能 >10MB                         | Canvas 缩放后再传给 OCR                          |
| **iframe sandbox**     | Dashboard iframe 需要 sandbox 属性            | 使用 `allow-scripts allow-same-origin`           |
| **localStorage 隔离**  | extension 页面和 iframe 的 localStorage 隔离  | 通过 background 中转数据，或使用 chrome.storage  |
| **跨域问题**           | 扩展访问 localhost:3006 需要 host_permissions | 已在 manifest 中配置                             |
| **Readability 兼容性** | 部分 SPA 网站可能提取失败                     | 提供备选策略 + 手动编辑功能                      |
