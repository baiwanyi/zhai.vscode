/**
 * 大纲模块视图模型：描述作品设定、人物卡、卷纲与章纲在界面层的形状。
 * 复用约定：仅声明类型，不依赖宿主服务；字段语义与 press 模块的 Markdown 约定一一对应
 * （作品设定 → README.md / 设定.md，人物卡 → 角色设定.md，卷纲与章纲 → 大纲.md）；
 * 角色设定图直接复用 shared/types/press 的契约，避免前后端各写一份导致字段分叉。
 * 关键约束：章纲是「计划」，章节文件的摘要才是「事实」，两者不得合并为同一字段，
 * 否则大纲修订后无法区分「打算写」与「已经写」；状态取值须与 constants 中的元数据表保持同步。
 */
import type { CharacterPortrait, PortraitStyle } from '@shared/types/press'

/** 章纲状态：待写、在写、已完成、大纲已变更需复核 */
export type PlanStatus = 'planned' | 'drafting' | 'done' | 'stale'

/** 章末钩子类型：悬念、反转、情绪高点、无 */
export type HookKind = 'suspense' | 'twist' | 'emotion' | 'none'

/** 角色分类：主角、配角、反派、中立、龙套 */
export type CharacterRole = 'protagonist' | 'supporting' | 'antagonist' | 'neutral' | 'extra'

/** 角色性别：男、女，建卡时必选其一，不提供未设定 */
export type CharacterGender = 'male' | 'female'

/** 目标读者：与作品 README 的 audience 字段取值一致 */
export type Audience = '男频' | '女频'

/** 结局倾向：HE、BE、开放 */
export type EndingKind = 'HE' | 'BE' | '开放'

/** 单条节拍：章内可勾选的叙事单位，勾选表示正文已兑现 */
export interface OutlineBeat {
    id: string
    text: string
    isDone: boolean
}

/** 章纲：一行即一「章」，承载与该章正文相关的全部规划字段 */
export interface OutlineChapter {
    id: string
    /** 卷内序号，从 1 开始，展示与导出均以此排序 */
    order: number
    title: string
    /** 计划梗概：打算写什么，与章节文件里的实际摘要分离 */
    summary: string
    status: PlanStatus
    beats: OutlineBeat[]
    /** 出场人物，值为 CharacterCard.id */
    characterIds: string[]
    location: string
    wordGoal: number
    /** 已写正文字数，用于进度对比 */
    wordCount: number
    hook: HookKind
    /** 张力 1-5，用于节奏曲线 */
    tension: number
}

/** 卷纲：一部作品下的一卷，含阶段目标与冲突描述 */
export interface OutlineVolume {
    id: string
    name: string
    goal: string
    conflict: string
    chapters: OutlineChapter[]
}

/** 人物卡：与 角色设定.md 中一个人物区块对应 */
export interface CharacterCard {
    id: string
    name: string
    alias: string
    role: CharacterRole
    /** 性别标签：男或女，外貌与设定图生成时作为硬约束 */
    gender: CharacterGender
    age: string
    identity: string
    /** 外貌描写：外观与气质的白描，供正文引用，可由 AI 依据其他字段生成 */
    appearance: string
    traits: string[]
    desire: string
    weakness: string
    catchphrase: string
    ability: string
    arc: string
    relation: string
    /** 角色设定图：宿主生成并落盘的图片，path 为相对存储根口径，url 仅本次会话有效 */
    portraits: CharacterPortrait[]
    /** 角色封面：指向 portraits 中的一项，null 表示未设置 */
    coverPortraitId: string | null
    /** 生成角色卡时使用的画风，随人物卡保存，切换后只影响后续生成 */
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
    logline: string
    conflict: string
    ending: EndingKind
    era: string
    factions: string
    powerSystem: string
    taboo: string
    goldenFingerType: string
    goldenFingerAbility: string
    goldenFingerCost: string
    perspective: string
    tone: string
    references: string
    banned: string[]
}

/** 工作台数据：三个步骤共享的同一份作品草稿 */
export interface OutlineWorkspace {
    setting: ProjectSetting
    characters: CharacterCard[]
    volumes: OutlineVolume[]
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
