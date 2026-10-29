/**
 * 审批弹窗：承载两类待决事项 —— 写入确认（可改目标路径）与模型提问（选项作答）。
 * 复用 @components/ui 的 Dialog 与 @webview/components/Button；主体按事项 id 重挂载，切换时状态自然复位。
 * 关键约束：一次只处理队首事项，提交后由调用方出队；路径改写仍由宿主重新校验，前端不做白名单判断；
 * 关闭弹窗等同拒绝，避免等待中的工具调用一直挂到超时。
 */
import { useState } from 'react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@components/ui/dialog'
import { Input } from '@components/ui/input'
import type { AiAskQuestion, AiPermissionDecision, AiPermissionRequest } from '@shared/types/aiChat'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'
import { describeTool } from '../utils'

/** 多选答案的分隔符：SDK 的 answers 是问题到字符串的映射，多选需自行合并 */
const ANSWER_SEPARATOR = '、'

interface AiChatPermissionDialogProps {
    /** 队首待确认事项：null 时弹窗关闭 */
    pending: AiPermissionRequest | null
    onRespond: (decision: AiPermissionDecision) => void
}

export function AiChatPermissionDialog({ pending, onRespond }: AiChatPermissionDialogProps): JSX.Element {
    const isQuestion = pending?.kind === 'question'
    return (
        <Dialog open={pending !== null} onOpenChange={(open) => (open ? undefined : onRespond({ allowed: false }))}>
            <DialogContent className="max-w-xl">
                <DialogHeader>
                    <DialogTitle>{isQuestion ? '需要你补充信息' : '确认写入'}</DialogTitle>
                    <DialogDescription>
                        {isQuestion ? '模型需要你做出选择后才能继续。' : '该操作会修改磁盘文件，确认后立即执行。'}
                    </DialogDescription>
                </DialogHeader>
                {pending === null ? null : isQuestion ? (
                    <QuestionBody key={pending.id} request={pending} onSubmit={onRespond} />
                ) : (
                    <ToolBody key={pending.id} request={pending} onSubmit={onRespond} />
                )}
            </DialogContent>
        </Dialog>
    )
}

interface BodyProps {
    request: AiPermissionRequest
    onSubmit: (decision: AiPermissionDecision) => void
}

/** 写入确认：写入类工具允许改目标路径，其余只展示摘要 */
function ToolBody({ request, onSubmit }: BodyProps): JSX.Element {
    const [path, setPath] = useState(request.editablePath ?? '')
    return (
        <>
            <div className="flex flex-col gap-2">
                <span className="text-sm">
                    模型请求{describeTool(request.toolName)}
                    {request.editablePath === null ? '：' : ''}
                </span>
                {request.editablePath === null ? (
                    <span className="break-all text-sm text-muted-foreground">{request.detail}</span>
                ) : (
                    <Input value={path} aria-label="目标路径" onChange={(event) => setPath(event.target.value)} />
                )}
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={() => onSubmit({ allowed: false })}>
                    拒绝
                </Button>
                <Button variant="primary" onClick={() => onSubmit({ allowed: true, path })}>
                    允许
                </Button>
            </DialogFooter>
        </>
    )
}

/** 模型提问：每个问题各选一轮，多选以顿号合并后回传 */
function QuestionBody({ request, onSubmit }: BodyProps): JSX.Element {
    const [answers, setAnswers] = useState<Record<string, string[]>>({})

    const toggle = (question: AiAskQuestion, label: string): void => {
        setAnswers((previous) => {
            const picked = previous[question.question] ?? []
            const next = question.multiSelect
                ? picked.includes(label)
                    ? picked.filter((item) => item !== label)
                    : [...picked, label]
                : [label]
            return { ...previous, [question.question]: next }
        })
    }

    const isComplete = request.questions.every((question) => (answers[question.question] ?? []).length > 0)

    const submit = (): void => {
        const merged: Record<string, string> = {}
        for (const question of request.questions) {
            const picked = answers[question.question] ?? []
            if (picked.length > 0) {
                merged[question.question] = picked.join(ANSWER_SEPARATOR)
            }
        }
        onSubmit({ allowed: true, answers: merged })
    }

    return (
        <>
            <div className="flex flex-col gap-4">
                {request.questions.map((question) => (
                    <div key={question.question} className="flex flex-col gap-2">
                        <span className="text-sm font-medium">{question.question}</span>
                        <div className="flex flex-wrap gap-1.5">
                            {question.options.map((option) => {
                                const isSelected = (answers[question.question] ?? []).includes(option.label)
                                return (
                                    <Button
                                        key={option.label}
                                        variant={isSelected ? 'primary' : 'outline'}
                                        tooltip={option.description.length > 0 ? option.description : undefined}
                                        onClick={() => toggle(question, option.label)}
                                    >
                                        {option.label}
                                    </Button>
                                )
                            })}
                        </div>
                        {question.multiSelect ? <span className="text-xs text-muted-foreground">可多选</span> : null}
                    </div>
                ))}
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={() => onSubmit({ allowed: false })}>
                    跳过
                </Button>
                <Button variant="primary" disabled={!isComplete} onClick={submit}>
                    提交
                </Button>
            </DialogFooter>
        </>
    )
}
