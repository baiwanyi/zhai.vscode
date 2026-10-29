/**
 * 提及检索弹窗：输入关键词查全文索引，选中即加入对话上下文。
 * 复用约定：外壳取 @components/ui/dialog，输入取 ui/input，候选按钮取 @webview/components/Button；
 * 关键约束：回车才发检索请求（不随每次按键打索引库）；空关键词与空结果都给明确提示，不静默；
 * 选中成功后由调用方关闭弹窗并刷新上下文清单，本组件不持有引用状态。
 */
import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@components/ui/dialog'
import { Input } from '@components/ui/input'
import type { AiMentionCandidate, AiMentionKind } from '@shared/types/aiChat'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

/** 候选类型的中文标签 */
const KIND_LABELS: Readonly<Record<AiMentionKind, string>> = {
    note: '笔记',
    chapter: '章节',
    other: '其他',
}

interface AiChatMentionDialogProps {
    open: boolean
    candidates: readonly AiMentionCandidate[]
    isSearching: boolean
    onSearch: (keyword: string) => void
    onPick: (candidate: AiMentionCandidate) => void
    onClose: () => void
}

export function AiChatMentionDialog({
    open,
    candidates,
    isSearching,
    onSearch,
    onPick,
    onClose,
}: AiChatMentionDialogProps): JSX.Element {
    const [keyword, setKeyword] = useState('')

    /** 检索：关键词为空时只清空输入，不发请求 */
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
                    <DialogTitle>引用笔记或章节</DialogTitle>
                    <DialogDescription>按标题或正文关键词检索索引，选中后加入本轮上下文</DialogDescription>
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
                    {candidates.length === 0 ? (
                        <div className="p-3 text-xs text-muted-foreground">
                            {isSearching ? '正在检索…' : '没有候选：换个关键词，或先重建索引'}
                        </div>
                    ) : (
                        candidates.map((candidate) => (
                            <Button
                                key={candidate.path}
                                variant="ghost"
                                className="h-auto w-full justify-start gap-2 rounded-none px-2 py-1.5 text-left"
                                onClick={() => onPick(candidate)}
                            >
                                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                                    {KIND_LABELS[candidate.kind]}
                                </span>
                                <span className="min-w-0 flex-1 truncate">{candidate.title}</span>
                            </Button>
                        ))
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
