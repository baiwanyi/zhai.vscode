/**
 * 词条原文归一化：把上游提示词写法（`(tag:1.3)`、`[tag]`）还原为模型可直接使用的裸标签串。
 * 复用约定：纯函数、零依赖，webview 词库适配层与宿主出图服务共用同一份口径——
 * 面板上展示的词条文本与宿主最终拼入提示词的文本必须逐字一致，不能各算一套。
 * 关键约束：冒号前必须已有内容，`:3` 这类颜文字标签不能被当作权重吃掉；
 * 最多剥三轮，嵌套括号也能收敛到裸文本；按逗号拆段后丢弃空段，统一以「, 」连接。
 */

/** 权重后缀：`:1.3` 这类 SD 写法，剥离后对模型是等价的裸标签 */
const WEIGHT_SUFFIX = /(?<=\S)\s*:\s*\d+(?:\.\d+)?\s*$/u

/** 成对括号的两侧：每轮都从头剥一次，兼容 `(tag:1.3)` 这种「先括号后权重」的顺序 */
const OPEN_BRACKET = /^[([]\s*/u

const CLOSE_BRACKET = /\s*[)\]]$/u

/**
 * 剥离单个片段的权重与强调括号：`(autumn maple forest:1.3)` → `autumn maple forest`。
 * 最多三轮，嵌套写法（如 `((tag:1.2))`）也能收敛到裸文本，无变化即提前返回。
 */
function stripWeight(part: string): string {
    let current = part
    for (let round = 0; round < 3; round += 1) {
        const next = current.replace(WEIGHT_SUFFIX, '').replace(OPEN_BRACKET, '').replace(CLOSE_BRACKET, '').trim()
        if (next === current) {
            return current
        }
        current = next
    }
    return current
}

/** 归一化词条原文：按逗号拆段、逐段剥权重、丢弃空段后统一用「, 」连接 */
export function normalizePromptTag(raw: string): string {
    return raw
        .split(',')
        .map((part) => stripWeight(part))
        .filter((part) => part.length > 0)
        .join(', ')
}
