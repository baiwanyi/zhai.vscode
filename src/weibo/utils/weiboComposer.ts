/**
 * 发布框纯逻辑：把插入文本落到指定选区，并在超出上限时拒绝。
 * 复用约定：无 DOM 依赖，入参出参都是字符串与数字，调用方负责读写 textarea 与光标；
 * 与 textarea 的 maxLength 保持同一口径（UTF-16 长度），不另立一套字数规则。
 * 关键约束：越界选区由 slice 自身收敛，不抛错；超限返回 null，由调用方决定提示文案。
 */

/** 插入入参：value 为当前正文，start/end 为选区，insert 为待插入文本 */
export interface InsertAtSelectionInput {
    value: string
    start: number
    end: number
    insert: string
    maxLength: number
}

export interface InsertAtSelectionResult {
    /** 插入后的完整正文 */
    value: string
    /** 插入后的光标位置：落在插入文本末尾 */
    caret: number
}

/** 在选区处插入文本：超长返回 null，否则返回新正文与光标位置 */
export function insertAtSelection({
    value,
    start,
    end,
    insert,
    maxLength,
}: InsertAtSelectionInput): InsertAtSelectionResult | null {
    const nextValue = value.slice(0, start) + insert + value.slice(end)
    if (nextValue.length > maxLength) {
        return null
    }
    return { value: nextValue, caret: start + insert.length }
}
