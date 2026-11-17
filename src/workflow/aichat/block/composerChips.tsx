/**
 * AI 输入卡片的芯片映射：把已挂规则与上下文引用折算成 RichChip，供输入区首行内联展示。
 * 复用约定：图标取 lucide-react，文件名 / 行号 / 字数摘要取 ../utils，
 * 悬停路径取 @shared/utils/zhaiPath 的存储根折算；展示字段只在这一层维护。
 * 关键约束：规则芯片恒排在上下文之前，与输入区展示顺序一致；
 * 规则芯片 id 以 `ai-rule-` 前缀加名称，不得与上下文引用 id 复用。
 */
import { FileText, Library, PencilRuler, TextSelect } from 'lucide-react'
import type { AiContextRef } from '@shared/types/aiChat'
import { toZhaiDisplayPath } from '@shared/utils/zhaiPath'
import type { RichChip } from '@webview/components/RichChipInput'
import type { JSX } from 'react'
import { describeContext, toContextFileName, toContextLineRange } from '../utils'

/** 芯片集合入参：规则按挂载顺序，上下文按添加顺序 */
export interface BuildComposerChipsInput {
    /** 已挂规则名：作为提示词约束，与上下文分属两套预算 */
    ruleNames: readonly string[]
    contexts: AiContextRef[]
    /** 摘除规则：规则芯片的移除回调 */
    onRemoveRule: (ruleName: string) => void
}

/** 上下文芯片图标：笔记本用书库图标，行范围引用用选区图标，其余为文档图标 */
function buildContextIcon(kind: AiContextRef['kind']): JSX.Element {
    if (kind === 'notebook') {
        return <Library className="size-3 shrink-0 text-muted-foreground" />
    }
    if (kind === 'selection') {
        return <TextSelect className="size-3 shrink-0 text-muted-foreground" />
    }
    return <FileText className="size-3 shrink-0 text-muted-foreground" />
}

/** 上下文芯片：文件名悬停出 @zhai 存储根路径，尾部给字数 / 行数摘要，移除走页面回调 */
export function buildContextChip(context: AiContextRef): RichChip {
    return {
        id: context.id,
        label: toContextFileName(context),
        tail: toContextLineRange(context),
        icon: buildContextIcon(context.kind),
        hint: toZhaiDisplayPath(context.displayPath),
        meta: describeContext(context),
        removeLabel: '移除该引用',
    }
}

/** 规则芯片：名称即标识，移除按钮摘掉挂载，发送时不再注入该规则 */
export function buildRuleChip(ruleName: string, onRemove: () => void): RichChip {
    return {
        id: `ai-rule-${ruleName}`,
        label: ruleName,
        icon: <PencilRuler className="size-3 shrink-0 text-muted-foreground" />,
        badgeClassName: 'max-w-40',
        removeLabel: '移除该规则',
        onRemove,
    }
}

/** 芯片集合：规则、上下文依次排列，与输入区的展示顺序一致 */
export function buildComposerChips({ ruleNames, contexts, onRemoveRule }: BuildComposerChipsInput): RichChip[] {
    return [
        ...ruleNames.map((ruleName) => buildRuleChip(ruleName, () => onRemoveRule(ruleName))),
        ...contexts.map(buildContextChip),
    ]
}
