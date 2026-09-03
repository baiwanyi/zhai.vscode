# AI小说写作编辑器 - 需求与规划文档 V3 (轻量无账号版)

**版本**：3.0
**日期**：2026-05-30
**作者**：产品团队
**状态**：草案

---

## 1. 项目背景与目标

### 1.1 背景
创作者需要一款开箱即用、无需注册即可沉浸写作的工具，同时要求深度AI辅助能力。当前许多写作工具要么繁琐登录，要么AI集成生硬。市面缺少一个轻量化、可自托管、基于Markdown且无缝融合DeepSeek等大模型的Web编辑器。

### 1.2 产品目标
打造一款**无需登录、极致轻量、本地化部署**的AI写作编辑器。使用DeepSeek API提供高质量文本生成，通过模型切换满足不同写作场景，以MDX编辑器为核心，让作者在专注的标记语言环境中高效创作，并自动将数据持久化在本地SQLite数据库中。

### 1.3 用户核心价值
- **零摩擦力启动**：打开浏览器即写，无注册、无登录。
- **Markdown-native**：用简洁的标记语法写作，支持MDX高级组件，输出即为标准格式。
- **AI深度耦合**：DeepSeek模型提供续写、润色、大纲、对话等辅助，可随时切换模型（chat / coder / 通用等）。
- **数据自主可控**：所有稿件存于本地SQLite数据库，支持导入导出，可完全离线迁移。
- **全链路写作支持**：从作品设定 → 角色创建 → 大纲规划 → 章节写作 → 修改润色 → 完本归档，覆盖创作全流程。

---

## 2. 产品范围与用户角色

### 2.1 产品范围
- **形态**：单页Web应用，仅依赖Node.js后端，可本地运行或部署于个人服务器。
- **核心模块**：作品管理、MDX编辑器、AI副驾面板、人物/设定卡片、历史快照、大纲管理、角色管理、世界观设定、写作流程引导。
- **不包含**：多用户系统、权限管理、实时协作、原生移动端、云端同步。

### 2.2 用户角色
本项目为**单一本地用户**设计，无角色区分。使用者被视为默认作者，拥有全部数据的读写权限。

---

## 3. 页面模块与功能设计

### 3.1 整体布局
应用采用经典三栏式布局（可自适应收缩）：

```
+-----------------------------------------------------------+
|  顶部工具栏 (暗色背景，图标按钮)                            |
+----------+---------------------------+--------------------+
| 左侧边栏  |       中心编辑区           |   右侧AI面板       |
| (树状目录 |    (MDX编辑器)             | (AI功能+设定)      |
|  作品切换  |                           |                    |
|  大纲预览) |                           | (切换至侧边栏Tab)  |
+----------+---------------------------+--------------------+
|  底部状态栏 (字数、保存状态、模型标识、写作目标进度)        |
+-----------------------------------------------------------+
```

- **左侧边栏**：可折叠，宽度默认260px，支持分卷/章两级树形结构。
- **右侧AI面板**：可折叠/展开，宽度默认320px，支持拖拽调整。也可切换为侧边栏Tab模式（信息/角色/设定）。
- **中心编辑区**：自适应剩余空间，提供专注模式（全屏居中）。

### 3.2 页面路由与模块
由于是单页应用，主要使用面板切换而非路由。但为清晰理解，定义如下逻辑页面：

| 页面/视图 | 路由        | 说明                                             |
|-----------|-------------|--------------------------------------------------|
| 主编辑器  | `/`         | 默认视图，包含左侧目录树、中心编辑器、右侧AI面板 |
| 项目管理  | `/projects` | 全屏卡片式作品列表，可创建/导入/导出/删除        |
| 设定管理  | `/settings` | 全屏表单式人物与世界观管理，可独立编辑           |
| 历史快照  | `/history`  | 当前章节的版本历史对比视图                       |
| 导出中心  | `/export`   | 批量导出选项（格式、范围）                       |

在顶部工具栏提供图标导航，快速切换视图。

### 3.3 顶部工具栏功能
- **项目选择下拉**：快速切换作品
- **保存状态指示**：自动保存/保存中/保存失败
- **撤销/重做**
- **编辑器视图切换**：编辑模式 / 预览模式 / 双栏模式
- **专注模式**：一键隐藏所有侧边栏，仅保留编辑器
- **主题切换**：亮色/暗色/墨绿/暖黄
- **写作目标进度条**：显示当日/本周写作目标完成进度
- **番茄钟按钮**：开启/关闭番茄钟写作模式（25分钟写作+5分钟休息）
- **设置齿轮**：打开API配置、模型选择、写作偏好等全局设置

### 3.4 左侧边栏 - 目录树与大纲管理

#### 3.4.1 作品切换
- 顶部显示当前作品名称，点击展开全部作品列表
- **作品操作**：新建作品、重命名、删除、导出单个作品

#### 3.4.2 分卷管理
- 卷为章节树的一级分组，支持以下操作：
  - 创建/重命名/删除卷
  - 编辑卷说明（创作注释，仅作者可见）
  - 拖拽调整卷顺序
  - 卷展开/折叠
- 默认包含"卷一"，用户可自由新增

#### 3.4.3 章节树状列表
- 卷-章两级结构，以手风琴（Accordion）形式展示
- **每章节显示**：序号、标题、状态徽章（草稿/待修改/待发布/已发布）、字数
- **操作**：
  - 拖拽排序（跨卷/卷内）
  - 右键菜单（重命名、删除、添加子章节、上移/下移）
  - 点击切换章节编辑
- **大纲预览入口**：在大纲模式下，每章节下方显示其剧情摘要（1-3句）

#### 3.4.4 快速统计
- 该作品总字数、章节数、卷数

### 3.5 中心编辑区 - MDX编辑器

采用 `@mdxeditor/editor` 构建，提供丰富的Markdown编辑体验。

#### 3.5.1 核心特性
- 所见即所得Markdown编辑（支持标题、加粗、斜体、列表、引用、分割线、代码块、链接、图片等）
- 自定义MDX组件：支持插入人物卡、地点卡、时间戳等React组件（可切换预览）
- 打字机滚动模式
- 行号显示（可选）
- 高亮当前行
- 字数统计（选中/章节/全作）
- **自动保存**：5秒防抖，切换章节/关闭页面时自动保存

#### 3.5.2 章节元信息栏
位于编辑器上方或悬浮面板，显示当前章节的元数据：
- **章节标题**（可编辑）
- **章节状态**：草稿 / 待修改 / 待审核 / 待发布 / 已发布
- **写作便签**：仅作者可见的灵感备注、待办事项、线索提醒（支持Markdown短文本）
- **关联角色**：当前章节出场角色标签，可快速添加/移除，点击跳转角色详情
- **字数目标**：本章目标字数，实时进度条

#### 3.5.3 编辑器工具栏
悬浮在编辑区上方或固定底部，提供：
- **格式化按钮**：粗、斜、删除线、标题1-4、列表、引用、分割线、链接、图片
- **AI动作入口**：续写、润色、展开、对话生成（一键唤出AI面板对应功能）
- **插入快捷组件**：人物卡、地点卡、时间线
- **分章/合并操作**：拆分过长章节、合并多章

#### 3.5.4 多标签页编辑
- 支持同时打开多个章节，以Tab切换
- 标签页显示章节标题+关闭按钮
- 便于跨章对照、复制粘贴

#### 3.5.5 AI生成内容样式
- 生成过程中以淡蓝色斜体显示
- 接受后转为正常样式
- 拒绝后清除

#### 3.5.6 快捷键
- 自定义快捷键映射
- 默认支持 `Alt+Enter` 触发AI续写
- `Ctrl+S` 手动保存
- `Ctrl+Shift+N` 新建章节

### 3.6 右侧AI面板

可灵活折叠，提供多种AI子面板，通过标签页切换。也可切换为侧边栏Tab模式。

#### 3.6.1 AI功能标签页
- **续写/灵感**：基于上下文自动续写，或从空白生成情节开头
- **润色/改写**：对选中文本选择风格（更生动、更简洁、古风等）或自定义指令
- **对话生成**：选择已有人物或临时描述，生成符合人设的对话
- **描写展开**：将简单描述扩展为沉浸式段落
- **大纲生成**：给出当前章节的核心内容，生成后续章节大纲
- **智能校对**：检查错别字、标点、重复用词，在编辑器中以批注形式标记
- **AI写评**：写完一章后AI点评（节奏、情感、逻辑、改进建议）
- **情感/节奏分析**：分析章节的情感曲线和叙事节奏，以可视化图表展示
- **AI智能起名**：输入关键词/性格，AI生成角色名、地名、功法名等
- **自定义指令**：自由输入自然语言指令，操作选中文本或插入生成内容

#### 3.6.2 上下文与高级设置
- **前文范围滑块**：选择发送给AI的token数量（500-4000）
- **随机性/温度调节**：0.1~1.5
- **最大生成长度**：滑动设置（100~2000字）
- **模型切换**：DeepSeek-Chat / DeepSeek-R1 / 未来可扩展其他模型
- **音色预设**：如"小说家"、"诗人"、"论文作者"，快速调整系统提示词
- **注入设定复选框**：勾选后自动将当前作品的人物/世界观设定加入AI上下文

#### 3.6.3 AI对话面板
- 独立的聊天式界面，记录与AI的对话历史
- 支持发送章节内容作为上下文
- 对话可保存为便签

### 3.7 右侧侧边栏（替代AI面板的Tab模式）

当用户将右侧面板切换为"侧边栏"模式时，以Tab形式展示三个子面板：

#### 3.7.1 信息Tab
- **当前章节摘要**：编辑框，可填写100字以内的章节摘要
- **情节线列表**：当前章节关联的情节线（主线/感情线/暗线等），支持添加/移除
- **伏笔管理**：本章设置的伏笔列表，显示伏笔内容和预期回收章节
- **出场角色**：本章出现的角色列表，快速查看角色卡片

#### 3.7.2 角色Tab
- **当前作品所有角色列表**：卡片式展示
- **快速搜索/过滤**
- **角色关联章节数**：每个角色出场的章节数量
- **新建角色入口**

#### 3.7.3 设定Tab
- **世界观条目列表**：分类展示（地理/组织/时间线/种族/文化/魔法）
- **快速搜索/过滤**
- **新建设定入口**

### 3.8 底部状态栏
- 左：当前章节字数 / 作品总字数
- 左中：每日写作目标进度条（如：今日目标2000字，已写1200字）
- 中：自动保存状态（已保存 / 正在保存… / 保存失败）
- 右：当前使用的AI模型名称、API连接状态
- 右：番茄钟状态（如进行中显示剩余时间）

### 3.9 项目管理视图 (全屏)
- 网格或列表展示所有作品，每项显示封面、标题、最后修改时间、字数
- **新建作品**（弹窗输入标题+分类标签）
- **导入作品**：支持 .md / .docx / .txt 文件
- **导出**：选中作品导出为 .md 或 .docx
- **删除作品**（需确认）
- **作品归档**：归档后不显示在主列表，可在归档库中查看

### 3.10 作品信息面板（弹窗/抽屉）
- **作品名称**：可编辑
- **作者笔名**：可编辑
- **作品简介**：多版本简介（短简介30字 / 长简介500字）
- **分类标签**：可选 玄幻/都市/历史/科幻/悬疑/言情 等
- **作品状态**：连载中 / 已完本 / 暂停
- **作品封面**：前端生成单色渐变或自定义上传（本地图片Base64）
- **更新频率设定**：日更 / 周更 / 不定期
- **计划完成字数**：作品目标总字数

### 3.11 历史快照视图
- 每次手工保存（Ctrl+S）或自动保存时创建快照
- 时间线列表展示，包含快照时间和触发方式（手动/自动）
- 可选择两个版本进行diff对比（并排视图或统一diff视图）
- 可恢复到任意历史版本
- **快照管理**：删除旧快照，保留最近N个版本

### 3.12 写作目标与统计
- **每日目标**：设定每日写作字数目标（如2000字）
- **每周目标**：设定每周写作字数目标（如10000字）
- **进度展示**：在底部状态栏和侧边栏展示进度条
- **创作统计**：
  - 日/周/月字数统计
  - 连更天数（连续有写作的天数）
  - 创作热力图（类似GitHub贡献图）
  - 各章节字数分布柱状图
- **写作日历**：日历视图展示每日创作量，标记断更/爆发日

### 3.13 番茄钟写作模式
- 内置番茄钟计时器（25分钟写作 + 5分钟休息）
- 计时期间编辑区背景微变，提示专注状态
- 结束后自动保存当前章节
- 可自定义番茄时长（15-60分钟）

---

## 4. 功能需求

### 4.1 项目管理
- 本地SQLite存储，所有作品数据均存于服务端单一数据库文件
- 支持创建、重命名、删除、归档作品
- 章节树形结构：卷（Volume）-> 章（Chapter）两级
- 拖拽排序热更新（跨卷/卷内）
- 导入：支持 Markdown (.md)、Word (.docx)、纯文本 (.txt)
- 导出：支持 .md / .docx / EPUB / PDF
- 作品封面由前端生成单色渐变或自定义上传（本地图片Base64）
- 作品归档功能

### 4.2 MDX编辑器
- 基于 `@mdxeditor/editor`，原生支持Markdown快捷输入
- MDX插件体系：
  - 人物提及组件：`<Character id="xxx" />`，编辑时显示为姓名徽章
  - 地点组件：`<Location id="xxx" />`
  - 时间线组件：`<Timeline>` 包裹
- 编辑器工具栏按钮：
  - 格式化：粗、斜、删除线、标题1-4、列表、引用、分割线、链接、图片
  - AI按钮：续写、润色、扩展、对话生成（一键唤出AI面板对应功能）
  - 插入快捷组件：人物卡、地点卡
- **章节元信息**：状态标签（草稿/待修改/待发布/已发布）、写作便签、关联角色标签、字数目标
- **多标签页编辑**：同时打开多个章节，Tab切换
- **分章/合并**：在章节树操作拆分过长的章节、合并相邻多章
- 预览模式：实时渲染无MDX组件（未来可渲染为React组件）
- 字数统计：中文字符+单词数，实时更新
- 数据格式：编辑器内容以MDX字符串存储于数据库，版本快照亦为MDX文本

### 4.3 AI辅助（集成DeepSeek API）
- **可切换模型**：前端下拉选择，支持 DeepSeek-Chat (v3)、DeepSeek-R1 等，配置界面可输入自定义API endpoint和key（存储本地localStorage，安全免责）
- **功能清单**：
  - **续写**：取光标前最多N字符作为前文，调用DeepSeek流式生成后续内容。
  - **重写/润色**：选中文本 + 风格指令，返回改写版本。
  - **对话模拟**：用户选择人物A、B及场景，AI生成符合人设的对话。
  - **细节展开**：输入简单句，生成细腻描写。
  - **大纲规划**：基于章节内容生成续写大纲（列表）。
  - **校对建议**：返回原文的修改列表，编辑器以装饰性标记显示。
  - **AI写评**：完成章节后AI点评（节奏、情感、逻辑一致性）。
  - **情感/节奏分析**：分析叙事节奏和情感曲线，以图表展示。
  - **AI智能起名**：输入关键词/风格，生成角色名、地名、功法名。
  - **自由指令**：任意Prompt操作选中文本或从头生成。
- **流式传输**：AI生成通过Server-Sent Events (SSE) 推送到前端，逐字显示。
- **上下文自动注入**：从设定库中抓取当前作品的相关人物、世界观条目，构造成系统提示，保证一致性。
- **用量与配额**：本地无用户，但可设置每日调用次数上限（防API费用失控），由全局配置文件控制。

### 4.4 世界观设定

#### 4.4.1 设定分类
设定条目分为六大类别，每种有独特的字段模板：

| 类别      | 包含字段                                                  |
|-----------|-----------------------------------------------------------|
| 地理      | 区域名称、所属世界、地貌特征、气候、重要地点、物产、图片  |
| 组织势力  | 名称、类型（宗门/国家/商会/帮派）、领袖、成员、宗旨、据点 |
| 时间线    | 事件名称、发生时间、影响范围、关键人物、后续影响          |
| 种族      | 名称、外貌特征、寿命、天赋能力、社会结构、文化习俗        |
| 文化宗教  | 信仰体系、重要节日、禁忌、仪式、象征物                    |
| 魔法/科技 | 体系名称、原理、等级、使用者、限制、副作用                |

#### 4.4.2 设定管理操作
- 按分类标签筛选
- 搜索（名称/描述全文搜索）
- 条目关联：设定条目自动关联到引用它的章节，点击可跳转
- 设定数据以JSON存储，支持搜索过滤
- 从MDX编辑器中可通过 `@` 快速引用设定条目，自动生成MDX组件

### 4.5 角色管理

#### 4.5.1 角色卡片
每个角色包含以下属性（支持模板化填写）：

| 字段分类 | 具体属性                                                     |
|----------|--------------------------------------------------------------|
| 基础信息 | 姓名、别名、年龄、性别、生日、身高、体重、血型               |
| 外貌     | 多角度描述（正面/侧面/全身），可选上传头像（Base64）         |
| 性格     | 核心特质（3-5个关键词）、性格弱点、MBTI类型、习惯动作/口头禅 |
| 背景     | 出身、成长经历、重要事件、当前状态                           |
| 能力     | 战斗等级、特殊能力、武器/法宝、技能列表                      |
| 人际关系 | 关联角色列表（见4.5.2 关系图谱）                             |

#### 4.5.2 角色关系图谱
- 可视化角色关系网络，支持拖拽编辑布局
- 关系类型：盟友、敌对、恋人、师徒、亲缘、主仆、暗恋、恩怨
- 每条关系可附带描述文本
- 支持过滤显示（按关系类型/仅显示关联角色）

#### 4.5.3 角色标签与分组
- 自定义标签：如"主角"、"反派"、"配角"、"龙套"
- 按标签分组展示
- 角色模板预设：快速创建常见角色模板（勇者、智者、反派等）

#### 4.5.4 出场统计
- 自动统计角色在各章节的出现次数
- 按章节展示出场频率热力图
- 点击章节跳转到对应编辑位置
- 支持MDX标记自动识别角色名

### 4.6 大纲管理

#### 4.6.1 分卷管理
- 卷名编辑、卷简介（创作注释）
- 卷排序（拖拽）
- 卷字数汇总

#### 4.6.2 章节大纲摘要
- 每章节可填写核心剧情摘要（1-3句话）
- 大纲视图按卷展示所有章节的摘要，一目了然

#### 4.6.3 大纲视图切换
支持三种大纲查看模式：
- **树形视图**：经典卷-章-摘要结构（默认）
- **卡片视图**：每章一张卡片，展示标题、摘要、状态、字数
- **时间线视图**：以时间线形式展示情节发展脉络

#### 4.6.4 大纲便签
- 为整部作品/单卷/单章添加创作便签
- 记录写作思路、注意事项、灵感片段

#### 4.6.5 AI辅助生成大纲
- 输入作品核心设定和主角信息
- AI自动生成卷-章结构大纲
- 支持逐步细化（先分卷→再细化为章）

### 4.7 伏笔管理

#### 4.7.1 伏笔条目
- **设置章节**：在哪一章设置的伏笔
- **伏笔内容**：文本描述
- **类型**：人物伏笔 / 情节伏笔 / 道具伏笔 / 设定伏笔
- **预期回收章节**：计划在哪一章揭示
- **实际回收章节**：实际在哪一章回收
- **状态**：未回收 / 已回收 / 已废弃

#### 4.7.2 伏笔视图
- 按状态/类型筛选
- 按设置章节排序
- 概览看板：显示待回收伏笔数量，预警临近预期回收

### 4.8 情节线管理

#### 4.8.1 情节线定义
- 支持多条故事线并行
- 类型预设：主线、感情线、暗线、支线
- 每条情节线包含：名称、类型、描述

#### 4.8.2 章节关联
- 每章节可关联多条情节线
- 按情节线展示所有关联章节
- 可查看每条情节线的进展状态

### 4.9 版本历史
- 保存触发：手动Ctrl+S、切换章节、自动保存（5秒防抖后）
- 存储差异或全量快照（MDX文本），时间及触发方式记录
- 历史查看器：并排对比或统一diff视图，支持一键恢复
- 快照清理：自动清理超过30天的旧快照，保留最近100个版本

### 4.10 全局设置

#### 4.10.1 编辑器偏好
- 字体大小（12-24px）
- 行高（1.2-2.0）
- Tab宽度（2/4/8）
- 是否显示行号
- 打字机模式开关
- 自动保存间隔（3-60秒）

#### 4.10.2 AI默认参数
- 温度（0.1-1.5）
- 最大长度（100-4000）
- 上下文范围（500-8000 token）
- 默认模型

#### 4.10.3 API配置
- Base URL（默认 `https://api.deepseek.com/v1`）
- API Key
- 每日调用上限
- 存储于localStorage，不发送至服务器

#### 4.10.4 写作偏好
- 每日写作目标字数
- 番茄钟时长
- 创作提醒开关

#### 4.10.5 主题与无障碍
- 亮色/暗色/墨绿/暖黄主题
- 高对比度模式
- 减少动画

---

## 5. 非功能需求

### 5.1 性能
- 编辑器加载时间 <1秒
- MDX渲染大文档（10万字）不卡顿（利用虚拟渲染）
- AI流式响应延迟控制在100ms内首字输出
- SQLite查询即时响应（本地文件I/O）
- 章节树在1000+章节时保持流畅

### 5.2 安全
- 因无用户认证，服务端不开放公网端口时仅localhost可用；若需部署内网，应通过反向代理+IP白名单限制
- API Key存在浏览器localStorage，每次请求直接发送到后端，后端不使用自己的代理Key（或提供可选后端Key配置），需在文档中提示安全风险
- 内容输出转义，防止XSS
- 频率限制：AI端点单IP限流
- 自动备份：定时将SQLite数据库备份到指定目录

### 5.3 可用性
- 全键盘操作支持，符合WCAG 2.1 AA
- 首次使用提示引导，点击高亮区域结束
- 兼容现代浏览器（Chrome, Edge, Firefox, Safari）
- **首次创作流程引导**：新建作品后，引导用户依次完成设定→角色→大纲→写作

### 5.4 可维护性
- 前后端均TypeScript，共享类型定义
- MDX编辑器插件化，AI功能模块化
- 数据库使用Prisma + SQLite，迁移简单
- 模块间通过自定义Hooks通信，降低耦合
- 组件按功能分层：layout（布局）、modal（弹窗）、panel（面板）

---

## 6. 系统架构与Tech Stack

### 6.1 总体架构
```
React SPA (CSR)  ←→  Express API Server (TypeScript)
                         ├── SQLite (better-sqlite3 或 Prisma)
                         ├── 文件上传目录 (封面/头像)
                         └── DeepSeek API (直接调用)
```

不依赖外部数据库服务或缓存，极致轻量。

### 6.2 前端技术栈
- **核心**：React 18+，TypeScript，Vite
- **编辑器**：`@mdxeditor/editor` (基于Lexical)，自定义MDX插件
- **状态管理**：Zustand（轻量）
- **UI**：Tailwind CSS + Radix UI（对话框、下拉等无样式组件）+ shadcn/ui
- **HTTP**：Axios + @tanstack/react-query
- **本地设置**：localStorage 存储 API Key 和偏好
- **测试**：Vitest + Testing Library

### 6.3 后端技术栈
- **运行时**：Node.js 20+，Express，TypeScript
- **数据库**：SQLite，使用 Prisma（便于迁移）
- **AI交互**：`openai` 兼容包或直接 fetch 调用 DeepSeek API (base URL `https://api.deepseek.com/v1`)，支持stream
- **文件处理**：multer 用于封面上传（存于本地public目录）
- **文档解析**：mammoth (docx → md)，turndown (html → md)，epub-gen (EPUB导出)
- **验证**：zod 用于请求体校验
- **日志**：pino
- **测试**：Jest + supertest

---

## 7. 数据模型

### 7.1 完整数据模型（Prisma）

```prisma
model Project {
  id          Int       @id @default(autoincrement())
  title       String
  description String?
  authorName  String?   // 作者笔名
  shortIntro  String?   // 短简介（30字）
  longIntro   String?   // 长简介（500字）
  category    String?   // 分类：玄幻/都市/历史/科学/悬疑/言情
  status      String    @default("ongoing") // ongoing | completed | paused
  coverUrl    String?   // 封面URL
  wordGoal    Int?      // 计划完成字数
  updateFreq  String?   // 更新频率：daily | weekly | irregular
  dailyGoal   Int?      // 每日写作目标字数
  weeklyGoal  Int?      // 每周写作目标字数
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  volumes     Volume[]
  chapters    Chapter[]
  characters  Character[]
  settings    Setting[]
  plotLines   PlotLine[]
  foreshadowings Foreshadowing[]
}

model Volume {
  id          Int       @id @default(autoincrement())
  projectId   Int
  project     Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  title       String
  description String?   // 卷简介/创作注释
  order       Int       // 排序
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  chapters    Chapter[]
}

model Chapter {
  id          Int       @id @default(autoincrement())
  projectId   Int
  project     Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  volumeId    Int?
  volume      Volume?   @relation(fields: [volumeId], references: [id], onDelete: SetNull)
  title       String
  content     String    // MDX string
  status      String    @default("draft") // draft | revising | reviewing | ready | published
  summary     String?   // 章节大纲摘要
  notes       String?   // 写作便签（JSON string）
  wordGoal    Int?      // 本章目标字数
  order       Int
  wordCount   Int       @default(0)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  snapshots   Snapshot[]
  characters  ChapterCharacter[]
  plotLines   ChapterPlotLine[]
  foreshadowings Foreshadowing[]  // 本章设置的伏笔
}

model Snapshot {
  id         Int      @id @default(autoincrement())
  chapterId  Int
  chapter    Chapter  @relation(fields: [chapterId], references: [id], onDelete: Cascade)
  content    String   // MDX content snapshot
  reason     String   // "manual" | "auto"
  createdAt  DateTime @default(now())
}

model Character {
  id          Int       @id @default(autoincrement())
  projectId   Int
  project     Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  name        String
  alias       String?   // 别名/化名
  age         String?   // 年龄（可为"未知"）
  gender      String?
  height      String?
  weight      String?
  birthday    String?
  bloodType   String?
  avatarUrl   String?   // 头像（Base64或文件路径）
  // 外貌（多角度JSON）
  appearance  String?   // JSON: { frontal, profile, fullBody, features }
  // 性格
  personality String?   // JSON: { traits: string[], weaknesses: string[], mbti: string, habits: string, catchphrase: string }
  // 背景
  background  String?   // JSON: { origin, experience, keyEvents, currentStatus }
  // 能力
  ability     String?   // JSON: { combatLevel, specialAbilities, weapons, skills }
  tags        String?   // JSON array: ["主角", "反派"]
  template    String?   // 角色模板ID
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  // 关系
  relationsFrom CharacterRelation[] @relation("CharacterRelationFrom")
  relationsTo   CharacterRelation[] @relation("CharacterRelationTo")
  // 出场
  chapters    ChapterCharacter[]
}

model CharacterRelation {
  id          Int       @id @default(autoincrement())
  fromId      Int
  from        Character @relation("CharacterRelationFrom", fields: [fromId], references: [id], onDelete: Cascade)
  toId        Int
  to          Character @relation("CharacterRelationTo", fields: [toId], references: [id], onDelete: Cascade)
  type        String    // ally | enemy | lover | mentor | family | servant | crush | grudge
  description String?
  createdAt   DateTime  @default(now())
}

model ChapterCharacter {
  id          Int       @id @default(autoincrement())
  chapterId   Int
  chapter     Chapter   @relation(fields: [chapterId], references: [id], onDelete: Cascade)
  characterId Int
  character   Character @relation(fields: [characterId], references: [id], onDelete: Cascade)
  role        String    // main | supporting | cameo
  mentionCount Int      @default(0) // 在本章的出现次数

  @@unique([chapterId, characterId])
}

model Setting {
  id        Int       @id @default(autoincrement())
  projectId Int
  project   Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  category  String    // geography | organization | timeline | race | culture | magic
  name      String
  data      String    // JSON string (category-specific fields)
  tags      String?   // JSON array for custom tags
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
}

model PlotLine {
  id          Int       @id @default(autoincrement())
  projectId   Int
  project     Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  name        String
  type        String    // main | romance | sub | secret
  description String?
  color       String?   // 显示用颜色
  createdAt   DateTime  @default(now())
  chapters    ChapterPlotLine[]
}

model ChapterPlotLine {
  id          Int       @id @default(autoincrement())
  chapterId   Int
  chapter     Chapter   @relation(fields: [chapterId], references: [id], onDelete: Cascade)
  plotLineId  Int
  plotLine    PlotLine  @relation(fields: [plotLineId], references: [id], onDelete: Cascade)
  note        String?   // 本章在该情节线的进展描述

  @@unique([chapterId, plotLineId])
}

model Foreshadowing {
  id              Int       @id @default(autoincrement())
  projectId       Int
  project         Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  setChapterId    Int
  setChapter      Chapter   @relation("SetChapter", fields: [setChapterId], references: [id], onDelete: Cascade)
  content         String
  type            String    // character | plot | item | setting
  expectedRecover Int?      // 预期回收章节ID
  actualRecover   Int?      // 实际回收章节ID
  recoverChapter  Chapter?  @relation("RecoverChapter", fields: [actualRecover], references: [id])
  status          String    @default("pending") // pending | recovered | abandoned
  createdAt       DateTime  @default(now())
}

model WritingSession {
  id        Int      @id @default(autoincrement())
  projectId Int
  project   Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  date      DateTime
  wordCount Int      // 写作字数
  duration  Int?     // 写作时长（分钟）
  createdAt DateTime @default(now())

  @@unique([projectId, date])
}
```

---

## 8. API设计

无认证，所有端点开放（本地环境），路径前缀 `/api/v1`。

### 8.1 项目管理
| 方法   | 路径                    | 说明                 |
|--------|-------------------------|----------------------|
| GET    | /projects               | 获取作品列表         |
| POST   | /projects               | 创建新作品           |
| GET    | /projects/:id           | 获取单个作品含章节树 |
| PUT    | /projects/:id           | 更新作品信息         |
| DELETE | /projects/:id           | 删除作品             |
| POST   | /projects/:id/archive   | 归档作品             |
| POST   | /projects/:id/unarchive | 取消归档             |

### 8.2 章节管理
| 方法   | 路径                   | 说明               |
|--------|------------------------|--------------------|
| GET    | /projects/:id/chapters | 获取章节树（含卷） |
| POST   | /projects/:id/chapters | 创建章节           |
| PUT    | /chapters/:id          | 更新章节内容/标题  |
| PATCH  | /chapters/:id/status   | 更新章节状态       |
| PATCH  | /chapters/:id/notes    | 更新写作便签       |
| PUT    | /chapters/:id/order    | 更新排序（拖拽）   |
| PATCH  | /chapters/:id/move     | 移动章节到其他卷   |
| POST   | /chapters/:id/split    | 拆分章节           |
| POST   | /chapters/:id/merge    | 合并章节           |
| DELETE | /chapters/:id          | 删除章节           |

### 8.3 卷管理
| 方法   | 路径                  | 说明       |
|--------|-----------------------|------------|
| POST   | /projects/:id/volumes | 创建卷     |
| PUT    | /volumes/:id          | 更新卷信息 |
| DELETE | /volumes/:id          | 删除卷     |
| PUT    | /volumes/:id/order    | 更新卷排序 |

### 8.4 版本历史
| 方法   | 路径                                 | 说明                        |
|--------|--------------------------------------|-----------------------------|
| GET    | /chapters/:id/snapshots              | 获取快照列表                |
| POST   | /chapters/:id/snapshots              | 创建快照                    |
| GET    | /chapters/:id/snapshots/diff         | 对比两个版本（query: a, b） |
| POST   | /chapters/:id/snapshots/:sid/restore | 恢复到指定版本              |
| DELETE | /chapters/:id/snapshots/:sid         | 删除快照                    |

### 8.5 角色管理
| 方法   | 路径                      | 说明                 |
|--------|---------------------------|----------------------|
| GET    | /projects/:id/characters  | 获取所有角色         |
| POST   | /projects/:id/characters  | 创建角色             |
| GET    | /characters/:id           | 获取角色详情         |
| PUT    | /characters/:id           | 更新角色             |
| DELETE | /characters/:id           | 删除角色             |
| GET    | /characters/:id/relations | 获取角色关系图谱     |
| POST   | /characters/:id/relations | 添加角色关系         |
| DELETE | /relations/:id            | 删除角色关系         |
| GET    | /characters/:id/chapters  | 获取角色出场章节列表 |

### 8.6 设定管理
| 方法   | 路径                   | 说明                       |
|--------|------------------------|----------------------------|
| GET    | /projects/:id/settings | 获取设定列表（按分类过滤） |
| POST   | /projects/:id/settings | 创建设定条目               |
| PUT    | /settings/:id          | 更新设定                   |
| DELETE | /settings/:id          | 删除设定                   |
| GET    | /settings/:id/chapters | 获取引用该设定的章节列表   |

### 8.7 大纲管理
| 方法 | 路径                           | 说明                       |
|------|--------------------------------|----------------------------|
| GET  | /projects/:id/outline          | 获取完整大纲（卷-章-摘要） |
| PUT  | /chapters/:id/summary          | 更新章节大纲摘要           |
| POST | /projects/:id/outline/generate | AI自动生成大纲             |

### 8.8 伏笔管理
| 方法  | 路径                         | 说明           |
|-------|------------------------------|----------------|
| GET   | /projects/:id/foreshadowings | 获取所有伏笔   |
| POST  | /projects/:id/foreshadowings | 新增伏笔       |
| PUT   | /foreshadowings/:id          | 更新伏笔       |
| PATCH | /foreshadowings/:id/recover  | 标记伏笔已回收 |

### 8.9 情节线管理
| 方法   | 路径                         | 说明                 |
|--------|------------------------------|----------------------|
| GET    | /projects/:id/plotLines      | 获取所有情节线       |
| POST   | /projects/:id/plotLines      | 新建情节线           |
| PUT    | /plotLines/:id               | 更新情节线           |
| DELETE | /plotLines/:id               | 删除情节线           |
| POST   | /chapters/:id/plotLines      | 为章节关联情节线     |
| DELETE | /chapters/:id/plotLines/:pid | 移除章节的情节线关联 |

### 8.10 写作统计
| 方法 | 路径                        | 说明                                |
|------|-----------------------------|-------------------------------------|
| GET  | /projects/:id/stats         | 获取作品统计数据                    |
| GET  | /projects/:id/stats/daily   | 获取每日写作记录（query: from, to） |
| GET  | /projects/:id/stats/heatmap | 获取创作热力图数据                  |

### 8.11 导出
| 方法 | 路径                     | 说明                   |
|------|--------------------------|------------------------|
| POST | /export/project/:id      | 导出一个作品为指定格式 |
| POST | /export/project/:id/epub | 导出为EPUB             |
| POST | /export/project/:id/pdf  | 导出为PDF              |

### 8.12 AI
| 方法 | 路径                  | 说明                 |
|------|-----------------------|----------------------|
| POST | /ai/generate          | 非流式AI请求（备用） |
| POST | /ai/stream            | 流式AI请求（SSE）    |
| POST | /ai/analyze/sentiment | 情感/节奏分析        |
| POST | /ai/suggest/name      | AI起名提示           |

**流式AI端点说明**：
- 客户端发送POST，body含 `{ messages, model, temperature, max_tokens, projectId? }`
- 后端创建SSE流，代理转发DeepSeek API流式响应，同时记录用量（可选）

---

## 9. UI/UX设计原则

- **极简克制**：去装饰化，突出内容，操作入口少而精。
- **快捷键驱动**：所有核心动作可键盘完成。
- **AI无感化**：AI按钮不抢占视觉焦点，只在需要时于光标附近浮出或通过快捷键呼出。
- **本地优先**：明确传达数据完全本地存储，增强安全感。
- **渐进式复杂度**：基础功能开箱即用，高级功能（伏笔、情节线）可逐步探索。
- **一致性**：所有弹窗、面板的交互模式统一（关闭方式、快捷键、焦点管理）。
- **容错性**：所有关键操作（删除章节、恢复快照）提供确认对话框，支持撤销。

---

## 10. UI组件与视图说明

### 10.1 弹窗（Dialog/Modal）
| 弹窗名称                | 触发方式              | 内容                               |
|-------------------------|-----------------------|------------------------------------|
| PressModalSynopsis      | 工具栏按钮"大纲"      | 作品信息：名称/简介/分类/封面/状态 |
| PressModalCharacter     | 工具栏按钮"角色"      | 角色管理：列表+编辑/新建           |
| PressModalSetting       | 工具栏按钮"设定"      | 世界观设定：分类浏览+编辑/新建     |
| PressModalAIChat        | 工具栏按钮"AI聊天"    | AI对话面板                         |
| PressModalHistory       | 底部状态栏"历史"按钮  | 版本历史对比+恢复                  |
| PressModalGoal          | 侧边栏/状态栏目标区域 | 写作目标设置                       |
| PressModalExport        | 项目管理视图"导出"    | 导出格式选择+范围选择              |
| PressModalForeshadowing | 大纲视图中的伏笔入口  | 伏笔管理                           |

### 10.2 面板（Panel）
| 面板名称            | 位置        | 内容                                |
|---------------------|-------------|-------------------------------------|
| PressEditorSidebar  | 右侧侧边栏  | Tab: 信息 / 角色 / 设定             |
| PressEditorSideInfo | 右侧信息Tab | 章节摘要、情节线、伏笔、出场角色    |
| AIChatPanel         | 右侧AI面板  | AI对话/续写/润色等子面板，由Tab切换 |

### 10.3 侧边栏（Sidebar）
| 组件         | 位置     | 内容                            |
|--------------|----------|---------------------------------|
| PressChapter | 左侧边栏 | 卷-章树形结构+拖拽排序+状态徽章 |

---

## 11. 开发计划（调整后）

| 阶段          | 时间    | 目标                                                                        |
|---------------|---------|-----------------------------------------------------------------------------|
| M1 基础       | 周1-2   | 项目脚手架上搭建，Express + SQLite 数据层，基本作品CRUD API，React+SPA布局  |
| M2 编辑器     | 周3-4   | 集成 `@mdxeditor/editor`，实现分卷/章管理，自动保存，字数统计，导入导出(md) |
| M3 AI接入     | 周5-6   | DeepSeek API适配，流式续写、润色等功能，前端AI面板与编辑器联调              |
| M4 设定与角色 | 周7-8   | 世界观设定（6分类）、角色管理（卡片+关系图谱）、AI上下文自动注入            |
| M5 大纲与伏笔 | 周9-10  | 大纲管理（三种视图）、伏笔管理、情节线管理、章节摘要                        |
| M6 体验打磨   | 周11-12 | 番茄钟、写作目标、创作统计、多标签页、主题、历史快照、新手指引、安全加固    |
| M7 发布       | 周13    | 测试、打包、文档、发布可执行包或Docker镜像                                  |

---

## 12. 风险与缓解

| 风险                      | 缓解                                                     |
|---------------------------|----------------------------------------------------------|
| API Key泄漏（浏览器存储） | 文档警告，建议使用后端代理模式（配置环境变量）作为可选项 |
| 大文档编辑性能问题        | 利用Lexical虚拟滚动，压力测试10万字文档                  |
| DeepSeek服务不稳定        | 可降级为本地模板提示，或支持自定义接口地址               |
| 无用户系统导致数据混淆    | 单实例单用户设计，部署时明确免责                         |
| 功能膨胀导致开发周期拉长  | 按优先级分阶段迭代，M1-M3为核心功能必须先完成            |
| 数据丢失（未保存内容）    | 自动保存+版本历史双保险，启动时自动恢复上次未保存内容    |

---

## 13. 写作流程

### 13.1 总览
从新建作品到完本归档的完整创作工作流：

```
新建作品 → 设定世界观 → 创建角色 → 规划大纲 → 分章写作 → 修改润色 → 完本归档
```

### 13.2 步骤一：新建作品
1. 打开应用，进入项目管理视图（/projects）
2. 点击"新建作品"，输入：
   - 作品名称（必填）
   - 作品分类（可选）
   - 作者笔名（可选）
3. 系统自动创建：作品条目 + 默认"卷一" + 一个空白章节
4. 跳转到主编辑器视图

### 13.3 步骤二：设定世界观（可选但推荐）
1. 点击工具栏"设定"按钮，打开设定管理弹窗
2. 按分类添加设定条目：
   - 地理：区域、地点、地貌
   - 组织：势力、宗门、国家
   - 时间线：重要历史事件
   - 种族：主要种族特性
   - 文化：信仰、习俗
   - 魔法/科技：体系、规则
3. 设定完成后，这些信息将作为AI生成时的上下文自动注入

### 13.4 步骤三：创建角色（可选但推荐）
1. 点击工具栏"角色"按钮，打开角色管理弹窗
2. 创建主要角色，填写：
   - 基础信息（姓名/年龄/性别）
   - 外貌特征
   - 性格特质+弱点
   - 背景故事
   - 能力设定
3. 建立角色间关系（关系图谱）
4. 添加角色标签分组

### 13.5 步骤四：规划大纲
1. 在左侧边栏，管理卷结构（新增/重命名/排序）
2. 为每章填写大纲摘要（核心剧情1-3句）
3. 切换到大纲视图（卡片/时间线），全局审视故事结构
4. 设置情节线，将章节关联到对应情节线
5. 设置伏笔（在设置伏笔的章节标记）
6. （可选）使用AI辅助生成大纲

### 13.6 步骤五：分章写作
1. 在左侧章节树选择章节开始写作
2. 编辑时可使用的AI辅助：
   - **续写**：`Alt+Enter`，AI基于前文继续生成
   - **润色**：选中文本，选择润色风格
   - **对话生成**：选择角色，生成符合人设的对话
   - **描写展开**：简单句→沉浸式段落
3. 写作中可随时：
   - 添加写作便签（灵感备注）
   - 标注出场角色
   - 关联情节线
   - 记录伏笔
4. 章节管理：
   - 拆分过长章节（右键 → 拆分）
   - 合并连续章节（右键 → 合并）
   - 拖拽调整章节顺序
   - 更新章节状态：草稿→待修改→待发布

### 13.7 步骤六：修改润色
1. 完成初稿后，使用AI校对功能检查错别字
2. 使用AI写评获取章节改进建议
3. 查看情感/节奏分析，调整叙事节奏
4. 对照伏笔看板，确保伏笔得到回收
5. 多章节对比（多标签页编辑），统一风格

### 13.8 步骤七：完本与导出
1. 更新作品状态为"已完本"
2. 选择导出格式：
   - .md：纯Markdown（保留MDX组件为纯文本）
   - .docx：Word文档
   - EPUB：电子书格式
   - PDF：印刷排版格式
3. 导出完成，可选择归档作品

### 13.9 日常写作流程
```
打开应用 → 选择作品 → 继续上一次写作（自动跳转到上次编辑的章节）
         → 检查今日目标进度 → 开始写作（或使用番茄钟）
         → 自动保存 → 关闭应用
```

---

## 14. 假设与约束

- 应用部署在本地或个人服务器，前端与后端同源，无跨域问题。
- 用户具备DeepSeek API Key，费用自理。
- 浏览器需支持SSE和localStorage。
- 最小团队：1全栈，1前端（也可单人）。

---

## 15. 未来扩展方向

- 多模型协同（续写用chat模型，校对用专用模型）
- 从其他平台导入（起点/番茄等导出内容）
- 设定一致性检查（AI检测前后矛盾）
- 角色对话风格预设
- 灵感漫游（随机生成情节创意卡片）
- 白噪音/打字音效
- 多语言支持

---

**附录**
- @mdxeditor/editor 文档: https://mdxeditor.dev/
- DeepSeek API 文档: https://platform.deepseek.com/api-docs/
- 术语表：MDX, SSE, CRDT (如需协作)
