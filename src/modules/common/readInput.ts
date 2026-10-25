/**
 * 宿主侧入参收窄工具：把前端不可信的 unknown 归一为定长字符串与字符串数组。
 * 复用约定：各服务的 normalize 函数共用本文件的 readText / readTextList，不各自实现截断与去重；
 * 调用方仍须对必填字段与枚举白名单做二次校验，本文件只负责「类型与长度」这一层。
 * 关键约束：非字符串一律回落空串或空数组，不抛错；数组按首次出现顺序去重后截断，长度上限由调用方给定。
 */

/** 读取字符串字段：非字符串一律回落空串 */
export function readText(value: unknown, maxLength: number): string {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

/** 读取字符串数组：过滤非字符串、去重并按上限截断 */
export function readTextList(value: unknown, maxItems: number, maxLength: number): string[] {
    if (!Array.isArray(value)) {
        return []
    }
    const items: string[] = []
    for (const item of value) {
        if (typeof item !== 'string') {
            continue
        }
        const text = item.trim().slice(0, maxLength)
        if (text.length === 0 || items.includes(text)) {
            continue
        }
        items.push(text)
        if (items.length >= maxItems) {
            break
        }
    }
    return items
}
