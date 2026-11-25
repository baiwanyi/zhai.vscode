/**
 * 作品骨架生成：作品名校验、章节与卷的命名规则、骨架与章节文档模板，纯函数零副作用便于单测。
 * 骨架对齐 docs/modules/press.md 1.2/1.3：README.md + 大纲.md + 角色设定.md + 设定.md + Chapters/；
 * 章节文件按「两位序号-标题.md」命名，分卷目录按「两位序号-卷名」命名。
 * 关键约束：作品名同时作为目录名，须满足跨平台约束（非法字符、系统保留名、首尾空格与点）；
 * 本模块只产出相对路径与内容，落盘与索引由 projectService 负责；README 与章节的一级标题供索引器取标题；
 * 章节文档只有一级标题与小说正文，本章介绍 / 出场角色 / 金手指设定 / 字数目标在大纲里维护；
 * 新作品自带默认卷与首章，保证详情页一进去就有可写章节，不留空态。
 */
import type { PressAudience } from '@shared/types/press'

/** 作品根文档名：作品被打开时的落点，同时承载背景与风格设定 */
export const PROJECT_README_NAME = 'README.md'

/** 世界观文档名：设定页世界观分组手动保存的落点 */
export const PROJECT_WORLD_DOC_NAME = '世界观.md'

/** 金手指文档名：设定页金手指分组手动保存的落点 */
export const PROJECT_POWER_DOC_NAME = '金手指.md'

/** 势力文档名：设定页势力分段的条目落点，每个势力以二级标题起条 */
export const PROJECT_FACTION_DOC_NAME = '势力.md'

/** 地点文档名：设定页地点分段的条目落点 */
export const PROJECT_PLACE_DOC_NAME = '地点.md'

/** 物品文档名：设定页物品分段的条目落点 */
export const PROJECT_ITEM_DOC_NAME = '物品.md'

/** 章节目录名：其下的文档计入章节数，新建作品与新增章节统一写在这里 */
export const PROJECT_CHAPTER_DIR = 'Chapters'

/** 旧版章节目录名：早期版本用 `Chapter`，读取须兼容、写入前先整体迁移 */
export const LEGACY_PROJECT_CHAPTER_DIR = 'Chapter'

/** 章节目录的两种写法：路径第三段命中任一即视为章节，兼容尚未迁移的旧作品 */
export const CHAPTER_DIR_NAMES: readonly string[] = [PROJECT_CHAPTER_DIR, LEGACY_PROJECT_CHAPTER_DIR]

/** 作品名字符数上限：兼顾侧栏展示与文件系统路径长度 */
export const MAX_PROJECT_NAME_LENGTH = 60

/** Windows 保留设备名：这些名字作为目录名在 Windows 上不可创建 */
const WINDOWS_RESERVED_NAMES: readonly string[] = [
    'CON',
    'PRN',
    'AUX',
    'NUL',
    'COM1',
    'COM2',
    'COM3',
    'COM4',
    'COM5',
    'COM6',
    'COM7',
    'COM8',
    'COM9',
    'LPT1',
    'LPT2',
    'LPT3',
    'LPT4',
    'LPT5',
    'LPT6',
    'LPT7',
    'LPT8',
    'LPT9',
]

/** 文件名与目录名中不可出现的字符（Windows 与各平台通用的最小集合） */
const ILLEGAL_NAME_CHARS = ['\\', '/', ':', '*', '?', '"', '<', '>', '|']

/** 骨架文档：relativePath 相对作品目录，content 为落盘全文 */
export interface ProjectSkeletonFile {
    relativePath: string
    content: string
}

/** 是否含控制字符：不可见字符会污染文件系统与展示 */
function hasControlChar(value: string): boolean {
    return [...value].some((char) => char.charCodeAt(0) < 32)
}

/**
 * 名称通用校验：合法返回 null，非法返回可直接展示给用户的原因（label 用于拼装文案）。
 * 关键约束：调用方须先 trim；空名、超长、非法字符、控制字符、`.`/`..`、
 * 首空格或以空格/点结尾、Windows 保留名（含以扩展名形式出现的变体）一律拒绝。
 */
function validateName(name: string, label: string): string | null {
    if (name.length === 0) {
        return `${label}不能为空`
    }
    if (name.length > MAX_PROJECT_NAME_LENGTH) {
        return `${label}不能超过 ${MAX_PROJECT_NAME_LENGTH} 个字符`
    }
    if (ILLEGAL_NAME_CHARS.some((char) => name.includes(char)) || hasControlChar(name)) {
        return `${label}不能包含 \\ / : * ? " < > | 等非法字符`
    }
    if (name === '.' || name === '..') {
        return `${label}不能为 . 或 ..`
    }
    if (name.startsWith(' ') || name.endsWith(' ') || name.endsWith('.')) {
        return `${label}不能以空格开头，也不能以空格或点结尾`
    }
    const baseName = (name.split('.')[0] ?? '').toUpperCase()
    if (WINDOWS_RESERVED_NAMES.includes(baseName)) {
        return `${label}不能使用系统保留名：${name}`
    }
    return null
}

/** 校验作品名：同时作为目录名，规则与卷名一致，仅文案不同 */
export function validateProjectName(name: string): string | null {
    return validateName(name, '作品名')
}

/** 校验卷名：只用于卷目录名的可读部分，序号前缀由宿主保留 */
export function validateVolumeName(name: string): string | null {
    return validateName(name, '卷名')
}

/**
 * 生成重命名后的卷目录名：保留原目录的序号前缀，替换可读部分。
 * 原目录无序号前缀时新目录也不带前缀，避免凭空造出排序号。
 */
export function buildRenamedVolumeDirName(currentDirName: string, name: string): string {
    const matched = /^(\d+)(?:[-_.、\s])/.exec(currentDirName)
    return matched?.[1] === undefined ? name : `${matched[1]}-${name}`
}

/** 作品根文档：目标读者与目标字数写进正文的「作品设定」段，正文留给用户补背景与风格 */
export function buildReadmeContent(name: string, audience: PressAudience): string {
    return [
        `# ${name}`,
        '',
        '## 简介',
        '',
        '## 写作风格',
        '',
        '## 作品设定',
        '',
        '### 目标读者',
        '',
        audience,
        '',
        '### 目标字数',
        '',
        '0',
        '',
    ].join('\n')
}

/**
 * 大纲骨架：结构纲三阶段（激励事件 / 中点 / 高潮）、卷纲与章节内容两分区、伏笔线索与主线一次铺开。
 * 关键约束：段落标题必须与 workspaceWriter 的落点表、Webview 解析端的段落关键词完全一致，
 * 改名会让回写落到新段落、旧内容留在原地，表现为「保存后大纲消失」；
 * 卷在两段里各写一次三级标题（`### 第N卷`），卷序与作品列表的默认卷目录（01-默认卷）同一序号，
 * 首章与骨架里的章节文件一一对应（第1章 未命名章节），打开大纲即有可编辑的卷纲与章纲；
 * 故事核、人物纲、设定纲、节奏情绪与时间线都不铺段落——故事核与设定由作品设定承载，
 * 人物由角色设定（人物卡）承载，节奏类型写在章块里，时间线需要时由作者自行加段。
 */
function buildOutlineContent(): string {
    return [
        '# 大纲',
        '',
        '## 结构纲',
        '',
        '### 激励事件',
        '',
        '- 类型：激励事件',
        '- 卷位：',
        '- 叙事作用：打破平衡',
        '- 事件：',
        '- 主角变化：',
        '',
        '### 中点',
        '',
        '- 类型：中点',
        '- 卷位：',
        '- 叙事作用：赌注升级',
        '- 事件：',
        '- 主角变化：',
        '',
        '### 高潮',
        '',
        '- 类型：高潮',
        '- 卷位：',
        '- 叙事作用：迫使选择',
        '- 事件：',
        '- 主角变化：',
        '',
        '## 卷纲',
        '',
        `### ${DEFAULT_VOLUME_NAME}`,
        '',
        '#### 预计章节数',
        '',
        '1',
        '',
        '#### 核心事件',
        '',
        '本卷核心事件：主角要得到什么，谁 / 什么在阻碍，代价是什么',
        '',
        '#### 主要情节',
        '',
        '- 因为 A，所以 B，但 C 导致 D。',
        '',
        '#### 关键转折',
        '',
        '- 关键转折：意料之外但合理的变化',
        '',
        '#### 卷末结果',
        '',
        '卷末结果：目标达成 / 失败 / 付出的代价，以及留下的新问题',
        '',
        '- 颗粒度：中纲',
        '',
        '## 章节内容',
        '',
        `### ${DEFAULT_VOLUME_NAME}`,
        '',
        // 卷名与章名只写纯名称：卷序与章序由块的位置决定，界面上再补编号
        `#### ${DEFAULT_CHAPTER_TITLE}`,
        '',
        '- 状态：待写',
        '- 颗粒度：细纲',
        '- POV：主角',
        '- 目标：本章目标：他此刻想得到什么',
        '- 阻碍：阻碍：谁 / 什么阻止他',
        '- 转折：转折：意料之外但合理的变化',
        '- 结果：结果：达成 / 失败 / 代价',
        '- 情绪：情绪：紧张 / 爽 / 疑 / 悲',
        '- 钩子：悬念',
        '- 节奏：铺垫',
        '- 张力：3',
        '- 字数：0/0',
        '- 地点：',
        '',
        '##### 计划梗概',
        '',
        '本章梗概：一句话说清这一章发生了什么',
        '',
        '##### 节拍',
        '',
        '- [ ] 主角因「开端」被卷入新的阻碍',
        '- [ ] 推进过程中暴露一条新线索',
        '',
        '## 伏笔线索',
        '',
        '## 主线',
        '',
    ].join('\n')
}

/**
 * 生成作品级文档：README、大纲、角色设定、设定，以及设定页按标签页拆分的
 * 世界观、金手指与势力 / 地点 / 物品三份条目文档。
 * 新建作品与导入作品共用同一份内容来源，避免两处模板分叉；不含任何章节文件。
 */
export function buildProjectDocuments(name: string, audience: PressAudience): ProjectSkeletonFile[] {
    return [
        { relativePath: PROJECT_README_NAME, content: buildReadmeContent(name, audience) },
        { relativePath: '大纲.md', content: buildOutlineContent() },
        {
            relativePath: '角色设定.md',
            content:
                '# 角色设定\n\n> 每个角色以二级标题起条，字段按三级分组（身份档案 / 外貌形象 / 性格与能力 / 背景与关系）与四级标题承载，便于以 [[角色设定#角色名]] 引用。\n',
        },
        { relativePath: '设定.md', content: '# 设定\n\n## 世界观\n\n## 地理\n\n## 组织势力\n' },
        // 分组文档只留一级标题：设定页首次保存时才由 writer 追加「提取设定」段落，
        // 段落存在与否即「工作台写过这一组」的标记，解析端据此决定是否回落旧 设定.md
        { relativePath: PROJECT_WORLD_DOC_NAME, content: '# 世界观\n' },
        { relativePath: PROJECT_POWER_DOC_NAME, content: '# 金手指\n' },
        // 条目文档：一级标题是文件抬头，每个条目以二级标题起条，块内字段用三级标题，逐块合并时按二级标题匹配
        {
            relativePath: PROJECT_FACTION_DOC_NAME,
            content: '# 势力\n\n> 每个势力以二级标题起条，字段用三级标题承载，便于以 [[势力#势力名]] 引用。\n',
        },
        {
            relativePath: PROJECT_PLACE_DOC_NAME,
            content: '# 地点\n\n> 每个地点以二级标题起条，字段用三级标题承载，便于以 [[地点#地点名]] 引用。\n',
        },
        {
            relativePath: PROJECT_ITEM_DOC_NAME,
            content: '# 物品\n\n> 每个物品以二级标题起条，字段用三级标题承载，便于以 [[物品#物品名]] 引用。\n',
        },
    ]
}

/** 生成作品骨架文件清单：顺序固定，README 始终在首位，默认卷首章在末位 */
export function buildProjectSkeleton(name: string, audience: PressAudience): ProjectSkeletonFile[] {
    return [
        ...buildProjectDocuments(name, audience),
        {
            relativePath: `${PROJECT_CHAPTER_DIR}/${DEFAULT_VOLUME_DIR}/${buildChapterFileName(DEFAULT_VOLUME_ORDER)}`,
            content: buildChapterSkeleton(DEFAULT_VOLUME_ORDER),
        },
    ]
}

/** 章节文件名的序号位数：两位补零，超过 99 自然进位 */
const CHAPTER_ORDER_WIDTH = 2

/** 新建章节的默认标题 */
export const DEFAULT_CHAPTER_TITLE = '未命名章节'

/** 序号前缀：01-卷名、01-章节名.md 等，前缀后接分隔符或直接结束 */
const ORDER_PREFIX_PATTERN = /^(\d+)(?:[-_.、\s]|$)/

/** 参与序号排序的名称：order 为序号前缀，缺失为 null */
export interface OrderedName {
    order: number | null
    name: string
}

/** 读取名称的序号前缀：无前缀或非数字返回 null，缺失前缀的条目排序时置于有序项之后 */
export function readOrderPrefix(value: string): number | null {
    const matched = ORDER_PREFIX_PATTERN.exec(value)
    if (matched?.[1] === undefined) {
        return null
    }
    const parsed = Number.parseInt(matched[1], 10)
    return Number.isNaN(parsed) ? null : parsed
}

/** 按序号前缀升序：有序项在前按数值比较，无序号项在后按名称本地化比较，保证列表稳定 */
export function compareByOrder(left: OrderedName, right: OrderedName): number {
    if (left.order !== null && right.order !== null && left.order !== right.order) {
        return left.order - right.order
    }
    if (left.order !== null && right.order === null) {
        return -1
    }
    if (left.order === null && right.order !== null) {
        return 1
    }
    return left.name.localeCompare(right.name, 'zh')
}

/** 去掉序号前缀与 Markdown 扩展名，得到可直接展示的名称（章节名、卷名共用） */
export function toDisplayName(value: string): string {
    const withoutExtension = value.replace(/\.md$/i, '')
    const stripped = withoutExtension.replace(ORDER_PREFIX_PATTERN, '').trim()
    return stripped.length > 0 ? stripped : withoutExtension
}

/** 生成章节文件名：{两位序号}-未命名章节.md */
export function buildChapterFileName(order: number): string {
    return `${String(order).padStart(CHAPTER_ORDER_WIDTH, '0')}-${DEFAULT_CHAPTER_TITLE}.md`
}

/**
 * 生成重排序号后的章节文件名：保留可读部分，仅替换序号前缀。
 * 用途：跨卷移动章节时按目标卷重排，可读名与正文标题都不改动。
 */
export function buildOrderedChapterFileName(order: number, displayName: string): string {
    return `${String(order).padStart(CHAPTER_ORDER_WIDTH, '0')}-${displayName}.md`
}

/** 自动创建卷的默认名称：作品骨架、无卷兜底与手动新建卷共用同一来源 */
export const DEFAULT_VOLUME_NAME = '默认卷'

/** 默认卷名冲突时的最大后缀尝试次数 */
const MAX_VOLUME_NAME_SUFFIX = 99

/** 生成卷目录名：{两位序号}-{卷名} */
export function buildVolumeDirName(order: number, name: string = DEFAULT_VOLUME_NAME): string {
    return `${String(order).padStart(CHAPTER_ORDER_WIDTH, '0')}-${name}`
}

/**
 * 生成默认卷名：优先「默认卷」，与现有卷名冲突时依次尝试「默认卷 2」「默认卷 3」……
 * @param existingNames 作品下已有卷的展示名集合
 */
export function buildDefaultVolumeName(existingNames: ReadonlySet<string>): string {
    if (!existingNames.has(DEFAULT_VOLUME_NAME)) {
        return DEFAULT_VOLUME_NAME
    }
    for (let suffix = 2; suffix <= MAX_VOLUME_NAME_SUFFIX; suffix += 1) {
        const candidate = `${DEFAULT_VOLUME_NAME} ${suffix}`
        if (!existingNames.has(candidate)) {
            return candidate
        }
    }
    throw new Error(`卷名冲突过多：${DEFAULT_VOLUME_NAME} 已排到 ${MAX_VOLUME_NAME_SUFFIX}`)
}

/** 默认卷序号：作品创建时即生成第一卷 */
export const DEFAULT_VOLUME_ORDER = 1

/** 默认卷目录名：作品骨架创建与「无卷时章节落点」共用同一来源 */
export const DEFAULT_VOLUME_DIR = buildVolumeDirName(DEFAULT_VOLUME_ORDER)

/** 生成章节展示标题：{两位序号} 未命名章节 */
export function buildChapterTitle(order: number): string {
    return `${String(order).padStart(CHAPTER_ORDER_WIDTH, '0')} ${DEFAULT_CHAPTER_TITLE}`
}

/**
 * 生成章节文档：一级标题承载章节标题，正文紧随其后。
 * 关键约束：导入作品与新建章节共用同一套模板；正文结尾统一收敛为一个换行，空正文不留多余空行。
 */
export function buildChapterDocument(title: string, body: string): string {
    const trimmedBody = body.replace(/\s+$/u, '')
    return trimmedBody.length > 0 ? `# ${title}\n${trimmedBody}\n` : `# ${title}\n`
}

/** 生成空章节骨架：标题按两位序号命名，正文留白 */
export function buildChapterSkeleton(order: number): string {
    return buildChapterDocument(buildChapterTitle(order), '')
}
