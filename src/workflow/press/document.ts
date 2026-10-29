/**
 * 作品文档解析：把 README.md、世界观.md、金手指.md、势力.md、地点.md、物品.md、
 * 设定.md、角色设定.md、大纲.md 的原文解析成工作台的 OutlineWorkspace。
 * 复用约定：字段语义与 types.ts 一致；基本信息取自 README 的 Frontmatter 与「作品设定」段，
 * 世界观与金手指各取自己的文档（旧的 设定.md 仅在这两份缺失时兜底），
 * 角色按「# 角色名」切块，资料条目按「## 名称」切块，大纲按「卷 → 章 → 键值行」切块，
 * 优先认 `- 键：值` 行，缺失时回落到区块段落文本。
 * 关键约束：解析必须容错——文件缺失、区块改名、字段写法变化都只让对应字段为空，绝不抛错；
 * 章纲的 summary 表示计划、wordCount 表示已写事实，两者不互相推导；未识别的名称不进入 characterIds，
 * 避免正文引用到不存在的人物卡；条目描述取块内自然段落，键值行不参与描述。
 */
import { isMediaId } from '@shared/types/media'
import { DEFAULT_PORTRAIT_STYLE, PORTRAIT_STYLES, isPressCharacterId, isPressLoreId } from '@shared/types/press'
import type { PortraitStyle, PressSettingSectionFiles, PressWorkspaceFiles } from '@shared/types/press'
import { PERIOD_OPTIONS, PLACE_OPTIONS } from './setting/settingOptions'
import type {
    Audience,
    CharacterBodyType,
    CharacterCard,
    CharacterGender,
    CharacterRole,
    EndingKind,
    HookKind,
    LoreEntry,
    LoreKind,
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
    lore: LoreEntry[]
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
const ENDING_LABELS: readonly EndingKind[] = ['HE', 'BE', '开放', '真相', '喜忧参半']

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

/** 在键值表里按候选键取首个命中值：键名允许新旧并存，先出现的候选优先 */
function readFirst(values: ReadonlyMap<string, string>, keys: readonly string[]): string | undefined {
    for (const key of keys) {
        const value = values.get(key)
        if (value !== undefined) {
            return value
        }
    }
    return undefined
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
function readSectionText(sections: DocumentSection[], titles: readonly string[], limit = FALLBACK_TEXT_LIMIT): string {
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

/** 基本信息段落在 README 中的标题：该段存在时基本信息只认这一段，清空才能生效 */
const BASIC_SECTION_TITLE = '作品设定'

/** 分组文档中工作台写入的段落标题：段落存在即「这一组已由工作台维护」，不再回落旧 设定.md */
const SETTING_SECTION_TITLE = '提取设定'

/**
 * 解析作品设定：基本信息取自 README（Frontmatter + 「作品设定」段），
 * 世界观与金手指各取自自己的文档，旧的 设定.md 只在对应分组文档缺失时兜底。
 * 关键约束：分组文档存在时独占该分组字段——只在文档缺失时才回落旧文档，
 * 否则用户清空的字段会被旧值重新填回来。
 */
function parseSetting(
    readme: string,
    settingDoc: string,
    outlineDoc: string,
    settingSections: PressSettingSectionFiles,
    fallbackTitle: string,
): ProjectSetting {
    const { frontmatter, body: readmeBody } = splitFrontmatter(readme)
    const readmeValues = readKeyValues(readmeBody)
    const legacyValues = readKeyValues(settingDoc)
    const worldValues = readKeyValues(settingSections.world)
    const powerValues = readKeyValues(settingSections.power)
    const readmeSections = splitSections(readmeBody, 2)
    const legacySections = splitSections(settingDoc, 2)
    const basicSection = readmeSections.find((section) => section.title.includes(BASIC_SECTION_TITLE))
    const basicValues = basicSection === undefined ? null : readKeyValues(basicSection.content)
    // 「提取设定」段落存在才算工作台写过这一组：新建/导入作品的分组文档只有一级标题，
    // 此时必须继续从旧 设定.md 读，否则导入的世界观与金手指会在页面上凭空消失
    const sectionMark = `## ${SETTING_SECTION_TITLE}`
    const hasWorldDoc = settingSections.world.includes(sectionMark)
    const hasPowerDoc = settingSections.power.includes(sectionMark)
    /** 基本信息：有「作品设定」段时只认该段，否则先 README 键值、再回落旧 设定.md */
    const readBasicValue = (keys: readonly string[]): string | undefined => {
        if (basicValues !== null) {
            return readFirst(basicValues, keys)
        }
        return readFirst(readmeValues, keys) ?? readFirst(legacyValues, keys)
    }
    /** 世界观：专属文档存在时独占，缺失时回落旧 设定.md */
    const readWorldValue = (keys: readonly string[]): string | undefined =>
        readFirst(hasWorldDoc ? worldValues : legacyValues, keys)
    /** 金手指：专属文档存在时独占，缺失时回落旧 设定.md */
    const readPowerValue = (keys: readonly string[]): string | undefined =>
        readFirst(hasPowerDoc ? powerValues : legacyValues, keys)
    /** 旧 设定.md 的段落兜底：分组文档存在时不再读段落，避免同一字段出现两份口径 */
    const readLegacySection = (titles: readonly string[], limit?: number): string =>
        hasWorldDoc ? '' : readSectionText(legacySections, titles, limit)
    const synopsisSections = readmeSections.filter((section) => section.title.includes('简介'))
    const synopsisParagraphs = synopsisSections.flatMap((section) => readParagraphs(section.content))
    const outlineMain = splitSections(outlineDoc, 2).find((section) => section.title.includes('主线'))
    const audienceText = readFrontmatterValue(frontmatter, 'audience') ?? ''
    const endingText = readBasicValue(['结局倾向', '结局']) ?? ''
    const wordGoal = toNumber(readFrontmatterValue(frontmatter, 'wordGoal')) ?? 0
    // 篇幅走 README Frontmatter，其余新增档位字段只认基本信息的键值行
    const chapterWordGoal = toNumber(readBasicValue(['章节字数', '单章字数'])) ?? DEFAULT_CHAPTER_WORD_GOAL
    const periodText = readBasicValue(['时间', '故事时间']) ?? ''
    const placeText = readBasicValue(['地点', '故事地点']) ?? ''
    // 「双线交替」属于结构维度，旧文档却把它写在视角里：读到后搬到叙事结构，视角回落默认
    const perspectiveText = readBasicValue(['视角', '叙述视角']) ?? ''
    const structureText = readBasicValue(['叙事结构']) ?? ''
    const isLegacyDual = structureText.length === 0 && perspectiveText.includes('双线交替')
    const perspective = perspectiveText.length > 0 && !isLegacyDual ? perspectiveText : '第三人称'
    let narrative = structureText.length > 0 ? structureText : '单线顺叙'
    if (isLegacyDual) {
        narrative = '双线交替'
    }
    return {
        title: readFrontmatterValue(frontmatter, 'title') ?? fallbackTitle,
        penName: readBasicValue(['笔名']) ?? '',
        audience: AUDIENCE_LABELS.find((item) => item === audienceText) ?? '男频',
        genres: toList(readFrontmatterValue(frontmatter, 'tags') ?? readBasicValue(['题材'])),
        wordGoal,
        chapterWordGoal,
        // 简介单独认「作品简介」键：logline 的「简介」是旧文档别名，两者共用会互相覆盖
        summary: readBasicValue(['作品简介']) ?? '',
        // 基本信息段落存在时独占：段落里没有一句话简介就按空处理，不再从简介段落猜
        logline:
            readBasicValue(['一句话简介', '简介', '梗概']) ??
            (basicValues === null ? (synopsisParagraphs[0] ?? readFirstParagraph(outlineMain?.content ?? '')) : ''),
        opening: readBasicValue(['开篇灵感', '开场灵感']) ?? '',
        extra: readBasicValue(['补充信息', '补充说明']) ?? '',
        conflict: readBasicValue(['核心冲突', '冲突']) ?? (basicValues === null ? (synopsisParagraphs[1] ?? '') : ''),
        ending: ENDING_LABELS.find((item) => endingText.includes(item)) ?? '开放',
        period: PERIOD_OPTIONS.find((item) => periodText.includes(item)) ?? '现代',
        place: PLACE_OPTIONS.find((item) => placeText.includes(item)) ?? '中国',
        // 世界观总述与力量体系都曾回落到「## 世界观」段落：两者取同一段会让字段互相覆盖，
        // 现在各认专属键名与专属段落，段落缺失才退化为空，由作者或提取环节补齐
        worldview:
            readWorldValue(['世界观总述', '世界设定', '世界观']) ?? readLegacySection(['世界观'], LONG_TEXT_LIMIT),
        geography: readWorldValue(['地理', '地域', '地理格局']) ?? readLegacySection(['地理', '地域']),
        era: readWorldValue(['时代', '年代']) ?? '',
        factions: readWorldValue(['势力', '组织势力']) ?? readLegacySection(['组织势力']),
        powerSystem: readWorldValue(['力量体系', '修炼体系']) ?? readLegacySection(['修炼体系']),
        concepts: readWorldValue(['核心概念', '独有名词', '概念']) ?? readLegacySection(['核心概念'], LONG_TEXT_LIMIT),
        taboo: readWorldValue(['禁忌']) ?? readLegacySection(['写作约束']),
        goldenFingerType: readPowerValue(['金手指类型', '类型']) ?? '',
        goldenFingerAbility: readPowerValue(['金手指能力', '能力']) ?? '',
        goldenFingerCost: readPowerValue(['金手指代价', '代价']) ?? '',
        perspective,
        narrative,
        tone: readBasicValue(['语调', '基调', '文风']) ?? '',
        references: readBasicValue(['参考', '参考资料']) ?? '',
        banned: toList(readBasicValue(['禁写项', '禁写', '禁写内容'])),
    }
}

/**
 * 由名称生成稳定标识：对名称做确定性散列并映射到 8 位数字区间，人物与资料条目共用。
 * 关键约束：同一名称每次解析必须得到同一标识（角色卡与设定图文件名不会漂移），且取值落在宿主白名单内；
 * 旧文档里的 char- 前缀标识不再识别，缺少合法标识时按名称散列取号。
 */
function buildStableId(name: string): string {
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
        const baseId = rawId !== undefined && isPressCharacterId(rawId) ? rawId : buildStableId(name)
        let id = baseId
        let salt = 1
        while (usedIds.has(id) && salt <= 100) {
            // 重名角色换个散列盐重新取号，保持 8 位数字形态——拼后缀会破坏标识规范
            id = buildStableId(`${name}#${String(salt)}`)
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
            appearanceTags: toList(values.get('外貌标签')),
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
            // 封面只存媒体 id：图片本体在 images/ 下，URL 由宿主按会话签发，不能写进文档；
            // 出处类别由媒体索引判定，文档侧只校验格式，非媒体 id（历史命名或手改值）一律清空
            coverPortraitId: isMediaId(coverId) ? coverId : null,
            portraitStyle: toPortraitStyle(values.get('画风')),
        })
    }
    return cards
}

/** 行首键值行：与 serialize 的写法一致，解析描述前先剔除，避免元信息混进正文 */
const KEY_VALUE_LINE_PATTERN = /^\s*[-*]\s+[^：:]{1,16}[：:]/u

/**
 * 解析条目文档：`## 名称` 一块即一个条目，块内 `- 键：值` 提取标识、关联人物与封面，
 * 其余自然段落合并为描述。
 * 关键约束：`- id：` 只有符合宿主白名单才沿用，否则按名称散列取号；
 * 关联人物只认已存在的人物姓名，解析不到的名字直接丢弃，不在条目里留下悬空引用；
 * 封面只校验媒体 id 格式，换分类或手工改成别的值都会回到「未设置」。
 */
function parseLoreEntries(text: string, kind: LoreKind, characterIndex: Map<string, string>): LoreEntry[] {
    const entries: LoreEntry[] = []
    const usedIds = new Set<string>()
    for (const section of splitSections(text, 2)) {
        const name = section.title.trim()
        if (name.length === 0) {
            continue
        }
        const values = readKeyValues(section.content)
        const rawId = values.get('id')
        let id = rawId !== undefined && isPressLoreId(rawId) ? rawId : buildStableId(name)
        let salt = 1
        while (usedIds.has(id) && salt <= 100) {
            // 重名条目换个散列盐重新取号，与人物卡同一口径——拼后缀会破坏标识规范
            id = buildStableId(`${name}#${String(salt)}`)
            salt += 1
        }
        usedIds.add(id)
        const body = section.content
            .split(/\r?\n/u)
            .filter((line) => !KEY_VALUE_LINE_PATTERN.test(line))
            .join('\n')
        const coverId = values.get('封面') ?? ''
        entries.push({
            id,
            kind,
            name,
            description: readParagraphs(body).join('\n\n'),
            memberIds: toList(values.get('人物'))
                .map((member) => characterIndex.get(member))
                .filter((memberId): memberId is string => memberId !== undefined),
            coverImageId: isMediaId(coverId) ? coverId : null,
        })
    }
    return entries
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
    return /(第\s*[0-9一二三四五六七八九十百]+\s*卷|^卷\s*[0-9一二三四五六七八九十]|[0-9一二三四五六七八九十]+\s*卷)/u.test(
        title,
    )
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
        .map((section, index) => parseChapter(section.title, section.content, volumeOrder, index + 1, characterIds))
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
 * 解析整部作品：四份主文档与设定页的两份分组文档原文进来，一份可直接渲染的工作区出去。
 * 关键约束：任何单份文档为空都继续解析其余文档，保证缺文件时页面仍能显示已有内容；
 * 设定分组文档只服务设定页，缺失时世界观与金手指回落到旧的 设定.md。
 */
export function parseProjectWorkspace(
    files: PressWorkspaceFiles,
    settingSections: PressSettingSectionFiles,
    fallbackTitle: string,
): ParsedWorkspace {
    const characters = parseCharacters(files.characters)
    const characterIndex = buildCharacterIndex(characters)
    return {
        setting: parseSetting(files.readme, files.setting, files.outline, settingSections, fallbackTitle),
        characters,
        // 三份条目文档各按自己的分类解析，顺序固定为势力 → 地点 → 物品
        lore: [
            ...parseLoreEntries(settingSections.faction, 'faction', characterIndex),
            ...parseLoreEntries(settingSections.place, 'place', characterIndex),
            ...parseLoreEntries(settingSections.item, 'item', characterIndex),
        ],
        volumes: parseVolumes(files.outline, characterIndex),
    }
}
