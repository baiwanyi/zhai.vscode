/**
 * 提示词库适配层：把 data/promptTags.json 的三级分组摊平成分类清单、扁平词条表与分组索引。
 * 复用约定：数据由 scripts/build-prompt-tags.mjs 从上游分片生成，本文件只做类型收敛、权重归一与索引；
 * 组件从 PROMPT_OBJECTS / PROMPT_ATTRIBUTES / PROMPT_TAGS 与三个查询函数取值，不直接依赖 JSON 结构。
 * 关键约束：prompt 保留上游原文（含 (x:1.3) 权重写法），text 才是插入输入框的归一化文本；
 * preview 只是文件名，接入地址由宿主按图库目录拼装，本层不感知任何磁盘路径；
 * 一级分类图标集中在此映射，未命中的分类回落默认图标，新增分类时不会漏渲染。
 */
import {
    Camera,
    Frame,
    Gem,
    Image as ImageIcon,
    Layers,
    Package,
    Palette,
    PersonStanding,
    Rainbow,
    Shapes,
    Shirt,
    SlidersHorizontal,
    Smile,
    Sparkles,
    Sun,
    Trees,
    UserRound,
} from 'lucide-react'
import promptData from './data/promptTags.json'
import type { LucideIcon } from 'lucide-react'

/** 一级分类：name 与数据文件的 object 完全一致 */
export interface PromptObject {
    name: string
    icon: LucideIcon
}

/** 二级分类：object 所属一级分类，count 为该分组下的词条数 */
export interface PromptAttribute {
    object: string
    name: string
    count: number
}

/** 词条：name 是中文显示名，prompt 是上游原文，text 是剥离权重后实际插入的文本 */
export interface PromptTag {
    object: string
    attribute: string
    name: string
    prompt: string
    text: string
    preview: string
}

/** 一级分类图标：按 object 中文名映射，键须与数据文件保持一致 */
const ICON_BY_OBJECT: Readonly<Record<string, LucideIcon>> = {
    人物: UserRound,
    环境: Trees,
    素材: Layers,
    形状空间: Shapes,
    '形状|空间': Shapes,
    图像种类: ImageIcon,
    艺术风格: Palette,
    后期处理: SlidersHorizontal,
    成品范例: Frame,
    物品: Package,
    动作: PersonStanding,
    表情: Smile,
    服饰: Shirt,
    饰品: Gem,
    摄影: Camera,
    光影效果: Sun,
    色彩氛围: Rainbow,
}

/**
 * 权重后缀：`:1.3` 这类 SD 写法，剥离后对模型是等价的裸标签。
 * 冒号前必须已有内容——`:3` 是「猫嘴」这类颜文字标签，不能被当作权重吃掉。
 */
const WEIGHT_SUFFIX = /(?<=\S)\s*:\s*\d+(?:\.\d+)?\s*$/u

/** 成对括号的两侧：每轮都从头剥一次，兼容 `(tag:1.3)` 这种「先括号后权重」的顺序 */
const OPEN_BRACKET = /^[([]\s*/u

const CLOSE_BRACKET = /\s*[)\]]$/u

/** 分组索引的键分隔符：分类名里可能出现 `/`，不能用它拼键 */
const GROUP_SEPARATOR = '::'

/**
 * 剥离单个片段的权重与强调括号：`(autumn maple forest:1.3)` → `autumn maple forest`。
 * 最多三轮，嵌套写法（如 `((tag:1.2))`）也能收敛到裸文本，无变化即提前返回。
 */
function stripWeight(part: string): string {
    let current = part
    for (let round = 0; round < 3; round += 1) {
        const next = current
            .replace(WEIGHT_SUFFIX, '')
            .replace(OPEN_BRACKET, '')
            .replace(CLOSE_BRACKET, '')
            .trim()
        if (next === current) {
            return current
        }
        current = next
    }
    return current
}

/** 归一化提示词：按逗号拆段、逐段剥权重、丢弃空段后统一用「, 」连接 */
function normalizePrompt(raw: string): string {
    return raw
        .split(',')
        .map((part) => stripWeight(part))
        .filter((part) => part.length > 0)
        .join(', ')
}

/** 分组索引的键：object 与 attribute 的组合，两者都可能含标点，只能用固定分隔符拼接 */
function groupKey(object: string, attribute: string): string {
    return `${object}${GROUP_SEPARATOR}${attribute}`
}

const objects: PromptObject[] = []
const attributes: PromptAttribute[] = []
const tags: PromptTag[] = []
const tagsByGroup = new Map<string, PromptTag[]>()
const attributesByObject = new Map<string, PromptAttribute[]>()

for (const group of promptData.groups) {
    objects.push({ name: group.object, icon: ICON_BY_OBJECT[group.object] ?? Sparkles })
    const groupAttributes: PromptAttribute[] = []
    for (const attribute of group.attributes) {
        const attributeItem: PromptAttribute = {
            object: group.object,
            name: attribute.name,
            count: attribute.tags.length,
        }
        attributes.push(attributeItem)
        groupAttributes.push(attributeItem)
        const attributeTags: PromptTag[] = []
        for (const tag of attribute.tags) {
            attributeTags.push({
                object: group.object,
                attribute: attribute.name,
                name: tag.name,
                prompt: tag.prompt,
                text: normalizePrompt(tag.prompt),
                preview: tag.preview,
            })
        }
        tags.push(...attributeTags)
        tagsByGroup.set(groupKey(group.object, attribute.name), attributeTags)
    }
    attributesByObject.set(group.object, groupAttributes)
}

/** 一级分类清单：顺序与数据文件一致 */
export const PROMPT_OBJECTS: readonly PromptObject[] = objects

/** 二级分类清单：覆盖全部一级分类，count 供面板显示分组条目数 */
export const PROMPT_ATTRIBUTES: readonly PromptAttribute[] = attributes

/** 全部词条：搜索与跨分组平铺时使用 */
export const PROMPT_TAGS: readonly PromptTag[] = tags

/** 取一级分类下的二级分类：面板左栏切换时用它，不必全表过滤 */
export function promptAttributesOf(object: string): readonly PromptAttribute[] {
    return attributesByObject.get(object) ?? []
}

/** 取某个二级分类下的词条：面板右栏按选中分组取数 */
export function promptTagsOf(object: string, attribute: string): readonly PromptTag[] {
    return tagsByGroup.get(groupKey(object, attribute)) ?? []
}

/**
 * 关键词搜索：按中文名与提示词原文做大小写不敏感的子串匹配，空关键词返回空数组。
 * 由调用方判断「是否处于搜索态」，避免空串把 5000 条词条全量铺到面板里。
 */
export function searchPromptTags(keyword: string): readonly PromptTag[] {
    const query = keyword.trim().toLowerCase()
    if (query.length === 0) {
        return []
    }
    return tags.filter((tag) => tag.name.toLowerCase().includes(query) || tag.prompt.toLowerCase().includes(query))
}
