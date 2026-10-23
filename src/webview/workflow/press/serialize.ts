/**
 * 作品文档序列化：把工作台草稿转成可回写的段落片段，格式与 document.ts 的解析口径严格对齐。
 * 复用约定：状态、钩子、分类等中文标签取自 constants 的元数据表，不另写一套映射。
 * 关键约束：只产出「段落片段」而非整篇文档，落点与保留策略由宿主 writer 决定；
 * 卷章标题必须保留「第N卷 / 第N章」前缀，否则解析端认不出层级；
 * 键名一旦改动就必须同步改 document.ts 的读取键，否则回写后页面内容会凭空丢失。
 */
import type { PressApplyMeta } from '@shared/types/press'
import { CHARACTER_GENDER_META, CHARACTER_ROLE_META, HOOK_OPTIONS, PLAN_STATUS_META } from './constants'
import type { CharacterCard, OutlineChapter, OutlineVolume, ProjectSetting } from './types'

/** 设定段落的键值行：顺序固定，便于人工阅读与 diff */
function buildSettingLines(setting: ProjectSetting): string[] {
    return [
        `- 笔名：${setting.penName}`,
        `- 一句话简介：${setting.logline}`,
        `- 核心冲突：${setting.conflict}`,
        `- 结局：${setting.ending}`,
        `- 时代：${setting.era}`,
        `- 势力：${setting.factions}`,
        `- 力量体系：${setting.powerSystem}`,
        `- 禁忌：${setting.taboo}`,
        `- 金手指类型：${setting.goldenFingerType}`,
        `- 金手指能力：${setting.goldenFingerAbility}`,
        `- 金手指代价：${setting.goldenFingerCost}`,
        `- 视角：${setting.perspective}`,
        `- 语调：${setting.tone}`,
        `- 参考：${setting.references}`,
        `- 禁写项：${setting.banned.join('、')}`,
    ]
}

/** 设定.md 的段落正文：只写键值行，用户手写的其它段落由 writer 原样保留 */
export function serializeSettingSection(setting: ProjectSetting): string {
    return buildSettingLines(setting).join('\n')
}

/** README Frontmatter 的四个字段：其余字段（状态、创建时间）由 writer 保留原值 */
export function serializeReadmeMeta(setting: ProjectSetting): PressApplyMeta {
    return {
        title: setting.title,
        audience: setting.audience,
        genres: setting.genres,
        wordGoal: setting.wordGoal,
    }
}

/** 单个角色块：一级标题起条，键名与 parseCharacters 一一对应 */
function buildCharacterBlock(character: CharacterCard): string {
    return [
        `# ${character.name}`,
        `- id：${character.id}`,
        `- 姓名：${character.name}`,
        `- 别名：${character.alias}`,
        `- 分类：${CHARACTER_ROLE_META[character.role].label}`,
        `- 性别：${CHARACTER_GENDER_META[character.gender].label}`,
        `- 年龄：${character.age}`,
        `- 身份：${character.identity}`,
        `- 外貌：${character.appearance}`,
        `- 特质：${character.traits.join('、')}`,
        `- 欲望：${character.desire}`,
        `- 弱点：${character.weakness}`,
        `- 口头禅：${character.catchphrase}`,
        `- 能力：${character.ability}`,
        `- 弧线：${character.arc}`,
        `- 关系：${character.relation}`,
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
    const lines = [`### ${volume.name}`, `- 卷目标：${volume.goal}`, `- 卷冲突：${volume.conflict}`]
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
