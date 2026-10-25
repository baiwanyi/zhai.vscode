# ImageGen（生图）— 模块设计文档

**版本**：1.0
**日期**：2026-10-25
**状态**：图库管理、统一出图、作品级参数已落地；封面双通路收敛与旧目录迁移待决策
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
| press 设定页 | 仍保留独立的「封面画廊」（`generateCover` / `listCover` / `saveCover` / `selectCover` / `deleteCover`），用于合成封面与历史封面选择，见第 8 节 |
| ai | 图像通道（`ImageProviderRouter`）与用量记账（`UsageRecorder`）由 ai 提供，生图只消费 |

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

---

## 3. 协议

方法名登记在 `src/shared/types/messages.ts` 的 `HostMethodName`，分发在 `src/modules/press/pressRoutes.ts`。

### 3.1 图库

| 方法 | 入参 | 返回 | 说明 |
| --- | --- | --- | --- |
| `pressAi/listImageLibrary` | `dirPath` | `ImageLibraryResult` | 合并三目录扫描，按时间降序；`counts` 给出各分类数量 |
| `pressAi/deleteImage` | `dirPath`、`path` | `ImageDeleteResult` | 进回收站；一次算好作品封面回退值与角色封面回退值 |
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

`pressAi/generateCover`、`pressAi/listCover`、`pressAi/saveCover`、`pressAi/selectCover`、`pressAi/deleteCover`，见第 8 节。

### 3.5 角色卡（保留）

`pressAi/generatePortrait`、`pressAi/listPortraits`、`pressAi/listPortraitGallery`、`pressAi/aiPortrait/abort`，供角色卡面板使用，不在生图页范围内。

---

## 4. 宿主分层

| 文件 | 职责 |
| --- | --- |
| `imageLibraryService.ts` | 三目录合并列举、删除（带回退值计算）、设封面 |
| `imageGenerateService.ts` | 统一出图：参数校验、配额、单任务锁、落盘、侧车、用量记账 |
| `promptCompose.ts` | 提示词拼装纯函数：正文 → 作品补充 → 负向约束 → 画风描述 |
| `imageSettingsService.ts` | 作品级参数读写（`.zhai/image.json`），只存与默认不同的键 |
| `coverService.ts` | 设定页封面画廊：AI 生成（`Cover/` + `cover-*`）、合成保存、选择、删除 |
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
| `ImageGenPage.tsx` | 状态编排：筛选（类别 / 角色 / 关键词）、详情面板、删除、设封面、复制、插入、计数 |
| `ImageGenGrid.tsx` | 等宽卡片网格：3:4 裁切、封面徽标、悬停删除、点击打开详情 |
| `ImageComposer.tsx` | 输入卡片：命令动作与画风徽标、比例、增强提示词、发送 / 取消生成 |
| `ImagePromptPopover.tsx` | 提示词词库（人物 / 场景 / 光影 / 镜头），点击插入光标 |
| `useImageLibrary.ts` | 列举、删除、刷新 |
| `useImageSettings.ts` | 作品级参数读写，`isLoaded` 之前不得据此保存 |
| `promptLibrary.ts` | 词库数据 |

### 5.1 页面交互约束

- 筛选全部在内存中完成，不重复请求宿主；计数里「全部」取列表长度，「作品封面」由 `coverSelectedId` 推导，其余取宿主 `counts`。
- 详情面板用 `@components/ui/sheet`，点缩略图打开；设封面后重新列举，面板停留在当前图片；删除当前图片时面板自动关闭。
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
4. **角色封面指针由前端写回**：宿主只回传 `characterId` 与 `nextPortraitId`，前端在「被删图正是该角色当前封面」时才写回，避免覆盖用户新选择。
5. **配额与超时是全局护栏**：`zhai.image.dailyLimit` 不接受作品级覆盖；参数文件只管风格与默认值。
6. **参数只存差异**：`image.json` 中值为空集合时不写字段，`null` 表示取消覆盖。

---

## 7. 已知边界与后续

| 项 | 现状 | 后续 |
| --- | --- | --- |
| 封面双通路 | `generateCover`（`Cover/` + `cover-*`）与 `generateImage` 的 `kind=cover`（`Images/` + `photo-*`）并存；前端 composer 只发 `photo` / `portrait` | 需决策：① 保留双通路、明确边界；② 把封面生成入口迁入统一图库，设定页只留合成与选择 |
| 旧目录迁移 | `Cover/` 与 `Portraits/` 只读兼容 | 一次性搬迁进 `Images/` 并改写指针 |
| 提示词 chip | textarea + 顶部 chip 行 | 与 aichat 一致的内联 chip（需抽 `richInput` 光标逻辑） |
| 角色快照 | `PromptCharacterSnapshot` 只有 id 与 name | 注入外貌、身份等字段（需前端传更多或宿主提供上下文接口） |
| 网格能力 | 单张删除、详情面板复制/插入 | 多选批量删除、悬停快捷操作 |

---

## 8. 封面面板（设定页）与统一图库的关系

设定页封面面板仍走 `pressAi/generateCover` 等旧协议，原因：

- 它管理的是**封面画廊**（AI 生成 + 前端画布合成的书名排版图），语义是「候选封面」，不是通用图库；
- 新生成的封面落 `Cover/` 并由 `store` 登记为当前封面，统一图库通过 `IMAGE_DIR_NAMES` 也能列举到它（归类为 `orphan` 或按旧命名解析）。

因此当前存在**两套 AI 出图入口**：`generateCover`（封面构图提示词 + `zhai.image.size`）与 `generateImage`（统一提示词拼装 + 比例白名单）。两者的配额共用 `IMAGE_QUOTA_KEYS`，记账同一模块 `image`，不会重复计费；差异在落盘目录、命名与提示词口径。

---

## 9. 验证方式

- `pnpm exec tsc --noEmit`
- `pnpm exec eslint src/modules/imagegen src/webview/workflow/imagegen`
- `pnpm exec vitest run tests/imagegenIds.test.ts tests/imagegenPrompt.test.ts`
- 手测清单：列举三目录、按类别/角色/关键词筛选、设为封面、删除当前封面后的回退、详情面板复制与插入、生成中取消、切换作品后参数是否沿用。
