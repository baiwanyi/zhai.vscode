# ImageGen（生图）— 模块设计文档

**版本**：1.3
**日期**：2026-10-26
**状态**：图库管理、统一出图（角色卡与其他图片）、作品级参数、封面手动指定、芯片内联、批量删除、角色卡通道对齐、命名冲突统一、出图规则（自定义 md 作为上下文）、上下文与提示词分字段提交、参考图（多模态参考上下文）均已落地
**宿主**：VSCode 插件 Zhai（宅桌面）
**存储根**：作品资源在 `{storage.rootPath}/press/{作品名}/`，全局提示词资源在 `{storage.rootPath}/prompt/`（根目录配置见 `common.md` 第 1 节）

---

## 1. 模块概述

### 1.1 定位

作品图片资产的**统一入口**：列举、删除、设封面，以及在作品上下文里按提示词出图。前身是「作品封面 + 角色设定图」两条独立通道，现已合并为一套图库视图（生图页），封面不再是独立资源类型，而是「当前选中的那张图」。

### 1.2 与其他模块的边界

| 模块 | 边界 |
| --- | --- |
| press | 生图依赖作品目录（`press/{作品名}`）作为作用域；角色封面指针写在人物卡 Markdown 里，由前端在生成/删除后经 `updateCharacter` 写回 |
| press 设定页 | 只读展示封面（`listCover`）：基本信息左列显示当前封面，未设时取最新一张；出图、设封面与删除都在生图页，见第 8 节 |
| ai | 图像通道与用量记账由 ai 提供，生图只消费；服务层依赖的是 `ImageGenerator` 最小接口（`ImageProviderRouter` 是其唯一实现），测试可注入替身而无需拉起 CLI |

---

## 2. 目录与命名

### 2.1 目录

```
{root}/press/【小说名】/
├── Images/                  ← 统一图库：角色图与普通图都写这里
└── .zhai/image.json         ← 作品级生图参数（隐藏目录，不进作品索引）
```

`IMAGE_DIR_NAMES`（`src/modules/imagegen/constants.ts`）只含 `Images`：列举、复制、插入、删除与级联清理都按它遍历。

历史目录不再读取：`Cover/` 与 `Portraits/` 里的旧图不参与列举、删除与封面候选，代码不做迁移也不改写已有指针；需要保留的老图请手工移入 `Images/`（命名不符合当前规则的会显示为孤儿图）。

### 2.2 图片标识

| 类型 | 规则 | 示例 |
| --- | --- | --- |
| 角色图 | `portrait-{14 位时间戳}-{8 位角色标识}` | `portrait-20261025143000-10428736` |
| 普通图 | `photo-{14 位时间戳}-{8 位随机串}` | `photo-20261025143000-aB3xK9Qz` |

解析集中在 `src/shared/types/imagegen.ts`：`parseImageKind` / `parseImageCharacterId` / `isPressImageId`。只认当前命名，旧角色图与旧封面命名一律归为孤儿图。

### 2.4 命名冲突

生图页出图（角色图与普通图）共用 `src/modules/imagegen/imageNaming.ts` 的 `nextImageId`：落盘前按秒顺延探测同名文件，找到空位才返回标识，**永不覆盖已有文件**；顺延 60 秒仍冲突即报错，而不是随机改名造出无法解析的文件名。

### 2.3 侧车元数据

每张新图旁落一份同名 `{id}.json`，字段为 `prompt` / `ratio` / `style` / `characterId` / `enhancedFrom` / `createdAt`，用途仅限在详情面板复现该图的出图参数。写入失败只记 warn，不影响出图。

侧车不参与任何检索：图库列举只扫目录拿到文件名与时间，不读 JSON；页面搜索也只比对角色名与文件名（见 5.1），**不支持按提示词、画风等侧车字段搜索**。若将来要做按提示词找图，需新增读取侧车的检索协议，不能假设现有链路已具备。

侧车是可选附属物，读写两侧都不假设它存在：

- 生成：生图页出图（角色图与普通图）都写同名侧车；`ratio` 记录请求比例（`3:4` 等），详情面板据此显示「比例」。
- 读取：`pressAi/getImageDetail` 在侧车缺失或 JSON 不合法时，各字段返回 `null`，详情面板隐藏参数区，旧图仍可正常浏览。
- 删除：生图页删图与角色图删图都会顺带删同名侧车（不进回收站）；侧车本不存在时静默跳过。

---

## 3. 协议

方法名登记在 `src/shared/types/messages.ts` 的 `HostMethodName`，分发在 `src/modules/press/pressRoutes.ts`。

### 3.1 图库

| 方法 | 入参 | 返回 | 说明 |
| --- | --- | --- | --- |
| `pressAi/listImageLibrary` | `dirPath` | `ImageLibraryResult` | 扫描 Images，按时间降序；`counts` 给出各分类数量 |
| `pressAi/getImageDetail` | `dirPath`、`path` | `ImageDetailResult` | 读同名侧车；侧车缺失或字段不合法时各字段为 `null`，不抛错 |
| `pressAi/deleteImage` | `dirPath`、`path` | `ImageDeleteResult` | 进回收站；一次算好作品封面回退值与角色封面回退值 |
| `pressAi/deleteImages` | `dirPath`、`paths` | `ImageBatchDeleteResult` | 整单校验路径（任一越权即拒绝，最多 500 张）；逐张删除并清侧车，最后只重扫一次目录，回传新图库与逐张回执 |
| `pressAi/setImageCover` | `dirPath`、`path` | `ImageSetCoverResult` | 校验归属、文件存在与标准命名 |
| `pressAi/copyPortrait` | `path` | `PortraitCopyResult` | 宿主写系统剪贴板（webview 受 CSP 限制） |
| `pressAi/insertPortrait` | `path` | `PortraitInsertResult` | 插入光标处；`no-editor` 视为静默忽略 |

### 3.2 出图

| 方法 | 说明 |
| --- | --- |
| `pressAi/generateImage` | 入参 `prompt` / `promptTags` / `contexts` / `promptRules` / `referenceImages` / `kind` / `characterId` / `ratio` / `style` / `enhancedFrom`；`promptTags` 是词条芯片的标识（上游原文，最多 20 条），宿主按 `@shared/utils/promptTag` 换取归一化文本后与正文合并（词条在前、正文在后）；`contexts` 是「添加上下文」菜单展开的文本段（如作品设定，最多 4 段、每段 1500 字），不混入 `prompt`；`promptRules` 是规则芯片的标识（文件名主干，最多 5 条），宿主读 md 正文后接在上下文之后；`referenceImages` 是参考图芯片的本地路径（只接受选择流程登记过的图片，最多 3 张），宿主读取字节后作为多模态内容随指令提交，不写进文本提示词；正文、上下文、词条、规则与参考图全为空才拒绝出图；落 `Images/`，`kind` 只有 `portrait`（角色卡）与 `photo`（其他图片），生成不改作品封面 |
| `pressAi/generateImage/abort` | 取消在途请求，返回 `{ aborted }`；单任务锁保证不会并发出图。中断信号经 provider 传到 SDK 会话，真正中止本地出图；产物到手后还会再确认一次中断标记，已取消的请求不落盘、不记用量、不扣配额，因此「停止」之后不会凭空多出一张图 |
| `pressAi/pickReferenceImage` | — → `ImageReferencePickResult`。弹出系统文件选择框挑参考图：扩展名限 png / jpg / jpeg / webp / gif，校验常规文件、非符号链接、非空与 ≤12 MB，并按文件头嗅探真实类型；通过后登记路径并回传 `{ path, name, url }`，用户取消时 `reference` 为 `null` |
| `pressAi/enhanceImagePrompt` | 文本模型改写输入框正文，30 秒上限，不落盘、不计图片配额 |

### 3.3 作品参数

| 方法 | 说明 |
| --- | --- |
| `pressAi/getImageSettings` | 返回生效参数与已覆盖的键 |
| `pressAi/saveImageSettings` | 只处理请求中出现的键，`null` 表示取消覆盖；返回保存后的真实状态 |

可覆盖键：`defaultRatio`、`portraitStyle`、`promptSuffix`、`negative`。前两项由前端消费（composer 默认比例与画风）；后两项由宿主在出图前叠加。

### 3.4 提示词资源（预览图库与规则）

| 方法 | 入参 | 返回 | 说明 |
| --- | --- | --- | --- |
| `pressAi/getPromptImageBase` | — | `PromptImageBase` | 图库目录取 `{存储根}/prompt/images`，全局共享、与作品无关；目录里没有图片时 `baseUrl` 为 `null`，前端整体隐藏缩略图；`dirPath` 始终回传，空态据此提示用户把图片放在哪里 |
| `pressAi/listPromptRules` | — | `PromptRuleListResult` | 列举 `{存储根}/prompt/rules` 下的 `*.md`，返回 `{ id, name }`（均为文件名主干）与 `dirPath`；目录缺失视为空库，按中文名排序 |
| `pressAi/savePromptRule` | `{ name, content }` | `PromptRule` | 新建规则，落盘为 `{name}.md`；名称去 `.md` 后缀后校验长度与非法字符，同名文件已存在时拒绝覆盖；正文上限 4000 字 |
| `pressAi/openPromptRuleDir` | — | `PromptRuleListResult` | 目录不存在时先建出来，再用系统文件管理器定位，并回传最新列表 |

词条数据只存图片文件名，前端用 `baseUrl + '/' + preview` 拼地址。`preview` 是本地真实文件名：图库里的文件按 `{标题}_{哈希}.webp` 命名，哈希即 `sha1(https://img.aishort.top/imgprompt/{原始文件名})` 的前 10 位，因此生成数据时传 `--images <图库目录>` 就能按哈希精确反查，不依赖标题拼写。目录内的文件由用户自行下载放入，扩展不打包、不下载任何图片。目录为空与目录缺失走同一条判空逻辑（复用 `imageDirScan` 的 `listImageFiles`），不逐个文件试加载。宿主侧实现见 `modules/imagegen/promptImageService.ts`，另有命令 `zhai.prompt.openImageDir` 供空态按钮打开该目录。

出图规则是用户手写的 md 约束（如「只用青蓝与灰白」「避免出现文字」），全局共享、与作品无关：前端只持有文件名主干，正文一律由宿主在出图时读盘，规则改文无需重新进页面。文件已被删除的规则静默跳过并记日志，不阻断出图；单次请求最多并入 5 条、合计 3000 字，超出部分丢弃，避免规则挤占画面描述。用户也可以直接往目录里放 md 文件，重新打开命令菜单即可见。

### 3.5 作品封面（只读展示）

设定页只调 `pressAi/listCover`：候选只取 `Images/photo-*`，按修改时间降序后最多返回 60 张（`MAX_COVER_CANDIDATES`），同时回传 `total`；基本信息左列取选中封面、未设时取最新一张。合成、另选与删除入口已移除，设封面唯一入口是生图页图片详情的 `pressAi/setImageCover`，见第 8 节。

### 3.6 角色设定图（列举与图片操作）

`pressAi/listPortraits`、`pressAi/listPortraitGallery` 供人物卡与人物列表回读已落盘的设定图；`pressAi/copyPortrait` 与 `pressAi/insertPortrait` 在生图页图片详情里复用。出图不再有 `pressAi/generatePortrait`，人物设定图统一由生图页 `pressAi/generateImage`（`kind=portrait`）产出：新图落在 `Images/`，命名 `portrait-{14 位时间戳}-{8 位角色标识}`，并写同名侧车（`ratio` 记录请求比例）。

---

## 4. 宿主分层

| 文件 | 职责 |
| --- | --- |
| `imageLibraryService.ts` | 统一目录列举、删除（带回退值计算，侧车同步清理）、设封面、详情读侧车 |
| `imageGenerateService.ts` | 统一出图：参数校验、词条标识换取文本、配额、单任务锁、落盘、侧车、用量记账 |
| `imageDirScan.ts` | 图片目录扫描唯一入口：目录缺失视为空、只收普通文件、扩展名口径（png/jpe?g/webp/gif） |
| `promptImageService.ts` | 提示词预览图库：`{存储根}/prompt/images` 判空并转 webview 基址，另提供打开该目录的命令实现 |
| `promptRuleService.ts` | 出图规则：`{存储根}/prompt/rules` 列举、新建（不覆盖同名）、打开目录，并提供出图时的正文读取（条数与总长在此收口） |
| `referenceImageService.ts` | 参考图：系统文件选择框、扩展名 / 体积 / 文件头校验、路径登记表；出图时只读登记过的路径，读成 `{ bytes, mimeType }` 交给通道 |
| `imageNaming.ts` | 图片命名唯一入口：三类标识格式、同秒冲突按秒顺延、永不覆盖 |
| `imageSidecar.ts` | 侧车路径推导、随图删除与写入，尽力而为、不抛错 |
| `promptCompose.ts` | 提示词拼装纯函数：正文 → 作品补充 → 负向约束 → 画风描述 |
| `imageSettingsService.ts` | 作品级参数读写（`.zhai/image.json`），只存与默认不同的键 |
| `coverService.ts` | 封面候选列举：只取 `Images/photo-*` 供设定页只读展示，不写盘、不调用图像通道 |
| `portraitService.ts` | 角色图列举/复制/插入与角色级联清理（出图已迁到 `imageGenerateService`） |
| `db/coverRepository.ts` | 封面指针（`press.db`）；`isProjectImagePath` 判断归属 |

### 4.1 出图提示词叠加

```text
词条文本（按芯片顺序，逗号连接）＋ 用户正文 ＋ 角色段
\n\n 上下文段（「添加上下文」菜单展开，按芯片顺序，可选）
\n\n 规则正文（按芯片顺序，每条独立成段，可选）
\n\n 作品 promptSuffix（可选）
\n\n 避免出现：{negative}（可选）
\n\n STYLE_HINTS[style]（始终在最后）
```

空串一律跳过；词条由 `imageGenerateService` 用 `@shared/utils/promptTag` 的 `normalizePromptTag` 换取并前置，归一化口径与前端词库层同源，因此面板上的词条文本与最终提示词逐字一致；上下文段来自请求的 `contexts`（前端 `composeSettingContext` 展开），规则正文由 `promptRuleService.readForPrompt` 按标识读盘后传给 `composeImagePrompt`，空串、空规则与缺失文件都不占位。宿主侧拼装集中在 `src/modules/imagegen/promptCompose` 的 `composeImagePrompt`（对象入参，顺序固定），由 `tests/imagegenPrompt.test.ts` 覆盖顺序与空串行为，上下文、规则读盘与出图合并在 `tests/imageGenerateService.test.ts` 覆盖。前端只负责正文、角色段与上下文段（`workflow/imagegen/prompt/promptSections.ts`），画风与负向约束仍由宿主追加。

参考图不参与文本拼装：`imageGenerateService` 把 `referenceImages` 交给 `referenceImageService.readForPrompt` 读成字节与真实 MIME，再由 `codebuddyImageProvider` 把「指令文本 + image 内容块」作为一条结构化用户消息提交（`query` 的 `prompt` 支持 `AsyncIterable<UserMessage>`）。无参考图时仍走原字符串提示词路径，二者行为一致；单张参考图失效（被删除、被替换、超限）只跳过该张并记日志，不阻断出图。

---

## 5. 前端结构

| 文件 | 职责 |
| --- | --- |
| `ImageGenPage.tsx` | 页面骨架与编排：筛选、计数、分批渲染、详情面板与出图回调；多选、删除与封面指针同步交给 hooks |
| `ImageGenGrid.tsx` | 等宽卡片网格：3:4 裁切、封面徽标、悬停复制/插入/删除、多选勾选、点击打开详情 |
| `ImageComposer.tsx` | 输入卡片：添加上下文菜单（作品设定开关、规则）、参考图与角色选择、词条芯片、底部比例与画面风格、增强提示词、发送 / 取消生成 |
| `ImageCommandMenus.tsx` | 添加上下文菜单：作品设定开关 + 规则子菜单（列出 `prompt/rules` 的 md、勾选即挂芯片、新建规则弹窗、打开规则目录），菜单内各项都作为上下文提交 |
| `ImageReferencePicker.tsx` | 参考图：工具栏图标按钮，点击由宿主弹文件选择框；选中后挂「缩略图 + 文件名」芯片，悬停文件名预览大图，可挂多枚 |
| `ImageCharacterPicker.tsx` | 角色选择：工具栏图标按钮下拉，列出作品全部人物卡，选中即挂「图标 + 姓名」徽标，可切回「不使用角色」 |
| `ImagePromptPicker.tsx` | 提示词面板：工具栏图标按钮弹出，一级分类 / 二级分类 / 词条三级联动，顶部关键词跨分组搜索；点词条切换芯片并回显选中态，不写正文 |
| `useImageLibrary.ts` | 列举（含不切加载态的静默刷新）、单张删除、批量删除（含最新列表回传） |
| `useCharacterIndex.ts` | 角色索引：一次遍历派生 `byId` 与 `names` 两张表，封面修正与卡片角标共用；`ImageGenCharacter` 类型定义在此 |
| `useImageSelection.ts` | 多选状态：选中集合与筛选签名绑定（换筛选即派生空集）、全选只覆盖已渲染图片、进入/退出都清空 |
| `useImageDeletion.ts` | 删除编排：单张删除关详情、批量删除只处理当前筛选内的勾选、二次确认与 `removingTotal` 防重入 |
| `useCharacterCoverSync.ts` | 角色封面指针同步：单删按宿主回退值、批删按剩余列表最新一张、出图仅在该角色无封面时认领 |
| `useImageDetail.ts` | 详情面板按路径读取侧车；迟到回包按来源路径**丢弃**（不是覆盖后再过滤），切图不会把新图详情清空 |
| `useImageSettings.ts` | 作品级参数读写，`isLoaded` 之前不得据此保存 |
| `useImageComposer.ts` | 输入卡片会话状态：正文、增强态、生成态与请求代号，发送 / 取消 / 超时，失败或取消按草稿回填 |
| `usePromptChips.ts` | 芯片集合：设定与角色按 kind 唯一，词条按上游原文去重、规则按标识去重、参考图按磁盘路径去重且都可多枚；角色直接设置、词条与规则开关、参考图只增删、清空与草稿回填；图标映射留在 layout |
| `usePromptRules.ts` | 规则清单：列举、新建与打开目录，新建成功后自动挂芯片；正文不进前端，规则改文无需刷新 |
| `imageStyle.ts` | 画风取值与中文标签，composer 的画面风格面板与详情面板共用 |
| `prompt/promptSections.ts` | 前端提示词分段：正文与角色段合成为 `prompt`，作品设定由 `composeSettingContext` 单独展开为上下文段 |
| `prompt/ratioIntent.ts` | 正文比例意图探测：数字写法与中英文比例词合流，取最后出现者 |
| `@webview/components/RichChipInput.tsx` | 通用芯片输入区：芯片内联进正文流，带 `preview` 的芯片悬停文件名弹出大图，Enter 发送、组词期间不拦截，命令式 `insertText` |
| `@webview/components/richText.ts` | 可编辑区 DOM 工具：读写纯文本、光标定位、芯片识别与插入，与 aichat 共用 |
| `usePromptImages.ts` | 取提示词预览图基址（面板打开时请求一次），失败按「没有图」处理，不弹错误 |
| `prompt/promptLibrary.ts` | 词库适配层：读 `prompt/data/promptTags.json`，导出三级清单与查询函数，权重归一取 shared |
| `prompt/data/promptTags.json` | 词库数据（约 530 KB），由 `scripts/build-prompt-tags.mjs` 从上游分片生成，不手改 |
| `@shared/utils/promptTag.ts` | 词条原文归一化：前端词库层与宿主换取共用，剥离 `(x:1.3)` 与强调括号 |

### 5.1 页面交互约束

- 筛选全部在内存中完成，不重复请求宿主；计数里「全部」取列表长度，「作品封面」由 `coverSelectedId` 推导，其余取宿主 `counts`。
- 关键词范围：输入框占位即「搜索角色或文件名」——只对角色名与图片标识（文件名主干）做大小写不敏感的子串匹配，不读侧车、不搜提示词与画风；未归属角色的图片只匹配文件名。
- 详情面板用 `@components/ui/sheet`，点缩略图打开；设封面后重新列举，面板停留在当前图片；删除当前图片时面板自动关闭。
- 多选模式：点卡片切换勾选而不打开详情，悬停操作隐藏；批量删除需二次确认，走一次 `pressAi/deleteImages`，宿主删完只重扫一次并回传新图库。
- 分批渲染：网格一次挂载 60 张（`GRID_PAGE_SIZE`），筛选条件变化自动回到首批，底部「加载更多」按批追加；全选只覆盖已渲染的图片，未加载的图不会被批量删除带走。
- 选择生命周期：选中集合与筛选签名绑定，换类别/角色/关键词即派生为空集；批量删除只作用于当前筛选结果，删除期间按钮显示「正在删除 n 张」并禁止重复触发。
- 键盘与筛选复位：网格卡片可聚焦，回车/空格触发与点击相同的动作（内部操作按钮不拦截）；任一筛选生效时筛选条右侧出现「清空筛选」，一次复位类别、角色与关键词。
- 页面切换即重挂载：`PressSectionRouter` 按分区条件渲染（离开即卸载），生图页与设定页封面组都靠挂载 effect 重新读盘，因此跨页面改动无需额外刷新信号。
- 详情参数：按字段存在性分段渲染——无侧车时显示「没有出图参数」空态，提示词为空则隐藏复制按钮，`enhancedFrom` 存在时以折叠区展示增强前原文。
- 参数读取完成前不挂载 composer，用等高骨架占位，避免默认值覆盖用户已保存的比例与画风。
- 比例自动跟随：正文里写出 `1:1` / `3:4` / `4:3` / `16:9` / `9:16`（冒号全角半角与斜杠都认），或写「竖版 / 横版 / 方形」（对应 9:16 / 16:9 / 1:1），或写其英文同义词 `vertical` / `portrait`、`horizontal` / `landscape`、`square`（不区分大小写）时，底部比例菜单自动切到该档；各类写法按出现位置合流，多处出现取最后；只在前后的探测结果发生变化时切换，所以关键字没变时手动选的比例不会被后续输入打回；该切换只改本次会话，不写回作品配置。其余模糊描述不猜，避免猜错反而改坏比例。
- 生成中发送按钮切换为「取消生成」，取消后立即复位界面，不等宿主回包；迟到的回包不写回界面（不认领封面、不清空输入），但会静默刷新列表，把宿主已经落盘的图补上——用户不必切页才发现新图。
- 出图占位：`isGenerating` 由 composer 经 `onGeneratingChange` 上报，页面在网格首位渲染一张与卡片同比例（3:4）的骨架卡；成功后用静默刷新（`reload({ silent: true })`）拉回列表，占位由 `isRefreshingResult` 一直挂到新图入列，视线里只发生「骨架 → 新图」一次替换，中间不闪整块加载态。失败、取消、超时都会回收占位，composer 卸载时补发一次 `false`，不会卡在「生成中」。
- 点「停止」是同步复位：`setIsGenerating(false)` 先于取消请求发出，占位当帧收起，不等宿主回包；随后宿主侧中断请求，已取消的产物不会再落盘（见 3.2）。
- 角色选择：工具栏角色按钮展开作品全部人物卡，选中即挂「图标 + 姓名」徽标，发送时并入角色段（姓名、性别年龄、身份、外貌），随请求的 `kind` 变为 `portrait`、`characterId` 取该角色；选「不使用角色」或移除徽标即回落普通图；顶栏筛选的角色只作初值，之后以选择器为准，两者不联动。
- 增强提示词：提交的是「正文 + 角色段」，让改写结果带上角色长相与身份；设定段不进增强请求（避免复述作品信息），还原时回到纯正文。
- 添加上下文：工具栏左一按钮（气泡「添加上下文」）里的项都按上下文提交——「作品设定」由快照展开为 `contexts` 文本段，规则只传文件名主干、正文由宿主读盘，两者都不写进 `prompt` 正文；只挂上下文也能出图，生成中仍可切换（只影响下一次请求）。
- 出图规则：「添加上下文」菜单的「规则」子菜单列出 `{存储根}/prompt/rules` 下的 md，勾选即挂「图标 + 规则名」芯片，可多枚；芯片只带文件名主干，正文由宿主读盘并入，发送后随正文一起清空、失败时随草稿回填。每次打开菜单都重读目录，用户直接往目录里放文件也能看到；「新建规则」弹窗保存成功后自动挂上该芯片，重名由宿主拒绝，本层不做预判。
- 发送即清空：点击发送的同时清掉输入框与全部芯片（画风不在芯片里，只作请求参数，发送时由宿主并入提示词），增强态一并复位（按钮回到增强图标，请求仍带发送前的 `enhancedFrom`），生成期间输入框不会停着上一轮的提示词；草稿存在 `lastDraftRef`（含增强前原文），请求失败或用户取消时再回填，且仅在用户没有重新输入的情况下回填，正文与增强态同进同退，不覆盖等待期间写下的新内容。
- 提示词面板：一级分类与二级分类都是必选单选，重复点击当前项被忽略；切换一级分类后二级分类按「当前值不在新分组内即回落到首项」派生，不额外维护状态；关键词非空时词条区跨分组平铺命中项，最多渲染 120 条并提示细化。点词条只在输入区挂一枚芯片（已挂则取消），按钮以 `aria-pressed` 与 secondary 变体回显选中态；词条文本不写进正文，发送时按上游原文交给宿主换取，连续选多条即多枚芯片，顺序即并入顺序。
- 词条芯片：标识取词条上游原文（全库唯一，实测 5040 条无重复），同一条只允许一枚；正文为空但有词条时同样可发送，发送后芯片随正文一起清空，失败或取消时与草稿一并回填。
- 提示词缩略图：`pressAi/getPromptImageBase` 在面板每次打开时请求一次，`baseUrl` 为 `null` 时整块缩略图不渲染并改用更密的列宽，底部提示图库目录与「打开目录」按钮；单张图缺失只影响该条，由 `@webview/components/Image` 的占位兜住。
- 词条预览：有图的词条悬停 250ms 弹出 `@components/ui/hover-card` 大图（3:4，宽 10rem）与换取前的英文提示词（三行截断）；缺图条目只渲染按钮本身，不挂空浮层。

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
2. **作品归属必须校验**：删除与设封面只接受 `press/{作品名}/Images` 下的路径；设封面还要求标准命名。
3. **封面不是类别**：`PressImageKind` 只有 `portrait` / `photo` / `orphan`，「是否为封面」由 `coverSelectedId === id` 判断。
4. **角色封面指针由前端写回**：宿主只回传 `characterId` 与 `nextPortraitId`，前端在「被删图正是该角色当前封面」时才写回，避免覆盖用户新选择；批量删除时回退值改取「删除后剩余列表中该角色最新一张」，不采用单张回执里的 `nextPortraitId`（同批中可能指向即将被删的图）。
5. **配额与超时是全局护栏**：`zhai.image.dailyLimit` 不接受作品级覆盖；参数文件只管风格与默认值。
6. **参数只存差异**：`image.json` 中值为空集合时不写字段，`null` 表示取消覆盖。

---

## 7. 已知边界

| 项 | 现状 |
| --- | --- |
| 旧目录文件 | 不再读取：`Cover/` 与 `Portraits/` 的历史图不参与列举、删除与封面候选，新图只写 `Images/` |
| 提示词芯片 | 已内联：`RichChipInput` 与 aichat 共用 `richText` 的 DOM 工具，芯片可退格删除；芯片只带上游原文，文本由宿主换取，因此宿主不校验词条是否存在于库中 |
| 出图规则 | 全局共享（`prompt/rules`），不随作品迁移；保存只新建、不覆盖同名文件；规则被删除或读取失败时静默跳过；单次最多 5 条、合计 3000 字，单条正文上限 4000 字 |
| 上下文拆分 | 作品设定与规则走 `contexts` / `promptRules`，与 `prompt` 正文分字段提交；宿主侧仍拼成一段文本交给图像通道，模型侧只有单段输入 |
| 参考图 | 只接受选择流程登记过的本地路径（登记表上限 32 条，超出淘汰最早一条）；单次最多 3 张、单张 ≤12 MB；扩展名白名单 + 文件头嗅探双校验；侧车不记录参考图，详情面板无法据此复现 |
| 角色快照 | 已注入姓名、性别年龄、身份与外貌；更细的字段（体型、背景）仍留在人物卡内 |
| 网格能力 | 已支持多选批量删除与悬停复制/插入/删除 |
| 批量删除原子性 | 一次请求内逐张执行，非事务：单张失败只记回执，成功部分照常生效并按最新图库刷新，不做回滚；单次上限 500 张 |
| 图片扩展名口径 | 图库、角色图、封面候选统一认 `png` / `jpe?g` / `webp` / `gif`，由 `imageDirScan.ts` 单点维护 |
| 图库规模 | `listImageLibrary` 全量返回，前端按 60 张一批挂载（无虚拟滚动）；封面候选在宿主侧截断到 60 张并回传 `total` |
| 详情降级 | 读取侧车期间显示骨架占位；无侧车（旧图或手工图）时显示空态说明；`enhancedFrom` 以折叠区展示 |

---

## 8. 出图与封面设定的分工

**生成只有两种**：角色图（`kind=portrait`）与其他图片（`kind=photo`）。出图不改作品封面——封面是「图库里当前选中的那张」，任意一张普通图都可以在详情面板里直接指定，不必专门生成。

**封面只有一个写入入口**：生图页图片详情的 `pressAi/setImageCover`。设定页「基本信息」左列只读展示 `pressAi/listCover` 的结果，不再有套用书名、另选或删除。

因此封面来源只有图库里的普通图 `Images/photo-*`（详情面板里指定）；历史 `Cover/cover-*` 与 `Portraits/` 一律不再读取。角色图（`portrait-*`）不进封面候选，避免把人物设定图当作品封面。

`pressAi/saveCover`、`selectCover`、`deleteCover`、`generateCover`，以及 `ai/coverPrompt.ts`、`setting/coverCompose.ts`、`ai/portraitSceneGenerator.ts` 等旧链路已随入口迁移一并删除；`zhai.image.size` 现在作用于生图页全部出图。

---

## 9. 验证方式

- `pnpm exec tsc --noEmit`
- `pnpm exec eslint src/modules/imagegen src/workflow/imagegen`
- `pnpm exec vitest run tests/imagegenIds.test.ts tests/imagegenPrompt.test.ts tests/imageDirScan.test.ts tests/imageSidecar.test.ts tests/imageLibraryService.test.ts tests/coverService.test.ts tests/imageSettingsService.test.ts tests/imageGenerateService.test.ts tests/imageNaming.test.ts tests/useImageLibrary.test.tsx tests/useImageDetail.test.tsx tests/components/ImageGenGrid.test.tsx tests/components/ImageComposer.test.tsx tests/components/ImageGenPage.test.tsx`
- 手测清单：列举 Images 目录、按类别/角色/关键词筛选与「清空筛选」、设为封面、删除当前封面后的回退、详情面板复制与插入（含无侧车空态与骨架过渡）、生成中取消（含取消后迟到出图是否自动补进列表）、切换作品后参数是否沿用、多选批量删除（含进度文案与角色封面回退）、芯片内联输入与退格删除、键盘 Tab 聚焦卡片后回车打开详情。
