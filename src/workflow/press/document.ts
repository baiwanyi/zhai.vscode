/**
 * 作品文档解析：把 README.md、设定.md、角色设定.md、大纲.md 的原文解析成工作台的 OutlineWorkspace。
 * 复用约定：字段语义与 types.ts 一致；作品设定取自 README 的 Frontmatter 与两份设定文档，
 * 角色按「# 角色名」切块，大纲按「卷 → 章 → 键值行」切块，优先认 `- 键：值` 行，缺失时回落到区块段落文本。
 * 关键约束：解析必须容错——文件缺失、区块改名、字段写法变化都只让对应字段为空，绝不抛错；
 * 章纲的 summary 表示计划、wordCount 表示已写事实，两者不互相推导；未识别的名称不进入 characterIds，
 * 避免正文引用到不存在的人物卡。
 */
import { parseImageKind } from '@shared/types/imagegen'
import { DEFAULT_PORTRAIT_STYLE, PORTRAIT_STYLES, isPressCharacterId } from '@shared/types/press'
import type { PortraitStyle } from '@shared/types/press'
import type {
    Audience,
    CharacterBodyType,
    CharacterCard,
    CharacterGender,
    CharacterRole,
    EndingKind,
    HookKind,
    OutlineBeat,
    OutlineChapter,
    OutlineVolume,
    PlanStatus,
    ProjectSetting,
} from './types'

/** 文档区块：标题与区块正文 */
interface DocumentSection {
    title: string
    content: string
}

/** 解析结果：解析器自身不感知数据来源，调用方只在解析成功后用它替换界面工作区 */
export interface ParsedWorkspace {
    setting: ProjectSetting
    characters: CharacterCard[]
    volumes: OutlineVolume[]
}

/** 标题层级正则：精确到该层级，更深层级不会误匹配 */
const HEADING_PATTERNS: Readonly<Record<number, RegExp>> = {
    1: /^#\s+(.+)$/,
    2: /^##\s+(.+)$/,
    3: /^###\s+(.+)$/,
    4: /^####\s+(.+)$/,
}

/** 角色分类标签到枚举：中英文写法都接受，未识别按配角处理 */
const ROLE_LABELS: Readonly<Record<string, CharacterRole>> = {
    protagonist: 'protagonist',
    主角: 'protagonist',
    supporting: 'supporting',
    配角: 'supporting',
    antagonist: 'antagonist',
    反派: 'antagonist',
    neutral: 'neutral',
    中立: 'neutral',
    extra: 'extra',
    龙套: 'extra',
}

/** 性别标签到枚举：建卡必选其一，未识别按男处理 */
const GENDER_LABELS: Readonly<Record<string, CharacterGender>> = {
    male: 'male',
    男: 'male',
    female: 'female',
    女: 'female',
}

/** 章纲状态映射：兼容章节文档的 status 值域与中文文案 */
const STATUS_LABELS: Readonly<Record<string, PlanStatus>> = {
    published: 'done',
    done: 'done',
    已完成: 'done',
    draft: 'drafting',
    drafting: 'drafting',
    在写: 'drafting',
    pending: 'planned',
    planned: 'planned',
    待写: 'planned',
    stale: 'stale',
    需复核: 'stale',
}

/** 章末钩子映射：兼容英文枚举与中文标签 */
const HOOK_LABELS: Readonly<Record<string, HookKind>> = {
    suspense: 'suspense',
    悬念: 'suspense',
    twist: 'twist',
    反转: 'twist',
    emotion: 'emotion',
    情绪: 'emotion',
    情绪高点: 'emotion',
    none: 'none',
    无: 'none',
}

/** 结局倾向白名单：只接受类型允许的三个值 */
const ENDING_LABELS: readonly EndingKind[] = ['HE', 'BE', '开放']

/** 目标读者白名单：与 README Frontmatter 取值一致 */
const AUDIENCE_LABELS: readonly Audience[] = ['男频', '女频']

/** 章节默认目标字数：与新建章节时的默认值一致 */
const DEFAULT_CHAPTER_WORD_GOAL = 2500

/** 张力下限与上限：与 types.ts 的 1-5 约定一致 */
const MIN_TENSION = 1
const MAX_TENSION = 5

/** 兜底文本长度上限：区块段落作为字段兜底时只留一句概述，避免把整篇设定塞进表单 */
const FALLBACK_TEXT_LIMIT = 200

/** 长文本字段的长度上限：世界观总述与情节脉络本身就是多句描述，沿用概述长度会被截断成半句 */
const LONG_TEXT_LIMIT = 600

/** 分离 Frontmatter 与正文：未闭合或缺失时整体按正文处理 */
function splitFrontmatter(text: string): { frontmatter: string; body: string } {
    if (!text.startsWith('---')) {
        return { frontmatter: '', body: text }
    }
    const end = text.indexOf('\n---', 3)
    if (end < 0) {
        return { frontmatter: '', body: text }
    }
    return { frontmatter: text.slice(3, end), body: text.slice(end + 4) }
}

/** 读取 Frontmatter 的标量字段：数组形态（[a, b]）原样返回，交由调用方拆解 */
function readFrontmatterValue(frontmatter: string, key: string): string | undefined {
    const pattern = new RegExp(`^${key}\\s*:\\s*(.+)$`, 'mu')
    return pattern.exec(frontmatter)?.[1]?.trim()
}

/** 拆分数组文本：支持「[a, b]」与「a、b」两种写法 */
function toList(value: string | undefined): string[] {
    if (value === undefined) {
        return []
    }
    return value
        .replace(/^\[|\]$/g, '')
        .split(/[、,，;；/]/u)
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
}

/** 读取首个数字：用于字数、序号、张力等数值字段，未命中返回 null */
function toNumber(value: string | undefined): number | null {
    if (value === undefined) {
        return null
    }
    const matched = /(\d+)/.exec(value.replace(/,/g, ''))
    if (matched?.[1] === undefined) {
        return null
    }
    const parsed = Number.parseInt(matched[1], 10)
    return Number.isNaN(parsed) ? null : parsed
}

/** 按标题层级切块：同名标题按出现顺序保留，不合并 */
function splitSections(text: string, level: 1 | 2 | 3 | 4): DocumentSection[] {
    const pattern = HEADING_PATTERNS[level]
    if (pattern === undefined) {
        return []
    }
    const sections: DocumentSection[] = []
    let current: DocumentSection | null = null
    for (const line of text.split(/\r?\n/)) {
        const heading = pattern.exec(line.trim())
        if (heading?.[1] !== undefined) {
            current = { title: heading[1].trim(), content: '' }
            sections.push(current)
            continue
        }
        if (current !== null) {
            current.content += `${line}\n`
        }
    }
    return sections
}

/**
 * 读取列表项里的「键：值」：一行内用「｜」分隔的多个字段会被逐个拆出，
 * 重复键保留首次出现的值，避免后文举例覆盖正式字段。
 */
function readKeyValues(text: string): Map<string, string> {
    const values = new Map<string, string>()
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!/^[-*]\s+/u.test(trimmed)) {
            continue
        }
        for (const segment of trimmed.replace(/^[-*]\s+/u, '').split(/[｜|]/u)) {
            const matched = /^([^：:]{1,16})[：:]\s*(.+)$/u.exec(segment.trim())
            if (matched?.[1] === undefined || matched[2] === undefined) {
                continue
            }
            const key = matched[1].trim()
            const value = matched[2].trim()
            if (key.length > 0 && value.length > 0 && !values.has(key)) {
                values.set(key, value)
            }
        }
    }
    return values
}

/** 提取正文段落：跳过标题、引用、列表与表格行，段内换行合并 */
function readParagraphs(text: string): string[] {
    return text
        .split(/\n\s*\n/)
        .map((paragraph) => paragraph.trim())
        .filter(
            (paragraph) =>
                paragraph.length > 0 &&
                !paragraph.startsWith('#') &&
                !paragraph.startsWith('>') &&
                !paragraph.startsWith('|') &&
                !/^[-*]\s+/u.test(paragraph),
        )
        .map((paragraph) => paragraph.replace(/\s*\n\s*/g, ''))
}

/** 首个正文段落：作为简介、主线等字段的兜底 */
function readFirstParagraph(text: string): string {
    return readParagraphs(text)[0] ?? ''
}

/**
 * 区块文本合并：用于「组织势力」「写作约束」这类自由书写区块。
 * 优先取自然段落；只有列表项时（如逐条列势力）退化为列表文本，避免整段丢失。
 * limit 供世界观总述这类多句字段放宽截断长度。
 */
function readSectionText(
    sections: DocumentSection[],
    titles: readonly string[],
    limit = FALLBACK_TEXT_LIMIT,
): string {
    const target = sections.find((section) => titles.some((title) => section.title.includes(title)))
    if (target === undefined) {
        return ''
    }
    const paragraphs = readParagraphs(target.content)
    const text =
        paragraphs.length > 0
            ? paragraphs.join('；')
            : target.content
                  .split(/\r?\n/)
                  .map((line) => line.trim())
                  .filter((line) => line.length > 0 && !line.startsWith('#') && !line.startsWith('>'))
                  .map((line) => line.replace(/^[-*]\s+/u, ''))
                  .join('；')
    return text.length > limit ? `${text.slice(0, limit)}…` : text
}

/**
 * 体型标签到枚举：文档里存中文标签，手写时也可能出现「偏瘦」「微胖」这类近义写法，
 * 一并收进来做归一；都认不出时按「匀称」处理，避免人物卡因为一个词变成未定义。
 */
const BODY_TYPE_LABELS: Readonly<Record<string, CharacterBodyType>> = {
    petite: 'petite',
    娇小: 'petite',
    小巧: 'petite',
    lean: 'lean',
    清瘦: 'lean',
    偏瘦: 'lean',
    瘦削: 'lean',
    slim: 'slim',
    纤细: 'slim',
    苗条: 'slim',
    tall: 'tall',
    修长: 'tall',
    高挑: 'tall',
    average: 'average',
    匀称: 'average',
    中等: 'average',
    正常: 'average',
    athletic: 'athletic',
    健壮: 'athletic',
    健硕: 'athletic',
    强壮: 'athletic',
    burly: 'burly',
    魁梧: 'burly',
    壮硕: 'burly',
    round: 'round',
    圆润: 'round',
    丰满: 'round',
    plump: 'plump',
    丰腴: 'plump',
    微胖: 'plump',
    heavy: 'heavy',
    肥胖: 'heavy',
    臃肿: 'heavy',
}

/** 读取体型：未填写或写法未收录都回落「匀称」 */
function toBodyType(value: string | undefined): CharacterBodyType {
    return BODY_TYPE_LABELS[readLabel(value, 'average')] ?? 'average'
}

/** 画风中文标签反查：文档是给人读的，用户手改成「古风」时也要能认出来 */
const PORTRAIT_STYLE_LABELS: Readonly<Record<string, PortraitStyle>> = {
    智能匹配: 'auto',
    日漫: 'anime',
    古风: 'guofeng',
    写实: 'realistic',
    电影: 'cinematic',
    摄影: 'photo',
    像素风: 'pixel',
    游戏原画: 'gameart',
}

/** 读取画风：先认白名单 key，再认中文标签，其余回落默认风格 */
function toPortraitStyle(value: string | undefined): PortraitStyle {
    const label = value?.trim() ?? ''
    const fromKey = PORTRAIT_STYLES.find((item) => item === label)
    return fromKey ?? PORTRAIT_STYLE_LABELS[label] ?? DEFAULT_PORTRAIT_STYLE
}

/** 读取中英混写标签的首段标识：如「protagonist（主角）」取 protagonist */
function readLabel(value: string | undefined, fallback: string): string {
    if (value === undefined) {
        return fallback
    }
    const label = value.split(/[（(]/u)[0]?.trim() ?? ''
    return label.length > 0 ? label : fallback
}

/** 读取数值区间：如「2197 / 4000」返回 [2197, 4000]，单个数值返回 [值, null] */
function readRange(value: string | undefined): [number | null, number | null] {
    if (value === undefined) {
        return [null, null]
    }
    const parts = value.split('/')
    return [toNumber(parts[0]), parts.length > 1 ? toNumber(parts[1]) : null]
}

/** 解析节拍：支持「① 文本 ② 文本」与「[x] / [ ]」勾选标记 */
function parseBeats(value: string | undefined, chapterKey: string): OutlineBeat[] {
    if (value === undefined || value.length === 0) {
        return []
    }
    return value
        .split(/[①②③④⑤⑥⑦⑧⑨⑩]/u)
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .map((part, index) => ({
            id: `beat-${chapterKey}-${String(index + 1)}`,
            text: part.replace(/^\[[\s xX]?\]\s*/u, '').trim(),
            isDone: /^\[[xX]\]/u.test(part),
        }))
}

/** 解析作品设定：README 提供作品级信息，设定.md 提供世界观与写作约束，README 的同名字段优先 */
function parseSetting(readme: string, settingDoc: string, outlineDoc: string, fallbackTitle: string): ProjectSetting {
    const { frontmatter, body: readmeBody } = splitFrontmatter(readme)
    const readmeValues = readKeyValues(readmeBody)
    const settingValues = readKeyValues(settingDoc)
    const sections = splitSections(settingDoc, 2)
    const readmeSections = splitSections(readmeBody, 2)
    // 作品级字段只从 README 与设定.md 取：大纲里的键值属于章纲，取来会串成单章内容
    const readValue = (keys: readonly string[]): string | undefined => {
        for (const key of keys) {
            const value = readmeValues.get(key) ?? settingValues.get(key)
            if (value !== undefined) {
                return value
            }
        }
        return undefined
    }
    const synopsisSections = readmeSections.filter((section) => section.title.includes('简介'))
    const synopsisParagraphs = synopsisSections.flatMap((section) => readParagraphs(section.content))
    const outlineMain = splitSections(outlineDoc, 2).find((section) => section.title.includes('主线'))
    const audienceText = readFrontmatterValue(frontmatter, 'audience') ?? ''
    const endingText = readValue(['结局倾向', '结局']) ?? ''
    const wordGoal = toNumber(readFrontmatterValue(frontmatter, 'wordGoal')) ?? 0
    return {
        title: readFrontmatterValue(frontmatter, 'title') ?? fallbackTitle,
        penName: readValue(['笔名']) ?? '',
        audience: AUDIENCE_LABELS.find((item) => item === audienceText) ?? '男频',
        genres: toList(readFrontmatterValue(frontmatter, 'tags') ?? readValue(['题材'])),
        wordGoal,
        logline: readValue(['一句话简介', '简介', '梗概']) ?? synopsisParagraphs[0] ?? readFirstParagraph(outlineMain?.content ?? ''),
        conflict: readValue(['核心冲突', '冲突']) ?? synopsisParagraphs[1] ?? '',
        ending: ENDING_LABELS.find((item) => endingText.includes(item)) ?? '开放',
        // 世界观总述与力量体系都曾回落到「## 世界观」段落：两者取同一段会让字段互相覆盖，
        // 现在各认专属键名与专属段落，段落缺失才退化为空，由作者或提取环节补齐
        worldview:
            readValue(['世界观总述', '世界设定', '世界观']) ?? readSectionText(sections, ['世界观'], LONG_TEXT_LIMIT),
        geography: readValue(['地理', '地域', '地理格局']) ?? readSectionText(sections, ['地理', '地域']),
        era: readValue(['时代', '年代']) ?? '',
        factions: readValue(['势力', '组织势力']) ?? readSectionText(sections, ['组织势力']),
        powerSystem: readValue(['力量体系', '修炼体系']) ?? readSectionText(sections, ['修炼体系']),
        concepts:
            readValue(['核心概念', '独有名词', '概念']) ?? readSectionText(sections, ['核心概念'], LONG_TEXT_LIMIT),
        taboo: readValue(['禁忌']) ?? readSectionText(sections, ['写作约束']),
        goldenFingerType: readValue(['金手指类型', '类型']) ?? '',
        goldenFingerAbility: readValue(['金手指能力', '能力']) ?? '',
        goldenFingerCost: readValue(['金手指代价', '代价']) ?? '',
        perspective: readValue(['视角', '叙述视角']) ?? '',
        tone: readValue(['语调', '基调', '文风']) ?? '',
        references: readValue(['参考', '参考资料']) ?? '',
        banned: toList(readValue(['禁写项', '禁写', '禁写内容'])),
    }
}

/**
 * 由角色名生成人物标识：对名称做确定性散列并映射到 8 位数字区间。
 * 关键约束：同一姓名每次解析必须得到同一标识（角色卡文件名不会漂移），且取值落在宿主白名单内；
 * 旧文档里的 char- 前缀标识不再识别，缺少合法标识时按姓名散列取号。
 */
function buildCharacterId(name: string): string {
    let hash = 0
    for (const char of name) {
        hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 90_000_000
    }
    return String(10_000_000 + hash)
}

/**
 * 解析人物卡：每个「# 角色名」一块，块内键值行按字段映射，缺省值取类型默认。
 * 关键约束：`- id：` 只有本身符合宿主白名单才沿用（否则生成设定图会被拒绝），
 * 同名角色按出现顺序追加序号，避免角色卡目录互相覆盖。
 */
function parseCharacters(text: string): CharacterCard[] {
    const cards: CharacterCard[] = []
    const usedIds = new Set<string>()
    for (const section of splitSections(text, 1)) {
        if (section.title === '角色设定' || section.title === '角色索引') {
            continue
        }
        const values = readKeyValues(section.content)
        const name = values.get('姓名') ?? section.title
        if (name.length === 0) {
            continue
        }
        const rawId = values.get('id')
        const baseId = rawId !== undefined && isPressCharacterId(rawId) ? rawId : buildCharacterId(name)
        let id = baseId
        let salt = 1
        while (usedIds.has(id) && salt <= 100) {
            // 重名角色换个散列盐重新取号，保持 8 位数字形态——拼后缀会破坏标识规范
            id = buildCharacterId(`${name}#${String(salt)}`)
            salt += 1
        }
        usedIds.add(id)
        const roleLabel = readLabel(values.get('分类'), 'supporting')
        const genderLabel = readLabel(values.get('性别'), 'male')
        const coverId = values.get('封面') ?? ''
        cards.push({
            id,
            name,
            alias: values.get('别名') ?? '',
            role: ROLE_LABELS[roleLabel] ?? 'supporting',
            gender: GENDER_LABELS[genderLabel] ?? 'male',
            age: values.get('年龄') ?? '',
            height: values.get('身高') ?? '',
            bodyType: toBodyType(values.get('体型')),
            identity: values.get('身份') ?? '',
            appearance: values.get('外貌') ?? '',
            traits: toList(values.get('特质') ?? values.get('性格')),
            background: values.get('背景') ?? values.get('背景故事') ?? '',
            desire: values.get('欲望') ?? '',
            weakness: values.get('弱点') ?? '',
            catchphrase: values.get('口头禅') ?? '',
            ability: values.get('能力') ?? '',
            arc: values.get('弧线') ?? '',
            relation: values.get('关系') ?? '',
            portraits: [],
            // 封面只存图片 id：图片本体在 Images 下，URL 由宿主按会话签发，不能写进文档
            // 封面只认角色图标识：新旧两种 portrait 命名都合法，photo 与手工图一律清空
            coverPortraitId: parseImageKind(coverId) === 'portrait' ? coverId : null,
            portraitStyle: toPortraitStyle(values.get('画风')),
        })
    }
    return cards
}

/** 解析单章：标题、键值行与节拍共同决定章纲字段，缺失项按默认值补齐 */
function parseChapter(
    title: string,
    content: string,
    volumeOrder: number,
    fallbackOrder: number,
    characterIds: Map<string, string>,
): OutlineChapter {
    const values = readKeyValues(content)
    const headingOrder = toNumber(/第\s*(\d+)\s*章/u.exec(title)?.[1])
    const order = headingOrder ?? toNumber(values.get('序号')) ?? fallbackOrder
    const chapterKey = `${String(volumeOrder)}-${String(order)}`
    const [written, goal] = readRange(values.get('字数'))
    const statusLabel = readLabel(values.get('状态'), 'planned')
    const hookLabel = readLabel(values.get('钩子'), 'none')
    const characterNames = toList(values.get('人物') ?? values.get('出场人物'))
    const tension = toNumber(values.get('张力')) ?? MIN_TENSION
    const id = values.get('id') ?? `ch-${chapterKey}`
    return {
        id,
        order,
        title: title.replace(/^第\s*\d+\s*章\s*/u, '').trim() || title,
        summary: values.get('梗概') ?? values.get('本章介绍') ?? readFirstParagraph(content),
        status: STATUS_LABELS[statusLabel] ?? 'planned',
        beats: parseBeats(values.get('节拍'), chapterKey),
        characterIds: characterNames
            .map((name) => characterIds.get(name))
            .filter((characterId): characterId is string => characterId !== undefined),
        location: values.get('地点') ?? '',
        wordGoal: goal ?? toNumber(values.get('目标字数')) ?? DEFAULT_CHAPTER_WORD_GOAL,
        wordCount: written ?? toNumber(values.get('已写')) ?? 0,
        hook: HOOK_LABELS[hookLabel] ?? 'none',
        tension: Math.min(MAX_TENSION, Math.max(MIN_TENSION, tension)),
    }
}

/** 判断区块标题是否为卷：认「第N卷」「卷N」「X卷」等写法 */
function isVolumeTitle(title: string): boolean {
    return /(第\s*[0-9一二三四五六七八九十百]+\s*卷|^卷\s*[0-9一二三四五六七八九十]|[0-9一二三四五六七八九十]+\s*卷)/u.test(title)
}

/** 解析卷内章节：优先认四级标题，其次三级标题，保证自由书写的层级也能读到 */
function parseVolumeChapters(
    content: string,
    volumeOrder: number,
    characterIds: Map<string, string>,
): OutlineChapter[] {
    const levelFour = splitSections(content, 4)
    const sections = levelFour.length > 0 ? levelFour : splitSections(content, 3)
    return sections
        .filter((section) => section.title.trim().length > 0)
        .map((section, index) =>
            parseChapter(section.title, section.content, volumeOrder, index + 1, characterIds),
        )
}

/** 解析大纲：卷标题缺失时把全部章节收进单卷，章标题缺失时返回空卷列表 */
function parseVolumes(text: string, characterIds: Map<string, string>): OutlineVolume[] {
    const candidates = [...splitSections(text, 3), ...splitSections(text, 2)]
    const volumeSections = candidates.filter((section) => isVolumeTitle(section.title))
    if (volumeSections.length === 0) {
        const chapters = parseVolumeChapters(text, 1, characterIds)
        return chapters.length === 0
            ? []
            : [{ id: 'vol-1', name: '第1卷', goal: '', conflict: '', plotline: '', turningPoints: [], chapters }]
    }
    return volumeSections.map((section, index) => {
        const order = toNumber(/第\s*(\d+)\s*卷/u.exec(section.title)?.[1]) ?? index + 1
        const values = readKeyValues(section.content)
        return {
            id: `vol-${String(order)}`,
            name: section.title.trim(),
            goal: values.get('卷目标') ?? values.get('目标') ?? '',
            conflict: values.get('卷冲突') ?? values.get('冲突') ?? '',
            plotline: values.get('情节脉络') ?? values.get('情节线') ?? '',
            turningPoints: toList(values.get('关键转折') ?? values.get('转折')),
            chapters: parseVolumeChapters(section.content, order, characterIds),
        }
    })
}

/** 角色名到 id 的映射：章纲里的出场人物按名称回填成 id */
function buildCharacterIndex(characters: CharacterCard[]): Map<string, string> {
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
 * 解析整部作品：四份文档原文进来，一份可直接渲染的工作区出去。
 * 关键约束：任何单份文档为空都继续解析其余文档，保证缺文件时页面仍能显示已有内容。
 */
export function parseProjectWorkspace(files: {
    readme: string
    setting: string
    characters: string
    outline: string
}, fallbackTitle: string): ParsedWorkspace {
    const characters = parseCharacters(files.characters)
    return {
        setting: parseSetting(files.readme, files.setting, files.outline, fallbackTitle),
        characters,
        volumes: parseVolumes(files.outline, buildCharacterIndex(characters)),
    }
}
