/**
 * 大纲与人物卡纯函数：字段缺失判断、章节统计、节点构造、字数格式化，以及提取草案的建卡与字段补全。
 * 复用约定：字数口径复用仪表盘的 formatWordCount，不另写一套；节点 id 统一由 createId 生成，
 * 保证新增卷、章、节拍在树中可直接作为 key 与选中标识；草案的中文标签按 constants 的元数据表归一。
 * 关键约束：缺失判断只区分「是否填写」，缺失不视为错误、仅用于提示；
 * 章节统计以章纲上的目标字数为分母，不使用正文实际字数反推计划；
 * 补全已有角色只填空白字段、不覆盖作者已写内容，没有实际变化时必须返回原对象，避免无谓写盘。
 */
import { DEFAULT_PORTRAIT_STYLE } from '@shared/types/press'
import type { CharacterPortrait, PressExtractedCharacter, PressExtractedVolume } from '@shared/types/press'
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
    OutlineBeat,
    OutlineChapter,
    OutlineVolume,
    PlanStatus,
    ProjectSetting,
} from './types'
import { formatWordCount } from '../../dashboard/utils'

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

/**
 * 生成人物标识：8 位随机数字，与宿主的人物标识规范一致，也直接作为设定图文件名里的角色段。
 * 用 crypto 采样而非 Math.random，避免同一次解析里连续生成时出现可预期的重复。
 */
function createCharacterId(): string {
    const buffer = new Uint32Array(1)
    crypto.getRandomValues(buffer)
    return String(10_000_000 + ((buffer[0] ?? 0) % 90_000_000))
}

/** 生成节点 id：卷、章、节拍、人物共用；人物用 8 位数字，其余带前缀便于排查来源 */
export function createId(prefix: 'vol' | 'ch' | 'beat' | 'char'): string {
    if (prefix === 'char') {
        return createCharacterId()
    }
    return `${prefix}-${crypto.randomUUID()}`
}

/**
 * 合并角色图：两侧均为最新在前，本地草稿里磁盘尚未扫到的（刚生成还没回读）排在最前。
 * 按 id 去重，反复打开角色卡不会出现重复项。
 */
export function mergePortraits(
    listed: readonly CharacterPortrait[],
    local: readonly CharacterPortrait[],
): CharacterPortrait[] {
    const seen = new Set(listed.map((item) => item.id))
    return [...local.filter((item) => !seen.has(item.id)), ...listed]
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
        traits:
            character.traits.length > 0 || draft.traits.length === 0 ? character.traits : draft.traits,
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

/** 新建一章空章纲，序号与目标字数由调用方给出 */
export function createChapter(order: number, wordGoal: number): OutlineChapter {
    return {
        id: createId('ch'),
        order,
        title: `第${order}章 未命名`,
        summary: '',
        status: 'planned',
        beats: [createBeat()],
        characterIds: [],
        location: '',
        wordGoal,
        wordCount: 0,
        hook: 'suspense',
        tension: 3,
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

/** 新建一卷空卷纲，卷名默认按序号命名 */
export function createVolume(order: number, chapterWordGoal: number): OutlineVolume {
    return {
        id: createId('vol'),
        name: `第${order}卷 未命名`,
        goal: '',
        conflict: '',
        plotline: '',
        turningPoints: [],
        chapters: [createChapter(1, chapterWordGoal)],
    }
}

/** 卷章节统计：总数、已完成数、已写字数与目标字数 */
export function summarizeVolume(volume: OutlineVolume): {
    total: number
    done: number
    stale: number
    wordCount: number
    wordGoal: number
} {
    return volume.chapters.reduce(
        (summary, chapter) => ({
            total: summary.total + 1,
            done: summary.done + (chapter.status === 'done' ? 1 : 0),
            stale: summary.stale + (chapter.status === 'stale' ? 1 : 0),
            wordCount: summary.wordCount + chapter.wordCount,
            wordGoal: summary.wordGoal + chapter.wordGoal,
        }),
        { total: 0, done: 0, stale: 0, wordCount: 0, wordGoal: 0 },
    )
}

/** 整部作品的章节总数与完成数，用于工作台标题区进度 */
export function summarizeWorkspace(volumes: readonly OutlineVolume[]): {
    chapters: number
    done: number
    wordCount: number
    wordGoal: number
} {
    return volumes.reduce(
        (summary, volume) => {
            const volumeSummary = summarizeVolume(volume)
            return {
                chapters: summary.chapters + volumeSummary.total,
                done: summary.done + volumeSummary.done,
                wordCount: summary.wordCount + volumeSummary.wordCount,
                wordGoal: summary.wordGoal + volumeSummary.wordGoal,
            }
        },
        { chapters: 0, done: 0, wordCount: 0, wordGoal: 0 },
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
                status: 'planned',
                beats: [
                    createBeat(`${heroName}因「${phase}」被卷入新的阻碍`),
                    createBeat(
                        isClimax ? `阶段高潮：与${antagonist?.name ?? '对手'}正面相撞` : '推进过程中暴露一条新线索',
                    ),
                ],
                characterIds: [protagonist?.id, isClimax ? antagonist?.id : undefined].filter(
                    (id): id is string => typeof id === 'string',
                ),
                location: '',
                wordGoal: options.chapterWordGoal,
                wordCount: 0,
                hook,
                tension,
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
            chapters,
        }
    })
}
