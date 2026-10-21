/**
 * 大纲模块纯函数：设定完整度、章节统计、节点构造与字数格式化，供页面与卡片共用。
 * 复用约定：字数口径复用仪表盘的 formatWordCount，不另写一套；节点 id 统一由 createId 生成，
 * 保证新增卷、章、节拍在树中可直接作为 key 与选中标识。
 * 关键约束：完整度只统计可判断「是否填写」的字段，缺失不视为错误、仅用于提示；
 * 章节统计以章纲上的目标字数为分母，不使用正文实际字数反推计划。
 */
import { DEFAULT_PORTRAIT_STYLE } from '@shared/types/press'
import type {
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

/** 计入完整度的字段：覆盖作品设定页五个分组的主要输入项 */
const COMPLETENESS_KEYS: readonly (keyof ProjectSetting)[] = [
    'title',
    'penName',
    'genres',
    'audience',
    'wordGoal',
    'logline',
    'conflict',
    'ending',
    'era',
    'factions',
    'powerSystem',
    'taboo',
    'goldenFingerType',
    'goldenFingerAbility',
    'goldenFingerCost',
    'perspective',
    'tone',
    'references',
    'banned',
]

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

/** 设定完整度：已填字段占比，取整到百分比 */
export function computeSettingCompleteness(setting: ProjectSetting): number {
    const filled = COMPLETENESS_KEYS.filter((key) => isFilled(setting[key])).length
    return Math.round((filled / COMPLETENESS_KEYS.length) * 100)
}

/** 判断指定字段是否缺失，供分组标题与向导输入确认使用 */
export function isSettingFieldMissing(setting: ProjectSetting, key: keyof ProjectSetting): boolean {
    return !isFilled(setting[key])
}

/** 生成节点 id：卷、章、节拍、人物共用，前缀用于排查来源 */
export function createId(prefix: 'vol' | 'ch' | 'beat' | 'char'): string {
    return `${prefix}-${crypto.randomUUID()}`
}

/** 新建一张人物卡：定位默认配角、姓名占位；seed 承接新增弹窗填写的初始值，id 恒由本函数生成 */
export function createCharacterCard(seed: CharacterSeed = {}): CharacterCard {
    return {
        name: '新人物',
        alias: '',
        role: 'supporting',
        age: '',
        identity: '',
        appearance: '',
        traits: [],
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

/** 新建一卷空卷纲，卷名默认按序号命名 */
export function createVolume(order: number, chapterWordGoal: number): OutlineVolume {
    return {
        id: createId('vol'),
        name: `第${order}卷 未命名`,
        goal: '',
        conflict: '',
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
                    createBeat(isClimax ? `阶段高潮：与${antagonist?.name ?? '对手'}正面相撞` : '推进过程中暴露一条新线索'),
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
            chapters,
        }
    })
}
