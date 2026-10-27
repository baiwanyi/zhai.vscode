/**
 * 词条原文归一化：把上游提示词写法（`(tag:1.3)`、`[tag]`）还原为模型可直接使用的裸标签串。
 * 复用约定：纯函数、零依赖，webview 词库适配层与宿主出图服务共用同一份口径——
 * 面板上展示的词条文本与宿主最终拼入提示词的文本必须逐字一致，不能各算一套。
 * 关键约束：冒号前必须已有内容，`:3` 这类颜文字标签不能被当作权重吃掉；
 * 括号只在整串被同型括号完整包裹时才剥，`ballpoint_pen_(medium)` 这类词内括号必须保留；
 * 逗号按括号深度切分，`((a,b))` 内的逗号不参与分段，剥完括号后产生的逗号再递归拆分；
 * 最多剥六轮，空段丢弃后以「, 」连接。
 */

/** 权重后缀：`:1.3` 这类 SD 写法，剥离后对模型是等价的裸标签 */
const WEIGHT_SUFFIX = /(?<=\S)\s*:\s*\d+(?:\.\d+)?\s*$/u

/** 单段最多剥几层括号：历史词库出现过五层嵌套（`(((((tag)))))`），给到六轮才能收敛到裸文本 */
const MAX_STRIP_ROUNDS = 6

/** 开括号到闭括号的映射：只认方括号与圆括号，其它字符一律不参与包裹判断 */
const CLOSING_BRACKET: Record<string, string> = { '(': ')', '[': ']' }

/** 是否开括号：深度加一 */
function isOpening(char: string): boolean {
    return char === '(' || char === '['
}

/** 是否闭括号：深度减一，最低归零，避免多余的右括号把后续逗号当成段内内容 */
function isClosing(char: string): boolean {
    return char === ')' || char === ']'
}

/**
 * 按顶层逗号切分：括号内的逗号不参与分段，`((a,b))` 保持为一段。
 * 关键约束：深度只按括号配对增减，不看内容，因此 `ballpoint_pen_(medium)` 内部的括号也算一层。
 */
function splitTopLevel(raw: string): string[] {
    const parts: string[] = []
    let depth = 0
    let buffer = ''
    for (const char of raw) {
        if (isOpening(char)) {
            depth += 1
        } else if (isClosing(char)) {
            depth = Math.max(depth - 1, 0)
        }
        if (char === ',' && depth === 0) {
            parts.push(buffer)
            buffer = ''
            continue
        }
        buffer += char
    }
    parts.push(buffer)
    return parts
}

/**
 * 整串被同一对括号完整包裹时剥掉一层：`(tag)` → `tag`。
 * 关键约束：首尾必须同型括号，且首个开括号要一直闭合到串尾；
 * 中途就闭合说明括号只包住了前一段（如 `(a), (b)` 或 `ballpoint_pen_(medium)`），一律不动。
 */
function stripWholeWrapped(part: string): string | null {
    const open = part.charAt(0)
    const close = CLOSING_BRACKET[open] ?? ''
    if (close.length === 0 || part.length < 2 || part.charAt(part.length - 1) !== close) {
        return null
    }
    let depth = 0
    for (let index = 0; index < part.length; index += 1) {
        const char = part.charAt(index)
        if (char === open) {
            depth += 1
        } else if (char === close) {
            depth -= 1
            if (depth === 0 && index !== part.length - 1) {
                return null
            }
        }
    }
    return depth === 0 ? part.slice(1, -1).trim() : null
}

/**
 * 剥离单个片段的权重与强调括号：`(autumn maple forest:1.3)` → `autumn maple forest`。
 * 每轮先剥整串括号再剥结尾权重，兼容 `(tag:1.3)` 与 `((tag))` 两种嵌套顺序；
 * 最多六轮，无变化即提前返回，避免把 `ballpoint_pen_(medium)` 这类词内括号当成强调。
 */
function stripWeight(part: string): string {
    let current = part.trim()
    for (let round = 0; round < MAX_STRIP_ROUNDS; round += 1) {
        const wrapped = stripWholeWrapped(current)
        const next = (wrapped ?? current).replace(WEIGHT_SUFFIX, '').trim()
        if (next === current) {
            return current
        }
        current = next
    }
    return current
}

/**
 * 逐段剥离并按需再分段：剥掉括号后可能露出新的逗号（`((a,b))` → `a,b`），此时按顶层逗号递归一次。
 * 关键约束：递归只在剥出逗号时发生，段内容单调变短，不会无限展开。
 */
function normalizeParts(parts: readonly string[]): string[] {
    const output: string[] = []
    for (const part of parts) {
        const cleaned = stripWeight(part)
        if (cleaned.length === 0) {
            continue
        }
        if (cleaned.includes(',')) {
            output.push(...normalizeParts(splitTopLevel(cleaned)))
            continue
        }
        output.push(cleaned)
    }
    return output
}

/** 归一化词条原文：按顶层逗号分段、逐段剥权重与强调括号、丢弃空段后统一用「, 」连接 */
export function normalizePromptTag(raw: string): string {
    return normalizeParts(splitTopLevel(raw)).join(', ')
}
