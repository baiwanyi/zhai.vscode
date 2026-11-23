/**
 * 大纲模块视图模型：描述作品设定、人物卡、资料条目、卷纲与章纲在界面层的形状。
 * 复用约定：仅声明类型，不依赖宿主服务；字段语义与 press 模块的 Markdown 约定一一对应
 * （作品设定 → README.md / 世界观.md / 金手指.md，人物卡 → 角色设定.md，
 * 势力 / 地点 / 物品 → 同名文档，卷纲与章纲 → 大纲.md）；
 * 角色设定图直接复用 shared/types/press 的契约，避免前后端各写一份导致字段分叉。
 * 关键约束：章纲是「计划」，章节文件的摘要才是「事实」，两者不得合并为同一字段，
 * 否则大纲修订后无法区分「打算写」与「已经写」；状态取值须与 constants 中的元数据表保持同步；
 * 条目的名称即文档里的二级标题，同一分类内不得重名，否则回写会互相覆盖。
 */
import type { CharacterPortrait, PortraitStyle, PressLoreKind } from '@shared/types/press'

/**
 * 大纲状态：待写、已写、待改、废弃。
 * 关键约束：这是「大纲工作文件」的状态，不是章节文件状态；旧文档里的 doing / done / stale
 * 一律在解析层归一到这四个取值，页面与统计只认这四个，不再出现第五种。
 */
export type PlanStatus = 'planned' | 'written' | 'revise' | 'discarded'

/** 章末钩子类型：悬念、反转、情绪高点、无 */
export type HookKind = 'suspense' | 'twist' | 'emotion' | 'none'

/** 颗粒度：粗纲（故事核与结构）、中纲（事件链与章纲）、细纲（场景与节拍） */
export type OutlineGranularity = 'coarse' | 'medium' | 'fine'

/**
 * 功能模块：结构纲、伏笔线索、卷纲与章纲四个页面。
 * 卷纲按卡片列出每一卷（预计章节数 / 核心事件 / 主要情节），章纲把全部章节平铺并按卷筛选；
 * 设定纲、节奏情绪、时间线都不再作为模块：设定归作品设定（世界观 / 金手指 / 势力 / 地点 / 物品），
 * 节奏类型作为章纲字段维护，时间线数据只留在文档里供作者参考。
 */
export type OutlineModuleKey = 'structure' | 'clue' | 'volume' | 'chapter'

/** 大纲段落键：与宿主 writer 的段落落点表、PressApplyRequest.outlineSections 共用 */
export type OutlineSectionKey = 'structure' | 'clues' | 'volumes'

/**
 * 章节引用：卷序 + 卷内章序。
 * 关键约束：线索按章引用，一律用这个组合定位；
 * 章 id 由解析器按位置现算，卷章重排后即失效，不能写进文档。
 */
export interface OutlineChapterRef {
    /** 卷序：与卷名里的「第N卷」一致 */
    volumeOrder: number
    /** 卷内章序：与该卷章纲的 order 一致 */
    chapterOrder: number
}

/** 结构纲的一个阶段：三幕 / 起承转合 / 英雄之旅的节拍均可落在这里 */
export interface OutlineAct {
    id: string
    /** 阶段名：建置 / 对抗 / 解决 / 激励事件 / 中点… */
    name: string
    /** 位置说明：该阶段在全书里的作用 */
    position: string
    /** 关键事件：这一阶段真正发生了什么 */
    event: string
}

/** 节奏类型：紧张、铺垫、爽点、虐点、喘息 */
export type PacingKind = 'tension' | 'setup' | 'payoff' | 'sorrow' | 'breath'

/** 伏笔状态：已埋未收、已回收、已废弃 */
export type ClueStatus = 'planted' | 'paid-off' | 'dropped'

/** 伏笔线索：埋什么、第几章埋、何时回收、由谁触发 */
export interface OutlineClue {
    id: string
    name: string
    /** 埋设章：未定则 null */
    plant: OutlineChapterRef | null
    /** 回收章：未定则 null，逾期预警据此计算 */
    payoff: OutlineChapterRef | null
    /** 触发者：CharacterCard.id，落盘写姓名 */
    triggerId: string
    status: ClueStatus
    note: string
}

/**
 * 场景纲：一场戏的最小单元，挂在章纲之下。
 * 关键约束：没有欲望、阻碍与变化的场景通常可以删或合并，编辑器只给提示不阻断保存。
 */
export interface OutlineScene {
    id: string
    order: number
    title: string
    /** 谁想要什么 */
    desire: string
    /** 谁/什么阻止 */
    obstacle: string
    /** 做了什么选择 */
    choice: string
    /** 结果：达成 / 失败 / 代价 */
    result: string
    /** 情绪变化：从什么到什么 */
    emotion: string
}

/** 大纲的功能模块集合：除卷章外的两个段落一次装配进工作区（人物信息取人物卡，不在此维护） */
export interface OutlinePlan {
    /** 结构纲：阶段与节拍 */
    acts: OutlineAct[]
    /** 伏笔线索表 */
    clues: OutlineClue[]
}

/** 角色分类：主角、配角、反派、中立、龙套 */
export type CharacterRole = 'protagonist' | 'supporting' | 'antagonist' | 'neutral' | 'extra'

/** 角色性别：男、女，建卡时必选其一，不提供未设定 */
export type CharacterGender = 'male' | 'female'

/**
 * 角色体型：十档预设，用于外貌描写与设定图的比例约束；与分类一样以选项形式填写。
 * 取值覆盖身高与胖瘦两个维度（娇小/清瘦/纤细/修长/匀称/健壮/魁梧/圆润/丰腴/肥胖），
 * 顺序即表单顺序，不得随意调整——它是作者按身形找档位的唯一线索。
 */
export type CharacterBodyType =
    'petite' | 'lean' | 'slim' | 'tall' | 'average' | 'athletic' | 'burly' | 'round' | 'plump' | 'heavy'

/** 目标读者：与作品 README 的 audience 字段取值一致 */
export type Audience = '男频' | '女频'

/** 结局倾向：HE 圆满、BE 悲剧、开放、真相、喜忧参半 */
export type EndingKind = 'HE' | 'BE' | '开放' | '真相' | '喜忧参半'

/** 故事时间：预设年代档位，写入设定.md 的「时间」键 */
export type StoryPeriod = '现代' | '古代' | '民国' | '80年代' | '未来' | '历史' | '末日' | '近代'

/** 故事地点：预设地域与场景档位，写入设定.md 的「地点」键 */
export type StoryPlace = '中国' | '都市' | '职场' | '宫廷' | '农村' | '校园' | '东方' | '西方' | '架空世界' | '现实世界'

/** 单条节拍：章内可勾选的叙事单位，勾选表示正文已兑现 */
export interface OutlineBeat {
    id: string
    text: string
    isDone: boolean
}

/**
 * 章纲：承载一章的全部规划字段，是一张可直接落笔的「章纲卡」。
 * 关键约束：summary 是计划、actualSummary 是正文事实，两者永不同步覆盖；
 * 场景纲是该章的下一层，没有场景时章纲仍然完整可用。
 */
export interface OutlineChapter {
    id: string
    /** 卷内序号，从 1 开始，展示与导出均以此排序 */
    order: number
    title: string
    /**
     * 阶段名：本卷内的一段剧情（如「第一阶段：坠楼与觉醒」），空串表示未分组。
     * 关键约束：阶段只是卷内分组标签，章序仍是唯一顺序依据；改名须同时改该阶段各章。
     */
    stage: string
    /** 计划梗概：打算写什么，与章节文件里的实际摘要分离 */
    summary: string
    /** 正文事实摘要：写后回填写入，只读展示，不回写章节文件 */
    actualSummary: string
    status: PlanStatus
    beats: OutlineBeat[]
    /** 场景纲：章之下的最小写作单元，数组顺序即落笔顺序 */
    scenes: OutlineScene[]
    /** 视角人物：本章由谁的眼睛看 */
    pov: string
    /** 场景目标：他此刻想得到什么 */
    goal: string
    /** 阻碍：谁/什么阻止 */
    obstacle: string
    /** 转折：意料之外但合理的变化 */
    turn: string
    /** 结果：目标达成 / 失败 / 代价 */
    result: string
    /** 情绪：紧张 / 爽 / 疑 / 悲 */
    emotion: string
    /** 出场人物，值为 CharacterCard.id */
    characterIds: string[]
    location: string
    wordGoal: number
    /** 已写正文字数，用于进度对比 */
    wordCount: number
    hook: HookKind
    /** 节奏类型：紧张、铺垫、爽点、虐点、喘息，用于避免连续同类章节 */
    pacing: PacingKind
    /** 张力 1-5，用于节奏曲线 */
    tension: number
    /** 颗粒度标记：这一章被细化到哪一档，写盘后可在视图里按档筛选 */
    granularity: OutlineGranularity
}

/** 卷/幕纲：一部作品下的一卷（也可当作一幕），含核心事件、主要情节、转折与卷末结果 */
export interface OutlineVolume {
    id: string
    name: string
    /** 预计章节数：0 表示未填，按卷生成章纲时作为目标章数 */
    expectedChapters: number
    /** 核心事件：本卷真正发生的主线事件，涵盖卷目标与冲突 */
    coreEvent: string
    /** 主要情节：按发生顺序排列的情节条目 */
    mainPlot: string[]
    /** 关键转折：本卷剧情走向真正改变的地方，逐条记录 */
    turningPoints: string[]
    /** 卷末结果：本卷收束后留下什么新问题 */
    result: string
    /** 颗粒度标记：本卷细化到哪一档 */
    granularity: OutlineGranularity
    chapters: OutlineChapter[]
}

/**
 * 大纲树里的一个条目：卷与其章节的组合。
 * 数组顺序即列表展示顺序，任何派生都不得重排；提取对齐素材改用「卷序 + 卷内位置」，不再依赖全局章序。
 */
export interface OutlineTreeEntry {
    volume: OutlineVolume
    chapter: OutlineChapter
}

/**
 * 提取定位键：作品列表里的「卷序 + 卷内位置」，与素材草案的卷章顺序一一对应。
 * 关键约束：不用全局章序定位——大纲允许比作品多章，全局序会随任一卷的增删整体错位。
 */
export interface OutlineExtractKey {
    /** 卷序：作品卷目录的序号前缀，对应大纲卷名里的「第N卷」 */
    volumeOrder: number
    /** 卷内位置（1 基）：与作品该卷章节的数组顺序一致 */
    chapterIndex: number
}

/** 提取写入范围：全篇整树覆盖，或只刷新指定卷章位置的章纲 */
export type OutlineExtractTarget = { mode: 'all' } | { mode: 'chapters'; keys: readonly OutlineExtractKey[] }

/** 人物卡：与 角色设定.md 中一个人物区块对应 */
export interface CharacterCard {
    id: string
    name: string
    alias: string
    role: CharacterRole
    /** 性别标签：男或女，外貌与设定图生成时作为硬约束 */
    gender: CharacterGender
    age: string
    /** 身高：自由文本（如「一米七八」「178cm」），与年龄同排填写 */
    height: string
    /** 体型：预设档位之一，不明时取「匀称」 */
    bodyType: CharacterBodyType
    identity: string
    /** 外貌标签：七类可观察的短标签，是外貌的主设定，AI 生成时逐条落实 */
    appearanceTags: string[]
    /** 外貌描写：标签之外补的句子，作为补充说明，可由 AI 依据其他字段与标签生成 */
    appearance: string
    traits: string[]
    /** 背景故事：出身、关键经历与性格成因，导入时从原文摘录归纳 */
    background: string
    desire: string
    weakness: string
    catchphrase: string
    ability: string
    arc: string
    relation: string
    /** 角色设定图：宿主生成并落盘的图片，path 为相对存储根口径，url 仅本次会话有效 */
    portraits: CharacterPortrait[]
    /**
     * 角色封面：指向 portraits 中的一项，null 表示未设置。
     * 该字段会随人物卡写入角色设定.md——图片本身在磁盘，文档只记引用，重新打开作品后才能还原封面。
     */
    coverPortraitId: string | null
    /** 生成角色卡时使用的画面风格，随人物卡保存，切换后只影响后续生成 */
    portraitStyle: PortraitStyle
}

/** 新建人物卡的初始值：不含 id，id 一律由 utils.createCharacterCard 生成，避免调用方伪造主键 */
export type CharacterSeed = Partial<Omit<CharacterCard, 'id'>>

/** 作品设定：步骤二的全部表单字段，覆盖 README.md 与 设定.md 的常用区块 */
export interface ProjectSetting {
    title: string
    penName: string
    audience: Audience
    genres: string[]
    wordGoal: number
    /** 单章目标字数：新建章与大纲向导的默认值 */
    chapterWordGoal: number
    /** 简介：比一句话梗概更完整的内容介绍 */
    summary: string
    logline: string
    /** 开篇灵感：第一章的切入画面或开场桥段 */
    opening: string
    /** 补充信息：未归入其它字段的备注 */
    extra: string
    conflict: string
    /** 主题：故事要探讨的核心命题 */
    theme: string
    /** 主角弧光：从什么到什么，中间必须付出什么代价 */
    arc: string
    ending: EndingKind
    /** 叙事结构：单线顺叙 / 双线交替等，写入设定.md 的「叙事结构」键 */
    narrative: string
    /** 故事时间 */
    period: StoryPeriod
    /** 故事地点 */
    place: StoryPlace
    /** 世界观总述：世界形态、历史沿革、种族与文明结构 */
    worldview: string
    /** 地理：主要地域、场景与空间格局 */
    geography: string
    era: string
    factions: string
    powerSystem: string
    /** 核心概念：作品独有的名词与规则（灵气、序列、异火等） */
    concepts: string
    taboo: string
    goldenFingerType: string
    goldenFingerAbility: string
    /** 代价：使用金手指要付出的东西 */
    goldenFingerCost: string
    /** 限制：适用范围的边界与不可逾越的硬约束 */
    goldenFingerLimit: string
    /** 升级体系：金手指自身的成长阶段与解锁条件 */
    goldenFingerUpgrade: string
    perspective: string
    tone: string
    references: string
    banned: string[]
}

/** 资料条目分类：势力、地点、物品各写一份文档，顺序即设定页分段顺序；取值复用共享契约 */
export type LoreKind = PressLoreKind

/**
 * 资料条目：与 势力.md / 地点.md / 物品.md 中的一个二级标题块对应。
 * 名称即块标题，同分类内不得重名——回写按标题整块匹配，重名会互相覆盖。
 */
export interface LoreEntry {
    /** 8 位数字，与人物标识同规范；设定图靠 faction- / place- / item- 前缀区分归属 */
    id: string
    kind: LoreKind
    name: string
    /** 描述：条目块正文，支持多段，落盘时为标题下方的自然段落 */
    description: string
    /** 关联人物：仅势力使用，值为 CharacterCard.id；落盘写人物姓名，解析按姓名回填 */
    memberIds: string[]
    /** 设定图封面：指向磁盘中的条目图，null 表示未设置 */
    coverImageId: string | null
}

/** 新建条目的初始值：不含 id，id 一律由 utils.createLoreEntry 生成，避免调用方伪造主键 */
export type LoreSeed = Partial<Omit<LoreEntry, 'id'>>

/**
 * 工作台数据：各步骤共享的同一份作品草稿。
 * volumes 是四层级里的「卷—章—场景」，plan 是结构纲与线索两个模块的集合；
 * 两者都来自同一份 大纲.md，写入时各段落独立落盘，互不覆盖。
 */
export interface OutlineWorkspace {
    setting: ProjectSetting
    characters: CharacterCard[]
    lore: LoreEntry[]
    volumes: OutlineVolume[]
    plan: OutlinePlan
}

/** 向导参数：生成大纲前收窄的输入项 */
export interface OutlineWizardOptions {
    volumeCount: number
    chapterWordGoal: number
    /** 节奏偏好，决定张力与钩子的默认分布 */
    pacing: 'fast' | 'steady' | 'slow'
    structure: string
}

/** 向导步骤：输入确认、卷纲预览、章纲预览 */
export type WizardStep = 'input' | 'volume' | 'chapter'

/** 标签选项：value 即写入文档的标签文本，hint 为面板内的悬停说明 */
export interface TagOption {
    value: string
    hint?: string
}

/** 标签分组：TagPicker 按组渲染候选标签，组名只用于面板内的分组切换 */
export interface TagGroup {
    label: string
    options: readonly TagOption[]
}
