/**
 * 大纲与人物卡纯函数：字段缺失判断与设定文本补丁、设定快照、章节统计、节点构造、字数格式化，
 * 以及提取草案的建卡与字段补全。
 * 复用约定：字数口径复用仪表盘的 formatWordCount，不另写一套；节点 id 统一由 createId 生成，
 * 保证新增卷、章、节拍在树中可直接作为 key 与选中标识；草案的中文标签按 constants 的元数据表归一。
 * 关键约束：缺失判断只区分「是否填写」，缺失不视为错误、仅用于提示；
 * 章节统计以章纲上的目标字数为分母，不使用正文实际字数反推计划；
 * 补全已有角色只填空白字段、不覆盖作者已写内容，没有实际变化时必须返回原对象，避免无谓写盘。
 */
import { DEFAULT_PORTRAIT_STYLE } from '@shared/types/press'
import type {
    PressExtractedCharacter,
    PressExtractedVolume,
    PressVolumeGroup,
    SettingFieldKey,
    SettingSnapshot,
} from '@shared/types/press'
import { formatWordCount } from '@webview/dashboard/utils'
import {
    CHARACTER_BODY_TYPE_META,
    CHARACTER_BODY_TYPE_ORDER,
    CHARACTER_GENDER_META,
    CHARACTER_GENDER_ORDER,
    CHARACTER_ROLE_META,
    CHARACTER_ROLE_ORDER,
    HOOK_OPTIONS,
} from './constants'
import type {
    CharacterBodyType,
    CharacterCard,
    CharacterSeed,
    HookKind,
    LoreEntry,
    LoreSeed,
    OutlineAct,
    OutlineBeat,
    OutlineChapter,
    OutlineChapterRef,
    OutlineCharacterLine,
    OutlineClue,
    OutlineExtractKey,
    OutlinePacingEntry,
    OutlinePlan,
    OutlineScene,
    OutlineSettingNote,
    OutlineTimelineEvent,
    OutlineTreeEntry,
    OutlineVolume,
    PacingKind,
    PlanStatus,
    ProjectSetting,
} from './types'

export { formatWordCount }

/** 判断单个字段是否已填写：字符串去空白、数组看长度、数字需大于零 */
function isFilled(value: ProjectSetting[keyof ProjectSetting]): boolean {
    if (Array.isArray(value)) {
        return value.length > 0
    }
    if (typeof value === 'number') {
        return value > 0
    }
    return value.trim().length > 0
}

/** 判断指定字段是否缺失，供分组切换的缺项提示与向导输入确认使用 */
export function isSettingFieldMissing(setting: ProjectSetting, key: keyof ProjectSetting): boolean {
    return !isFilled(setting[key])
}

/** 设定文本字段的补丁：显式分支，避免计算属性被推断成索引签名；世界观、金手指等子集字段同样适用 */
export function toSettingTextPatch(field: SettingFieldKey, value: string): Partial<ProjectSetting> {
    switch (field) {
        case 'title':
            return { title: value }
        case 'summary':
            return { summary: value }
        case 'logline':
            return { logline: value }
        case 'opening':
            return { opening: value }
        case 'conflict':
            return { conflict: value }
        case 'worldview':
            return { worldview: value }
        case 'geography':
            return { geography: value }
        case 'era':
            return { era: value }
        case 'factions':
            return { factions: value }
        case 'powerSystem':
            return { powerSystem: value }
        case 'concepts':
            return { concepts: value }
        case 'taboo':
            return { taboo: value }
        case 'goldenFingerAbility':
            return { goldenFingerAbility: value }
        case 'goldenFingerCost':
            return { goldenFingerCost: value }
        case 'goldenFingerLimit':
            return { goldenFingerLimit: value }
        case 'goldenFingerUpgrade':
            return { goldenFingerUpgrade: value }
    }
}

/**
 * 设定快照：把整份设定摊平成 AI 请求可用的只读副本，设定字段与条目描述两类生成共用。
 * 只挑提示词用得到的字段——字数目标、禁忌词这类纯本地配置不进模型。
 */
export function toSettingSnapshot(setting: ProjectSetting): SettingSnapshot {
    return {
        title: setting.title,
        penName: setting.penName,
        audience: setting.audience,
        genres: [...setting.genres],
        period: setting.period,
        place: setting.place,
        era: setting.era,
        tone: setting.tone,
        ending: setting.ending,
        perspective: setting.perspective,
        narrative: setting.narrative,
        references: setting.references,
        summary: setting.summary,
        logline: setting.logline,
        opening: setting.opening,
        conflict: setting.conflict,
        worldview: setting.worldview,
        geography: setting.geography,
        factions: setting.factions,
        powerSystem: setting.powerSystem,
        concepts: setting.concepts,
        taboo: setting.taboo,
        goldenFingerType: setting.goldenFingerType,
        goldenFingerAbility: setting.goldenFingerAbility,
        goldenFingerCost: setting.goldenFingerCost,
        goldenFingerLimit: setting.goldenFingerLimit,
        goldenFingerUpgrade: setting.goldenFingerUpgrade,
        extra: setting.extra,
    }
}

/**
 * 生成 8 位随机数字标识：人物与资料条目共用，与宿主的标识规范一致，
 * 也直接作为设定图文件名里的归属段。
 * 用 crypto 采样而非 Math.random，避免同一次解析里连续生成时出现可预期的重复。
 */
function createNumericId(): string {
    const buffer = new Uint32Array(1)
    crypto.getRandomValues(buffer)
    return String(10_000_000 + ((buffer[0] ?? 0) % 90_000_000))
}

/**
 * 生成节点 id：卷、章、节拍、场景、人物、资料条目与大纲各功能模块共用；
 * 人物与条目用 8 位数字（宿主白名单要求），其余带前缀便于排查来源。
 */
export function createId(
    prefix: 'vol' | 'ch' | 'beat' | 'scene' | 'char' | 'lore' | 'act' | 'cline' | 'snote' | 'clue' | 'tline',
): string {
    if (prefix === 'char' || prefix === 'lore') {
        return createNumericId()
    }
    return `${prefix}-${crypto.randomUUID()}`
}

/**
 * 把控件回传的取值收敛到白名单：不在集合内返回 null，调用方据此保持原值，
 * 用于分段选择器这类只接受枚举档位、又不允许退化成空值的字段。
 */
export function toOptionValue<T extends string>(order: readonly T[], value: string): T | null {
    return order.find((item) => item === value) ?? null
}

/** 新建一张人物卡：角色默认配角、性别默认男、姓名占位；seed 承接新增弹窗填写的初始值，id 恒由本函数生成 */
export function createCharacterCard(seed: CharacterSeed = {}): CharacterCard {
    return {
        name: '新人物',
        alias: '',
        role: 'supporting',
        gender: 'male',
        age: '',
        height: '',
        // 体型只有五档预设，默认取中间档：既不让新卡带一个偏颇的身形，也省掉一次必填
        bodyType: 'average',
        identity: '',
        appearanceTags: [],
        appearance: '',
        traits: [],
        background: '',
        desire: '',
        weakness: '',
        catchphrase: '',
        ability: '',
        arc: '',
        relation: '',
        portraits: [],
        coverPortraitId: null,
        portraitStyle: DEFAULT_PORTRAIT_STYLE,
        ...seed,
        id: createId('char'),
    }
}

/**
 * 新建一条资料条目：分类默认势力、名称占位、无描述与关联人物；
 * seed 承接弹窗填写的初始值，id 恒由本函数生成，避免调用方伪造主键。
 */
export function createLoreEntry(seed: LoreSeed = {}): LoreEntry {
    return {
        kind: 'faction',
        name: '未命名',
        description: '',
        memberIds: [],
        coverImageId: null,
        ...seed,
        id: createId('lore'),
    }
}

/** 体型中文标签反查：草案存的是给作者看的标签，未收录的写法视为模型没给出可用档位 */
function toBodyTypeFromDraft(label: string): CharacterBodyType | null {
    const trimmed = label.trim()
    if (trimmed.length === 0) {
        return null
    }
    return CHARACTER_BODY_TYPE_ORDER.find((value) => CHARACTER_BODY_TYPE_META[value].label === trimmed) ?? null
}

/**
 * 由提取草案建卡：把中文标签归一到角色分类、性别与体型枚举，
 * 未识别的分类回落为配角、性别回落为男、体型回落为匀称，与作品文档解析的容错口径一致。
 * 别名、年龄、身高、体型、外貌、背景、口头禅逐项透传——这些字段是导入区别于「只拿到一个名字」的关键。
 */
export function createCharacterFromDraft(draft: PressExtractedCharacter): CharacterCard {
    const role = CHARACTER_ROLE_ORDER.find((value) => CHARACTER_ROLE_META[value].label === draft.role) ?? 'supporting'
    const gender = CHARACTER_GENDER_ORDER.find((value) => CHARACTER_GENDER_META[value].label === draft.gender) ?? 'male'
    return createCharacterCard({
        name: draft.name,
        alias: draft.alias,
        role,
        gender,
        age: draft.age,
        height: draft.height,
        bodyType: toBodyTypeFromDraft(draft.bodyType) ?? 'average',
        identity: draft.identity,
        appearance: draft.appearance,
        traits: draft.traits,
        background: draft.background,
        desire: draft.desire,
        weakness: draft.weakness,
        catchphrase: draft.catchphrase,
        ability: draft.ability,
        arc: draft.arc,
        relation: draft.relation,
    })
}

/** 人物卡上可由草案补全的单值字段：键名与草案一致，逐项比较即可，不另写一份映射 */
const DRAFT_TEXT_KEYS = [
    'alias',
    'age',
    'height',
    'identity',
    'appearance',
    'background',
    'desire',
    'weakness',
    'catchphrase',
    'ability',
    'arc',
    'relation',
] as const

/** 取「现有为空则用草案」的文本值：已有内容一律不覆盖，草案也没给时保持原样 */
function pickDraftText(current: string, incoming: string): string {
    return current.trim().length > 0 ? current : incoming.trim()
}

/** 判断补全是否真的改动了字段：只比较可能被写入的键，封面、设定图等原样带过的字段不参与 */
function hasCharacterChange(before: CharacterCard, after: CharacterCard): boolean {
    if (before.id !== after.id || before.traits !== after.traits || before.bodyType !== after.bodyType) {
        return true
    }
    return DRAFT_TEXT_KEYS.some((key) => before[key] !== after[key])
}

/**
 * 用提取草案补全一张已有的人物卡：只补空字段，不覆盖作者已写的内容。
 * 关键约束：分类与性别不参与合并——两者有默认档（配角 / 男），无法区分「作者明确选的」与「建卡默认」，
 * 而它们直接决定出场统计分组与设定图约束，改错的代价高于补全收益；体型同理，只把默认档「匀称」视作未表态，
 * 草案给出别的档位才写入，档位相同则视为无事发生；
 * id 为空说明这张卡不是按人物标识规范建出来的，补一个 8 位标识，否则角色卡目录与设定图文件名都会落空。
 * 返回 null 表示没有任何字段需要更新，调用方据此跳过写盘。
 */
export function mergeCharacterDraft(character: CharacterCard, draft: PressExtractedCharacter): CharacterCard | null {
    const draftBodyType = toBodyTypeFromDraft(draft.bodyType)
    const next: CharacterCard = {
        ...character,
        id: character.id.trim().length > 0 ? character.id : createId('char'),
        alias: pickDraftText(character.alias, draft.alias),
        age: pickDraftText(character.age, draft.age),
        height: pickDraftText(character.height, draft.height),
        identity: pickDraftText(character.identity, draft.identity),
        appearance: pickDraftText(character.appearance, draft.appearance),
        background: pickDraftText(character.background, draft.background),
        desire: pickDraftText(character.desire, draft.desire),
        weakness: pickDraftText(character.weakness, draft.weakness),
        catchphrase: pickDraftText(character.catchphrase, draft.catchphrase),
        ability: pickDraftText(character.ability, draft.ability),
        arc: pickDraftText(character.arc, draft.arc),
        relation: pickDraftText(character.relation, draft.relation),
        traits: character.traits.length > 0 || draft.traits.length === 0 ? character.traits : draft.traits,
        bodyType:
            character.bodyType === 'average' && draftBodyType !== null && draftBodyType !== 'average'
                ? draftBodyType
                : character.bodyType,
    }
    return hasCharacterChange(character, next) ? next : null
}

/** 合并结果：characters 为合并后的完整列表，created 与 updated 供调用方决定提示文案 */
export interface CharacterMergeResult {
    characters: CharacterCard[]
    /** 本次新建的人物数 */
    created: number
    /** 本次被草案补全过字段的人物数 */
    updated: number
}

/**
 * 合并提取草案：同名人物按字段补全，未匹配的按草案新建。
 * 关键约束：逐条处理而不是先筛重名再建卡——同名草案第二次会落到补全分支，
 * 既不会重复建卡，也能把先出现那条缺的字段补上；
 * 匹配只认姓名，别名不参与，避免「娘子」这类称呼把两个人并成一张卡。
 */
export function mergeCharacterDrafts(
    existing: readonly CharacterCard[],
    drafts: readonly PressExtractedCharacter[],
): CharacterMergeResult {
    const characters = [...existing]
    const indexByName = new Map<string, number>()
    characters.forEach((character, index) => {
        if (!indexByName.has(character.name)) {
            indexByName.set(character.name, index)
        }
    })
    let created = 0
    let updated = 0
    for (const draft of drafts) {
        const name = draft.name.trim()
        if (name.length === 0) {
            continue
        }
        const index = indexByName.get(name)
        if (index === undefined) {
            indexByName.set(name, characters.length)
            characters.push(createCharacterFromDraft(draft))
            created += 1
            continue
        }
        const current = characters[index]
        if (current === undefined) {
            continue
        }
        const merged = mergeCharacterDraft(current, draft)
        if (merged === null) {
            continue
        }
        characters[index] = merged
        updated += 1
    }
    return { characters, created, updated }
}

/** 新建一条空节拍，默认未兑现 */
export function createBeat(text = ''): OutlineBeat {
    return { id: createId('beat'), text, isDone: false }
}

/** 新建一个空场景，序号由调用方给出 */
export function createScene(order: number): OutlineScene {
    return {
        id: createId('scene'),
        order,
        title: `场景${order}`,
        desire: '',
        obstacle: '',
        choice: '',
        result: '',
        emotion: '',
    }
}

/** 新建一章空章纲，序号与目标字数由调用方给出 */
export function createChapter(order: number, wordGoal: number): OutlineChapter {
    return {
        id: createId('ch'),
        order,
        title: `第${order}章 未命名`,
        summary: '',
        actualSummary: '',
        status: 'planned',
        beats: [createBeat()],
        scenes: [],
        pov: '',
        goal: '',
        obstacle: '',
        turn: '',
        result: '',
        emotion: '',
        characterIds: [],
        location: '',
        wordGoal,
        wordCount: 0,
        hook: 'suspense',
        tension: 3,
        granularity: 'medium',
    }
}

/** 新建一条结构阶段 */
export function createAct(name = '新阶段', position = ''): OutlineAct {
    return { id: createId('act'), name, position, event: '' }
}

/** 人物纲的初始值：不含 id 与姓名，调用方按人物卡或空白模板填写 */
export type CharacterLineSeed = Partial<Omit<OutlineCharacterLine, 'id' | 'name'>>

/**
 * 新建一条人物纲：默认只带姓名，其余字段留空由作者填。
 * seed 用于「从人物卡导入」：把欲望、缺陷、关系与弧光一次带进来，已有内容仍可继续编辑。
 */
export function createCharacterLine(name = '新人物', seed: CharacterLineSeed = {}): OutlineCharacterLine {
    return {
        characterId: '',
        desire: '',
        fear: '',
        flaw: '',
        secret: '',
        relation: '',
        arc: '',
        ...seed,
        id: createId('cline'),
        name,
    }
}

/** 新建一条设定纲 */
export function createSettingNote(name = '新设定'): OutlineSettingNote {
    return { id: createId('snote'), name, rule: '', cost: '', note: '' }
}

/** 新建一条节奏行：默认铺垫、张力 3 */
export function createPacingEntry(chapterOrder: number, kind: PacingKind = 'setup'): OutlinePacingEntry {
    return { id: `pacing-${String(chapterOrder)}`, chapterOrder, kind, tension: 3 }
}

/** 新建一条伏笔线索：默认未回收，触发者与章节引用留空 */
export function createClue(name = '新线索'): OutlineClue {
    return { id: createId('clue'), name, plant: null, payoff: null, triggerId: '', status: 'planted', note: '' }
}

/** 新建一条时间线事件 */
export function createTimelineEvent(title = '新事件'): OutlineTimelineEvent {
    return { id: createId('tline'), when: '', title, refs: [], characterIds: [] }
}

/** 新建空大纲计划：缺段落的作品打开时用它兜底，页面永远拿到完整结构 */
export function createEmptyPlan(): OutlinePlan {
    return {
        book: { logline: '', conflict: '', theme: '', ending: '', arc: '' },
        acts: [],
        characters: [],
        setting: [],
        pacing: [],
        clues: [],
        timeline: [],
    }
}

/** 角色名与别名到 id 的映射：章纲里的出场人物按名称回填成 characterIds */
function buildCharacterIndex(characters: readonly CharacterCard[]): Map<string, string> {
    const index = new Map<string, string>()
    for (const character of characters) {
        index.set(character.name, character.id)
        if (character.alias.length > 0) {
            index.set(character.alias, character.id)
        }
    }
    return index
}

/**
 * 由大纲草案重建大纲树：卷名与章序沿用素材口径，id、状态、节拍等展示字段在此补齐。
 * 关键约束：钩子标签按「包含」匹配——素材侧写「情绪」，表单值为「情绪高点」，等值比较会全部回落为无；
 * 张力越界时夹到 1–5；章标题缺失时回退到默认命名，避免出现空行；
 * 关键节点直接落成节拍、出场人物按名称回填成 id，重建后的大纲可以直接接着写，不需要人工重抄一遍。
 */
export function createOutlineFromDraft(
    drafts: PressExtractedVolume[],
    chapterWordGoal: number,
    characters: readonly CharacterCard[] = [],
): OutlineVolume[] {
    const characterIndex = buildCharacterIndex(characters)
    return drafts.map((draft, volumeIndex) => ({
        id: createId('vol'),
        name: draft.name.length > 0 ? draft.name : `第${volumeIndex + 1}卷`,
        goal: draft.goal,
        conflict: draft.conflict,
        plotline: draft.plotline,
        turningPoints: [...draft.turningPoints],
        result: '',
        granularity: 'medium',
        chapters: draft.chapters.map((chapter) => {
            const base = createChapter(chapter.order, chapterWordGoal)
            const matched =
                chapter.hook.length > 0
                    ? HOOK_OPTIONS.find((option) => option.label.startsWith(chapter.hook))
                    : undefined
            const beats = chapter.beats
                .map((text) => text.trim())
                .filter((text) => text.length > 0)
                .map((text) => createBeat(text))
            const characterIds = chapter.characters
                .map((name) => characterIndex.get(name.trim()))
                .filter((id): id is string => id !== undefined)
            return {
                ...base,
                title: chapter.title.length > 0 ? chapter.title : base.title,
                summary: chapter.summary,
                wordCount: chapter.wordCount,
                beats: beats.length > 0 ? beats : base.beats,
                characterIds: [...new Set(characterIds)],
                hook: matched?.value ?? 'none',
                tension: Math.min(5, Math.max(1, chapter.tension)),
            }
        }),
    }))
}

/** 序号前缀：与宿主 projectFactory 同口径（01-卷名 / 01-章名.md），读不到返回 null */
const ORDER_PREFIX_PATTERN = /^(\d+)(?:[-_.、\s]|$)/u

/** 读取名称的序号前缀：卷目录名与章节文件名共用，缺失前缀返回 null */
export function readOrderPrefix(value: string): number | null {
    const matched = ORDER_PREFIX_PATTERN.exec(value)
    if (matched?.[1] === undefined) {
        return null
    }
    const parsed = Number.parseInt(matched[1], 10)
    return Number.isNaN(parsed) ? null : parsed
}

/** 大纲卷名里的卷序：新卷统一写成「第N卷」，旧数据可能只有目录口径的序号前缀 */
const VOLUME_TITLE_PATTERN = /第\s*(\d+)\s*卷/u

/** 大纲卷序：先认「第N卷」，再认序号前缀，都没有时按数组位置兜底 */
function readOutlineVolumeOrder(name: string, index: number): number {
    const byTitle = VOLUME_TITLE_PATTERN.exec(name)?.[1]
    if (byTitle !== undefined) {
        return Number.parseInt(byTitle, 10)
    }
    return readOrderPrefix(name) ?? index + 1
}

/**
 * 按所选卷章位置刷新大纲树：素材草案与作品列表同构，按「卷序 + 卷内位置」逐卷对齐后只覆盖选中章。
 * 关键约束：结构（卷、章数量、章 id、状态、目标字数、地点）一律沿用现有草稿，
 * 大纲可以比作品多章，因此只按位置逐卷匹配、不按全局章序；草案章数不足时跳过越界位置，
 * 「指定章节提取」不会增删章节、也不会改动卷纲字段；全篇提取仍走 createOutlineFromDraft。
 */
export function refreshOutlineChapters(
    current: readonly OutlineVolume[],
    drafts: readonly PressExtractedVolume[],
    keys: readonly OutlineExtractKey[],
    chapterWordGoal: number,
    characters: readonly CharacterCard[] = [],
): { volumes: OutlineVolume[]; refreshed: number } {
    const templates = createOutlineFromDraft([...drafts], chapterWordGoal, characters)
    // 草案卷序取卷目录名的序号前缀：宿主按章节清单产出，卷名可能是「01-默认卷」这种目录口径
    const templateByVolume = new Map<number, OutlineChapter[]>()
    templates.forEach((volume, index) => {
        templateByVolume.set(readOrderPrefix(volume.name) ?? index + 1, volume.chapters)
    })
    const targets = new Set(keys.map((key) => `${String(key.volumeOrder)}-${String(key.chapterIndex)}`))
    let refreshed = 0
    const volumes = current.map((volume, index) => {
        const volumeOrder = readOutlineVolumeOrder(volume.name, index)
        const volumeTemplates = templateByVolume.get(volumeOrder) ?? []
        return {
            ...volume,
            chapters: volume.chapters.map((chapter, position) => {
                const key = `${String(volumeOrder)}-${String(position + 1)}`
                const template = targets.has(key) ? volumeTemplates[position] : undefined
                if (template === undefined) {
                    return chapter
                }
                refreshed += 1
                return {
                    ...chapter,
                    title: template.title,
                    summary: template.summary,
                    beats: template.beats,
                    characterIds: template.characterIds,
                    wordCount: template.wordCount,
                    hook: template.hook,
                    tension: template.tension,
                }
            }),
        }
    })
    return { volumes, refreshed }
}

/** 提取范围列表里的章节选项：展示字段，全局序只用于列表与区间输入 */
export interface ExtractChapterOption {
    /** 1 基全局序：按作品卷章摊平，只用于列表展示与区间输入 */
    order: number
    volumeId: string
    /** 卷名 · 章标题：下拉与可访问名用 */
    label: string
    /** 纯章标题：勾选列表显示用 */
    title: string
}

/**
 * 作品章节选项：在展示字段之外带上定位用的卷序与卷内位置，供大纲按位置刷新。
 * 关键约束：只读取仪表盘的作品列表——素材草案由章节清单产出，选大纲章会导致错位。
 */
export interface ProjectChapterOption extends ExtractChapterOption {
    /** 卷序：与大纲卷名里的「第N卷」对应 */
    volumeOrder: number
    /** 卷内位置（1 基）：与该卷章节数组顺序一致 */
    chapterIndex: number
    /** 卷展示名：卷筛选标签，未分卷为「未分卷」 */
    volumeLabel: string
}

/** 未分卷章节的卷筛选取值：Radix Select 不接受空串作为条目值 */
const UNASSIGNED_VOLUME_ID = 'unassigned'

/**
 * 由作品详情构建提取选项：按卷分组顺序摊平，卷序取目录的序号前缀，卷内位置取数组下标 + 1。
 * 关键约束：分组顺序与宿主产出素材草案的顺序一致，重排会让范围提取错位。
 */
export function createProjectChapterOptions(volumes: readonly PressVolumeGroup[]): ProjectChapterOption[] {
    const options: ProjectChapterOption[] = []
    volumes.forEach((volume, index) => {
        const volumeOrder = readOrderPrefix(volume.dirName) ?? index + 1
        const volumeLabel = volume.name.length > 0 ? volume.name : '未分卷'
        const volumeId = volume.dirName.length > 0 ? volume.dirName : UNASSIGNED_VOLUME_ID
        volume.chapters.forEach((chapter, position) => {
            options.push({
                order: options.length + 1,
                volumeOrder,
                chapterIndex: position + 1,
                volumeId,
                volumeLabel,
                label: `${volumeLabel} · ${chapter.title}`,
                title: chapter.title,
            })
        })
    })
    return options
}

/** 卷筛选选项：按顺序去重，取值一律用卷 id——卷名允许重名 */
export function createVolumeOptions(entries: readonly OutlineTreeEntry[]): { value: string; label: string }[] {
    const seen = new Map<string, string>()
    for (const entry of entries) {
        if (!seen.has(entry.volume.id)) {
            seen.set(entry.volume.id, entry.volume.name)
        }
    }
    return [...seen].map(([value, label]) => ({ value, label }))
}

/** 章序取值：留空或非数字回落 fallback，越界夹到 [1, 全书章数]，避免手输残值在提交时越界 */
export function clampChapterOrder(value: string, fallback: number, totalCount: number): number {
    const parsed = Number(value)
    if (value.trim().length === 0 || !Number.isInteger(parsed)) {
        return fallback
    }
    return Math.min(Math.max(parsed, 1), Math.max(totalCount, 1))
}

/** 由起止章序展开 1 基连续章序：倒序输入自动归一为同一段区间 */
export function createOrderRange(start: number, end: number): number[] {
    const lower = Math.min(start, end)
    const upper = Math.max(start, end)
    return Array.from({ length: upper - lower + 1 }, (_, index) => lower + index)
}

/** 新建一卷空卷纲，卷名默认按序号命名 */
export function createVolume(order: number, chapterWordGoal: number): OutlineVolume {
    return {
        id: createId('vol'),
        name: `第${order}卷 未命名`,
        goal: '',
        conflict: '',
        plotline: '',
        turningPoints: [],
        result: '',
        granularity: 'medium',
        chapters: [createChapter(1, chapterWordGoal)],
    }
}

/**
 * 卷章节统计：总数、已写数、待改数、废弃数、已写字数与目标字数。
 * 关键约束：废弃章节不计入总数与字数分母，否则完成度永远到不了 100%。
 */
export function summarizeVolume(volume: OutlineVolume): {
    total: number
    done: number
    revise: number
    discarded: number
    wordCount: number
    wordGoal: number
} {
    return volume.chapters.reduce(
        (summary, chapter) => {
            if (chapter.status === 'discarded') {
                return { ...summary, discarded: summary.discarded + 1 }
            }
            return {
                total: summary.total + 1,
                done: summary.done + (chapter.status === 'written' ? 1 : 0),
                revise: summary.revise + (chapter.status === 'revise' ? 1 : 0),
                discarded: summary.discarded,
                wordCount: summary.wordCount + chapter.wordCount,
                wordGoal: summary.wordGoal + chapter.wordGoal,
            }
        },
        { total: 0, done: 0, revise: 0, discarded: 0, wordCount: 0, wordGoal: 0 },
    )
}

/** 整部作品的章节总数与完成数，用于工作台标题区进度；废弃章节同样不计入分母 */
export function summarizeWorkspace(volumes: readonly OutlineVolume[]): {
    chapters: number
    done: number
    revise: number
    discarded: number
    wordCount: number
    wordGoal: number
} {
    return volumes.reduce(
        (summary, volume) => {
            const volumeSummary = summarizeVolume(volume)
            return {
                chapters: summary.chapters + volumeSummary.total,
                done: summary.done + volumeSummary.done,
                revise: summary.revise + volumeSummary.revise,
                discarded: summary.discarded + volumeSummary.discarded,
                wordCount: summary.wordCount + volumeSummary.wordCount,
                wordGoal: summary.wordGoal + volumeSummary.wordGoal,
            }
        },
        { chapters: 0, done: 0, revise: 0, discarded: 0, wordCount: 0, wordGoal: 0 },
    )
}

/** 按状态过滤卷内章节，'all' 不过滤 */
export function filterChapters(chapters: readonly OutlineChapter[], status: PlanStatus | 'all'): OutlineChapter[] {
    return status === 'all' ? [...chapters] : chapters.filter((chapter) => chapter.status === status)
}

/** 章节展示名：序号与标题拆开渲染，标题留空时回退为序号 */
export function chapterTitleLabel(chapter: OutlineChapter): string {
    return chapter.title.trim().length > 0 ? chapter.title : `第${chapter.order}章`
}

/** 向导参数：卷数、每卷章数、单章目标字数与节奏偏好 */
export interface OutlineDraftOptions {
    volumeCount: number
    chaptersPerVolume: number
    chapterWordGoal: number
    pacing: 'fast' | 'steady' | 'slow'
    /** 结构模板名，决定各卷的阶段命名 */
    structure: string
}

/** 结构模板到卷阶段名的映射：模板只影响命名，不改变卷数与章数的换算 */
const STAGE_NAMES: Readonly<Record<string, readonly string[]>> = {
    三幕式: ['建置', '对抗', '解决', '尾声'],
    起承转合: ['起', '承', '转', '合'],
    黄金三章: ['开局', '升级', '决战', '余波'],
    不使用模板: ['一', '二', '三', '四'],
}

/** 节奏到章内阶段的映射：四段循环，保证每一章都有明确落点 */
const PACING_PHASES: Readonly<Record<OutlineDraftOptions['pacing'], readonly string[]>> = {
    fast: ['开局钩子', '冲突升级', '强敌压境', '阶段高潮'],
    steady: ['日常切入', '线索浮现', '正面交锋', '阶段收束'],
    slow: ['群像登场', '暗线铺开', '关系裂变', '阶段回望'],
}

/** 节奏到章末钩子与张力的默认分布：快节奏多反转、慢热多情绪 */
const PACING_HOOKS: Readonly<Record<OutlineDraftOptions['pacing'], readonly HookKind[]>> = {
    fast: ['suspense', 'twist', 'twist', 'emotion'],
    steady: ['suspense', 'suspense', 'twist', 'emotion'],
    slow: ['emotion', 'suspense', 'twist', 'emotion'],
}

/** 节奏到基础张力：位于 1-5 档的起始值 */
const PACING_TENSION: Readonly<Record<OutlineDraftOptions['pacing'], number>> = {
    fast: 3,
    steady: 2,
    slow: 2,
}

/**
 * 按结构模板展开一份卷纲草案：只做结构推导，不生成具体情节文本。
 * 卷的阶段名、每卷目标与章内阶段由模板与节奏决定，梗概保留为可编辑的占位描述，
 * 因此草案可以直接写入大纲.md，也可以交给 AI 继续细化。
 */
export function buildOutlineDraft(
    setting: ProjectSetting,
    characters: readonly CharacterCard[],
    options: OutlineDraftOptions,
): OutlineVolume[] {
    const stages = STAGE_NAMES[options.structure] ?? STAGE_NAMES['起承转合'] ?? ['一', '二', '三', '四']
    const phases = PACING_PHASES[options.pacing]
    const hooks = PACING_HOOKS[options.pacing]
    const baseTension = PACING_TENSION[options.pacing]
    const protagonist = characters.find((character) => character.role === 'protagonist')
    const antagonist = characters.find((character) => character.role === 'antagonist')
    const heroName = protagonist?.name ?? '主角'
    const shortLogline = setting.logline.length > 0 ? setting.logline.slice(0, 24) : '围绕核心冲突推进'

    return Array.from({ length: options.volumeCount }, (_, volumeIndex) => {
        const stage = stages[volumeIndex] ?? `第${volumeIndex + 1}阶段`
        const chapters: OutlineChapter[] = Array.from({ length: options.chaptersPerVolume }, (_, chapterIndex) => {
            const order = chapterIndex + 1
            const phase = phases[chapterIndex % phases.length] ?? '推进'
            const hook = hooks[chapterIndex % hooks.length] ?? 'suspense'
            const tension = Math.min(5, baseTension + (chapterIndex % 4 === 3 ? 1 : 0))
            const isClimax = chapterIndex % 4 === 3

            return {
                id: createId('ch'),
                order,
                title: `第${order}章 ${phase}`,
                summary: `${heroName}在「${stage}」阶段推进：${shortLogline}。本章需要给出一个明确结果，并留下一个未解决的疑问。`,
                actualSummary: '',
                status: 'planned',
                beats: [
                    createBeat(`${heroName}因「${phase}」被卷入新的阻碍`),
                    createBeat(
                        isClimax ? `阶段高潮：与${antagonist?.name ?? '对手'}正面相撞` : '推进过程中暴露一条新线索',
                    ),
                ],
                scenes: [],
                pov: protagonist?.name ?? '',
                goal: `${phase}：把本阶段目标推进一格`,
                obstacle: `与${antagonist?.name ?? '对手'}的利益冲突`,
                turn: isClimax ? '阶段高潮迫使主角做出选择' : '推进过程中暴露一条新线索',
                result: '',
                emotion: '',
                characterIds: [protagonist?.id, isClimax ? antagonist?.id : undefined].filter(
                    (id): id is string => typeof id === 'string',
                ),
                location: '',
                wordGoal: options.chapterWordGoal,
                wordCount: 0,
                hook,
                tension,
                granularity: 'medium',
            }
        })

        return {
            id: createId('vol'),
            name: `第${volumeIndex + 1}卷 ${stage}`,
            goal: `${stage}阶段：${shortLogline}`,
            conflict: setting.conflict.length > 0 ? setting.conflict : '围绕核心冲突升级对抗',
            // 结构推导只给可编辑的占位描述，不伪造具体情节：真正的脉络由写作者或导入归纳填入
            plotline: `本卷按「${phases.join(' → ')}」推进：${shortLogline}，在阶段高潮处收束并留下悬念。`,
            turningPoints: [`${stage}阶段高潮：与${antagonist?.name ?? '对手'}正面相撞`],
            result: '',
            granularity: 'medium',
            chapters,
        }
    })
}

/** 卷章索引：把「卷序 + 章序」映射到全书章序，供线索与时间线的跨章判断使用 */
interface ChapterIndex {
    /** 键为「卷序-章序」，值为全书 1 基章序 */
    map: ReadonlyMap<string, number>
    /** 全书最后一章的章序：无章时为 0 */
    last: number
}

/** 构建卷章索引：卷序认「第N卷」，读不到时按数组位置兜底，与大纲解析同一口径 */
function buildChapterIndex(volumes: readonly OutlineVolume[]): ChapterIndex {
    const map = new Map<string, number>()
    let last = 0
    volumes.forEach((volume, index) => {
        const volumeOrder = readOutlineVolumeOrder(volume.name, index)
        for (const chapter of volume.chapters) {
            last += 1
            map.set(`${String(volumeOrder)}-${String(chapter.order)}`, last)
        }
    })
    return { map, last }
}

/** 读取章节引用的全书章序：引用不到时返回 null，不猜测位置 */
export function readRefGlobalOrder(volumes: readonly OutlineVolume[], ref: OutlineChapterRef | null): number | null {
    if (ref === null) {
        return null
    }
    return buildChapterIndex(volumes).map.get(`${String(ref.volumeOrder)}-${String(ref.chapterOrder)}`) ?? null
}

/** 章节引用选项：线索与时间线的「埋设章 / 回收章 / 涉及章」下拉共用 */
export interface ChapterRefOption {
    /** 取值形如「1-2」，与文档里的写法一致 */
    value: string
    /** 展示名：第1卷 · 第2章 章名 */
    label: string
    ref: OutlineChapterRef
}

/**
 * 章节引用条目：引用键之外带上卷与章对象本身，供回填按位置匹配章节事实。
 * 关键约束：chapterIndex 取数组位置（1 基），与作品章节清单的顺序一致；
 * chapterOrder 取章纲自己的 order，允许作者手改，两者不互相推导。
 */
export interface ChapterRefEntry {
    ref: OutlineChapterRef
    chapterIndex: number
    volume: OutlineVolume
    chapter: OutlineChapter
}

/** 由卷章树生成引用条目：卷序认「第N卷」，读不到时按数组位置兜底 */
export function createChapterRefEntries(volumes: readonly OutlineVolume[]): ChapterRefEntry[] {
    const entries: ChapterRefEntry[] = []
    volumes.forEach((volume, index) => {
        const volumeOrder = readOutlineVolumeOrder(volume.name, index)
        volume.chapters.forEach((chapter, position) => {
            entries.push({
                ref: { volumeOrder, chapterOrder: chapter.order },
                chapterIndex: position + 1,
                volume,
                chapter,
            })
        })
    })
    return entries
}

/** 由卷章树生成章节引用选项：线索与时间线的下拉共用 */
export function createChapterRefOptions(volumes: readonly OutlineVolume[]): ChapterRefOption[] {
    return createChapterRefEntries(volumes).map((entry) => ({
        value: `${String(entry.ref.volumeOrder)}-${String(entry.ref.chapterOrder)}`,
        label: `第${String(entry.ref.volumeOrder)}卷 · ${chapterTitleLabel(entry.chapter)}`,
        ref: entry.ref,
    }))
}

/** 解析章节引用取值：非法写法返回 null，不猜测位置 */
export function parseChapterRefValue(value: string): OutlineChapterRef | null {
    const matched = /^(\d+)\s*-\s*(\d+)$/u.exec(value.trim())
    if (matched?.[1] === undefined || matched[2] === undefined) {
        return null
    }
    return { volumeOrder: Number.parseInt(matched[1], 10), chapterOrder: Number.parseInt(matched[2], 10) }
}

/** 当前写作位置：最后一个「已写」章节的全书章序，没有已写章节时为 0 */
export function readWritingPosition(volumes: readonly OutlineVolume[]): number {
    let position = 0
    let globalOrder = 0
    volumes.forEach((volume) => {
        for (const chapter of volume.chapters) {
            globalOrder += 1
            if (chapter.status === 'written') {
                position = globalOrder
            }
        }
    })
    return position
}

/** 线索预警：逾期未收、临近回收章、未定回收章三种，供线索表与章详情展示 */
export interface ClueWarning {
    clue: OutlineClue
    /** warning 表示逾期，info 表示临期或未定 */
    severity: 'warning' | 'info'
    message: string
}

/** 临期阈值：回收章距当前写作位置不超过这么多章即提示 */
const CLUE_DUE_SOON = 3

/**
 * 计算线索预警：只针对「未回收」的线索，按当前写作位置比较回收章。
 * 关键约束：回收章解析不到（引用了不存在的卷章）时按「未定」提示，不误判为逾期。
 */
export function findClueWarnings(plan: OutlinePlan, volumes: readonly OutlineVolume[]): ClueWarning[] {
    const position = readWritingPosition(volumes)
    const index = buildChapterIndex(volumes)
    const warnings: ClueWarning[] = []
    for (const clue of plan.clues) {
        if (clue.status !== 'planted') {
            continue
        }
        if (clue.payoff === null) {
            warnings.push({ clue, severity: 'info', message: `「${clue.name}」尚未指定回收章` })
            continue
        }
        const payoffOrder = index.map.get(`${String(clue.payoff.volumeOrder)}-${String(clue.payoff.chapterOrder)}`)
        if (payoffOrder === undefined) {
            warnings.push({ clue, severity: 'info', message: `「${clue.name}」的回收章不在当前大纲里` })
            continue
        }
        if (payoffOrder < position) {
            warnings.push({
                clue,
                severity: 'warning',
                message: `「${clue.name}」已过回收章（第${String(payoffOrder)}章）仍未回收`,
            })
            continue
        }
        if (payoffOrder - position <= CLUE_DUE_SOON) {
            warnings.push({
                clue,
                severity: 'info',
                message: `「${clue.name}」将在第${String(payoffOrder)}章回收，还剩 ${String(payoffOrder - position)} 章`,
            })
        }
    }
    return warnings
}

/** 最小可用模板的产出：七个模块的计划 + 一卷一章的骨架 */
export interface OutlineTemplateDraft {
    plan: OutlinePlan
    volume: OutlineVolume
}

/**
 * 最小可用模板：一句话、主题、主角弧光、三幕、卷纲与章纲卡各铺一条占位内容。
 * 关键约束：模板只提供可编辑的填空题，不伪造具体情节；主角信息取自人物卡，没有主角时留空让作者填。
 */
export function buildMinimalTemplate(
    setting: ProjectSetting,
    characters: readonly CharacterCard[],
    chapterWordGoal: number,
): OutlineTemplateDraft {
    const protagonist = characters.find((character) => character.role === 'protagonist')
    const heroName = protagonist?.name ?? '主角'
    const volume = createVolume(1, chapterWordGoal)
    volume.name = '第1卷 开端'
    volume.goal = '本卷目标：主角要得到什么'
    volume.conflict = setting.conflict.length > 0 ? setting.conflict : '本卷主要冲突：谁/什么在阻碍'
    volume.plotline = '本卷情节脉络：因为 A，所以 B，但 C 导致 D。'
    volume.result = '卷末结果：目标达成 / 失败 / 付出的代价，以及留下的新问题'
    volume.granularity = 'medium'
    const firstChapter = volume.chapters[0] ?? createChapter(1, chapterWordGoal)
    firstChapter.title = '第1章 开端'
    firstChapter.pov = heroName
    firstChapter.goal = '本章目标：他此刻想得到什么'
    firstChapter.obstacle = '阻碍：谁 / 什么阻止他'
    firstChapter.turn = '转折：意料之外但合理的变化'
    firstChapter.result = '结果：达成 / 失败 / 代价'
    firstChapter.emotion = '情绪：紧张 / 爽 / 疑 / 悲'
    firstChapter.summary = '本章梗概：一句话说清这一章发生了什么'
    firstChapter.granularity = 'fine'
    volume.chapters = [firstChapter]

    return {
        plan: {
            book: {
                logline:
                    setting.logline.length > 0 ? setting.logline : `主角为了____，必须____，但____，最终他选择____。`,
                conflict: setting.conflict.length > 0 ? setting.conflict : '核心冲突：主角的欲望与什么正面相撞',
                theme: '通过____事件，探讨____。',
                ending: setting.ending,
                arc: protagonist?.arc ?? `主角弧光：从____到____。`,
            },
            acts: [
                { id: createId('act'), name: '开端', position: '打破平衡', event: '激励事件把主角推离日常' },
                { id: createId('act'), name: '对抗', position: '升级对抗', event: '中点反转，代价加码' },
                { id: createId('act'), name: '高潮', position: '迫使选择', event: '主角做出不可逆的选择' },
            ],
            characters:
                protagonist === undefined
                    ? [
                          {
                              id: createId('cline'),
                              characterId: '',
                              name: '主角',
                              desire: '他想要什么',
                              fear: '他害怕什么',
                              flaw: '他的缺陷',
                              secret: '他的秘密',
                              relation: '与谁的关系最关键',
                              arc: '从____到____',
                          },
                      ]
                    : [
                          {
                              id: createId('cline'),
                              characterId: protagonist.id,
                              name: protagonist.name,
                              desire: protagonist.desire,
                              fear: '',
                              flaw: protagonist.weakness,
                              secret: '',
                              relation: protagonist.relation,
                              arc: protagonist.arc,
                          },
                      ],
            setting: [],
            pacing: [],
            clues: [],
            timeline: [],
        },
        volume,
    }
}

/**
 * 把最小模板合并进现有计划：只填空字段与空列表，绝不覆盖作者已写内容。
 * 关键约束：设定纲、节奏、线索与时间线不在模板范围内，一律保留现稿；
 * 连续点两次「套用模板」结果不变，满足幂等。
 */
export function mergeTemplatePlan(current: OutlinePlan, template: OutlinePlan): OutlinePlan {
    return {
        book: {
            logline: current.book.logline.length > 0 ? current.book.logline : template.book.logline,
            conflict: current.book.conflict.length > 0 ? current.book.conflict : template.book.conflict,
            theme: current.book.theme.length > 0 ? current.book.theme : template.book.theme,
            ending: current.book.ending.length > 0 ? current.book.ending : template.book.ending,
            arc: current.book.arc.length > 0 ? current.book.arc : template.book.arc,
        },
        acts: current.acts.length > 0 ? current.acts : template.acts,
        characters: current.characters.length > 0 ? current.characters : template.characters,
        setting: current.setting,
        pacing: current.pacing,
        clues: current.clues,
        timeline: current.timeline,
    }
}
