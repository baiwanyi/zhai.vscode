/**
 * 词条面板的展示适配层：把宿主回传的分组与扁平词条映射成面板直接可用的结构。
 * 复用约定：数据与增删改由 ../hooks/usePromptLibrary 取宿主，md 的解析与落盘在宿主侧完成；
 * 本文件只做纯函数转换与查询，不再内置任何词条数据，也不感知磁盘路径。
 * 关键约束：搜索按中文名与提示词原文做大小写不敏感子串匹配，空关键词返回空数组，
 * 由调用方判断「是否处于搜索态」，避免空串把整库铺到面板里；
 * 分类图标由面板自行决定，本层不维护名称到图标的映射，用户新建分类无需登记图标。
 */
import type { PromptTag, PromptTagAttribute, PromptTagObject } from '@shared/types/imagegen'

export type { PromptTag, PromptTagAttribute, PromptTagObject }

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
