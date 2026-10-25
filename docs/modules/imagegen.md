# ImageGen（生图）— 模块设计文档

**版本**：1.0
**日期**：2026-10-25
**状态**：图库管理、统一出图、作品级参数、封面入口收敛、旧目录迁移、芯片内联、批量删除均已落地
**宿主**：VSCode 插件 Zhai（宅桌面）
**存储根**：`{storage.rootPath}/press/{作品名}/`（根目录配置见 `common.md` 第 1 节）

---

## 1. 模块概述

### 1.1 定位

作品图片资产的**统一入口**：列举、删除、设封面，以及在作品上下文里按提示词出图。前身是「作品封面 + 角色设定图」两条独立通道，现已合并为一套图库视图（生图页），封面不再是独立资源类型，而是「当前选中的那张图」。

### 1.2 与其他模块的边界

| 模块 | 边界 |
| --- | --- |
| press | 生图依赖作品目录（`press/{作品名}`）作为作用域；角色封面指针写在人物卡 Markdown 里，由前端在生成/删除后经 `updateCharacter` 写回 |
| press 设定页 | 保留「封面画廊」（`listCover` / `saveCover` / `selectCover` / `deleteCover`）：候选为合成封面与图库 `photo-*`，可套用书名、另选、删除；AI 生成本身在生图页，见第 8 节 |
| ai | 图像通道与用量记账由 ai 提供，生图只消费；服务层依赖的是 `ImageGenerator` 最小接口（`ImageProviderRouter` 是其唯一实现），测试可注入替身而无需拉起 CLI |

---

## 2. 目录与命名

### 2.1 目录

```
{root}/press/【小说名】/
├── Images/                  ← 统一图库：新图一律写这里
├── Cover/                   ← 历史封面：只读兼容，不再写入新文件
├── Portraits/               ← 历史角色图：只读兼容，不再写入新文件
└── .zhai/image.json         ← 作品级生图参数（隐藏目录，不进作品索引）
```

`IMAGE_DIR_NAMES`（`src/modules/imagegen/constants.ts`）是三个目录的白名单：列举、复制、插入、删除、级联清理都按它遍历，因此旧目录里的图仍可正常管理，只是不再产生新文件。

旧目录仍有残留时，生图页会在筛选条下方给出一次性迁移入口（`pressAi/migrateImageDirs`）：只搬运文件、不改文件名，目标已存在同名文件时跳过并保留两份，迁移后同步改写作品封面指针的目录前缀。

### 2.2 图片标识

| 类型 | 规则 | 示例 |
| --- | --- | --- |
| 角色图 | `portrait-{14 位时间戳}-{8 位角色标识}` | `portrait-20261025143000-10428736` |
| 普通图 / 封面 | `photo-{14 位时间戳}-{8 位随机串}` | `photo-20261025143000-aB3xK9Qz` |
| 旧角色图（只读） | `portrait-{8 位角色标识}-{14 位时间戳}` | `portrait-10428736-20261025143000` |
| 旧封面（只读） | `cover-{14 位时间戳}` | `cover-20261025143000` |

解析集中在 `src/shared/types/imagegen.ts`：`parseImageKind` / `parseImageCharacterId` / `isPressImageId`。新旧规则必须并存且互不误判。

### 2.3 侧车元数据

每张新图旁落一份同名 `{id}.json`，字段为 `prompt` / `ratio` / `style` / `characterId` / `enhancedFrom` / `createdAt`，用于复现参数与后续搜索。写入失败只记 warn，不影响出图。

侧车是可选附属物，读写两侧都不假设它存在：

- 生成：生图页与角色卡通道都写同名侧车；`ratio` 记录实际出图规格——生图页写比例（`3:4`），角色卡写像素尺寸（`768x1024`），详情面板按值形态显示「比例」或「尺寸」。
- 读取：`pressAi/getImageDetail` 在侧车缺失或 JSON 不合法时，各字段返回 `null`，详情面板隐藏参数区，旧图仍可正常浏览。
- 删除：图库删图、角色卡删图、封面画廊删图都会顺带删同名侧车（不进回收站）；侧车本不存在时静默跳过。
- 迁移：`pressAi/migrateImageDirs` 搬图时同步搬走侧车，目标已有同名侧车则不覆盖，避免迁移后图片丢参数、旧目录留孤儿 JSON。

---

## 3. 协议

方法名登记在 `src/shared/types/messages.ts` 的 `HostMethodName`，分发在 `src/modules/press/pressRoutes.ts`。

### 3.1 图库

| 方法 | 入参 | 返回 | 说明 |
| --- | --- | --- | --- |
| `pressAi/listImageLibrary` | `dirPath` | `ImageLibraryResult` | 合并三目录扫描，按时间降序；`counts` 给出各分类数量 |
| `pressAi/getImageDetail` | `dirPath`、`path` | `ImageDetailResult` | 读同名侧车；侧车缺失或字段不合法时各字段为 `null`，不抛错 |
| `pressAi/deleteImage` | `dirPath`、`path` | `ImageDeleteResult` | 进回收站；一次算好作品封面回退值与角色封面回退值 |
| `pressAi/deleteImages` | `dirPath`、`paths` | `ImageBatchDeleteResult` | 整单校验路径（任一越权即拒绝，最多 500 张）；逐张删除并清侧车，最后只重扫一次目录，回传新图库与逐张回执 |
| `pressAi/migrateImageDirs` | `dirPath` | `ImageMigrateResult` | 把 `Cover` / `Portraits` 的图片搬进 `Images`，只搬不改名，同名跳过；搬空后删除旧目录 |
| `pressAi/setImageCover` | `dirPath`、`path` | `ImageSetCoverResult` | 校验归属、文件存在与标准命名 |
| `pressAi/copyPortrait` | `path` | `PortraitCopyResult` | 宿主写系统剪贴板（webview 受 CSP 限制） |
| `pressAi/insertPortrait` | `path` | `PortraitInsertResult` | 插入光标处；`no-editor` 视为静默忽略 |

### 3.2 出图

| 方法 | 说明 |
| --- | --- |
| `pressAi/generateImage` | 入参 `prompt` / `kind` / `characterId` / `ratio` / `style` / `enhancedFrom`；落 `Images/`，`kind=cover` 时自动设封面 |
| `pressAi/generateImage/abort` | 取消在途请求，返回 `{ aborted }`；单任务锁保证不会并发出图 |
| `pressAi/enhanceImagePrompt` | 文本模型改写输入框正文，30 秒上限，不落盘、不计图片配额 |

### 3.3 作品参数

| 方法 | 说明 |
| --- | --- |
| `pressAi/getImageSettings` | 返回生效参数与已覆盖的键 |
| `pressAi/saveImageSettings` | 只处理请求中出现的键，`null` 表示取消覆盖；返回保存后的真实状态 |

可覆盖键：`defaultRatio`、`portraitStyle`、`coverStyle`、`promptSuffix`、`negative`。前三项目前由前端消费（composer 默认比例与画风）；后两项由宿主在出图前叠加。

### 3.4 封面面板（设定页）

`pressAi/listCover`、`pressAi/saveCover`、`pressAi/selectCover`、`pressAi/deleteCover`，见第 8 节。候选合并 `Cover/cover-*` 与 `Images/photo-*`，按修改时间降序后最多返回 60 张（`MAX_COVER_CANDIDATES`），同时回传 `total` 命中总数，前端据此提示「仅显示最新 N 张」；AI 生成已并入 `pressAi/generateImage` 的 `kind=cover`。

### 3.5 角色卡（保留）

`pressAi/generatePortrait`、`pressAi/listPortraits`、`pressAi/listPortraitGallery`、`pressAi/aiPortrait/abort`，供角色卡面板使用，不在生图页范围内。

出图规则与生图页已对齐：新图落在 `Images/`，命名 `portrait-{14 位时间戳}-{8 位角色标识}`，并写同名侧车（`ratio` 取 `zhai.image.size` 像素尺寸）；`Portraits/` 目录只作只读兼容，不再写入。

---

## 4. 宿主分层

| 文件 | 职责 |
| --- | --- |
| `imageLibraryService.ts` | 三目录合并列举、删除（带回退值计算，侧车同步清理）、设封面、旧目录迁移、详情读侧车 |
| `imageGenerateService.ts` | 统一出图：参数校验、配额、单任务锁、落盘、侧车、用量记账 |
| `imageDirScan.ts` | 图片目录扫描唯一入口：目录缺失视为空、只收普通文件、扩展名口径（png/jpe?g/webp/gif） |
| `imageSidecar.ts` | 侧车路径推导与随图删除/迁移，尽力而为、不抛错 |
| `promptCompose.ts` | 提示词拼装纯函数：正文 → 作品补充 → 负向约束 → 画风描述 |
| `imageSettingsService.ts` | 作品级参数读写（`.zhai/image.json`），只存与默认不同的键 |
| `coverService.ts` | 设定页封面画廊：候选合并 `Cover/cover-*` 与 `Images/photo-*`，负责合成保存、选择、删除，不调用图像通道 |
| `portraitService.ts` | 角色图列举/复制/插入/删除与角色级联清理 |
| `db/coverRepository.ts` | 封面指针（`press.db`）；`isProjectImagePath` 判断归属 |

### 4.1 出图提示词叠加

```text
用户正文
\n\n 作品 promptSuffix（可选）
\n\n 避免出现：{negative}（可选）
\n\n STYLE_HINTS[style]（始终在最后）
```

空串一律跳过；拼装逻辑集中在 `composeImagePrompt`，由 `tests/imagegenPrompt.test.ts` 覆盖顺序与空串行为。

---

## 5. 前端结构

| 文件 | 职责 |
| --- | --- |
| `ImageGenPage.tsx` | 状态编排：筛选、计数、分批渲染、详情面板、单张/批量删除、设封面、复制、插入、旧目录迁移 |
| `ImageGenGrid.tsx` | 等宽卡片网格：3:4 裁切、封面徽标、悬停复制/插入/删除、多选勾选、点击打开详情 |
| `ImageComposer.tsx` | 输入卡片：命令动作与画风芯片内联、比例、增强提示词、封面模式、发送 / 取消生成 |
| `ImagePromptPopover.tsx` | 提示词词库（人物 / 场景 / 光影 / 镜头），点击插入光标 |
| `useImageLibrary.ts` | 列举、单张删除、批量删除（含最新列表回传）、旧目录迁移 |
| `useImageDetail.ts` | 详情面板按路径读取侧车；结果与来源路径绑定，迟到的回包不串图 |
| `useImageSettings.ts` | 作品级参数读写，`isLoaded` 之前不得据此保存 |
| `imageStyle.ts` | 画风取值与中文标签，composer 芯片与详情面板共用 |
| `@webview/components/RichChipInput.tsx` | 通用芯片输入区：芯片内联进正文流，Enter 发送、组词期间不拦截，命令式 `insertText` |
| `@webview/components/richText.ts` | 可编辑区 DOM 工具：读写纯文本、光标定位、芯片识别与插入，与 aichat 共用 |
| `promptLibrary.ts` | 词库数据 |

### 5.1 页面交互约束

- 筛选全部在内存中完成，不重复请求宿主；计数里「全部」取列表长度，「作品封面」由 `coverSelectedId` 推导，其余取宿主 `counts`。
- 详情面板用 `@components/ui/sheet`，点缩略图打开；设封面后重新列举，面板停留在当前图片；删除当前图片时面板自动关闭。
- 多选模式：点卡片切换勾选而不打开详情，悬停操作隐藏；批量删除需二次确认，走一次 `pressAi/deleteImages`，宿主删完只重扫一次并回传新图库。
- 分批渲染：网格一次挂载 60 张（`GRID_PAGE_SIZE`），筛选条件变化自动回到首批，底部「加载更多」按批追加；全选只覆盖已渲染的图片，未加载的图不会被批量删除带走。
- 选择生命周期：选中集合与筛选签名绑定，换类别/角色/关键词即派生为空集；批量删除只作用于当前筛选结果，删除期间按钮显示「正在删除 n 张」并禁止重复触发。
- 键盘与筛选复位：网格卡片可聚焦，回车/空格触发与点击相同的动作（内部操作按钮不拦截）；任一筛选生效时筛选条右侧出现「清空筛选」，一次复位类别、角色与关键词。
- 页面切换即重挂载：`PressSectionRouter` 按分区条件渲染（离开即卸载），生图页与设定页封面组都靠挂载 effect 重新读盘，因此跨页面改动无需额外刷新信号。
- 详情参数：按字段存在性分段渲染——无侧车时显示「没有出图参数」空态，提示词为空则隐藏复制按钮，`enhancedFrom` 存在时以折叠区展示增强前原文。
- 参数读取完成前不挂载 composer，用等高骨架占位，避免默认值覆盖用户已保存的比例与画风。
- 生成中发送按钮切换为「取消生成」，取消后立即复位界面，不等宿主回包；迟到的回包按请求代号丢弃。

### 5.2 超时口径

| 请求 | 前端兜底 | 宿主上限 |
| --- | --- | --- |
| `pressAi/generateImage` | 15 分钟 | 通道内置 10 分钟 |
| `pressAi/enhanceImagePrompt` | 60 秒 | 30 秒 |
| 其他图库请求 | bridge 默认 10 秒 | — |

出图超时或失败后前端主动调用 `abort`，释放宿主单任务锁，避免下一张被「已有生成中的图片请求」拒绝。

---

## 6. 关键约束

1. **磁盘是唯一事实来源**：任何写操作后重新列举，不做乐观删除或乐观新增。
2. **作品归属必须校验**：删除与设封面只接受 `press/{作品名}` 下、目录在白名单内的路径；设封面还要求标准命名。
3. **封面不是类别**：`PressImageKind` 只有 `portrait` / `photo` / `orphan`，「是否为封面」由 `coverSelectedId === id` 判断。
4. **角色封面指针由前端写回**：宿主只回传 `characterId` 与 `nextPortraitId`，前端在「被删图正是该角色当前封面」时才写回，避免覆盖用户新选择；批量删除时回退值改取「删除后剩余列表中该角色最新一张」，不采用单张回执里的 `nextPortraitId`（同批中可能指向即将被删的图）。
5. **配额与超时是全局护栏**：`zhai.image.dailyLimit` 不接受作品级覆盖；参数文件只管风格与默认值。
6. **参数只存差异**：`image.json` 中值为空集合时不写字段，`null` 表示取消覆盖。

---

## 7. 已知边界

| 项 | 现状 |
| --- | --- |
| 旧目录迁移 | 已提供一次性入口（`pressAi/migrateImageDirs`）：只搬不改名，同名跳过；角色封面存 id 不受影响，作品封面指针同步改写 |
| 提示词芯片 | 已内联：`RichChipInput` 与 aichat 共用 `richText` 的 DOM 工具，芯片可退格删除 |
| 角色快照 | 已注入姓名、性别年龄、身份与外貌；更细的字段（体型、背景）仍留在人物卡内 |
| 网格能力 | 已支持多选批量删除与悬停复制/插入/删除 |
| 批量删除原子性 | 一次请求内逐张执行，非事务：单张失败只记回执，成功部分照常生效并按最新图库刷新，不做回滚；单次上限 500 张 |
| 图片扩展名口径 | 图库、角色卡、封面画廊统一认 `png` / `jpe?g` / `webp` / `gif`，由 `imageDirScan.ts` 单点维护 |
| 图库规模 | `listImageLibrary` 全量返回，前端按 60 张一批挂载（无虚拟滚动）；封面画廊在宿主侧截断到 60 张并回传 `total` |
| 详情降级 | 读取侧车期间显示骨架占位；无侧车（旧图或手工图）时显示空态说明；`enhancedFrom` 以折叠区展示 |
| 旧目录清理 | 迁移后若 `Cover` / `Portraits` 已搬空且无其它文件，目录一并删除；有残留文件时保留 |

---

## 8. 封面生成入口与设定页面板的分工

**生成只有一套**：生图页 composer 的「作品封面」模式（`kind=cover`）。新封面落 `Images/`、按 `photo-*` 命名、自动设为作品封面，走统一提示词拼装与每日配额。

**设定页面板只做三件事**：

| 能力 | 协议 | 说明 |
| --- | --- | --- |
| 展示候选封面 | `pressAi/listCover` | 合并 `Cover/cover-*` 与 `Images/photo-*`，按修改时间降序，最多返回 60 张并回传 `total` |
| 套用书名 | `pressAi/saveCover` | 前端画布合成 PNG 后上传，落 `Cover/` 并自动设为封面，不消耗出图次数 |
| 另选 / 删除 | `pressAi/selectCover`、`pressAi/deleteCover` | 删除当前封面时回退到剩余最新一张 |

因此存在两类封面文件：生图页生成的 `Images/photo-*`，与设定页合成的 `Cover/cover-*`。画廊把两类合并展示（`Cover/cover-*` + `Images/photo-*`），但**角色图（`portrait-*`）不进画廊**，避免把角色卡当封面误删；在画廊里删除 `Images` 来源的图，等同于从统一图库删除该图（进回收站，封面指针按剩余最新一张回退）。

`pressAi/generateCover` 与 `ai/coverPrompt.ts` 已随入口迁移一并删除；`zhai.image.size` 现在只作用于角色卡出图（`pressAi/generatePortrait`），不再影响封面比例——封面比例取 composer 当前选择。

---

## 9. 验证方式

- `pnpm exec tsc --noEmit`
- `pnpm exec eslint src/modules/imagegen src/webview/workflow/imagegen`
- `pnpm exec vitest run tests/imagegenIds.test.ts tests/imagegenPrompt.test.ts tests/imageDirScan.test.ts tests/imageSidecar.test.ts tests/imageLibraryMigrate.test.ts tests/imageLibraryService.test.ts tests/coverCandidates.test.ts tests/coverService.test.ts tests/imageSettingsService.test.ts tests/imageGenerateService.test.ts`
- 手测清单：列举三目录、按类别/角色/关键词筛选与「清空筛选」、设为封面、删除当前封面后的回退、详情面板复制与插入（含无侧车空态与骨架过渡）、生成中取消、切换作品后参数是否沿用、多选批量删除（含进度文案与角色封面回退）、旧目录迁移（含同名跳过与搬空后目录删除）、芯片内联输入与退格删除、键盘 Tab 聚焦卡片后回车打开详情。
