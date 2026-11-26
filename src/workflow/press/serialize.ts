/**
 * 工作台草稿转可回写段落片段，格式与 document.ts 的解析口径严格对齐。
 * 复用约定：中文标签取 constants 元数据表；大纲分结构纲 / 卷纲 / 章节内容 / 伏笔线索四段。
 * 关键约束：只产出段落片段、落点由宿主 writer 决定；段内只能用三级及更深标题；
 * 键名改动须同步 document.ts 读取键，否则回写后内容凭空丢失。
 */
import type { PressApplyBlock, PressApplyMeta } from '@shared/types/press'
import {
    ACT_KIND_META,
    CHARACTER_BODY_TYPE_META,
    CHARACTER_GENDER_META,
    CHARACTER_ROLE_META,
    CLUE_KIND_META,
    CLUE_STATUS_META,
    HOOK_OPTIONS,
    PACING_META,
} from './constants'
import { sceneTitleLabel, stripChapterOrderPrefix, stripVolumeOrderPrefix } from './utils'
import type {
    CharacterCard,
    LoreEntry,
    LoreKind,
    OutlineChapter,
    OutlineChapterRef,
    OutlineClue,
    OutlinePlan,
    OutlineScene,
    OutlineSectionKey,
    OutlineVolume,
    ProjectSetting,
} from './types'

/**
 * 字段正文折成单行：字段值写在标题下，正文里出现换行会被解析端当成新段落甚至新标题。
 * 条目描述走的是正文段而非字段，保留多段，不经过这里。
 */
function toSingleLine(value: string): string {
    return value.replace(/\s*\r?\n\s*/gu, ' ').trim()
}

/**
 * 单个设定字段：`### 标题` + 正文行。
 * 关键约束：标题固定三级——「作品设定」「提取设定」等段落以二级标题起头，
 * 段内出现二级标题会被 writer 当成段落终点，后半段直接被截掉。
 */
function buildField(title: string, value: string): string {
    return `### ${title}\n\n${toSingleLine(value)}`
}

/** 字段组：空值不写标题，作者清空某字段后它的标题随之从文档里消失 */
function buildFields(pairs: readonly (readonly [string, string])[]): string {
    return pairs
        .map(([title, value]) => [title, toSingleLine(value)] as const)
        .filter(([, value]) => value.length > 0)
        .map(([title, value]) => buildField(title, value))
        .join('\n\n')
}

/** 基本信息段落正文：标题即字段名，顺序跟随表单，便于人工阅读与 diff */
export function serializeBasicSection(setting: ProjectSetting): string {
    return buildFields([
        ['笔名', setting.penName],
        ['章节字数', String(setting.chapterWordGoal)],
        ['时间', setting.period],
        ['地点', setting.place],
        ['结局', setting.ending],
        ['视角', setting.perspective],
        ['叙事结构', setting.narrative],
        ['语调', setting.tone],
        ['参考', setting.references],
        ['禁写项', setting.banned.join('、')],
        ['作品简介', setting.summary],
        ['一句话简介', setting.logline],
        ['开篇灵感', setting.opening],
        ['核心冲突', setting.conflict],
        ['主题', setting.theme],
        ['主角弧光', setting.arc],
        ['补充信息', setting.extra],
    ])
}

/** 世界观段落正文：标题与 document.ts 的读取键一一对应 */
export function serializeWorldSection(setting: ProjectSetting): string {
    return buildFields([
        ['世界观总述', setting.worldview],
        ['地理', setting.geography],
        ['时代', setting.era],
        ['势力', setting.factions],
        ['力量体系', setting.powerSystem],
        ['核心概念', setting.concepts],
        ['禁忌', setting.taboo],
    ])
}

/** 金手指段落正文：标题与 document.ts 的读取键一一对应，抬头「# 金手指」已限定语境故省去前缀 */
export function serializeGoldenFingerSection(setting: ProjectSetting): string {
    return buildFields([
        ['类型', setting.goldenFingerType],
        ['能力', setting.goldenFingerAbility],
        ['代价', setting.goldenFingerCost],
        ['限制', setting.goldenFingerLimit],
        ['升级体系', setting.goldenFingerUpgrade],
    ])
}

/** README 的四个元信息字段：由 writer 写进一级标题与「作品设定」段 */
export function serializeReadmeMeta(setting: ProjectSetting): PressApplyMeta {
    return {
        // 作品名用 textarea 编辑，写入一级标题时必须是单行
        title: toSingleLine(setting.title),
        audience: setting.audience,
        genres: setting.genres,
        wordGoal: setting.wordGoal,
    }
}

/** 角色卡字段组：三级标题分组，组内每个字段一个四级标题 */
interface CharacterFieldGroup {
    title: string
    fields: readonly (readonly [string, string])[]
}

/**
 * 角色卡正文：`## 角色名` 起块，三级标题分组、四级标题承载字段。
 * 关键约束：块标题必须是二级——角色文档的一级标题留给文件抬头，writer 按一/二级边界切块；
 * 空字段不写标题，因此清空某字段等于让它的标题消失；
 * 封面为空表示未设置，同样不写，避免把空串读成「有封面但无效」。
 */
function buildCharacterBlock(character: CharacterCard): string {
    const groups: readonly CharacterFieldGroup[] = [
        {
            title: '身份档案',
            fields: [
                ['id', character.id],
                ['姓名', character.name],
                ['别名', character.alias],
                ['分类', CHARACTER_ROLE_META[character.role].label],
                ['性别', CHARACTER_GENDER_META[character.gender].label],
                ['年龄', character.age],
                ['身高', character.height],
                ['体型', CHARACTER_BODY_TYPE_META[character.bodyType].label],
                ['身份', character.identity],
            ],
        },
        {
            title: '外貌形象',
            fields: [
                ['外貌标签', character.appearanceTags.join('、')],
                ['外貌', character.appearance],
                ['画风', character.portraitStyle],
                ['封面', character.coverPortraitId ?? ''],
            ],
        },
        {
            title: '性格与能力',
            fields: [
                ['特质', character.traits.join('、')],
                ['口头禅', character.catchphrase],
                ['能力', character.ability],
            ],
        },
        {
            title: '背景与关系',
            fields: [
                ['背景', character.background],
                ['欲望', character.desire],
                ['弱点', character.weakness],
                ['弧线', character.arc],
                ['关系', character.relation],
            ],
        },
    ]
    const body = groups
        .map((group) => {
            const fields = group.fields
                .map(([title, value]) => [title, toSingleLine(value)] as const)
                .filter(([, value]) => value.length > 0)
                .map(([title, value]) => `#### ${title}\n\n${value}`)
                .join('\n\n')
            return fields.length === 0 ? '' : `### ${group.title}\n\n${fields}`
        })
        .filter((text) => text.length > 0)
        .join('\n\n')
    return body.length > 0 ? `## ${character.name}\n\n${body}` : `## ${character.name}`
}

/** 角色块列表：name 作为宿主侧的匹配键，text 是包含「## 名称」标题行的完整块 */
export function serializeCharacterBlocks(characters: CharacterCard[]): { name: string; text: string }[] {
    return characters.map((character) => ({ name: character.name, text: buildCharacterBlock(character) }))
}

/**
 * 单个条目块：二级标题起条，标识与关联写三级标题下的单行，描述作为三级标题下的正文段。
 * 关键约束：id 必须落盘（设定图与媒体引用靠它区分归属），关联人物写姓名而不是 id，文档可读也能手改；
 * 描述可以多段——它不在字典型字段里，换行不会破坏结构。
 */
function buildLoreBlock(entry: LoreEntry, nameById: ReadonlyMap<string, string>): string {
    const sections = [`### id\n\n${entry.id}`]
    if (entry.kind === 'faction') {
        const memberNames = entry.memberIds
            .map((id) => nameById.get(id))
            .filter((name): name is string => name !== undefined)
        if (memberNames.length > 0) {
            sections.push(`### 关联人物\n\n${memberNames.join('、')}`)
        }
    }
    // 封面只存图片标识：图片本体在 Images 下，URL 由宿主按会话签发，不能写进文档
    if (entry.coverImageId !== null) {
        sections.push(`### 封面\n\n${entry.coverImageId}`)
    }
    const description = entry.description.trim()
    if (description.length > 0) {
        sections.push(`### 描述\n\n${description}`)
    }
    return `## ${entry.name}\n\n${sections.join('\n\n')}`
}

/**
 * 条目块按分类分组：每类对应一份文档，调用方按分类发起各自的分段保存。
 * name 作为宿主侧的匹配键，text 是含「## 名称」标题行的完整块。
 */
export function serializeLoreBlocks(
    entries: readonly LoreEntry[],
    characters: readonly CharacterCard[],
): Record<LoreKind, PressApplyBlock[]> {
    const nameById = new Map(characters.map((character) => [character.id, character.name]))
    const blocks: Record<LoreKind, PressApplyBlock[]> = { faction: [], place: [], item: [] }
    for (const entry of entries) {
        blocks[entry.kind].push({ name: entry.name, text: buildLoreBlock(entry, nameById) })
    }
    return blocks
}

/** 键值行：空值不写，避免回写后文档里堆满空字段；解析端缺省即空串 */
function buildKeyLines(pairs: readonly (readonly [string, string])[]): string[] {
    return pairs
        .map(([key, value]) => [key, toSingleLine(value)] as const)
        .filter(([, value]) => value.length > 0)
        .map(([key, value]) => `- ${key}：${value}`)
}

/** 场景块：六级标题挂在章的「节拍」小节之后，字段即场景纲五项，顺序与 parseScenes 的读取键一致 */
function buildSceneBlock(scene: OutlineScene): string {
    const lines = buildKeyLines([
        ['欲望', scene.desire],
        ['阻碍', scene.obstacle],
        ['选择', scene.choice],
        ['结果', scene.result],
        ['情绪变化', scene.emotion],
    ])
    return [`###### ${sceneTitleLabel(scene, '')}`, '', ...lines].join('\n')
}

/**
 * 单章节：四级标题挂在「### 章节内容」下，计划梗概与节拍各占一个五级小节，场景用六级标题。
 * 关键约束：除计划梗概与节拍外，其余章纲字段仍写成键值行（留在章标题下），
 * 解析端读取键值行前会先剥离五级及更深的块，因此场景与章可以同名键而不互相污染。
 */
function buildChapterBlock(chapter: OutlineChapter, nameById: ReadonlyMap<string, string>): string {
    const hook = HOOK_OPTIONS.find((option) => option.value === chapter.hook)?.label ?? '无'
    // 解析端按「角色名 → id」映射，这里必须写名称而不是 id
    const characterNames = chapter.characterIds
        .map((id) => nameById.get(id))
        .filter((name): name is string => name !== undefined)
    const lines = [
        // 章号不进标题：章序由章块位置决定，标题只写纯名称（存量数据里的「第N章」前缀一并剥掉）
        `#### ${stripChapterOrderPrefix(chapter.title) || '未命名'}`,
        '',
        ...buildKeyLines([
            ['阶段', chapter.stage],
            ['POV', chapter.pov],
            ['目标', chapter.goal],
            ['阻碍', chapter.obstacle],
            ['转折', chapter.turn],
            ['结果', chapter.result],
            ['情绪', chapter.emotion],
            ['实际', chapter.actualSummary],
            ['钩子', hook],
            ['节奏', PACING_META[chapter.pacing].label],
            ['张力', String(chapter.tension)],
            ['字数', String(chapter.wordCount)],
            ['地点', chapter.location],
            ['人物', characterNames.join('、')],
        ]),
    ]
    const summary = toSingleLine(chapter.summary)
    if (summary.length > 0) {
        lines.push('', '##### 计划梗概', '', summary)
    }
    const beats = chapter.beats
        .filter((beat) => beat.text.trim().length > 0)
        .map((beat) => `- ${beat.isDone ? '[x]' : '[ ]'} ${beat.text.trim()}`)
    if (beats.length > 0) {
        lines.push('', '##### 节拍', '', beats.join('\n'))
    }
    const scenes = chapter.scenes
        .filter((scene) => scene.title.trim().length > 0)
        .map((scene) => buildSceneBlock(scene))
    if (scenes.length > 0) {
        lines.push('', scenes.join('\n\n'))
    }
    return lines.join('\n')
}

/** 列表小节：条目一行一条，空列表不写小节；level 为小节标题层级（结构纲 3、卷纲 4） */
function buildListSection(title: string, items: readonly string[], level = 3): string[] {
    const lines = items.map((item) => toSingleLine(item)).filter((item) => item.length > 0)
    return lines.length === 0 ? [] : ['', `${'#'.repeat(level)} ${title}`, '', ...lines.map((item) => `- ${item}`)]
}

/** 正文小节：单行文本，空值不写小节；level 同上 */
function buildBodySection(title: string, body: string, level = 3): string[] {
    const text = toSingleLine(body)
    return text.length === 0 ? [] : ['', `${'#'.repeat(level)} ${title}`, '', text]
}

/**
 * 单卷卷纲：三级标题即卷名，卷内固定小节（四级）依次为预计章节数 / 核心事件 / 主要情节 /
 * 关键转折 / 卷末结果。
 */
function buildVolumeOutlineBlock(volume: OutlineVolume): string {
    return [
        // 卷号不进标题：卷序由卷块位置决定，标题只写纯卷名
        `### ${stripVolumeOrderPrefix(volume.name) || '未命名'}`,
        ...(volume.expectedChapters > 0 ? ['', '#### 预计章节数', '', String(volume.expectedChapters)] : []),
        ...buildBodySection('核心事件', volume.coreEvent, 4),
        ...buildListSection('主要情节', volume.mainPlot, 4),
        ...buildListSection('关键转折', volume.turningPoints, 4),
        ...buildBodySection('卷末结果', volume.result, 4),
        '',
    ].join('\n')
}

/** 卷纲段落正文：整批卷纲小节，由 writer 按「## 卷纲」固定标题整段替换 */
export function serializeVolumeOutlinesSection(volumes: readonly OutlineVolume[]): string {
    return volumes.map((volume) => buildVolumeOutlineBlock(volume)).join('\n\n')
}

/**
 * 章节内容段落正文：每卷一个三级标题，卷内是四级章块。
 * 关键约束：卷名与卷纲段同源（同一份卷对象产出），改名两侧天然同步；
 * 没有章节的卷不写空标题，解析端按卷序并集合并。
 * @param characters 用于把章纲里的角色 id 还原成文档要求的角色名
 */
export function serializeChapterSection(
    volumes: readonly OutlineVolume[],
    characters: readonly CharacterCard[],
): string {
    const nameById = new Map(characters.map((character) => [character.id, character.name]))
    return volumes
        .filter((volume) => volume.chapters.length > 0)
        .map((volume) =>
            [
                `### ${stripVolumeOrderPrefix(volume.name) || '未命名'}`,
                '',
                volume.chapters.map((chapter) => buildChapterBlock(chapter, nameById)).join('\n\n'),
            ].join('\n'),
        )
        .join('\n\n')
}

/** 章节引用的文档写法：卷序-章序，未定则空串 */
function formatChapterRef(ref: OutlineChapterRef | null): string {
    return ref === null ? '' : `${String(ref.volumeOrder)}-${String(ref.chapterOrder)}`
}

/** 结构纲段落：每个阶段一个三级块，转折类型、卷位、叙事作用与主角变化写键值行 */
export function serializeStructureSection(plan: OutlinePlan): string {
    return plan.acts
        .map((act) =>
            [
                `### ${act.name}`,
                ...buildKeyLines([
                    ['id', act.id],
                    ['类型', act.kind === 'none' ? '' : ACT_KIND_META[act.kind].label],
                    ['卷位', act.volumeOrder === null ? '' : `第${String(act.volumeOrder)}卷`],
                    ['叙事作用', act.narrativeRole],
                    ['事件', act.event],
                    ['主角变化', act.protagonistChange],
                ]),
            ].join('\n'),
        )
        .join('\n\n')
}

/** 单条伏笔块：类型与状态写文案，埋设章与回收章写「卷序-章序」，触发者写姓名 */
function buildClueBlock(clue: OutlineClue, nameById: ReadonlyMap<string, string>): string {
    return [
        `### ${clue.name}`,
        ...buildKeyLines([
            ['id', clue.id],
            ['类型', CLUE_KIND_META[clue.kind].label],
            ['埋设章', formatChapterRef(clue.plant)],
            ['回收章', formatChapterRef(clue.payoff)],
            ['触发者', nameById.get(clue.triggerId) ?? ''],
            ['状态', CLUE_STATUS_META[clue.status].label],
            ['备注', clue.note],
        ]),
    ].join('\n')
}

/** 伏笔线索段落正文：整段由线索表重建，顺序即线索表顺序 */
export function serializeClueSection(plan: OutlinePlan, characters: readonly CharacterCard[]): string {
    const nameById = new Map(characters.map((character) => [character.id, character.name]))
    return plan.clues.map((clue) => buildClueBlock(clue, nameById)).join('\n\n')
}

/**
 * 大纲的全部段落：一次产出四个段落文本，调用方按需只提交变动的那一段。
 * 关键约束：段落键必须与宿主 writer 的落点表、PressApplyRequest.outlineSections 完全一致，
 * 键名改动会直接导致回写落到错误段落；人物信息只在角色设定里维护，大纲不再有「人物纲」段落；
 * 卷纲与章节内容分开产出——改卷纲不重写章节，改章纲不重写卷纲；
 * 设定纲 / 节奏情绪 / 时间线不再产出，旧文档里的这三段由 writer 原样保留。
 */
export function serializeOutlineSections(
    plan: OutlinePlan,
    volumes: readonly OutlineVolume[],
    characters: readonly CharacterCard[],
): Record<OutlineSectionKey, string> {
    return {
        structure: serializeStructureSection(plan),
        volumeOutlines: serializeVolumeOutlinesSection(volumes),
        chapters: serializeChapterSection(volumes, characters),
        clues: serializeClueSection(plan, characters),
    }
}
