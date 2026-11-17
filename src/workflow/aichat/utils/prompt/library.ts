/**
 * 词条面板的展示适配层：把宿主回传的分组与扁平词条映射成面板直接可用的结构。
 * 复用约定：数据与增删改由 ../../hooks/usePromptLibrary 取宿主，md 的解析与落盘在宿主侧完成；
 * 本文件只做纯函数转换与查询，不再内置任何词条数据，也不感知磁盘路径。
 * 提示词面板的两套归属（生图 imagegen / 写作 press）共用本层的分组、检索与分类回落，避免各写一套口径。
 * 关键约束：搜索按中文名与提示词原文做大小写不敏感子串匹配，空关键词返回空数组，
 * 由调用方判断「是否处于搜索态」，避免空串把整库铺到面板里；
 * 分类图标由面板自行决定，本层不维护名称到图标的映射，用户新建分类无需登记图标。
 */
import type { PromptTag, PromptTagAttribute, PromptTagObject } from '@shared/types/promptLibrary'

export type { PromptTag, PromptTagAttribute, PromptTagObject }

/** 分类栏项：一级分类只有名称，二级分组额外带该组词条数 */
export interface PromptCategoryRailItem {
    readonly name: string
    /** 该分组下的词条数：一级分类不传，省略计数徽标 */
    readonly count?: number
}

/** 分类回落：当前值不在新列表里（词库增删后）就取首项，保证两级分类始终有一项生效 */
export function resolveActivePromptCategory(items: readonly { readonly name: string }[], active: string): string {
    return items.some((item) => item.name === active) ? active : (items[0]?.name ?? '')
}

/** 取某个分类下的分组：分类不存在时返回空数组 */
export function attributesOf(objects: readonly PromptTagObject[], object: string): readonly PromptTagAttribute[] {
    return objects.find((item) => item.name === object)?.attributes ?? []
}

/** 取某个分组下的词条：顺序与 md 内一致 */
export function tagsOf(tags: readonly PromptTag[], object: string, attribute: string): readonly PromptTag[] {
    return tags.filter((tag) => tag.object === object && tag.attribute === attribute)
}

/**
 * 关键词搜索：按中文名与提示词原文做大小写不敏感的子串匹配，空关键词返回空数组。
 * 由调用方判断是否处于搜索态，避免空串把整库铺到面板里。
 */
export function searchTags(tags: readonly PromptTag[], keyword: string): readonly PromptTag[] {
    const query = keyword.trim().toLowerCase()
    if (query.length === 0) {
        return []
    }
    return tags.filter((tag) => tag.name.toLowerCase().includes(query) || tag.prompt.toLowerCase().includes(query))
}
