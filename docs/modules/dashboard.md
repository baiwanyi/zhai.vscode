# 仪表盘 (Dashboard) — 完整设计方案

基于对项目现有 4 个数据库（`zhai.db`、`notebook.db`、`gallery.db`、`reader.db`）和 5 个业务模块（Notebook、Gallery、Reader、AI对话、Press）的深入分析，设计如下。

---

## 1. 页面整体布局

```
┌────────────────────────────────────────────────────────┐
│  顶部栏 (HomeHeader)                                    │
│  欢迎回来 · 宅桌面  |  2026年5月30日 星期六  02:55       │
├────────────────────────────────────────────────────────┤
│  关键数据概览 (StatCardRow)                               │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │ ✏️ 累计字数 │ │ 📚 书籍   │ │ 🔮 Token │ │ (备用)   │ │
│  │ 586,240   │ │ 47 本    │ │ 12,584  │ │          │ │
│  │           │ │           │ │ ~¥0.38  │ │          │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ │
├────────────────────────────────────────────────────────┤
│  快捷操作入口 (QuickActions)  — 一行 5 个大按钮            │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐                   │
│  │ 新建 │ │ 写作 │ │ 图库 │ │ AI  │ │ 阅读 │              │
│  │ 笔记 │ │ 编辑 │ │ 浏览 │ │ 对话 │ │书籍 │              │
│  └────┘ └────┘ └────┘ └────┘ └────┘                   │
├────────────────────────────────────────────────────────┤
│  ★★★ 网址快捷方式网格 (WidgetShortcut) — 主区域           │
│                                                         │
│  快捷方式                    [+ 添加] [📦 导入预设]     │
│                                                         │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐    │
│  │ 🔍 │ │ 💻 │ │ 📖 │ │ 🎬 │ │ 🛒  │ │ ☁️  │ │ ➕  │    │
│  │百度 │ │Git │ │知乎 │ │ B站 │ │淘宝 │ │阿里云│ │添加 │    │
│  └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘    │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐           │
│  │ 📧 │ │ 🐦 │ │ 📺 │ │ 🎵 │ │ 📝 │ │ 🎮  │           │
│  │邮箱 │ │微博 │ │油管 │ │网易云│ │飞书 │ │Steam│           │
│  └────┘ └────┘ └────┘ └────┘ └────┘ └────┘           │
│                                                         │
│  (拖拽排序 · 右键编辑/删除 · 自动获取 Favicon)          │
├────────────────────────────────────────────────────────┤
│  最近活动 (ActivityFeed)  |  待办事项 (WidgetTodo)       │
│  ┌──────────────────┐ ┌──────────────────┐             │
│  │ 📚 阅读斗破苍穹45%│ │ ☐ 更新 API Key    │             │
│  │ 📝 新建"React"   │ │ ☐ 扫描 TXT 目录  │             │
│  └──────────────────┘ └──────────────────┘             │
└────────────────────────────────────────────────────────┘
```

---

## 2. 变更清单（相比 V1）

| 移除项 | 替换/强化项 |
|--------|------------|
| 笔记总数卡片 | 保留「累计字数」卡片 |
| 媒体总数卡片 | 保留「书籍总数」卡片 |
| 收藏数量卡片 | 保留「今日Token」卡片 |
| 每日新增笔记柱状图 | **强化**为「网址快捷方式网格」 |
| 媒体分布饼图 | **强化**为「网址快捷方式网格」 |

最终 StatCard 网格调整为 3 张卡片 + 1 个预留空位。

---

## 3. 后端 API 设计

### 核心 API：`GET /api/dashboard/stats`

一次性聚合所有模块数据，减少网络请求。响应结构：

```typescript
interface DashboardStats {
    notebook: {
        totalNotebooks: number    // 笔记本总数
        totalNotes: number        // 笔记总数
        totalWords: number        // 内容总字符数
        todayNewNotes: number     // 今日新增
        totalTags: number         // 标签总数
        recentNotes: Array<{ sourceId: string; title: string; updatedAt: string }>
    }
    gallery: {
        totalMedia: number        // 媒体总数
        imageCount: number        // 图片数
        videoCount: number        // 视频数
        totalFavorites: number    // 收藏数
        totalShorts: number       // 短视频数
        todayNewMedia: number     // 今日新增
        sourceDistribution: Array<{ source: string; count: number }>
        typeDistribution: Array<{ type: string; count: number }>
        storageUsedBytes: number  // 占用磁盘空间
    }
    reader: {
        totalBooks: number        // 书籍总数
        totalChars: number        // 总字符数
        recentlyRead: Array<{ id: number; title: string; progress: number; lastReadAt: string }>
    }
    ai: {
        totalSessions: number     // 对话会话数
        todayTokens: number       // 今日 Token
        monthTokens: number       // 本月 Token
        estimatedCost: number     // 预估费用 (元)
        recentDays: Array<{ date: string; tokens: number }>  // 近7天
    }
    press: {
        totalProjects: number     // 作品数（Press上线后可用）
        totalChapters: number
        totalWords: number
    }
    diskUsage: {
        path: string
        totalBytes: number
        usedBytes: number
        freeBytes: number
        usagePercent: number      // 0~100
    }
}
```

**实现要点**：
- 新建 `modules/Dashboard/dashboard.stats.service.ts`，分别查询 4 个数据库
- 新建 `modules/Dashboard/dashboard.stats.controller.ts`，调用 Service 返回
- 新建 `modules/Dashboard/dashboard.route.ts`，注册到 `/api/dashboard`
- 在 `apps/server.ts` 中添加 `app.use('/api/dashboard', dashboardRouter)`

### 可选 API：`GET /api/dashboard/activity`

跨模块聚合最近操作，按时间倒序（取各模块最近 20 条记录合并后排序）。

---

## 4. 前端组件结构

```
modules/Dashboard/
├── dashboard.type.ts                  # 类型定义（含 ShortcutItem）
├── dashboard.hooks.ts                 # 自定义 Hooks
├── dashboard.stats.service.ts         # [服务端] 统计聚合
├── dashboard.stats.controller.ts      # [服务端] 控制器
├── dashboard.route.ts                 # [服务端] 路由
├── index.tsx                          # 主页面
└── layout/
    ├── HomeHeader.tsx                 # 已有，改造为欢迎横幅
    ├── StatCard.tsx                   # 统计卡片（通用）
    ├── StatCardRow.tsx                # 统计卡片行（4张）
    ├── WidgetShortcut.tsx             # ★★★ 强化：快捷方式网格
    ├── WidgetTodo.tsx                 # 已有，待办事项
    ├── ActivityFeed.tsx               # 最近活动列表
    └── QuickActions.tsx               # 快捷操作入口栏
```

---

## 5. 强化版网址快捷方式网格 — 完整方案

### 5.1 功能对标 Infinity New Tab Pro

| 功能点 | Infinity Pro | 本方案 |
|--------|-------------|--------|
| 磁贴式快捷方式 | ✅ 图标+名称+可选背景色 | ✅ 实现，更丰富 |
| 自动抓取网站 Favicon | ✅ 自动拉取 | ✅ 使用 `https://www.google.com/s2/favicons?domain=` |
| 自定义图标（Emoji/上传） | ✅ Emoji + 图标库 | ✅ Emoji + Tabler Icons 库 |
| 拖拽排序 | ✅ 自由拖拽 | ✅ 使用 HTML5 DnD API |
| 添加/编辑/删除 | ✅ 弹窗表单 | ✅ Dialog 弹窗 |
| 文件夹分组 | ✅ 文件夹收纳 | ⚠️ V1 暂不加，V2 扩展 |
| 背景图/壁纸 | ✅ 自定义背景 | ❌ 暂不实现（已有扩展页） |
| 云端同步 | ✅ 账号同步 | ❌ 本地 localStorage |

### 5.2 磁贴卡片规格

| 属性 | 值 |
|------|------|
| 尺寸 | `112×96px` (桌面)，响应式缩小 |
| 图标区 | 顶部 56px，大圆角 `rounded-xl` |
| 文字区 | 底部 40px，单行截断 |
| 默认图标 | 自动获取 Favicon + Emoji 备选 |
| 悬停效果 | 上浮 `translateY(-4px)` + 阴影加深 |
| 右键菜单 | 编辑 / 删除 / 新窗口打开 |

### 5.3 添加/编辑弹窗设计

```
┌────────────────────────────────────┐
│  ✏️ 添加快捷方式                      │
│                                      │
│  名称: [____________________]       │
│  网址: [____________________]       │
│                                      │
│  图标:                               │
│  ┌────────────────────────────────┐ │
│  │ ○ 自动 (Favicon)               │ │
│  │ ○ Emoji:  [😀 ▼]              │ │
│  │ ○ Tabler 图标: [🔍搜索...]     │ │
│  │ ○ 自定义颜色:  [🎨色板]       │ │
│  └────────────────────────────────┘ │
│                                      │
│  ┌──────┐      ┌──────┐            │
│  │ 取消  │      │ 保存  │            │
│  └──────┘      └──────┘            │
└────────────────────────────────────┘
```

### 5.4 空状态设计

```
┌──────────────────────────────────────────┐
│                                          │
│         🧭     (大图标)                   │
│     还没有快捷方式                          │
│   点击右上角"+"按钮添加你的常用网站           │
│                                          │
│    ❓ 预设常用网站快捷导入                    │
│    [  一键导入  ]                          │
│                                          │
└──────────────────────────────────────────┘
```

### 5.5 核心类型定义 (`dashboard.type.ts`)

```typescript
/** 快捷方式条目 */
export interface ShortcutItem {
    /** 唯一 ID（生成 UUID） */
    id: string
    /** 显示名称 */
    name: string
    /** 完整 URL（含协议） */
    url: string
    /** 图标类型 */
    iconType: 'favicon' | 'emoji' | 'tabler' | 'color'
    /** 图标值：favicon 存 domain, emoji 存 emoji char, tabler 存 icon name, color 存色值 */
    iconValue: string
    /** 排序序号 */
    order: number
    /** 自定义背景色（可选） */
    bgColor?: string
    /** 创建时间 */
    createdAt: string
}
```

### 5.6 图标渲染策略

```typescript
const ShortcutIcon = ({ item }: { item: ShortcutItem }) => {
    switch (item.iconType) {
        case 'favicon': {
            const domain = new URL(item.url).hostname
            return (
                <img
                    src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
                    alt={item.name}
                    className="size-8 rounded"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
            )
        }
        case 'emoji':
            return <span className="text-2xl">{item.iconValue}</span>
        case 'tabler': {
            const Icon = iconMap[item.iconValue]
            return Icon ? <Icon className="size-6" /> : <IconWorld className="size-6" />
        }
        case 'color':
            return (
                <div
                    className="size-8 rounded-lg"
                    style={{ backgroundColor: item.iconValue }}
                />
            )
        default:
            return <IconWorld className="size-6" />
    }
}
```

### 5.7 预设导入推荐列表

```typescript
const PRESETS = {
    '🔍 常用搜索': [
        { name: '百度', url: 'https://www.baidu.com' },
        { name: 'Google', url: 'https://www.google.com' },
        { name: 'Bing', url: 'https://www.bing.com' },
        { name: '搜狗', url: 'https://www.sogou.com' },
    ],
    '💻 开发工具': [
        { name: 'GitHub', url: 'https://github.com' },
        { name: 'Stack Overflow', url: 'https://stackoverflow.com' },
        { name: 'NPM', url: 'https://www.npmjs.com' },
        { name: 'MDN', url: 'https://developer.mozilla.org' },
        { name: 'Vercel', url: 'https://vercel.com' },
    ],
    '📖 内容平台': [
        { name: '知乎', url: 'https://www.zhihu.com' },
        { name: '哔哩哔哩', url: 'https://www.bilibili.com' },
        { name: '微博', url: 'https://weibo.com' },
        { name: '掘金', url: 'https://juejin.cn' },
    ],
    '🤖 AI 工具': [
        { name: 'DeepSeek', url: 'https://chat.deepseek.com' },
        { name: 'ChatGPT', url: 'https://chat.openai.com' },
        { name: 'Claude', url: 'https://claude.ai' },
        { name: '通义千问', url: 'https://tongyi.aliyun.com' },
    ],
}
```

---

## 6. 数据持久化方案

网址快捷方式使用 **localStorage** 存储（与浏览器扩展现有实现一致），额外可选后端同步：

| 键 | 值 | 说明 |
|----|-----|------|
| `dashboard_shortcuts` | `JSON.stringify(ShortcutItem[])` | 快捷方式列表 |
| `dashboard_shortcuts_version` | `number` | 版本号，用于迁移 |

**同步 API**（可选，二期实现）：

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/dashboard/shortcuts` | 获取存储的快捷方式 |
| `PUT` | `/api/dashboard/shortcuts` | 批量保存快捷方式 |
| `POST` | `/api/dashboard/shortcuts/sync` | 合并 localStorage 与服务端 |

> **为何优先 localStorage**：这是浏览器扩展已有的模式，即时响应无网络延迟。后端同步作为可选数据备份。

---

## 7. 快捷键支持

| 快捷键 | 功能 |
|--------|------|
| `Ctrl + D` | 将当前页面添加为快捷方式（需在应用内） |
| `↑↓←→` | 在网格中导航选中 |
| `Enter` | 打开选中的快捷方式 |
| `Delete` | 删除选中的快捷方式 |
| `/` | 聚焦搜索框（未来可加） |

---

## 8. 状态处理设计

所有组件需处理 4 种状态：

| 状态 | 表现 | 实现 |
|------|------|------|
| **Loading** | Skeleton 骨架屏 | `Skeleton className="h-24 w-full"` |
| **Empty** | 引导性空状态 | 图标 + 说明文字 + 操作指引 |
| **Error** | 错误提示 + 重试 | `toast.error()` + "重试"按钮 |
| **Data** | 正常展示 | 动画入场 (fadeIn) |

---

## 9. 依赖清单

| 依赖 | 用途 | 安装状态 |
|------|------|----------|
| `recharts` | 图表 | ✅ 已安装 |
| `@tabler/icons-react` | 图标 | ✅ 已安装 |
| `date-fns` | 日期格式化 | ✅ 已安装 |
| `sonner` | Toast 通知 | ✅ 已安装 |
| `react-router-dom` | 快捷操作路由跳转 | ✅ 已安装 |
| `@tanstack/react-query` | 数据缓存 | ❌ 可选安装（可用 useEffect 替代） |

---

## 10. 数据流图

```
用户访问 /
  ↓
Dashboard 组件挂载
  ↓
useDashboardStats() Hook 调用
  ↓
fetch GET /api/dashboard/stats
  ↓
dashboard.stats.controller.ts
  ↓
dashboard.stats.service.ts
  ├── notebook.db → 笔记/标签统计
  ├── gallery.db  → 媒体/收藏统计
  ├── reader.db   → 书籍/阅读统计
  └── zhai.db     → AI/Token 统计
  ↓
聚合 JSON 返回
  ↓
StatCardRow / ActivityFeed 展示
  ↓
用户在各模块间跳转
```

---

## 11. 实现工时估算

| 组件 | 工时 | 说明 |
|------|------|------|
| StatCardRow（3 卡 + 1 预留） | 2h | 简化版 |
| **WidgetShortcut 强化版** | **8h** | 核心：网格/拖拽/弹窗/图标/右键菜单/导入预设 |
| ActivityFeed（最近活动） | 2h | 从各模块聚合显示 |
| QuickActions（快捷入口） | 1h | 5 大按钮 |
| HomeHeader 改造 | 0.5h | |
| 后端 Stats API | 6h | 4 数据库聚合 |
| 后端 Activity API | 2h | 跨模块聚合 |
| WidgetTodo 保留扩展 | 1h | |
| **合计** | **~22.5h** | |

---

## 12. 扩展性考虑

- **Press 模块上线后**：在 `DashboardStats` 中添加 `press` 字段无需改接口结构
- **未来新增模块**：Service 层使用策略模式，每个模块独立统计函数
- **缓存策略**：后端可加 60s 内存缓存（使用 Node.js Map），避免高并发重复计算
- **定时刷新**：前端每 5 分钟自动 refetch，页面聚焦时立即刷新
- **快捷方式文件夹**：后续可添加分组功能，支持将多个快捷方式收纳到一个文件夹磁贴中
