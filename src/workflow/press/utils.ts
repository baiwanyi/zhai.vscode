/**
 * 大纲与人物卡纯函数：字段判断、设定快照、章节统计、节点构造、提取草案合并与生成上下文转换。
 * 复用约定：字数口径取仪表盘 formatWordCount，节点 id 取 createId，中文标签取 constants 元数据表。
 * 关键约束：缺失只作提示而非错误；统计以目标字数为分母；补全只填空字段；
 * 生成上下文只传文案与本卷线索，线索按「卷序 + 章序」引用，卷章重排后需重新校正。
 */
import { DEFAULT_PORTRAIT_STYLE } from '@shared/types/press'
import type {
    OutlineActContext,
    OutlineClueContext,
    PressExtractedCharacter,
    PressExtractedVolume,
    PressVolumeGroup,
    SettingFieldKey,
    SettingSnapshot,
    VolumeChapterClueRef,
} from '@shared/types/press'
import { formatWordCount } from '@webview/dashboard/utils'
import {
    ACT_KIND_META,
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
    LoreEntry,
    LoreSeed,
    OutlineAct,
    OutlineBeat,
    OutlineChapter,
    OutlineChapterRef,
    OutlineClue,
    OutlineExtractKey,
    OutlinePlan,
    OutlineScene,
    OutlineTreeEntry,
    OutlineVolume,
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

/** 判断指定字段是否缺失，供设定分组切换的缺项提示使用 */
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
        case 'theme':
            return { theme: value }
        case 'arc':
            return { arc: value }
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
        theme: setting.theme,
        arc: setting.arc,
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
    prefix: 'vol' | 'ch' | 'beat' | 'plot' | 'scene' | 'char' | 'lore' | 'act' | 'snote' | 'clue' | 'tline',
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
        // 章号不进标题：文档与数据只存纯名称，展示时由 chapterTitleLabel 补「第N章」
        title: '未命名',
        stage: '',
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
        pacing: 'setup',
        tension: 3,
        granularity: 'medium',
    }
}

/** 新建一条结构阶段：类型与卷位留空，由作者显式指定 */
export function createAct(name = '新阶段', narrativeRole = ''): OutlineAct {
    return {
        id: createId('act'),
        name,
        kind: 'none',
        volumeOrder: null,
        narrativeRole,
        event: '',
        protagonistChange: '',
    }
}

/** 新建一条伏笔线索：默认未指定类型与未回收，触发者与章节引用留空 */
export function createClue(name = '新线索'): OutlineClue {
    return {
        id: createId('clue'),
        name,
        kind: 'none',
        plant: null,
        payoff: null,
        triggerId: '',
        status: 'planted',
        note: '',
    }
}

/** 新建空大纲计划：缺段落的作品打开时用它兜底，页面永远拿到完整结构 */
export function createEmptyPlan(): OutlinePlan {
    return {
        acts: [],
        clues: [],
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
    return drafts.map((draft) => ({
        id: createId('vol'),
        // 卷名只存纯名称：素材侧可能给「01-天都篇」或「第1卷 天都篇」，统一剥掉卷号与序号前缀
        name: stripVolumeOrderPrefix(draft.name).replace(/^\d+\s*[-_.、]\s*/u, '') || `未命名`,
        expectedChapters: draft.chapters.length,
        coreEvent: draft.coreEvent.trim(),
        mainPlot: draft.mainPlot.map((item) => item.trim()).filter((item) => item.length > 0),
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

/** 大纲卷序：先认「第N卷」，再认序号前缀，都没有时按数组位置兜底；线索引用写回也用此口径 */
export function readOutlineVolumeOrder(name: string, index: number): number {
    const byTitle = VOLUME_TITLE_PATTERN.exec(name)?.[1]
    if (byTitle !== undefined) {
        return Number.parseInt(byTitle, 10)
    }
    return readOrderPrefix(name) ?? index + 1
}

/** 卷名开头是否已带卷号：兼容「第1卷」与「第一卷」，只认开头，避免正文里的「第3卷」误判 */
const VOLUME_PREFIX_PATTERN = /^第\s*[0-9一二三四五六七八九十百]+\s*卷/u

/**
 * 卷名展示：名称已带卷号时原样返回，否则按数组位置补上「第N卷」。
 * 关键约束：这只影响展示，不改写文档里的卷名——卡片与下拉都用它，
 * 因此素材导入的「01-天都篇」这类目录口径名称也会带上卷号，避免看不出顺序。
 */
export function volumeTitleLabel(name: string, index: number): string {
    const trimmed = name.trim()
    const order = index + 1
    if (trimmed.length === 0) {
        return `第${String(order)}卷`
    }
    return VOLUME_PREFIX_PATTERN.test(trimmed) ? trimmed : `第${String(order)}卷 ${trimmed}`
}

/**
 * 卷纲的纯文本快照：供「添加到 AI 对话」复制成可粘贴的上下文。
 * 关键约束：卷名用展示名（带卷号），不写章节内容——对话里只需要卷级上下文；
 * 空字段整行省略，避免把「核心事件：」这类空壳粘进对话。
 */
export function formatVolumeOutlineText(volume: OutlineVolume, index: number): string {
    const lines: string[] = [`【${volumeTitleLabel(volume.name, index)}】`]
    if (volume.expectedChapters > 0) {
        lines.push(`预计章节数：${String(volume.expectedChapters)}`)
    }
    if (volume.coreEvent.trim().length > 0) {
        lines.push(`核心事件：${volume.coreEvent.trim()}`)
    }
    const mainPlot = volume.mainPlot.map((item) => item.trim()).filter((item) => item.length > 0)
    if (mainPlot.length > 0) {
        lines.push('主要情节：', ...mainPlot.map((item) => `- ${item}`))
    }
    const turningPoints = volume.turningPoints.map((item) => item.trim()).filter((item) => item.length > 0)
    if (turningPoints.length > 0) {
        lines.push('关键转折：', ...turningPoints.map((item) => `- ${item}`))
    }
    if (volume.result.trim().length > 0) {
        lines.push(`卷末结果：${volume.result.trim()}`)
    }
    return lines.join('\n')
}

/**
 * 章纲的纯文本快照：供「添加到 AI 对话」作为写正文的上下文。
 * 关键约束：只输出计划内容（summary），不混入 actualSummary 正文事实；
 * 空字段整行省略，节拍与场景按落笔顺序排列，字段口径与章纲编辑页保持一致。
 */
export function formatChapterOutlineText(chapter: OutlineChapter): string {
    const lines: string[] = [`【${chapterTitleLabel(chapter)}】`]
    if (chapter.stage.trim().length > 0) {
        lines.push(`阶段：${chapter.stage.trim()}`)
    }
    if (chapter.summary.trim().length > 0) {
        lines.push(`计划梗概：${chapter.summary.trim()}`)
    }
    const card: readonly (readonly [string, string])[] = [
        ['POV', chapter.pov],
        ['目标', chapter.goal],
        ['阻碍', chapter.obstacle],
        ['转折', chapter.turn],
        ['结果', chapter.result],
        ['情绪', chapter.emotion],
        ['场景地点', chapter.location],
    ]
    const filledCard = card
        .map(([label, value]) => [label, value.trim()] as const)
        .filter(([, value]) => value.length > 0)
    if (filledCard.length > 0) {
        lines.push('章纲卡：', ...filledCard.map(([label, value]) => `- ${label}：${value}`))
    }
    const hookLabel = HOOK_OPTIONS.find((option) => option.value === chapter.hook)?.label
    if (hookLabel !== undefined && hookLabel !== '无') {
        lines.push(`章末钩子：${hookLabel}`)
    }
    const beats = chapter.beats.map((beat) => beat.text.trim()).filter((text) => text.length > 0)
    if (beats.length > 0) {
        lines.push('节拍：', ...beats.map((text) => `- ${text}`))
    }
    if (chapter.scenes.length > 0) {
        lines.push('场景纲：')
        chapter.scenes.forEach((scene) => {
            lines.push(`场景${String(scene.order)} ${scene.title.trim() || '未命名'}`)
            const fields: readonly (readonly [string, string])[] = [
                ['欲望', scene.desire],
                ['阻碍', scene.obstacle],
                ['选择', scene.choice],
                ['结果', scene.result],
                ['情绪变化', scene.emotion],
            ]
            fields.forEach(([label, value]) => {
                const trimmed = value.trim()
                if (trimmed.length > 0) {
                    lines.push(`- ${label}：${trimmed}`)
                }
            })
        })
    }
    return lines.join('\n')
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
export function createVolumeOptions(volumes: readonly OutlineVolume[]): { value: string; label: string }[] {
    // 直接取作品卷表：空卷（还没有章）也要能选，否则进不了它的卷纲视图；
    // 标签用展示名（带卷号），卷名本身只存纯名称，下拉里才看得出顺序
    return volumes.map((volume, index) => ({ value: volume.id, label: volumeTitleLabel(volume.name, index) }))
}

/** 整数输入归一：留空或非整数回落 fallback，越界夹到 [min, max]（max 小于 min 时按 min 处理） */
export function clampIntegerInput(value: string, fallback: number, min: number, max: number): number {
    const parsed = Number(value)
    if (value.trim().length === 0 || !Number.isInteger(parsed)) {
        return fallback
    }
    return Math.min(Math.max(parsed, min), Math.max(max, min))
}

/** 章序取值：留空或非数字回落 fallback，越界夹到 [1, 全书章数]，避免手输残值在提交时越界 */
export function clampChapterOrder(value: string, fallback: number, totalCount: number): number {
    return clampIntegerInput(value, fallback, 1, Math.max(totalCount, 1))
}

/** 由起止章序展开 1 基连续章序：倒序输入自动归一为同一段区间 */
export function createOrderRange(start: number, end: number): number[] {
    const lower = Math.min(start, end)
    const upper = Math.max(start, end)
    return Array.from({ length: upper - lower + 1 }, (_, index) => lower + index)
}

/**
 * 新建一卷空卷纲：卷名只存纯名称，卷号由位置决定、展示时由 volumeTitleLabel 补上。
 * 关键约束：默认带一条空章纲，保证新卷可直接进入章纲编辑。
 */
export function createVolume(chapterWordGoal: number): OutlineVolume {
    return {
        id: createId('vol'),
        name: '未命名',
        expectedChapters: 0,
        coreEvent: '',
        mainPlot: [],
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
/**
 * 章标题展示：数据与文档只存纯名称，章号由位置决定，展示时补「第N章」。
 * 关键约束：名称里可能残留「第N章」前缀（存量数据），先剥掉再拼，避免「第1章 第3章 开局」。
 */
export function chapterTitleLabel(chapter: OutlineChapter): string {
    const name = stripChapterOrderPrefix(chapter.title)
    return name.length > 0 ? `第${chapter.order}章 ${name}` : `第${chapter.order}章`
}

/** 去掉标题里的「第N章」前缀：AI 草案、手写标题与存量数据都可能自带序号 */
export function stripChapterOrderPrefix(title: string): string {
    return title.replace(/^第\s*[0-9]+\s*章\s*/u, '').trim()
}

/** 去掉卷名里的「第N卷」前缀（含中文数字）：文档与数据只存纯卷名 */
export function stripVolumeOrderPrefix(name: string): string {
    return name.replace(/^第\s*[0-9一二三四五六七八九十百]+\s*卷\s*/u, '').trim()
}

/** 章纲写入方式：追加到卷末，或先清掉未动过的空章再续排 */
export type VolumeChapterWriteMode = 'append' | 'replace-empty'

/**
 * 空章判定：待写、没有字数、没有梗概，且节拍全是空白。
 * 「替换卷内空章」与章纲预览计算起始章序共用这一口径，两处判断必须一致。
 */
export function isEmptyOutlineChapter(chapter: OutlineChapter): boolean {
    return (
        chapter.status === 'planned' &&
        chapter.wordCount === 0 &&
        chapter.summary.trim().length === 0 &&
        chapter.beats.every((beat) => beat.text.trim().length === 0)
    )
}

/** 按卷生成章纲时的单章草案：阶段、标题、梗概、节拍与线索动作，其余字段写入时取默认值 */
export interface ChapterSeed {
    /** 阶段名：如「第一阶段：坠楼与觉醒」，空串表示未分组 */
    stage: string
    title: string
    /** 章节介绍：写入计划梗概 */
    summary: string
    /** 章节细纲：逐条写入节拍，空数组时留一条空节拍 */
    beats: readonly string[]
    /** 本章承担的线索动作：写入后按实际章序回写线索表，不写进章块 */
    clueRefs: readonly VolumeChapterClueRef[]
}

/**
 * 由草案构造章纲：章序从 startOrder 连续续排，标题统一成「第N章 标题」。
 * 关键约束：阶段、标题、梗概与节拍按生成结果写入，POV、人物等留给作者在章纲里逐章细化。
 */
export function createChaptersFromSeeds(
    seeds: readonly ChapterSeed[],
    startOrder: number,
    wordGoal: number,
): OutlineChapter[] {
    return seeds.map((seed, index) => {
        const order = startOrder + index
        const chapter = createChapter(order, wordGoal)
        const beats = seed.beats
            .map((text) => text.trim())
            .filter((text) => text.length > 0)
            .map((text) => createBeat(text))
        return {
            ...chapter,
            // 章号由 order 决定，标题只留纯名称：AI 偶尔带「第N章」前缀，这里剥掉
            title: stripChapterOrderPrefix(seed.title) || chapter.title,
            stage: seed.stage.trim(),
            summary: seed.summary.trim(),
            beats: beats.length > 0 ? beats : chapter.beats,
        }
    })
}

/**
 * 线索引用补丁：按草案的 clueRefs 与写入后的实际章序生成，同一线索多次出现以最后一章为准。
 * 关键约束：只改 plant / payoff 引用，回收状态由作者在回填时确认；卷序取大纲卷名解析结果。
 */
export function buildClueRefPatches(
    seeds: readonly ChapterSeed[],
    startOrder: number,
    volumeOrder: number,
): Map<string, { plant?: OutlineChapterRef; payoff?: OutlineChapterRef }> {
    const patches = new Map<string, { plant?: OutlineChapterRef; payoff?: OutlineChapterRef }>()
    seeds.forEach((seed, index) => {
        const ref: OutlineChapterRef = { volumeOrder, chapterOrder: startOrder + index }
        for (const clueRef of seed.clueRefs) {
            const patch = patches.get(clueRef.id) ?? {}
            if (clueRef.action === 'plant') {
                patch.plant = ref
            } else {
                patch.payoff = ref
            }
            patches.set(clueRef.id, patch)
        }
    })
    return patches
}

/** 阶段分组结果：stage 为空串表示「未分组」 */
export interface ChapterStageGroup {
    stage: string
    chapters: OutlineChapter[]
}

/**
 * 卷内章序规整：按数组顺序重排为 1..N。
 * 关键约束：章号只改 order，标题不拼编号；标题里若残留「第N章」前缀（存量数据）一并剥掉，
 * 剥完为空时回落到「未命名」，避免展示成单独一个「第N章」。
 */
export function renumberChapters(chapters: readonly OutlineChapter[]): OutlineChapter[] {
    return chapters.map((chapter, index) => ({
        ...chapter,
        order: index + 1,
        title: stripChapterOrderPrefix(chapter.title) || '未命名',
    }))
}

/**
 * 按阶段分组：组序按阶段首次出现的章序，未填阶段的章归入末尾的「未分组」。
 * 关键约束：只做分组，不重排章序——阶段内部仍按传入顺序展示。
 */
export function groupChaptersByStage(chapters: readonly OutlineChapter[]): ChapterStageGroup[] {
    const groups = new Map<string, OutlineChapter[]>()
    const ungrouped: OutlineChapter[] = []
    for (const chapter of chapters) {
        const stage = chapter.stage.trim()
        if (stage.length === 0) {
            ungrouped.push(chapter)
            continue
        }
        const bucket = groups.get(stage)
        if (bucket === undefined) {
            groups.set(stage, [chapter])
        } else {
            bucket.push(chapter)
        }
    }
    const result: ChapterStageGroup[] = [...groups].map(([stage, items]) => ({ stage, chapters: items }))
    if (ungrouped.length > 0) {
        result.push({ stage: '', chapters: ungrouped })
    }
    return result
}

/** 卷章索引：把「卷序 + 章序」映射到全书章序，供线索的跨章判断使用 */
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

/** 章节引用选项：线索的「埋设章 / 回收章」下拉使用 */
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

/**
 * 章节详情视图上下文：一次算出引用、前后章与后续两章，避免聚焦视图与详情页各自重复查找。
 * 关键约束：chapterRef 优先取真实引用条目，缺失时按所在卷序与本章 order 兜底；
 * prev/next 按 order 相邻匹配，nextChapters 取本章之后最近两章，两者口径不同不可互换。
 */
export function resolveChapterViewContext(
    selectedEntry: OutlineTreeEntry,
    volumes: readonly OutlineVolume[],
    refEntries: readonly ChapterRefEntry[],
): {
    chapterRef: OutlineChapterRef
    prevChapter: OutlineChapter | null
    nextChapter: OutlineChapter | null
    nextChapters: OutlineChapter[]
} {
    const chapters = selectedEntry.volume.chapters
    const order = selectedEntry.chapter.order
    const volumeIndex = volumes.findIndex((volume) => volume.id === selectedEntry.volume.id)
    return {
        chapterRef: refEntries.find((entry) => entry.chapter.id === selectedEntry.chapter.id)?.ref ?? {
            volumeOrder: readOutlineVolumeOrder(selectedEntry.volume.name, volumeIndex),
            chapterOrder: order,
        },
        prevChapter: chapters.find((chapter) => chapter.order === order - 1) ?? null,
        nextChapter: chapters.find((chapter) => chapter.order === order + 1) ?? null,
        nextChapters: chapters.filter((chapter) => chapter.order > order).slice(0, 2),
    }
}

/** 由卷章树生成章节引用选项：线索的下拉使用 */
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

/** 结构阶段转生成上下文：传转折类型、卷位、叙事作用、事件与主角变化，id 不进提示词 */
export function toOutlineActContexts(acts: readonly OutlineAct[]): OutlineActContext[] {
    return acts.map((act) => ({
        name: act.name,
        kind: ACT_KIND_META[act.kind].label,
        volumeOrder: act.volumeOrder,
        narrativeRole: act.narrativeRole,
        event: act.event,
        protagonistChange: act.protagonistChange,
    }))
}

/** 本卷线索转生成上下文：埋设章或回收章落在本卷才传，章节引用写「卷序-章序」 */
export function toVolumeClueContexts(
    clues: readonly OutlineClue[],
    volumes: readonly OutlineVolume[],
    volumeId: string,
): OutlineClueContext[] {
    const index = volumes.findIndex((volume) => volume.id === volumeId)
    if (index < 0) {
        return []
    }
    const volumeOrder = readOutlineVolumeOrder(volumes[index]?.name ?? '', index)
    const formatRef = (ref: OutlineChapterRef | null): string =>
        ref === null ? '' : `${String(ref.volumeOrder)}-${String(ref.chapterOrder)}`
    return clues
        .filter(
            (clue) =>
                (clue.plant !== null && clue.plant.volumeOrder === volumeOrder) ||
                (clue.payoff !== null && clue.payoff.volumeOrder === volumeOrder),
        )
        .map((clue) => ({
            id: clue.id,
            name: clue.name,
            plant: formatRef(clue.plant),
            payoff: formatRef(clue.payoff),
            note: clue.note,
        }))
}

/** 章节引用的 UI 展示格式：卷X · X章（与文档序列化的 X-Y 口径区分） */
export function formatChapterRefLabel(ref: OutlineChapterRef): string {
    return `卷${String(ref.volumeOrder)} · ${String(ref.chapterOrder)}章`
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
