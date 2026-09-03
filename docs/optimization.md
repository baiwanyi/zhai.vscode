# 系统优化指南

**版本**：1.0
**日期**：2026-05-30
**状态**：待实施

---

本文档汇总了项目的安全性、稳定性与性能优化项，按优先级分为 P0~P3 四个等级。每个优化项包含问题描述、影响评估、推荐方案和预估工作量。

| 优先级 | 说明                 |
|--------|----------------------|
| P0     | 严重问题，必须立即修复 |
| P1     | 重要优化，短期实施     |
| P2     | 一般优化，持续改进     |
| P3     | 锦上添花，后续规划     |

---

## 目录

1. [安全性 (Security)](#1-安全性-security)
2. [稳定性 (Stability)](#2-稳定性-stability)
3. [性能 (Performance)](#3-性能-performance)
4. [项目已做好的防护措施](#4-项目已做好的防护措施)
5. [实施路线建议](#5-实施路线建议)

---

## 1. 安全性 (Security)

### 1.1 [P0] 缺少 CORS 中间件

**问题**：`cors` 包已安装在 `package.json` 中，但 `server.ts` 未导入和使用。当前服务器监听 `0.0.0.0`，任意第三方网站均可通过浏览器发起 API 请求。

**影响**：跨站请求伪造 (CSRF) 风险。若应用暴露在局域网中，攻击者可直接利用用户浏览器调用全部 API（包括删除、AI 对话等敏感操作）。

| 涉及文件 | 位置 |
|----------|------|
| `apps/server.ts` | 中间件配置区域 (第 47~53 行) |

**推荐方案**：

```typescript
import cors from 'cors'

app.use(cors({
    origin: appConfig.mode === 'production'
        ? ['http://localhost:3000', 'http://127.0.0.1:3000']  // 生产环境限制来源
        : '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}))
```

**预估工作量**：极小（约 10 行代码）

---

### 1.2 [P0] 缺少请求频率限制

**问题**：`express-rate-limit` 已安装但未使用。所有 API 接口均无频率限制，可被无限制调用。

**影响**：
- `POST /api/reader/scan` 可被反复触发，导致大规模磁盘扫描
- `GET /api/gallery/random` 可被高频请求拖垮数据库
- `POST /api/deepseek/ai/chat/send` 可被滥用消耗 AI API 额度
- 所有 API 端点均存在暴力攻击风险

| 涉及文件 | 位置 |
|----------|------|
| `apps/server.ts` | 第 47~53 行（安全中间件区域） |

**推荐方案**：

```typescript
import rateLimit from 'express-rate-limit'

// 全局通用限制
const globalLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,  // 1 分钟
    max: 100,                  // 最多 100 次请求
    standardHeaders: true,
    legacyHeaders: false,
})

// 敏感操作限制（扫描、AI 对话等）
const strictLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 10,
})

app.use(globalLimiter)
// 对敏感路由单独应用严格限制
// app.use('/api/reader/scan', strictLimiter)
// app.use('/api/deepseek/ai/chat/send', strictLimiter)
```

**预估工作量**：小（约 30 行代码）

---

### 1.3 [P1] Python 脚本路径遍历风险

**问题**：`gallery.controller.ts` 中 `runPythonScript` 函数将 `req.query.dir`/`source`/`target` 直接传递给 Python 子进程参数，未做路径安全校验。

| 涉及文件 | 代码位置 |
|----------|----------|
| `modules/Gallery/gallery.controller.ts` | 第 461~499 行 |
| `apps/utils/python.ts` | 第 164~235 行 |

**当前代码（简化）**：

```typescript
const dir = typeof req.query.dir === 'string' ? req.query.dir.trim() : ''
// 未做路径安全检查，直接拼入 args
if (dir) args.push(dir)
const handle = await usePython(scriptPath, args, res)
```

**推荐方案**：
- 对传入的路径参数进行归一化和白名单校验
- 使用 `path.resolve` 解析后，校验是否在允许的根目录范围内
- 对非法路径直接拒绝（返回 403）

```typescript
function sanitizePath(input: string): string | null {
    const normalized = path.normalize(input)
    // 检查路径穿越
    if (normalized.includes('..')) return null
    // 检查是否在允许的根目录下
    const resolved = path.resolve(normalized)
    // ... 更多校验逻辑
    return resolved
}
```

**预估工作量**：小（约 20 行代码 + 工具函数）

---

### 1.4 [P1] 文件上传安全增强

**问题**：Notebook 模块的文件上传存在以下风险：
- MIME 类型完全依赖客户端声明（可伪造）
- 上传文件名未做消毒处理
- 内存存储 (memoryStorage)，大文件并发可能 OOM

| 涉及文件 | 代码位置 |
|----------|----------|
| `modules/Notebook/router/notebook.route.ts` | 第 33~50 行 |

**推荐方案**：
1. 增加文件内容头检测（Magic Bytes），验证文件类型是否与 MIME 声明一致
2. 对上传文件名进行消毒，移除危险字符
3. 内存存储改为磁盘临时存储（`multer.diskStorage`），或保持内存但降低并发限制

```typescript
// 文件名消毒
function sanitizeFileName(name: string): string {
    return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\.\./g, '')
}
```

**预估工作量**：中（约 40 行代码）

---

### 1.5 [P2] 缺少请求日志审计

**问题**：服务器未使用日志中间件（如 `morgan`），安全事件发生后无法追溯访问来源。

| 涉及文件 | 位置 |
|----------|------|
| `apps/server.ts` | 中间件配置区域 |

**推荐方案**：

```typescript
import morgan from 'morgan'

app.use(morgan(appConfig.mode === 'production' ? 'combined' : 'dev'))
```

**预估工作量**：极小（约 5 行代码）

---

### 1.6 [P2] 统一错误响应格式

**问题**：项目中 API 错误响应格式不一致：
- Gallery 模块多数返回 `{ error: 'message' }`
- Reader 模块返回 `{ error: true, message: '...' }`
- 全局错误中间件返回 `{ error: 'message' }`

**影响**：前端错误处理需要适配多种格式，增加复杂度。

| 涉及文件 | 范围 |
|----------|------|
| `modules/Gallery/gallery.controller.ts` | 全部 |
| `modules/Reader/reader.controller.ts` | 全部 |
| `apps/server.ts` | 全局错误处理 |

**推荐方案**：统一为 `{ error: true, message: string, details?: unknown }` 格式，并通过中间件或工具函数自动包装所有错误响应。

**预估工作量**：中（涉及多个文件的修改）

---

### 1.7 [P2] dotfiles 允许的安全风险

**问题**：缩略图回退时使用 `{ dotfiles: 'allow' }` 选项，若路径存在漏洞可能导致敏感文件（如 `.env`）被泄露。

| 涉及文件 | 代码位置 |
|----------|----------|
| `modules/Gallery/gallery.controller.ts` | 第 386~388 行 |

**推荐方案**：移除 `dotfiles: 'allow'`，或在回退前校验文件类型白名单。

**预估工作量**：极小（约 2 行代码）

---

### 1.8 [P2] JSON 解析未做严格校验

**问题**：`gallery.controller.ts` 第 91 行的 `JSON.parse(String(req.query.exclude || '[]'))` 缺少对输入格式的校验，如果传入非法 JSON 字符串会抛出异常。

| 涉及文件 | 代码位置 |
|----------|----------|
| `modules/Gallery/gallery.controller.ts` | 第 90~92 行 |

**推荐方案**：当前的 `try/catch` 已提供基本保护，可进一步考虑使用替代解析方式（如传值列表而非 JSON 字符串）。

**预估工作量**：极小（视方案而定）

---

### 1.9 [P3] API 认证机制

**问题**：所有 API 端点无身份验证。服务器暴露于局域网时，任何人都可访问全部数据。

**影响**：当应用部署到非本地环境时，数据完全暴露。

**推荐方案**：
- 添加简单的 Basic Auth 或 Bearer Token 认证
- 认证信息从 `app.yaml` 或环境变量读取
- 可通过中间件选择性保护敏感路由

```typescript
// 简易认证中间件
function authMiddleware(req: Request, res: Response, next: NextFunction) {
    const token = req.headers.authorization
    if (token === `Bearer ${appConfig.server.apiToken}`) {
        next()
    } else {
        res.status(401).json({ error: true, message: '未授权访问' })
    }
}
```

**预估工作量**：中（需设计认证架构，约 30 行代码）

---

## 2. 稳定性 (Stability)

### 2.1 [P1] 大 TXT 文件全量读入内存

**问题**：Reader 模块的 `detectAndRead` 函数通过 `readFileSync` 一次性读取整个文件到内存中。

| 涉及文件 | 代码位置 |
|----------|----------|
| `modules/Reader/reader.service.ts` | 第 51~61 行 |

**当前代码**：

```typescript
function detectAndRead(filePath: string): { encoding: string; content: string } {
    const fd = readFileSync(filePath)       // 同步读取全部内容到内存
    const headBuffer = fd.subarray(0, Math.min(65536, fd.byteLength))
    const detected = jschardet.detect(headBuffer)
    const encoding = detected?.encoding ? detected.encoding.replace('-', '') : 'UTF-8'
    const content = iconv.decode(fd, encoding)  // 解码全文
    return { encoding, content }
}
```

**影响**：100MB+ 的 TXT 文件会导致：
- 内存占用飙升
- Node.js 事件循环阻塞（同步 I/O）
- 扫描阶段 OOM 崩溃

**推荐方案**：
- 编码检测保持现状（只读头部 64KB）
- 文件内容改为流式分块读取（按章节或固定大小分块）
- 数据库存储改为存储文件路径 + 编码信息，仅在阅读时流式读取

**预估工作量**：中（涉及数据模型和读取逻辑改造）

---

### 2.2 [P1] Python 子进程缺少超时限制

**问题**：`apps/utils/python.ts` 的 `executePythonScript` 函数在 `spawn` 子进程后没有设置超时机制。如果 Python 脚本陷入死循环或挂起，进程会无限占用系统资源。

| 涉及文件 | 代码位置 |
|----------|----------|
| `apps/utils/python.ts` | 第 188~235 行 |

**推荐方案**：

```typescript
const PROCESS_TIMEOUT = 5 * 60 * 1000  // 5 分钟

const timeout = setTimeout(() => {
    child.kill('SIGTERM')
    events.onError?.(new Error('Python 脚本执行超时，已终止'))
    res.end()
}, PROCESS_TIMEOUT)

child.on('close', (code) => {
    clearTimeout(timeout)
    // ... 剩余处理
})
```

**预估工作量**：小（约 15 行代码）

---

### 2.3 [P2] 扫描并发锁（避免并行触发）

**问题**：`POST /api/reader/scan` 可被多次并发调用。多个 `walkDirectory` + `computeMD5` 同时运行会相互竞争磁盘 I/O，且数据库写入无保护。

**影响**：并发扫描可能导致：
- 重复导入（TOCTOU 竞争条件）
- 磁盘 I/O 飙高
- 数据库写冲突

| 涉及文件 | 范围 |
|----------|------|
| `modules/Reader/reader.service.ts` | `scanAndImport` 函数 |
| `modules/Reader/reader.controller.ts` | `scanDirectory` 函数 |

**推荐方案**：使用简单的互斥锁防止并发扫描：

```typescript
let isScanning = false

export async function scanAndImport(txtDir: string): Promise<ScanResult> {
    if (isScanning) {
        throw new Error('扫描任务正在进行中，请等待完成后再试')
    }
    isScanning = true
    try {
        // ... 扫描逻辑
    } finally {
        isScanning = false
    }
}
```

**预估工作量**：小（约 10 行代码）

---

### 2.4 [P2] 批量导入缺少事务保护

**问题**：Reader 模块的文件逐一导入（第 126~142 行）在循环中逐个执行异步操作，无事务包裹，中间失败会导致部分写入。

| 涉及文件 | 代码位置 |
|----------|----------|
| `modules/Reader/reader.service.ts` | 第 126~142 行 |

**影响**：
- TOCTOU 竞争：MD5 检查到写入之间存在时间窗口
- 批量导入中途失败后，部分文件已写入但部分未写入，状态不一致

**推荐方案**：
- 先收集所有待导入文件和 MD5，批量检查去重
- 对新增文件在一个事务内批量写入
- 利用 `SQLiteManager.transaction` 方法

**预估工作量**：中（需重构文件导入流程）

---

### 2.5 [P2] 并发扫描中的 TOCTOU 竞争

**问题**：`reader.service.ts` 中的 `computeMD5` → `isAlreadyImported` → `importSingleFile` 三步之间不是原子的，并发扫描可能重复导入同一文件。

**推荐方案**：
- 结合上述并发锁和事务保护解决
- 数据库层依赖 `fileHash` 的 UNIQUE 约束兜底

**预估工作量**：小（与 2.3 和 2.4 结合实施）

---

### 2.6 [P2] 文件上传缺少大小上限全局配置

**问题**：文件上传的大小限制分散在各模块配置中，缺少统一的配置中心管理。

| 涉及文件 | 位置 |
|----------|------|
| `modules/Notebook/router/notebook.route.ts` | 第 33~50 行（10MB 限制写死） |

**推荐方案**：将上传限制移动到 `app.yaml` 配置中统一管理。

**预估工作量**：小

---

## 3. 性能 (Performance)

### 3.1 [P1] 同步文件 I/O 阻塞事件循环

**问题**：Reader 模块多处使用 Node.js 同步文件 API，在扫描期间完全阻塞事件循环。

| 涉及文件 | 函数/位置 |
|----------|-----------|
| `modules/Reader/reader.service.ts` | `walkDirectory` (第 15~31 行) |
| `modules/Reader/reader.service.ts` | `detectAndRead` (第 51~61 行) |
| `modules/Reader/reader.service.ts` | `importSingleFile` (第 78~97 行) |

**影响**：扫描大量文件期间（如 1000+ 个 TXT），Node.js 事件循环被长时间阻塞，其他 HTTP 请求无法被响应。

**推荐方案**：

```typescript
// walkDirectory 改为异步递归
import { promises as fs } from 'node:fs'

async function walkDirectory(dir: string): Promise<string[]> {
    const results: string[] = []
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name)
            if (entry.isDirectory()) {
                results.push(...await walkDirectory(fullPath))
            } else if (entry.name.toLowerCase().endsWith('.txt')) {
                results.push(fullPath)
            }
        }
    } catch (err) {
        console.warn(`[Reader] 无法读取目录 ${dir}:`, err)
    }
    return results
}
```

**预估工作量**：中（涉及多个文件的改造）

---

### 3.2 [P2] COUNT 统计查询无缓存

**问题**：Gallery 的 `total` 计数、Reader 的书籍列表总条目数等统计查询每次都重新执行 `COUNT(*)`，对于大表（50w+ 记录）性能开销明显。

**影响**：高并发的随机浏览请求中，每次分页都重新计算总数，增加数据库压力。

**推荐方案**：
- 引入简单内存计数缓存（带过期时间）
- 或使用单独的表/字段维护统计值，增量更新

```typescript
const countCache = new Map<string, { value: number; expiresAt: number }>()

function getCachedCount(key: string, ttlMs: number): number | null {
    const entry = countCache.get(key)
    if (entry && entry.expiresAt > Date.now()) return entry.value
    return null
}

function setCachedCount(key: string, value: number, ttlMs: number): void {
    countCache.set(key, { value, expiresAt: Date.now() + ttlMs })
}
```

**预估工作量**：中（需实现缓存机制）

---

### 3.3 [P2] Python 子进程频繁创建销毁

**问题**：每个 Gallery Python 操作都 `spawn` 一个新进程，包括 `findPython()` 检测（虽然已有 Promise 缓存）。Python 进程启动开销较大（~100-500ms）。

**影响**：频繁执行 Python 脚本（如图片处理）时，进程创建销毁开销累积明显。

**推荐方案**：
- `findPython()` 的 Promise 缓存已做得很好了
- 对于高频调用的脚本，考虑复用子进程（通过 stdin/stdout 通信）
- 或改用 Node.js 原生方案（如 Sharp 替代 Pillow 任务）

**预估工作量**：大

---

### 3.4 [P3] 数据库连接池深度配置

**问题**：当前 SQLite 通过 `SQLiteManager.get()` 返回单例连接，但缺少连接池深度配置。

| 涉及文件 | 位置 |
|----------|------|
| `apps/sqlite.ts` | 第 161~216 行 |

**影响**：高并发写入场景下（如大量媒体导入），写操作仍然串行。

**推荐方案**：当前架构为单连接 + WAL 模式，在本地桌面应用场景下已够用。如需更高并发，可考虑：
- 使用 `better-sqlite3` 的多连接池
- 或改用 `sql.js` 在 Web Worker 中运行

**预估工作量**：大（架构级变更）

---

### 3.5 [P3] 缩略图计算缓存

**问题**：每次请求缩略图时，即使文件未变更，仍需检查缓存目录。对于频繁请求的热门图片，路径解析消耗累积。

**推荐方案**：在内存中维护一个 LRU 缓存（MD5 → 缓存路径映射），减少重复的磁盘 I/0。

**预估工作量**：中

---

### 3.6 [P3] HTTP 响应未启用 Brotli 压缩

**问题**：当前使用 `compression` 中间件支持 gzip，但未配置 Brotli 压缩。Brotli 对文本类资源的压缩率比 gzip 高约 20%。

**推荐方案**：
```typescript
import compression from 'compression'
app.use(compression({ brotli: { enabled: true, quality: 11 } }))
```
注意：`compression` 包默认不包含 Brotli，需要使用 `shrink-ray` 或替换为 `express-brotli`。

**预估工作量**：小

---

## 4. 项目已做好的防护措施

项目在以下方面已有良好的基础，值得肯定：

### 4.1 数据库层
- ✅ SQLite WAL 模式（提升并发性能）
- ✅ 性能 PRAGMA 优化（`cache_size = -80000`, `synchronous = NORMAL`, `temp_store = MEMORY`）
- ✅ 外键约束启用
- ✅ 迁移幂等性保障（`__migrations` 追踪表）
- ✅ 种子数据幂等执行（`__seeds` 追踪表）
- ✅ 事务支持（`transaction` / `transactionAsync`）

### 4.2 服务器层
- ✅ Helmet 安全头（CSP、XSS 保护）
- ✅ 请求体大小限制（JSON 1MB、URL-encoded 1MB）
- ✅ `X-Powered-By` 隐藏
- ✅ 响应压缩（gzip）
- ✅ 端口冲突友好提示
- ✅ 优雅关闭（SIGTERM/SIGINT）
- ✅ 全局错误处理中间件
- ✅ 未捕获异常/拒绝处理

### 4.3 安全层
- ✅ 静态文件路径穿越检查（`isWithinDirectory`）
- ✅ 绝对路径安全归一化（`normalizeAndCheck`）
- ✅ 加密密钥自动生成 + 持久化（`encryption.ts`）
- ✅ API Key AES-256-GCM 加密存储
- ✅ 缩略图哈希分桶目录（防止单目录文件过多）

### 4.4 前端
- ✅ React Query 数据缓存（`staleTime`）
- ✅ 图片懒加载（Intersection Observer）
- ✅ 响应压缩（gzip）

---

## 5. 实施路线建议

| 阶段 | 优先级 | 优化项 | 依赖 | 预估工时 |
|------|--------|--------|------|----------|
| **阶段一** | P0 | 添加 CORS 中间件 (1.1) | 无 | 10 min |
| **阶段一** | P0 | 添加请求频率限制 (1.2) | 无 | 20 min |
| **阶段一** | P1 | 添加 Python 子进程超时 (2.2) | 无 | 15 min |
| **阶段一** | P1 | Python 脚本路径遍历防护 (1.3) | 无 | 30 min |
| **阶段二** | P1 | 文件上传安全增强 (1.4) | 无 | 1h |
| **阶段二** | P1 | 大 TXT 文件流式读取 (2.1) | 无 | 3h |
| **阶段二** | P1 | 同步 I/O 异步化 (3.1) | 2.1 | 3h |
| **阶段二** | P2 | 添加请求日志 (1.5) | 无 | 10 min |
| **阶段三** | P2 | 扫描并发锁 (2.3) | 无 | 15 min |
| **阶段三** | P2 | 批量导入事务保护 (2.4) | 2.3 | 1h |
| **阶段三** | P2 | 统一错误响应格式 (1.6) | 无 | 1h |
| **阶段三** | P2 | 移除 dotfiles allow (1.7) | 无 | 5 min |
| **阶段四** | P2 | COUNT 统计缓存 (3.2) | 无 | 2h |
| **阶段四** | P2 | 文件上传集中配置 (2.6) | 无 | 30 min |
| **阶段五** | P3 | API 认证机制 (1.9) | 无 | 2h |
| **阶段五** | P3 | Python 子进程池复用 (3.3) | 2.2 | 4h |
| **阶段五** | P3 | 缩略图 LRU 缓存 (3.5) | 无 | 2h |
| **阶段六** | P3 | Brotli 压缩 (3.6) | 无 | 30 min |
| **阶段六** | P3 | 数据库连接池深度 (3.4) | 无 | 3h |

### 5.1 阶段一（立即实施 - 安全加固）

核心目标：**修补安全漏洞，防止被直接攻击**

1. 添加 CORS 中间件
2. 添加请求频率限制
3. 添加 Python 子进程超时
4. Python 脚本参数路径校验

### 5.2 阶段二（短期实施 - 稳定性提升）

核心目标：**提升系统稳定性，消除已知风险**

1. 文件上传安全增强
2. 大 TXT 文件流式读取
3. 同步 I/O 异步化改造
4. 添加请求日志

### 5.3 阶段三（持续改进 - 架构加固）

核心目标：**加固核心模块，提升数据一致性**

1. 扫描并发锁
2. 批量导入事务保护
3. 统一错误响应格式
4. 移除不安全配置

### 5.4 阶段四（性能优化 - 初步）

核心目标：**降低高频操作的开销**

1. COUNT 统计缓存
2. 文件上传集中配置

### 5.5 阶段五（深度优化 - 高级）

核心目标：**架构级改进，大幅度提升性能**

1. API 认证机制
2. Python 子进程池复用
3. 缩略图 LRU 缓存

### 5.6 阶段六（锦上添花）

核心目标：**极致性能与体验**

1. Brotli 压缩
2. 数据库连接池深度配置

---

## 附录：关键文件清单

| 文件 | 用途 |
|------|------|
| `apps/server.ts` | Express 服务器入口，安全/性能中间件配置 |
| `apps/config.ts` | 应用配置加载（`app.yaml`） |
| `apps/sqlite.ts` | SQLite 数据库管理器 |
| `apps/utils/python.ts` | Python 子进程执行工具 |
| `apps/utils/server.ts` | 服务端工具函数（路径安全等） |
| `apps/utils/encryption.ts` | AES-256-GCM 加密工具 |
| `modules/Gallery/gallery.controller.ts` | Gallery 模块控制器 |
| `modules/Reader/reader.service.ts` | Reader 模块服务层（文件扫描/导入） |
| `modules/Notebook/router/notebook.route.ts` | Notebook 路由（含文件上传配置） |
