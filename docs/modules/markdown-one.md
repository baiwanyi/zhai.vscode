# Markdown ONE — 模块设计文档

**版本**：1.0
**日期**：2026-09-03
**状态**：草案
**宿主**：VSCode 插件 Zhai（宅桌面）

---

## 1. 模块概述

### 1.1 定位

全插件统一的 **Markdown 处理管线**：解析、校验、格式化、增强语法、图片本地化、目录生成与导出。其他模块（笔记、写作、知识库、同步发布）都复用这一层，避免各自实现一套解析逻辑。

### 1.2 目标

- **一套 AST 走天下**：以 unified/remark 为统一管线，解析结果可被格式化、索引、导出、发布共用
- **对 VSCode 原生体验零侵入**：所有能力以命令/右键菜单提供，不接管保存流程
- **输出即可用**：导出的 Markdown/HTML 符合主流平台规范（GitHub、公众号、EPUB）

### 1.3 非目标

- 不做所见即所得块编辑（沿用 VSCode 原生编辑器）
- 不提供幻灯片/海报等花哨导出
- 不内置图床上传（图片本地化到工作区 `assets/`，发布时再按平台上传，见 `wechat.md`）

---

## 2. 用户场景

| 编号 | 场景 | 用户旅程 |
|------|------|----------|
| US-1 | 规范化导入 | 从别处拷来一份格式混乱的 md → 命令「格式化文档」→ 标题层级/列表/空行/标点统一 |
| US-2 | 图片本地化 | 笔记里全是外链图片 → 命令「图片本地化」→ 下载到 `assets/` 并重写为相对路径 |
| US-3 | 生成目录 | 长文写完后 → 命令「插入目录」→ 生成带锚点的 TOC，后续保存自动更新 |
| US-4 | 批量导出 | 选中 20 篇笔记 → 命令「导出」→ 合并为一个 HTML/PDF |
| US-5 | 粘贴富文本 | 从网页复制内容 → `Ctrl+V` → 自动转为 Markdown 表格/链接/加粗 |
| US-6 | 重命名同步 | 重命名一篇笔记 → 所有引用它的 `[[链接]]` 与相对图片链接同步更新 |

---

## 3. 功能清单

| 编号 | 功能点 | 描述 | 优先级 | 状态 |
|------|--------|------|--------|------|
| M1 | Frontmatter 校验与修复 | 校验字段类型，缺失字段补全，支持自定义 schema | P0 | 待实现 |
| M2 | 文档格式化 | 标题层级递增、列表统一、空行规范、中英文标点与空格 | P0 | 待实现 |
| M3 | 增强语法支持 | `[[双向链接]]`、`#标签`、告警块、脚注、表格、Mermaid | P1 | 待实现 |
| M4 | 图片本地化 | 外链下载落盘 `assets/`，重写为相对路径 | P1 | 待实现 |
| M5 | 图片压缩 | 批量压缩（sharp），保留原图备份可选 | P2 | 待实现 |
| M6 | 路径重写 | 文件移动/重命名时批量更新链接与图片引用 | P1 | 待实现 |
| M7 | TOC 生成与更新 | 按标题生成目录，保存时可选自动更新 | P1 | 待实现 |
| M8 | 导出单文件 | Markdown / HTML（内联样式） | P0 | 待实现 |
| M9 | 导出合并 | 多选文件合并导出为一个文档 | P2 | 待实现 |
| M10 | 导出 PDF/DOCX | 经 HTML 走打印 / `docx` 库生成 | P2 | 待实现 |
| M11 | 粘贴富文本转 MD | 剪贴板 HTML → Turndown → Markdown | P1 | 待实现 |
| M12 | 预览主题 | GitHub / VSCode 风格预览，代码高亮与 Mermaid 渲染 | P1 | 待实现 |
| M13 | 批量替换 | 按 AST 精确替换（仅正文，不动代码块与链接） | P2 | 待实现 |
| M14 | 文档体检 | 报告死链、缺失图片、标题跳级、重复标题 | P2 | 待实现 |

---

## 4. 交互与流程

### 4.1 处理管线

```
文件内容 (string)
   │
   ▼  gray-matter
{ data: Frontmatter, content }
   │
   ▼  unified().use(remarkParse).use(remarkGfm).use(remarkWikilink)…
mdast（抽象语法树）
   │
   ├──► transform 插件链（按命令组合）
   │      · remarkToc        生成目录
   │      · remarkLocalImage 外链转本地
   │      · remarkDirective  告警块
   │      · remarkNormalize  标题层级/标点
   │
   ▼  remarkStringify / prettier
输出 Markdown ──► 写入文件或导出
   │
   ▼  remarkRehype → rehypeHighlight / rehypeMermaid
输出 HTML ──► 预览 / 导出 / 发布（公众号）
```

### 4.2 图片本地化

```
扫描 AST 中 type='image' 且 url 为 http(s)
   │
   ▼
下载（带超时 10s + 单次重试 + 体积上限 10MB）
   │
   ▼ 失败 → 保留原链接并在诊断面板报告
内容 hash 命名 → 写入 assets/<hash>.<ext>
   │
   ▼
AST 中 url 重写为相对路径（相对当前文件）
   │
   ▼
stringify 写回文件（单次 WorkspaceEdit，可撤销）
```

---

## 5. 关键技术选型

| 关注点 | 候选方案 | 结论 | 理由 |
|--------|----------|------|------|
| 解析管线 | `unified + remark` / 正则拼接 | **unified + remark** | AST 变换可靠，生态完整（gfm、toc、directive） |
| 格式化 | `prettier` / `remark-stringify` 选项 | **prettier（md 支持）** | 用户熟悉，规则统一；AST 结构改动仍走 remark |
| Frontmatter | `gray-matter` | **gray-matter** | 与 `common.md` 保持一致 |
| 双向链接 | `remark-wikilink` / 正则 | **remark-wikilink** | 导出时能正确渲染为链接；索引用正则（见 `notes.md`） |
| 告警块 | `remark-directive` + 自定义渲染 | **remark-directive** | 兼容 GitHub Alert 写法 |
| 代码高亮 | `shiki` / `highlight.js` | **shiki（导出） + VSCode 内置高亮（预览）** | shiki 输出内联样式，适合公众号/HTML 导出 |
| Mermaid | `mermaid` | **mermaid** | 主流事实标准 |
| 富文本转 MD | `turndown` + `turndown-plugin-gfm` | **turndown** | 与剪藏方案一致 |
| 图片处理 | `sharp` / ffmpeg | **sharp** | 图片压缩与格式转换，无需外部进程 |
| HTML 内联样式 | `juice` / 手写正则 | **juice** | 公众号不支持 `<style>`，必须内联（见 `wechat.md`） |
| PDF | 系统打印 / `puppeteer-core` | **HTML → 系统打印** | 零重型依赖；若需自动化，`puppeteer-core` **保持沙箱开启** |
| DOCX | `docx` | **docx** | 纯 JS 生成 |

> **弃用规避**：不使用 remark 已废弃的 `remark-github` 旧 API、不使用 `turndown` 直接改写原型方法的做法（改用 `addRule`）；不使用 `new Buffer()`。

---

## 6. 数据模型

本模块**不引入独立数据表**，复用：

- `files` 表（`common.md`）：标题、字数、标签、hash
- 图片本地化记录复用 `assets/` 目录与 Frontmatter，不额外建表
- 导出任务为一次性操作，不持久化

**Frontmatter 约定（统一 schema）**：

```yaml
---
title: 笔记标题
created: 2026-09-03T10:00:00+08:00
updated: 2026-09-03T11:20:00+08:00
tags: [技术, TypeScript]
summary: AI 生成的一句话摘要（可选）
pinned: false         # 笔记置顶
# 写作模块扩展字段（见 press.md）
status: draft
characters: [林凡]
plotLines: [主线]
wordGoal: 3000
---
```

**校验规则**：`title` 缺失时用首行 `#` 标题或文件名补全；`created` 缺失时用文件创建时间；未知字段保留不删除（尊重用户自定义）。

---

## 7. 接口与命令

| Command ID | 标题 | 说明 |
|------------|------|------|
| `zhai.md.format` | 格式化文档 | 规范化当前文档 |
| `zhai.md.formatAll` | 批量格式化 | 对选中目录/多文件执行 |
| `zhai.md.fixFrontmatter` | 修复 Frontmatter | 校验并补全字段 |
| `zhai.md.localizeImages` | 图片本地化 | 下载外链图片并重写路径 |
| `zhai.md.compressImages` | 压缩图片 | 批量压缩 `assets/` |
| `zhai.md.insertToc` | 插入目录 | 生成或更新 TOC |
| `zhai.md.pasteAsMarkdown` | 粘贴为 Markdown | 富文本转 MD |
| `zhai.md.export` | 导出 | 选择格式与范围 |
| `zhai.md.healthCheck` | 文档体检 | 报告死链/缺失图片/标题跳级 |

**Webview 方法**：`md/format`、`md/export`（含进度流）、`md/health`

```typescript
/** 导出请求 */
interface ExportRequest {
    method: 'md/export'
    payload: {
        format: 'markdown' | 'html' | 'pdf' | 'docx'
        scope: { uris: string[]; merge: boolean }
        options: {
            inlineStyles: boolean          // HTML/PDF 是否内联样式
            includeFrontmatter: boolean
            codeTheme: string
        }
    }
}

/** 导出进度（流式） */
interface ExportProgress {
    type: 'stream'
    reqId: string
    channel: 'progress'
    text: string                            // 如 "3/20 已处理"
    done: boolean
}
```

---

## 8. 验收标准

| 编号 | 场景 | 指标 |
|------|------|------|
| AC-1 | 格式化 | 1 万字文档格式化 < 500ms；格式化后再格式化无 diff（幂等） |
| AC-2 | Frontmatter 修复 | 缺失字段补全，未知字段不丢失 |
| AC-3 | 图片本地化 | 单张 < 2s；失败保留原链并报告；路径为相对路径 |
| AC-4 | TOC | 标题变更后「更新目录」一次生效，锚点可跳转 |
| AC-5 | 粘贴转 MD | 网页表格/链接/加粗转换保真度 ≥ 90% |
| AC-6 | 导出 HTML | 内联样式后在无网络环境正常显示，代码高亮生效 |
| AC-7 | 合并导出 | 20 篇合并为一个文档，章节顺序与选择顺序一致 |
| AC-8 | 文档体检 | 死链检出率 100%（人工构造 10 例） |
| AC-9 | 非破坏性 | 所有写操作走 `WorkspaceEdit`，可 `Ctrl+Z` 撤销 |
| AC-10 | 大文档 | 10 万字文档格式化不阻塞 UI（< 1s 或显示进度） |

---

## 9. 风险与开放问题

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 格式化改动用户刻意排版 | 体验受损 | 格式化前自动创建快照（见 `notes.md` 修订），并提供「仅检查不修改」模式 |
| 外链图片下载失败/防盗链 | 本地化中断 | 超时 + 重试 + 失败保留原链，输出失败清单 |
| 非标准 Markdown 方言（如 Obsidian callout） | 解析异常 | 通过 `remark-directive` 兼容主流写法，未知语法原样保留 |
| 导出 PDF 排版差异 | 输出不一致 | 提供预览 + 主题选择，PDF 走系统打印由用户最终确认 |
| 批量操作误伤 | 数据风险 | 批量操作前显示影响文件清单并二次确认 |
| shiki 体积较大 | 包体膨胀 | 按需加载语言包与主题，默认仅中文/JS/TS/Python 等常用语言 |

**开放问题**

1. 是否需要支持自定义格式化规则（如中英文空格开关）？
2. 导出是否需要支持自定义模板（封面、页眉页脚）？
3. 是否接入 Pandoc（作为可选外部依赖）以扩展导出格式？
