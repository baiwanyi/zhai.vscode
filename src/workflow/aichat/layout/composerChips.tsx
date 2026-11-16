/**
 * AI 输入卡片的芯片映射：把已选命令与上下文引用折算成 RichChip，供输入区首行内联展示。
 * 复用约定：图标取 ./commandIcons 与 lucide-react，文件名 / 行号 / 字数摘要取 ../utils，
 * 悬停路径取 @shared/utils/zhaiPath 的存储根折算；展示字段只在这一层维护。
 * 关键约束：命令芯片恒排在上下文之前，与输入区展示顺序一致；
 * 命令芯片自带 onRemove（语义是取消命令），上下文芯片缺省回落 onRemoveChip(id)；
 * 命令芯片 id 是保留值，只用于 key 与退格查找，不得与上下文引用 id 复用。
 */
import { FileText, TextSelect } from 'lucide-react'
import type { AiContextRef } from '@shared/types/aiChat'
import { toZhaiDisplayPath } from '@shared/utils/zhaiPath'
import type { RichChip } from '@webview/components/RichChipInput'
import { COMMAND_ICONS } from './commandIcons'
import type { AiCommand } from '../constants'
import { describeContext, toContextFileName, toContextLineRange } from '../utils'

/** 命令芯片的保留 id：只用于 React key 与退格查找，移除语义由 onRemove 承担 */
const COMMAND_CHIP_ID = 'ai-command'

/** 芯片集合入参：命令可为空，上下文按添加顺序排列 */
export interface BuildComposerChipsInput {
    command: AiCommand | null
    contexts: AiContextRef[]
    /** 取消命令：命令芯片的移除语义由它承担，不走统一的移除引用回调 */
    onClearCommand: () => void
}

/** 命令芯片：图标取命令表，移除按钮即「取消命令」 */
export function buildCommandChip(command: AiCommand, onClearCommand: () => void): RichChip {
    const Icon = COMMAND_ICONS[command.id]
    return {
        id: COMMAND_CHIP_ID,
        label: command.title,
        icon: <Icon className="size-3 shrink-0 text-muted-foreground" />,
        badgeClassName: 'max-w-40',
        removeLabel: '取消命令',
        onRemove: onClearCommand,
    }
}

/** 上下文芯片：文件名悬停出 @zhai 存储根路径，尾部给字数 / 行数摘要，移除走页面回调 */
export function buildContextChip(context: AiContextRef): RichChip {
    return {
        id: context.id,
        label: toContextFileName(context),
        tail: toContextLineRange(context),
        icon:
            context.kind === 'selection' ? (
                <TextSelect className="size-3 shrink-0 text-muted-foreground" />
            ) : (
                <FileText className="size-3 shrink-0 text-muted-foreground" />
            ),
        hint: toZhaiDisplayPath(context.displayPath),
        meta: describeContext(context),
        removeLabel: '移除该引用',
    }
}

/** 芯片集合：命令在前、上下文按添加顺序随后，与输入区的展示顺序一致 */
export function buildComposerChips({ command, contexts, onClearCommand }: BuildComposerChipsInput): RichChip[] {
    return [
        ...(command === null ? [] : [buildCommandChip(command, onClearCommand)]),
        ...contexts.map(buildContextChip),
    ]
}
