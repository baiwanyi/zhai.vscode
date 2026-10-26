/**
 * 提示词库适配层：把 data/promptTags.json 的三级分组摊平成分类清单、扁平词条表与分组索引。
 * 复用约定：数据由 scripts/build-prompt-tags.mjs 从上游分片生成，权重归一取 @shared/utils/promptTag
 * 与宿主共用同一套写法；组件从 PROMPT_OBJECTS / PROMPT_ATTRIBUTES / PROMPT_TAGS 与三个查询函数取值。
 * 关键约束：prompt 保留上游原文（含 (x:1.3) 权重写法），同时作为词条芯片的标识——全库唯一，可据此在宿主换取文本；
 * text 只是归一化结果，供悬停预览展示「发送后会变成什么」，选中词条不再依赖它写入正文；
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
import { normalizePromptTag } from '@shared/utils/promptTag'
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

/** 词条：name 是中文显示名，prompt 是上游原文兼全库唯一标识，text 是剥离权重后的归一化文本 */
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

/** 分组索引的键分隔符：分类名里可能出现 `/`，不能用它拼键 */
const GROUP_SEPARATOR = '::'

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
                text: normalizePromptTag(tag.prompt),
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
