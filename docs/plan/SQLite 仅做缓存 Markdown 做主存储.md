# SQLite 仅做缓存 Markdown 做主存储

这个架构的精髓在于**“关注点分离”**：Markdown 负责**“人的可读性与版本控制”**，SQLite 负责**“机器的检索效率与快速响应”**。两者通过文件系统的变更事件（File System Events）来保持同步。

对于你“写小说+写代码”的场景，这套架构简直是天作之合。以下是具体的实现蓝图：

### 1. 核心分工逻辑
-   **Markdown（主存储）**：
    -   **内容**：小说正文、章节标题、角色设定、大纲列表。
    -   **操作**：用户直接用 VSCode 打开 `.md` 文件进行编辑，享受 Git 版本管理、多光标操作和沉浸式写作体验。
    -   **同步**：用户用 GitHub 或 OneDrive 同步整个项目文件夹，天然解决多端问题。
-   **SQLite（缓存/索引）**：
    -   **内容**：不存储正文全文，只存储**元数据**（文件路径、标题、最后修改时间 `mtime`、字数统计、标签列表、自定义别名）。
    -   **操作**：插件在后台静默读写，用户无感知。
    -   **位置**：存储在 VSCode 的 `workspaceStoragePath` 下（项目级别的 `.vscode` 隐藏目录），不参与用户的 Git 同步。

---

### 2. VSCode 插件中的实时同步机制
这是架构的“引擎”，核心是监听文件变化并增量更新数据库。

**第一步：监听 Markdown 文件**
在插件激活时，创建一个文件监听器：

```typescript
// 监听当前工作区所有 .md 文件
const watcher = vscode.workspace.createFileSystemWatcher('**/*.md');

// 监听事件
watcher.onDidCreate(uri => indexFile(uri)); // 新增
watcher.onDidChange(uri => indexFile(uri)); // 修改
watcher.onDidDelete(uri => removeFromDB(uri)); // 删除
```

**第二步：解析并写入 SQLite（增量更新）**
当用户按下 `Ctrl+S` 保存小说章节时，`onDidChange` 触发，插件执行 `indexFile` 函数。这里使用**防抖（Debounce）**技术，避免频繁保存导致卡顿（比如延迟 500ms 再执行）。

```typescript
async function indexFile(uri: vscode.Uri) {
    // 1. 读取文件内容（只读前几KB或全文，视需求而定）
    const doc = await vscode.workspace.openTextDocument(uri);
    const text = doc.getText();

    // 2. 解析元数据（使用正则或 gray-matter 库解析 Frontmatter）
    const metadata = {
        path: uri.fsPath,
        title: extractTitle(text),      // 取第一个 # 标题
        wordCount: countWords(text),    // 字数统计
        tags: extractTags(text),        // 提取标签 #玄幻
        characters: extractNames(text), // 提取角色名（简单正则）
        mtime: new Date().toISOString()
    };

    // 3. 更新 SQLite（INSERT OR REPLACE）
    db.run(`
        INSERT OR REPLACE INTO files (path, title, word_count, tags, characters, mtime)
        VALUES (?, ?, ?, ?, ?, ?)
    `, [metadata.path, metadata.title, metadata.wordCount, JSON.stringify(metadata.tags), JSON.stringify(metadata.characters), metadata.mtime]);
}
```

---

### 3. 启动时的全量重建（兜底策略）
为了避免数据库与文件系统不一致（比如用户通过 Git 拉取了别人更新的大量文件），需要提供一个**“重建索引”**命令。

-   **触发时机**：插件激活时，检测 SQLite 数据库是否存在。如果不存在，或者用户手动执行命令，就扫描整个工作区所有 `.md` 文件，批量插入数据库。
-   **性能**：50MB 的小说（大约 25 万汉字，约 100 个章节），全量扫描并建索引耗时不超过 **2-3 秒**，完全可以接受。

---

### 4. 如何利用这个缓存来增强 AI 写作？
这是这套架构最有价值的地方，SQLite 缓存可以让你的 AI（DeepSeek）更“懂”你的小说：

-   **上下文检索**：用户在写第 50 章时，插件无需加载 50MB 全量数据，而是向 SQLite 查询“最近修改的 3 个章节”或“提及主角‘林凡’的章节”，将这部分文本提取出来作为 Prompt 的上下文，喂给 AI。这既省 Token（省钱），又保证了 AI 不会忘记前文。
-   **全局搜索加速**：如果用户想搜索某个角色名，VSCode 自带的搜索需要遍历文件。你可以在侧边栏用 SQLite 的 `LIKE` 查询瞬间返回结果，并支持点击跳转。

---

### 5. 数据库表结构设计（极简示例）
```sql
CREATE TABLE IF NOT EXISTS files (
    path TEXT PRIMARY KEY,          -- 文件绝对路径
    title TEXT,                     -- 章节标题
    word_count INTEGER,             -- 字数
    tags TEXT,                      -- 标签 JSON 数组
    summary TEXT,                   -- AI 生成的摘要（预留）
    mtime TEXT                      -- 最后修改时间
);

CREATE INDEX idx_mtime ON files(mtime);
```

---

### ⚠️ 需要注意的两个大坑

1.  **不要存全文到 SQLite**：**50MB 的全文完全可以放进 SQLite**（SQLite 单表支持 TB 级），但**不要这么做**。因为一旦 SQLite 里存了全文，你就容易陷入“两边都要维护”的焦虑。记住：**Markdown 是上帝，SQLite 只是它的影子**。只要 Markdown 在，SQLite 随时可以删了重建。
2.  **跨设备同步延迟**：当用户在另一台电脑通过 GitHub Pull 拉取新章节时，VSCode 的 `onDidCreate` 事件会触发，SQLite 会自动更新，无需人工干预。但如果文件太多，拉取瞬间会触发大量索引操作，记得在上面的 `indexFile` 函数里加上**队列**或**批量处理**，避免 VSCode 卡顿。

---

### 总结落地动作
1.  用户在 VSCode 中写 `.md` 小说。
2.  插件监听文件变化 → 解析 YAML Frontmatter + 字数。
3.  写入 SQLite（仅存路径、标签、字数、修改时间）。
4.  AI 请求时，先从 SQLite 查“最近章节”，再去磁盘读对应 `.md` 文件内容发给 DeepSeek。
5.  用户用 Git 同步文件夹，换台电脑打开 VSCode，插件自动重建索引。

这套方案让你**既享受了 SQLite 的查询速度，又保留了纯文本 Git 管理的绝对安全**。你现在是想先看 SQLite 的 Node.js 封装代码（`better-sqlite3` 用法），还是想了解如何设计 AI Prompt 从 SQLite 中捞取最相关的上下文？我可以继续给你细讲。😊
