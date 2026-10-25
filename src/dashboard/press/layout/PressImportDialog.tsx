/**
 * 导入确认弹窗：展示预检结果（编码、章节数、卷数、字数、首末章标题）并允许修正作品名与目标读者。
 * 复用 @components/ui 的 dialog、field、textarea、alert、toggle-group，目标读者取值取自 shared/types/press；
 * 字数展示复用 dashboard 的 formatWordCount，与作品列表口径一致。
 * 关键约束：作品名以宿主建议值为初值，用户可改；预检告警逐条列出，让用户在落盘前决定是否继续；
 * 导入只负责写入正文，不触发 AI 归纳（归纳改由作品设定页 / 大纲页手动发起）；
 * 导入进行中禁用全部控件并拒绝关闭，避免任务在无提示的情况下继续写盘。
 */
import { TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@components/ui/alert'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@components/ui/field'
import { Textarea } from '@components/ui/textarea'
import type { PressAudience, PressImportCandidate } from '@shared/types/press'
import { DEFAULT_PRESS_AUDIENCE, PRESS_AUDIENCES, readPressAudience } from '@shared/types/press'
import { Button } from '@webview/components/Button'
import { SegmentedRail } from '@webview/components/SegmentedRail'
import { formatWordCount } from '@webview/dashboard/utils'
import type { JSX } from 'react'

/** 编码展示名：面向用户说明源文件编码，落盘统一转为 UTF-8 */
const ENCODING_LABELS: Readonly<Record<PressImportCandidate['encoding'], string>> = {
    'utf-8': 'UTF-8',
    'utf-8-bom': 'UTF-8（含 BOM）',
    gb18030: 'GB18030',
    'utf-16le': 'UTF-16 LE',
}

interface PressImportDialogProps {
    /** 可见性与其他弹窗保持同一契约：由父级传入 open + onOpenChange，不靠 open 字面量硬编码 */
    open: boolean
    candidate: PressImportCandidate | null
    isImporting: boolean
    onOpenChange: (open: boolean) => void
    onSubmit: (name: string, audience: PressAudience) => Promise<boolean>
}

export function PressImportDialog({
    open,
    candidate,
    isImporting,
    onOpenChange,
    onSubmit,
}: PressImportDialogProps): JSX.Element | null {
    const [name, setName] = useState(candidate?.suggestedName ?? '')
    const [audience, setAudience] = useState<PressAudience>(DEFAULT_PRESS_AUDIENCE)
    if (candidate === null) {
        return null
    }
    // 作品名按单行语义提交：textarea 里的换行与连续空白折叠成一个空格，避免带进目录名
    const trimmedName = name.replace(/\s+/g, ' ').trim()
    const isSubmitDisabled = isImporting || trimmedName.length === 0
    const volumeLabel = candidate.volumeCount > 0 ? `${String(candidate.volumeCount)} 卷` : '未分卷'

    const handleOpenChange = (next: boolean): void => {
        if (isImporting) {
            return
        }
        onOpenChange(next)
    }

    const handleSubmit = async (): Promise<void> => {
        if (isSubmitDisabled) {
            return
        }
        await onSubmit(trimmedName, audience)
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle className="text-lg">导入作品</DialogTitle>
                    <DialogDescription>
                        文件已通过安全检查，确认后将按作品结构写入作品目录，正文原样保留。
                    </DialogDescription>
                </DialogHeader>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
                    <div className="col-span-2 flex flex-col gap-0.5">
                        <dt className="text-muted-foreground">文件</dt>
                        <dd className="truncate">{candidate.fileName}</dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                        <dt className="text-muted-foreground">编码</dt>
                        <dd>{ENCODING_LABELS[candidate.encoding]}</dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                        <dt className="text-muted-foreground">章节</dt>
                        <dd>{`${String(candidate.chapterCount)} 章 · ${volumeLabel}`}</dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                        <dt className="text-muted-foreground">字数</dt>
                        <dd>{formatWordCount(candidate.charCount)}</dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                        <dt className="text-muted-foreground">首章</dt>
                        <dd className="truncate">{candidate.firstChapterTitle}</dd>
                    </div>
                    <div className="col-span-2 flex flex-col gap-0.5">
                        <dt className="text-muted-foreground">末章</dt>
                        <dd className="truncate">{candidate.lastChapterTitle}</dd>
                    </div>
                </dl>
                {candidate.warnings.length > 0 ? (
                    <Alert variant="destructive">
                        <TriangleAlert />
                        <AlertTitle>预检提醒</AlertTitle>
                        <AlertDescription>
                            <ul className="flex list-disc flex-col gap-1 pl-4">
                                {candidate.warnings.map((warning) => (
                                    <li key={warning}>{warning}</li>
                                ))}
                            </ul>
                        </AlertDescription>
                    </Alert>
                ) : null}
                <FieldGroup>
                    <Field>
                        <FieldLabel htmlFor="press-import-name">作品名</FieldLabel>
                        <Textarea
                            id="press-import-name"
                            value={name}
                            rows={2}
                            maxLength={60}
                            disabled={isImporting}
                            onChange={(event) => setName(event.target.value)}
                            onKeyDown={(event) => {
                                // Enter 提交由弹窗接管，避免换行混入作品名；输入法组合中的 Enter 交给输入法处理
                                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                                    event.preventDefault()
                                    void handleSubmit()
                                }
                            }}
                        />
                    </Field>
                    <Field>
                        <FieldLabel>目标读者</FieldLabel>
                        <SegmentedRail
                            items={PRESS_AUDIENCES.map((item) => ({ value: item, label: item }))}
                            value={audience}
                            onChange={(value) => setAudience(readPressAudience(value))}
                            ariaLabel="目标读者"
                            variant="outline"
                            size="lg"
                            isDisabled={isImporting}
                        />
                    </Field>
                </FieldGroup>
                <DialogFooter>
                    <Button variant="outline" disabled={isImporting} onClick={() => onOpenChange(false)}>
                        取消
                    </Button>
                    <Button disabled={isSubmitDisabled} onClick={() => void handleSubmit()}>
                        开始导入
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
