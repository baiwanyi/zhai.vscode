/**
 * 作品文档序列化：把工作台草稿转成可回写的段落片段，格式与 document.ts 的解析口径严格对齐。
 * 复用约定：状态、钩子、分类等中文标签取自 constants 的元数据表，不另写一套映射；
 * 设定按标签页拆分：基本信息写 README 的「作品设定」段，世界观与金手指各写自己的文档，
 * 势力 / 地点 / 物品按分类各产出自己的条目块。
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
    HOOK_OPTIONS,
    PLAN_STATUS_META,
} from './constants'
import type { CharacterCard, LoreEntry, LoreKind, OutlineChapter, OutlineVolume, ProjectSetting } from './types'

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

/** 单章节：标题保留「第N章」前缀，节拍按 ① 分隔以对齐 parseBeats */
function buildChapterBlock(chapter: OutlineChapter, nameById: ReadonlyMap<string, string>): string {
    const hook = HOOK_OPTIONS.find((option) => option.value === chapter.hook)?.label ?? '无'
    const status = PLAN_STATUS_META[chapter.status].label
    const beats = chapter.beats
        .filter((beat) => beat.text.trim().length > 0)
        .map((beat) => `${beat.isDone ? '[x] ' : '[ ] '}${beat.text.trim()}`)
        .join('①')
    const lines = [
        `#### 第${chapter.order}章 ${chapter.title}`,
        `- 状态：${status}`,
        `- 梗概：${chapter.summary}`,
        `- 钩子：${hook}`,
        `- 张力：${chapter.tension}`,
        `- 字数：${chapter.wordCount}/${chapter.wordGoal}`,
        `- 地点：${chapter.location}`,
    ]
    // 解析端按「角色名 → id」映射，这里必须写名称而不是 id
    const characterNames = chapter.characterIds
        .map((id) => nameById.get(id))
        .filter((name): name is string => name !== undefined)
    if (characterNames.length > 0) {
        lines.push(`- 人物：${characterNames.join('、')}`)
    }
    if (beats.length > 0) {
        lines.push(`- 节拍：${beats}`)
    }
    return lines.join('\n')
}

/** 单卷：三/四级标题层级与 parseVolumes 的读取顺序一致 */
function buildVolumeBlock(volume: OutlineVolume, nameById: ReadonlyMap<string, string>): string {
    const lines = [
        `### ${volume.name}`,
        `- 卷目标：${volume.goal}`,
        `- 卷冲突：${volume.conflict}`,
        `- 情节脉络：${volume.plotline}`,
        `- 关键转折：${volume.turningPoints.join('；')}`,
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
