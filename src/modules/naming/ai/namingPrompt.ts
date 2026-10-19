/**
 * AI 取名提示词与结果校验：构造一次性生成的对话消息，并把模型输出收敛为合法候选名。
 * 复用约定：消息结构复用 ../ai/client 的 ChatMessage；条件文案复用 data/catalog 的分类与选项标签；
 * 解析层兼容 ```json 围栏、裸对象与裸数组三种常见输出形态，失败时正则兜底提取引号字符串。
 * 关键约束：模型输出一律视为不可信——必须再过长度、字符集、后缀、姓氏与去重校验，
 * 不合规项直接丢弃，由调用方决定是否回退本地生成。
 */
import type { NamingCandidate, NamingRequest } from '../../../shared/types/naming'
import type { ChatMessage } from '../../ai/client'
import { readCategoryDefinition } from '../data/catalog'

/** 系统提示：约束输出为纯 JSON，禁止解释与编号 */
const SYSTEM_PROMPT = `你是中文小说命名助手。严格按用户条件输出 JSON：{"names":["名字1","名字2"]}。
不得输出解释、编号、Markdown 代码块以外的任何文字；名字之间不得重复。`

/** 名字最大长度（西方姓名允许空格，放宽到 24 个字符） */
const MAX_NAME_LENGTH = 24
/** 解析时提取引号字符串的正则兜底 */
const QUOTED_TEXT_PATTERN = /"([^"\\]{1,24})"/g
/** 名字首尾可能出现的书名号与引号 */
const WRAPPING_PATTERN = /^[《「『"']+|[》」』"']+$/g

/** 构造 AI 取名消息 */
export function buildNamingMessages(request: NamingRequest): ChatMessage[] {
    return [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(request) },
    ]
}

/** 用户提示：条件 + 数量 + 硬约束 + 一个示例 */
function buildUserPrompt(request: NamingRequest): string {
    const definition = readCategoryDefinition(request.category)
    const variantLabel =
        definition.variants.find((variant) => variant.value === request.variant)?.label ?? definition.variants[0]?.label ?? ''
    const lines = [`类别：${definition.label}｜${definition.variantLabel}：${variantLabel}`, `数量：${request.count} 个`]
    if (definition.isPerson) {
        lines.push(
            `地域：${variantLabel}`,
            `时代：${request.era === 'ancient' ? '古代' : '现代'}`,
            `性别：${readGenderLabel(request.gender)}`,
            `名字字数（不含姓氏）：${readLengthLabel(request.length)}`,
        )
        if (request.surname.length > 0) {
            lines.push(`姓氏：${request.surname}（每个名字必须包含该姓氏）`)
        }
    }
    if (definition.hasSuffix) {
        lines.push(
            request.suffix.length > 0
                ? `强制后缀：${request.suffix}（每个名字必须以后缀结尾）`
                : '后缀：自选，需符合该分类的命名习惯',
        )
    }
    if (request.requirement.length > 0) {
        lines.push(`具体要求：${request.requirement}`)
    }
    lines.push(
        '约束：只使用常用汉字；名字之间不重复；不要输出与示例相同的名字；不要输出标点与解释。',
        `示例：{"names":["${buildExample(request, definition.label)}"]}`,
    )
    return lines.join('\n')
}

/** 示例名：按分类给一个示例，避免模型误把示例当作答案 */
function buildExample(request: NamingRequest, categoryLabel: string): string {
    if (categoryLabel === '人物') {
        return `${request.surname.length > 0 ? request.surname : '沈'}${request.gender === 'female' ? '清禾' : '砚舟'}`
    }
    const suffix = request.suffix.length > 0 ? request.suffix : '宫'
    return `听潮${suffix}`
}

function readGenderLabel(gender: NamingRequest['gender']): string {
    if (gender === 'female') {
        return '女'
    }
    return gender === 'male' ? '男' : '中性'
}

function readLengthLabel(length: NamingRequest['length']): string {
    if (length === 'one') {
        return '1 字'
    }
    return length === 'two' ? '2 字' : '1~2 字'
}

/**
 * 解析模型输出为候选名：提取 JSON → 逐项清洗 → 规则校验 → 去重限量。
 * @returns 合规候选；全部不合规时返回空数组
 */
export function parseNamingResponse(content: string, request: NamingRequest): NamingCandidate[] {
    const names = extractNames(content)
    const items: NamingCandidate[] = []
    const used = new Set<string>()
    for (const raw of names) {
        const name = raw.replace(WRAPPING_PATTERN, '').trim()
        if (!isValidName(name, request) || used.has(name)) {
            continue
        }
        used.add(name)
        items.push({
            id: `c${items.length}`,
            name,
            surname: request.category === 'person' && request.surname.length > 0 ? request.surname : null,
            suffix: request.suffix.length > 0 ? request.suffix : null,
        })
        if (items.length >= request.count) {
            break
        }
    }
    return items
}

/** 从输出中提取名字数组：优先 JSON，失败后退回引号文本 */
function extractNames(content: string): string[] {
    const cleaned = content.replace(/```[a-zA-Z]*/g, '').replace(/```/g, '').trim()
    const objectStart = cleaned.indexOf('{')
    const objectEnd = cleaned.lastIndexOf('}')
    if (objectStart >= 0 && objectEnd > objectStart) {
        const fromObject = parseJsonNames(cleaned.slice(objectStart, objectEnd + 1))
        if (fromObject.length > 0) {
            return fromObject
        }
    }
    const arrayStart = cleaned.indexOf('[')
    const arrayEnd = cleaned.lastIndexOf(']')
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
        const fromArray = parseJsonNames(cleaned.slice(arrayStart, arrayEnd + 1))
        if (fromArray.length > 0) {
            return fromArray
        }
    }
    return [...cleaned.matchAll(QUOTED_TEXT_PATTERN)].map((match) => match[1] ?? '')
}

/** 解析 JSON：对象取 names 字段，数组直接使用 */
function parseJsonNames(text: string): string[] {
    try {
        const parsed: unknown = JSON.parse(text)
        if (Array.isArray(parsed)) {
            return parsed.filter((item): item is string => typeof item === 'string')
        }
        if (typeof parsed === 'object' && parsed !== null) {
            const names = (parsed as { names?: unknown }).names
            if (Array.isArray(names)) {
                return names.filter((item): item is string => typeof item === 'string')
            }
        }
        return []
    } catch {
        return []
    }
}

/** 单项校验：长度、字符集、强制后缀与姓氏约束 */
function isValidName(name: string, request: NamingRequest): boolean {
    if (name.length < 1 || name.length > MAX_NAME_LENGTH) {
        return false
    }
    if (!/^[\u4e00-\u9fa5A-Za-z·\s]+$/.test(name)) {
        return false
    }
    if (request.suffix.length > 0 && !name.endsWith(request.suffix)) {
        return false
    }
    if (request.category === 'person' && request.surname.length > 0) {
        const surname = request.surname
        const isMatched = request.variant === 'west' ? name.endsWith(` ${surname}`) : name.startsWith(surname)
        if (!isMatched) {
            return false
        }
    }
    return true
}
