/**
 * 参考资料检索弹窗：输入关键词查 {存储根}/reference 语料，选中即按条目行范围注入上下文。
 * 复用约定：外壳取 @components/ui/dialog，输入取 ui/input，结果项取 @webview/components/Button；
 * 关键约束：回车才发检索请求；空关键词与空结果都给明确提示；语料为空时提示去「打开语料目录」放文件。
 */
import { useState } from 'react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@components/ui/dialog'
import { Input } from '@components/ui/input'
import type { AiReferenceEntry } from '@shared/types/aiChat'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

interface AiChatReferenceDialogProps {
    open: boolean
    entries: readonly AiReferenceEntry[]
    isSearching: boolean
    onSearch: (keyword: string) => void
    onPick: (entry: AiReferenceEntry) => void
    onClose: () => void
}

export function AiChatReferenceDialog({
    open,
    entries,
    isSearching,
    onSearch,
    onPick,
    onClose,
}: AiChatReferenceDialogProps): JSX.Element {
    const [keyword, setKeyword] = useState('')

    const submit = (): void => {
        if (keyword.trim().length === 0) {
            return
        }
        onSearch(keyword)
    }

    return (
        <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>检索参考资料</DialogTitle>
                    <DialogDescription>
                        语料来自存储根下的 reference 目录，按一级标题分类、二级标题分条；选中只注入该条正文
                    </DialogDescription>
                </DialogHeader>
                <div className="flex items-center gap-2">
                    <Input
                        autoFocus
                        value={keyword}
                        placeholder="输入关键词后回车"
                        onChange={(event) => setKeyword(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                submit()
                            }
                        }}
                    />
                    <Button variant="secondary" disabled={isSearching} onClick={submit}>
                        {isSearching ? '检索中…' : '检索'}
                    </Button>
                </div>
                <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
                    {entries.length === 0 ? (
                        <div className="p-3 text-xs text-muted-foreground">
                            {isSearching ? '正在检索…' : '没有匹配的条目：换个关键词，或先在「打开语料目录」里放入 .md 语料'}
                        </div>
                    ) : (
                        entries.map((entry) => (
                            <Button
                                key={`${entry.file}-${String(entry.startLine)}`}
                                variant="ghost"
                                className="h-auto w-full flex-col items-start gap-0.5 rounded-none px-2 py-1.5 text-left"
                                onClick={() => onPick(entry)}
                            >
                                <span className="flex w-full items-center gap-2">
                                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                                        {entry.category}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                                </span>
                                {entry.snippet.length > 0 ? (
                                    <span className="w-full truncate text-xs font-normal text-muted-foreground">
                                        {entry.snippet}
                                    </span>
                                ) : null}
                            </Button>
                        ))
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
