/**
 * AI 对话待发送上下文清单：Attachment 呈现引用标签与体积，支持单条移除与一键清空。
 * 复用 @/components/ui 的 attachment 与 button 组件、../format 的体积折算，为纯展示组件。
 * 关键约束：移除回调只回传宿主生成的引用 id，不携带文件路径。
 */
import { FileText, TextSelect, X } from 'lucide-react'
import {
    Attachment,
    AttachmentAction,
    AttachmentActions,
    AttachmentContent,
    AttachmentDescription,
    AttachmentGroup,
    AttachmentMedia,
    AttachmentTitle,
} from '@/components/ui/attachment'
import { Button } from '@/components/ui/button'
import type { AiContextRef } from '@/shared/types/aiChat'
import type { JSX } from 'react'
import { describeContext } from '../utils'

interface AiChatContextListProps {
    contexts: AiContextRef[]
    onRemove: (id: string) => void
    onClear: () => void
}

/** 待发送上下文清单：Attachment 呈现标签与体积，支持单条移除与一键清空 */
export function AiChatContextList({ contexts, onRemove, onClear }: AiChatContextListProps): JSX.Element {
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">上下文 {contexts.length} 项</span>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={onClear}>
                    清空
                </Button>
            </div>
            <AttachmentGroup>
                {contexts.map((context) => (
                    <Attachment key={context.id} size="xs">
                        <AttachmentMedia>
                            {context.kind === 'selection' ? <TextSelect /> : <FileText />}
                        </AttachmentMedia>
                        <AttachmentContent>
                            <AttachmentTitle title={context.displayPath}>{context.label}</AttachmentTitle>
                            <AttachmentDescription>{describeContext(context)}</AttachmentDescription>
                        </AttachmentContent>
                        <AttachmentActions>
                            <AttachmentAction title="移除该引用" onClick={() => onRemove(context.id)}>
                                <X />
                            </AttachmentAction>
                        </AttachmentActions>
                    </Attachment>
                ))}
            </AttachmentGroup>
        </div>
    )
}
