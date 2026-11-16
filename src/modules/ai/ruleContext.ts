/**
 * 规则上下文：把已挂的写作规则名还原为模型可读片段，规则正文只在当轮读取。
 * 复用约定：规则清单与正文由 imagegen 的 PromptRuleService 维护（{存储根}/prompt/rules），本模块只读不写；
 * 规则名按会话草稿与消息列流转，库里的 JSON 文本一律按不可信输入处理。
 * 关键约束：规则不占上下文条数与字数配额，与引用分属两套预算；
 * 历史消息只回传规则名，不重复注入正文，避免每轮历史累积膨胀。
 */

/** 全部规则合计的注入上限：规则是约束而非资料，占上下文预算的四成以内 */
export const MAX_RULE_CHARS = 8_000
/** 单条规则上限：超过单条上限的规则整体跳过，截断后的约束可能自相矛盾 */
const MAX_SINGLE_RULE_CHARS = 4_000

/** 规则段构造结果：skipped 为读取失败、超长或预算不足而未注入的规则名 */
export interface RuleBlockResult {
    block: string
    skipped: string[]
}

/** 规则名转义：名称是用户输入，进入标签属性前先转义尖括号与引号 */
function escapeRuleName(value: string): string {
    return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/** 规则正文转义：防止正文伪造闭合标签 */
function escapeRuleContent(text: string): string {
    return text.replaceAll('</rule>', '<\\/rule>')
}

/**
 * 构造规则段：按挂载顺序逐条读取，同名只注入一次，超预算的整条跳过而不是截断。
 * 未注入读取回调时返回空段，调用方据此跳过规则段拼装。
 */
export async function buildRuleBlock(
    names: readonly string[],
    readRule: ((name: string) => Promise<string | null>) | undefined,
): Promise<RuleBlockResult> {
    if (names.length === 0 || readRule === undefined) {
        return { block: '', skipped: [] }
    }
    const parts: string[] = []
    const skipped: string[] = []
    let used = 0
    for (const name of new Set(names)) {
        const content = await readRule(name)
        if (content === null || content.length === 0 || content.length > MAX_SINGLE_RULE_CHARS) {
            skipped.push(name)
            continue
        }
        if (used + content.length > MAX_RULE_CHARS) {
            skipped.push(name)
            continue
        }
        used += content.length
        parts.push(`<rule name="${escapeRuleName(name)}">\n${escapeRuleContent(content)}\n</rule>`)
    }
    if (parts.length === 0) {
        return { block: '', skipped }
    }
    return { block: `【写作规则】\n${parts.join('\n\n')}`, skipped }
}

/** 历史消息的规则说明行：只回传挂了哪些规则，不重复注入正文 */
export function describeRules(names: readonly string[]): string {
    return names.length === 0 ? '' : `【已挂规则】${names.join('、')}`
}

/** 解析库里的规则名列：不可信 JSON，非字符串项与空串逐条丢弃 */
export function parseStoredRuleNames(raw: string): string[] {
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return []
    }
    if (!Array.isArray(parsed)) {
        return []
    }
    return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
}
