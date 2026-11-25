/**
 * AI 输入卡片的芯片映射：把已挂规则、参考图与上下文引用折算成 RichChip，供输入区首行内联展示。
 * 复用约定：图标取 lucide-react，参考图缩略图取 @webview/components/Image，文件名 / 行号 / 字数摘要取 ../utils，
 * 悬停路径取 @shared/utils/zhaiPath 的存储根折算；展示字段只在这一层维护。
 * 关键约束：顺序恒为规则、参考图、上下文，与输入区展示顺序一致；
 * 规则芯片 id 以 `ai-rule-` 前缀加名称、参考图以 `ai-ref-` 前缀加路径，不得与上下文引用 id 复用。
 */
import { FileText, Layers, Library, MessageSquare, PencilRuler, TextSelect } from 'lucide-react'
import type { AiContextRef } from '@shared/types/aiChat'
import type { ImageReferenceItem } from '@shared/types/imageReference'
import { toZhaiDisplayPath } from '@shared/utils/zhaiPath'
import { Image } from '@webview/components/Image'
import type { RichChip } from './RichChipInput'
import type { JSX } from 'react'
import { describeContext, toContextFileName, toContextLineRange } from '../utils/chat/format'

/** 芯片集合入参：规则按挂载顺序，参考图与上下文按添加顺序 */
export interface BuildComposerChipsInput {
    /** 已挂规则名：作为提示词约束，与上下文分属两套预算 */
    ruleNames: readonly string[]
    /** 待发送参考图：随本轮请求以图片块提交 */
    references: readonly ImageReferenceItem[]
    contexts: AiContextRef[]
    /** 摘除规则：规则芯片的移除回调 */
    onRemoveRule: (ruleName: string) => void
    /** 摘除参考图：按路径移除该图 */
    onRemoveReference: (path: string) => void
}

/** 上下文芯片图标：笔记本用书库、行范围用选区、微信用对话、大纲快照用层叠图标，其余为文档图标 */
function buildContextIcon(kind: AiContextRef['kind']): JSX.Element {
    if (kind === 'notebook') {
        return <Library className="size-3 shrink-0 text-muted-foreground" />
    }
    if (kind === 'selection') {
        return <TextSelect className="size-3 shrink-0 text-muted-foreground" />
    }
    if (kind === 'weibo') {
        // 微博引用没有文件路径：图标区分来源，避免被误认成某篇笔记
        return <MessageSquare className="size-3 shrink-0 text-muted-foreground" />
    }
    if (kind === 'volumeOutline' || kind === 'chapterOutline') {
        // 大纲快照同样没有文件路径：用层叠图标区分来源，不伪装成某篇文档
        return <Layers className="size-3 shrink-0 text-muted-foreground" />
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

/** 参考图芯片：缩略图作前置图标，悬停文件名出大图，移除按钮摘掉该图 */
export function buildReferenceChip(reference: ImageReferenceItem, onRemove: () => void): RichChip {
    return {
        id: `ai-ref-${reference.path}`,
        label: reference.name,
        icon: <Image src={reference.url} alt={reference.name} size="sm" className="size-3.5 shrink-0 object-cover" />,
        preview: { src: reference.url, alt: reference.name },
        badgeClassName: 'max-w-40',
        removeLabel: '移除该参考图',
        onRemove,
    }
}

/** 芯片集合：规则、参考图、上下文依次排列，与输入区的展示顺序一致 */
export function buildComposerChips({
    ruleNames,
    references,
    contexts,
    onRemoveRule,
    onRemoveReference,
}: BuildComposerChipsInput): RichChip[] {
    return [
        ...ruleNames.map((ruleName) => buildRuleChip(ruleName, () => onRemoveRule(ruleName))),
        ...references.map((reference) => buildReferenceChip(reference, () => onRemoveReference(reference.path))),
        ...contexts.map(buildContextChip),
    ]
}
