/**
 * 源码模式编辑区：直接编辑 Markdown 原文，作为往返异常时的兜底通道。
 * 复用约定：shadcn Textarea 撑满剩余高度，等宽字体；保存与退出状态由 useSourceMode 提供。
 * 关键约束：错误文案必须常驻显示（stale 时用户还在源码模式里，改动尚未落盘）；
 * 保存按钮走「保存并返回」一个动作，不做「保存」与「返回」两个按钮——后者容易点错丢改动。
 */
import { Textarea } from '@components/ui/textarea'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

export interface SourceEditorProps {
    content: string
    isSaving: boolean
    error: string | null
    onChange: (content: string) => void
    onExit: () => Promise<void>
}

export function SourceEditor({ content, isSaving, error, onChange, onExit }: SourceEditorProps): JSX.Element {
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-1.5 text-xs text-muted-foreground">
                <span>源码模式 · Ctrl+Shift+M 返回</span>
                <div className="flex items-center gap-2">
                    {error === null ? null : <span className="text-destructive">{error}</span>}
                    <Button size="sm" variant="ghost" isLoading={isSaving} onClick={(): void => void onExit()}>
                        保存并返回
                    </Button>
                </div>
            </div>
            <Textarea
                autoFocus
                value={content}
                spellCheck={false}
                onChange={(event): void => {
                    onChange(event.target.value)
                }}
                className="min-h-0 flex-1 resize-none rounded-none border-0 px-6 py-4 font-mono text-sm shadow-none focus-visible:ring-0"
            />
        </div>
    )
}
