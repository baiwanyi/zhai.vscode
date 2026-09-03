# TXT 小说阅读器 - 实现文档

**版本**：1.0
**日期**：2026-05-30
**状态**：开发中（M1 已完成 — 文件导入）

---

## 1. 项目概述

### 1.1 背景

宅桌面平台需要一款本地 TXT 小说阅读器，支持从指定目录自动批量导入、编码自动检测、MD5 去重、书架管理与基础阅读能力。

### 1.2 架构

遵循项目现有模块化架构，后置 Express + SQLite，前置 React + TypeScript + Tailwind CSS（前端 UI 待后续实现）。

| 层 | 技术 |
|----|------|
| 数据库 | SQLite（独立 `data/reader.db`，Drizzle ORM） |
| 后端 | Express（Controller → Service） |
| 前端 | React + TypeScript（待实现） |

---

## 2. 已实现功能（M1 — 文件导入）

### 2.1 TXT 目录扫描

- 配置 `app.yaml` → `reader.txtDir` 指定 TXT 文件根目录
- 手动触发：`POST /api/reader/scan`
- 递归遍历所有子目录，筛选 `.txt` 文件
- 忽略非 `.txt` 文件，目录不存在时输出警告不崩溃

### 2.2 MD5 文件去重

- 使用 `node:crypto.createHash('md5')` 流式计算
- 流式读取避免大文件（>100MB）内存溢出
- 数据库 `file_hash` 字段设为 `UNIQUE` 约束
- 导入前比对已存在的 MD5，重复文件自动跳过

### 2.3 编码自动检测

- 读取文件头 64KB → `jschardet` 检测编码
- 使用 `iconv-lite` 解码为 UTF-8 字符串
- 写入数据库时存储检测到的编码名称
- 检测失败时默认 UTF-8

### 2.4 数据库存储

单表 `books`：

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键自增 |
| title | TEXT | 文件名（不含 .txt 后缀） |
| file_path | TEXT | 文件绝对路径 |
| file_hash | TEXT | MD5 唯一标识（UNIQUE） |
| encoding | TEXT | 检测编码（UTF-8/GBK 等） |
| file_size | INTEGER | 文件字节数 |
| total_chars | INTEGER | 总字符数 |
| total_lines | INTEGER | 总行数 |
| current_line | INTEGER | 阅读进度行号 |
| current_offset | INTEGER | 阅读进度字符偏移 |
| progress | REAL | 进度百分比 0~1 |
| last_read_at | TEXT | 最后阅读时间 |
| is_deleted | INTEGER | 软删除标记 |
| created_at | TEXT | 导入时间 |
| updated_at | TEXT | 更新时间 |

### 2.5 API 接口

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/api/reader/scan` | 手动触发扫描目录，返回 `{ totalFiles, newFiles, skippedFiles, errors }` |
| GET | `/api/reader/list?page=1&pageSize=50` | 获取未删除的书籍列表（按最后阅读时间倒序，分页） |
| GET | `/api/reader/:bookId` | 获取单本书详情 |
| DELETE | `/api/reader/:bookId` | 软删除书籍 |

---

## 3. 文件结构

```
modules/Reader/
├── reader.type.ts          # 类型定义（Book, ScanResult）
├── reader.schema.ts        # Drizzle ORM 表结构
├── reader.migrate.ts       # SQL 迁移脚本
├── reader.service.ts       # 核心业务：扫描、MD5、编码检测、导入
├── reader.controller.ts    # Express 请求处理
├── reader.route.ts         # 路由注册
├── reader.scanner.ts       # （保留，未引用）
└── index.tsx               # 前端占位入口（待实现）
```

### 3.1 数据流

```
用户 POST /api/reader/scan
  → reader.controller.scanDirectory()
  → reader.service.scanAndImport(txtDir)
  → walkDirectory()                  递归扫描 .txt 文件
  → computeMD5()                     流式计算 MD5
  → isAlreadyImported()              检查去重
  → detectAndRead()                  编码检测 + 解码
  → importSingleFile()               INSERT INTO books
  → 返回 ScanResult 报告
```

---

## 4. API 使用示例

### 手动扫描

```http
POST /api/reader/scan
```

**响应**：
```json
{
  "success": true,
  "data": {
    "totalFiles": 12,
    "newFiles": 5,
    "skippedFiles": 7,
    "errors": []
  }
}
```

### 获取书籍列表

```http
GET /api/reader/list?page=1&pageSize=20
```

**响应**：
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "title": "斗破苍穹",
      "filePath": "D:\\Zhai\\books\\斗破苍穹.txt",
      "fileHash": "a1b2c3d4e5...",
      "encoding": "UTF-8",
      "fileSize": 5242880,
      "totalChars": 5242880,
      "totalLines": 102400,
      "currentLine": 0,
      "currentOffset": 0,
      "progress": 0,
      "lastReadAt": null,
      "createdAt": "2026-05-30 02:35:00"
    }
  ]
}
```

### 删除书籍

```http
DELETE /api/reader/1
```

**响应**：
```json
{
  "success": true,
  "message": "书籍已删除"
}
```

---

## 5. 配置项

在 `app.yaml` 中：

```yaml
reader:
    txtDir: D:\Zhai\books    # TXT 小说目录
```

未配置时，`POST /api/reader/scan` 返回 `totalFiles: 0`，不会报错。

---

## 6. 未实现功能（后续阶段）

| 阶段 | 功能 |
|------|------|
| M2 | 阅读器核心（虚拟滚动、上下滑动、章节解析、阅读进度） |
| M3 | 翻页模式、字体/间距/主题设置 |
| M4 | 书签管理、全文搜索 |
| M5 | 亮度调节、屏幕常亮、分组管理、回收站 |

---

## 7. 依赖

| 包 | 用途 |
|----|------|
| `jschardet` | 编码检测 |
| `iconv-lite` | 编码转换为 UTF-8 |

---

## 8. 验收标准

| 场景 | 预期 |
|------|------|
| 配置 txtDir，目录有 5 个 `.txt` | 扫描后导入 5 本书 |
| 再次扫描（文件未变） | 全部跳过，`newFiles: 0, skippedFiles: 5` |
| 目录新增 2 个 `.txt` | 导入 2 本新书，跳过 5 本旧书 |
| 包含非 `.txt` 文件（.pdf） | 自动忽略，不影响 |
| GBK 编码文件 | 正确检测为 GBK，正常存储 |
| 大文件 >100MB | 流式计算 MD5，不阻塞 |
| 目录不存在 | 输出警告，不崩溃 |
| 文件相同但文件名不同 | MD5 相同，去重跳过 |
