/**
 * 词条插入片段：把提示词词条拼成可直接插入输入框的文本，含前置分隔符判定。
 * 复用约定：只处理纯文本，真正的插入动作由 RichChipInput 的 insertText 执行，本文件不接触 DOM 与光标。
 * 关键约束：词条统一前置逗号，连点即可自然拼成 `a, b, c`；末尾已是标点或空白时不再补，
 * 避免出现 `a,, b` 这类双分隔符；正文为空时首个词条同样带逗号，保证规则可预测。
 */

/** 句末分隔符：命中则说明已有标点或空白收尾，不再补前置逗号 */
const TRAILING_SEPARATOR = /[,\s。，、;；:：]$/u

/** 拼出应插入的片段：入参为输入框当前正文与待插入词条 */
export function composeInsertion(current: string, fragment: string): string {
    const trimmed = current.trimEnd()
    return TRAILING_SEPARATOR.test(trimmed) ? fragment : `, ${fragment}`
}
