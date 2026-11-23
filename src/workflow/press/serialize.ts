/**
 * 作品文档序列化：把工作台草稿转成可回写的段落片段，格式与 document.ts 的解析口径严格对齐。
 * 复用约定：状态、钩子、分类等中文标签取自 constants 的元数据表，不另写一套映射；
 * 设定按标签页拆分：基本信息写 README 的「作品设定」段，世界观与金手指各写自己的文档，
 * 势力 / 地点 / 物品按分类各产出自己的条目块。
 * 大纲按功能模块拆成八个段落（全书纲 / 结构纲 / 人物纲 / 设定纲 / 节奏情绪 / 伏笔线索 / 时间线 / 分卷规划），
 * 卷章再按「卷 → 章 → 场景」分级，场景用五级标题挂在章块下。
 * 关键约束：设定字段与角色字段以标题承载（三级标题，角色卡再分三级分组 + 四级字段），不再用 `- 键：值` 列表；
 * 段落与块内部只能出现三、四级标题——宿主按「下一个一/二级标题」判断段落终点，写成二级会把文档截断；
 * 只产出「段落片段」而非整篇文档，落点与保留策略由宿主 writer 决定；
 * 卷章标题必须保留「第N卷 / 第N章」前缀，条目必须保留「## 名称」二级标题，否则解析端认不出层级；
 * 键名一旦改动就必须同步改 document.ts 的读取键，否则回写后页面内容会凭空丢失。
 */
import type { PressApplyBlock, PressApplyMeta } from '@shared/types/press'
import {
    CHARACTER_BODY_TYPE_META,
    CHARACTER_GENDER_META,
    CHARACTER_ROLE_META,
    CLUE_STATUS_META,
    GRANULARITY_META,
    HOOK_OPTIONS,
    PACING_META,
    PLAN_STATUS_META,
} from './constants'
import type {
    CharacterCard,
    LoreEntry,
    LoreKind,
    OutlineChapter,
    OutlineChapterRef,
    OutlineClue,
    OutlinePacingEntry,
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

/** README Frontmatter 的四个字段：其余字段（状态、创建时间）由 writer 保留原值 */
export function serializeReadmeMeta(setting: ProjectSetting): PressApplyMeta {
    return {
        // 作品名用 textarea 编辑，Frontmatter 的 title 必须是单行
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

/** 场景块：五级标题，字段即场景纲五项，顺序与 parseScenes 的读取键一致 */
function buildSceneBlock(scene: OutlineScene): string {
    const lines = buildKeyLines([
        ['欲望', scene.desire],
        ['阻碍', scene.obstacle],
        ['选择', scene.choice],
        ['结果', scene.result],
        ['情绪变化', scene.emotion],
    ])
    return [`##### 场景${String(scene.order)} ${scene.title}`, ...lines].join('\n')
}

/**
 * 单章节：标题保留「第N章」前缀，节拍按 ① 分隔以对齐 parseBeats。
 * 关键约束：章纲字段写在章块自己的键值行里，场景块紧随其后用五级标题——
 * 解析端会先剥离场景块，因此场景与章可以同名键（结果 / 情绪）而不互相污染。
 */
function buildChapterBlock(chapter: OutlineChapter, nameById: ReadonlyMap<string, string>): string {
    const hook = HOOK_OPTIONS.find((option) => option.value === chapter.hook)?.label ?? '无'
    const status = PLAN_STATUS_META[chapter.status].label
    const granularity = GRANULARITY_META[chapter.granularity].label
    const beats = chapter.beats
        .filter((beat) => beat.text.trim().length > 0)
        .map((beat) => `${beat.isDone ? '[x] ' : '[ ] '}${beat.text.trim()}`)
        .join('①')
    // 解析端按「角色名 → id」映射，这里必须写名称而不是 id
    const characterNames = chapter.characterIds
        .map((id) => nameById.get(id))
        .filter((name): name is string => name !== undefined)
    const lines = [
        `#### 第${String(chapter.order)}章 ${chapter.title}`,
        ...buildKeyLines([
            ['状态', status],
            ['颗粒度', granularity],
            ['POV', chapter.pov],
            ['目标', chapter.goal],
            ['阻碍', chapter.obstacle],
            ['转折', chapter.turn],
            ['结果', chapter.result],
            ['情绪', chapter.emotion],
            ['梗概', chapter.summary],
            ['实际', chapter.actualSummary],
            ['钩子', hook],
            ['张力', String(chapter.tension)],
            ['字数', `${String(chapter.wordCount)}/${String(chapter.wordGoal)}`],
            ['地点', chapter.location],
            ['人物', characterNames.join('、')],
            ['节拍', beats],
        ]),
    ]
    const scenes = chapter.scenes
        .filter((scene) => scene.title.trim().length > 0)
        .map((scene) => buildSceneBlock(scene))
    if (scenes.length > 0) {
        lines.push('', scenes.join('\n\n'))
    }
    return lines.join('\n')
}

/** 单卷：三/四级标题层级与 parseVolumes 的读取顺序一致 */
function buildVolumeBlock(volume: OutlineVolume, nameById: ReadonlyMap<string, string>): string {
    const lines = [
        `### ${volume.name}`,
        ...buildKeyLines([
            ['卷目标', volume.goal],
            ['卷冲突', volume.conflict],
            ['情节脉络', volume.plotline],
            ['关键转折', volume.turningPoints.join('；')],
            ['卷末结果', volume.result],
            ['颗粒度', GRANULARITY_META[volume.granularity].label],
        ]),
    ]
    if (volume.chapters.length > 0) {
        lines.push('', volume.chapters.map((chapter) => buildChapterBlock(chapter, nameById)).join('\n\n'))
    }
    return lines.join('\n')
}

/**
 * 大纲「分卷规划」段落正文：整段由草稿重建，段落之外的主线等内容由 writer 保留。
 * @param characters 用于把章纲里的角色 id 还原成文档要求的角色名
 */
export function serializeOutlineSection(volumes: OutlineVolume[], characters: CharacterCard[]): string {
    const nameById = new Map(characters.map((character) => [character.id, character.name]))
    return volumes.map((volume) => buildVolumeBlock(volume, nameById)).join('\n\n')
}

/** 章节引用的文档写法：卷序-章序，未定则空串 */
function formatChapterRef(ref: OutlineChapterRef | null): string {
    return ref === null ? '' : `${String(ref.volumeOrder)}-${String(ref.chapterOrder)}`
}

/** 全书纲段落：五个字段各占一个三级标题，与 parseBookOutline 的读取键对齐 */
export function serializeBookSection(plan: OutlinePlan): string {
    return buildFields([
        ['一句话梗概', plan.book.logline],
        ['核心冲突', plan.book.conflict],
        ['主题', plan.book.theme],
        ['结局方向', plan.book.ending],
        ['主角弧光', plan.book.arc],
    ])
}

/** 结构纲段落：每个阶段一个三级块，位置与事件写键值行 */
export function serializeStructureSection(plan: OutlinePlan): string {
    return plan.acts
        .map((act) =>
            [
                `### ${act.name}`,
                ...buildKeyLines([
                    ['id', act.id],
                    ['位置', act.position],
                    ['事件', act.event],
                ]),
            ].join('\n'),
        )
        .join('\n\n')
}

/** 人物纲段落：关联字段写人物卡姓名，解析端按姓名回填 id */
export function serializeCharacterOutlineSection(plan: OutlinePlan, characters: readonly CharacterCard[]): string {
    const nameById = new Map(characters.map((character) => [character.id, character.name]))
    return plan.characters
        .map((line) =>
            [
                `### ${line.name}`,
                ...buildKeyLines([
                    ['id', line.id],
                    ['关联', nameById.get(line.characterId) ?? ''],
                    ['欲望', line.desire],
                    ['恐惧', line.fear],
                    ['缺陷', line.flaw],
                    ['秘密', line.secret],
                    ['关系', line.relation],
                    ['弧光', line.arc],
                ]),
            ].join('\n'),
        )
        .join('\n\n')
}

/** 设定纲段落：规则、代价与说明三项，只写会推动情节的部分 */
export function serializeSettingOutlineSection(plan: OutlinePlan): string {
    return plan.setting
        .map((note) =>
            [
                `### ${note.name}`,
                ...buildKeyLines([
                    ['id', note.id],
                    ['规则', note.rule],
                    ['代价', note.cost],
                    ['说明', note.note],
                ]),
            ].join('\n'),
        )
        .join('\n\n')
}

/** 节奏情绪段落：一章一档，类型写中文标签、张力写数字 */
function buildPacingBlock(entry: OutlinePacingEntry): string {
    return [
        `### 第${String(entry.chapterOrder)}章`,
        ...buildKeyLines([
            ['类型', PACING_META[entry.kind].label],
            ['张力', String(entry.tension)],
        ]),
    ].join('\n')
}

/** 节奏情绪段落正文 */
export function serializePacingSection(plan: OutlinePlan): string {
    return plan.pacing.map((entry) => buildPacingBlock(entry)).join('\n\n')
}

/** 单条线索块：埋设章与回收章写「卷序-章序」，触发者写姓名 */
function buildClueBlock(clue: OutlineClue, nameById: ReadonlyMap<string, string>): string {
    return [
        `### ${clue.name}`,
        ...buildKeyLines([
            ['id', clue.id],
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

/** 时间线段落正文：涉及章写多个「卷序-章序」，涉及人物写姓名 */
export function serializeTimelineSection(plan: OutlinePlan, characters: readonly CharacterCard[]): string {
    const nameById = new Map(characters.map((character) => [character.id, character.name]))
    return plan.timeline
        .map((event) =>
            [
                `### ${event.title}`,
                ...buildKeyLines([
                    ['id', event.id],
                    ['时间', event.when],
                    ['涉及章', event.refs.map((ref) => formatChapterRef(ref)).join('、')],
                    [
                        '涉及人物',
                        event.characterIds
                            .map((id) => nameById.get(id))
                            .filter((name): name is string => name !== undefined)
                            .join('、'),
                    ],
                ]),
            ].join('\n'),
        )
        .join('\n\n')
}

/**
 * 大纲的全部段落：一次产出八个段落文本，调用方按需只提交变动的那一段。
 * 关键约束：段落键必须与宿主 writer 的落点表、PressApplyRequest.outlineSections 完全一致，
 * 键名改动会直接导致回写落到错误段落。
 */
export function serializeOutlineSections(
    plan: OutlinePlan,
    volumes: readonly OutlineVolume[],
    characters: readonly CharacterCard[],
): Record<OutlineSectionKey, string> {
    return {
        book: serializeBookSection(plan),
        structure: serializeStructureSection(plan),
        characters: serializeCharacterOutlineSection(plan, characters),
        setting: serializeSettingOutlineSection(plan),
        pacing: serializePacingSection(plan),
        clues: serializeClueSection(plan, characters),
        timeline: serializeTimelineSection(plan, characters),
        volumes: serializeOutlineSection([...volumes], [...characters]),
    }
}
