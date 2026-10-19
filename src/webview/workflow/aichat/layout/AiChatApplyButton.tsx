/**
 * AI 对话写回按钮：把助手回复写回编辑器，展示未应用 / 写入中 / 已应用三态。
 * 复用 @/components/ui 的 Button 与 AlertDialog，整篇覆盖前强制二次确认。
 * 关键约束：写回范围由宿主快照决定，本组件只上抛消息 id 对应的回调，不接触路径与行号。
 */
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import type { AiWriteScope } from '@/shared/types/aiChat'
import type { JSX } from 'react'

interface AiChatApplyButtonProps {
    /** 写回快照的作用域：整篇时点击需二次确认 */
    scope: AiWriteScope | null
    applied: boolean
    applying: boolean
    onApply: () => void
}

export function AiChatApplyButton({ scope, applied, applying, onApply }: AiChatApplyButtonProps): JSX.Element {
    const label = applied ? '已应用' : applying ? '写入中…' : '应用到编辑栏'
    const isDisabled = applied || applying

    if (scope === 'document' && !applied) {
        return (
            <AlertDialog>
                <AlertDialogTrigger asChild>
                    <Button size="xs" variant="outline" disabled={isDisabled}>
                        {label}
                    </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>覆盖整篇文档？</AlertDialogTitle>
                        <AlertDialogDescription>
                            将用生成结果替换整篇内容，写入后可在编辑器中按 Ctrl+Z 撤销。
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction onClick={onApply}>继续写入</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        )
    }

    return (
        <Button size="xs" variant="outline" disabled={isDisabled} onClick={onApply}>
            {label}
        </Button>
    )
}
