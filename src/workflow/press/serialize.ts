/**
 * 作品文档序列化：把工作台草稿转成可回写的段落片段，格式与 document.ts 的解析口径严格对齐。
 * 复用约定：状态、钩子、分类等中文标签取自 constants 的元数据表，不另写一套映射；
 * 设定按标签页拆分：基本信息写 README 的「作品设定」段，世界观与金手指各写自己的文档。
 * 关键约束：只产出「段落片段」而非整篇文档，落点与保留策略由宿主 writer 决定；
 * 卷章标题必须保留「第N卷 / 第N章」前缀，否则解析端认不出层级；
 * 键名一旦改动就必须同步改 document.ts 的读取键，否则回写后页面内容会凭空丢失。
 */
import type { PressApplyMeta } from '@shared/types/press'
import {
    CHARACTER_BODY_TYPE_META,
    CHARACTER_GENDER_META,
    CHARACTER_ROLE_META,
    HOOK_OPTIONS,
    PLAN_STATUS_META,
} from './constants'
import type { CharacterCard, OutlineChapter, OutlineVolume, ProjectSetting } from './types'

/**
 * 键值行只能占一行：textarea 输入的多行文本折成单行，
 * 否则回写后下一行会被解析端当成缺少冒号的新内容，字段在重新打开时丢失。
 */
function toSingleLine(value: string): string {
    return value.replace(/\s*\r?\n\s*/gu, ' ').trim()
}

/** 基本信息段落的键值行：顺序跟随表单，便于人工阅读与 diff */
function buildBasicLines(setting: ProjectSetting): string[] {
    return [
        `- 笔名：${setting.penName}`,
        `- 章节字数：${setting.chapterWordGoal}`,
        `- 时间：${setting.period}`,
        `- 地点：${setting.place}`,
        `- 结局：${setting.ending}`,
        `- 视角：${setting.perspective}`,
        `- 叙事结构：${setting.narrative}`,
        `- 语调：${setting.tone}`,
        `- 参考：${setting.references}`,
        `- 禁写项：${setting.banned.join('、')}`,
        `- 作品简介：${toSingleLine(setting.summary)}`,
        `- 一句话简介：${toSingleLine(setting.logline)}`,
        `- 开篇灵感：${toSingleLine(setting.opening)}`,
        `- 核心冲突：${toSingleLine(setting.conflict)}`,
        `- 补充信息：${toSingleLine(setting.extra)}`,
    ]
}

/** 世界观段落的键值行：键名与 document.ts 的读取键一一对应 */
function buildWorldLines(setting: ProjectSetting): string[] {
    return [
        `- 世界观总述：${setting.worldview}`,
        `- 地理：${setting.geography}`,
        `- 时代：${setting.era}`,
        `- 势力：${setting.factions}`,
        `- 力量体系：${setting.powerSystem}`,
        `- 核心概念：${setting.concepts}`,
        `- 禁忌：${setting.taboo}`,
    ]
}

/** 金手指段落的键值行：键名与 document.ts 的读取键一一对应 */
function buildGoldenFingerLines(setting: ProjectSetting): string[] {
    return [
        `- 金手指类型：${setting.goldenFingerType}`,
        `- 金手指能力：${setting.goldenFingerAbility}`,
        `- 金手指代价：${setting.goldenFingerCost}`,
    ]
}

/** README「作品设定」段落正文：只写键值行，用户手写的其它段落由 writer 原样保留 */
export function serializeBasicSection(setting: ProjectSetting): string {
    return buildBasicLines(setting).join('\n')
}

/** 世界观.md「提取设定」段落正文 */
export function serializeWorldSection(setting: ProjectSetting): string {
    return buildWorldLines(setting).join('\n')
}

/** 金手指.md「提取设定」段落正文 */
export function serializeGoldenFingerSection(setting: ProjectSetting): string {
    return buildGoldenFingerLines(setting).join('\n')
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

/**
 * 单个角色块：一级标题起条，键名与 parseCharacters 一一对应。
 * 关键约束：封面与画风必须随块落盘——图片本体在 Images 下，文档只记引用；
 * 不写这两行，重新打开作品后封面选择会丢失，列表与角色卡页都回到「未生成」状态。
 */
function buildCharacterBlock(character: CharacterCard): string {
    return [
        `# ${character.name}`,
        `- id：${character.id}`,
        `- 姓名：${character.name}`,
        `- 别名：${character.alias}`,
        `- 分类：${CHARACTER_ROLE_META[character.role].label}`,
        `- 性别：${CHARACTER_GENDER_META[character.gender].label}`,
        `- 年龄：${character.age}`,
        `- 身高：${character.height}`,
        `- 体型：${CHARACTER_BODY_TYPE_META[character.bodyType].label}`,
        `- 身份：${character.identity}`,
        `- 外貌标签：${character.appearanceTags.join('、')}`,
        `- 外貌：${character.appearance}`,
        `- 特质：${character.traits.join('、')}`,
        `- 背景：${character.background}`,
        `- 欲望：${character.desire}`,
        `- 弱点：${character.weakness}`,
        `- 口头禅：${character.catchphrase}`,
        `- 能力：${character.ability}`,
        `- 弧线：${character.arc}`,
        `- 关系：${character.relation}`,
        `- 画风：${character.portraitStyle}`,
        `- 封面：${character.coverPortraitId ?? ''}`,
    ].join('\n')
}

/** 角色块列表：name 作为宿主侧的匹配键，text 是包含标题行的完整块 */
export function serializeCharacterBlocks(characters: CharacterCard[]): { name: string; text: string }[] {
    return characters.map((character) => ({ name: character.name, text: buildCharacterBlock(character) }))
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
