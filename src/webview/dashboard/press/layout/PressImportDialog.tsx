/**
 * 导入确认弹窗：展示预检结果（编码、章节数、卷数、字数、首末章标题）并允许修正作品名与目标读者。
 * 复用 @components/ui 的 dialog、field、input、toggle-group，目标读者取值取自 shared/types/press；
 * 字数展示复用 dashboard 的 formatWordCount，与作品列表口径一致。
 * 关键约束：作品名以宿主建议值为初值，用户可改；预检告警逐条列出，让用户在落盘前决定是否继续；
 * 导入进行中禁用全部控件并拒绝关闭，避免任务在无提示的情况下继续写盘。
 */
import { useState } from 'react'
import { Button } from '@components/ui/button'
import { Checkbox } from '@components/ui/checkbox'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@components/ui/toggle-group'
import type { PressAudience, PressImportCandidate } from '@shared/types/press'
import { DEFAULT_PRESS_AUDIENCE, PRESS_AUDIENCES, readPressAudience } from '@shared/types/press'
import type { JSX } from 'react'
import { formatWordCount } from '../../utils'

/** 编码展示名：面向用户说明源文件编码，落盘统一转为 UTF-8 */
const ENCODING_LABELS: Readonly<Record<PressImportCandidate['encoding'], string>> = {
    'utf-8': 'UTF-8',
    'utf-8-bom': 'UTF-8（含 BOM）',
    gb18030: 'GB18030',
    'utf-16le': 'UTF-16 LE',
}

interface PressImportDialogProps {
    candidate: PressImportCandidate | null
    isImporting: boolean
    /** 导入完成后是否继续生成章节摘要 */
    shouldSummarize: boolean
    onSummaryChange: (value: boolean) => void
    onOpenChange: (open: boolean) => void
    onSubmit: (name: string, audience: PressAudience) => Promise<boolean>
}

export function PressImportDialog({
    candidate,
    isImporting,
    shouldSummarize,
    onSummaryChange,
    onOpenChange,
    onSubmit,
}: PressImportDialogProps): JSX.Element | null {
    const [name, setName] = useState(candidate?.suggestedName ?? '')
    const [audience, setAudience] = useState<PressAudience>(DEFAULT_PRESS_AUDIENCE)
    if (candidate === null) {
        return null
    }
    const trimmedName = name.trim()
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
        <Dialog open onOpenChange={handleOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>导入作品</DialogTitle>
                    <DialogDescription>
                        文件已通过安全检查，确认后将按作品结构写入 press/ 目录，正文原样保留。
                    </DialogDescription>
                </DialogHeader>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                    <div className="col-span-2 flex flex-col gap-0.5">
                        <dt className="text-muted-foreground text-xs">文件</dt>
                        <dd className="truncate">{candidate.fileName}</dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                        <dt className="text-muted-foreground text-xs">编码</dt>
                        <dd>{ENCODING_LABELS[candidate.encoding]}</dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                        <dt className="text-muted-foreground text-xs">章节</dt>
                        <dd>{`${String(candidate.chapterCount)} 章 · ${volumeLabel}`}</dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                        <dt className="text-muted-foreground text-xs">字数</dt>
                        <dd>{formatWordCount(candidate.charCount)}</dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                        <dt className="text-muted-foreground text-xs">首章</dt>
                        <dd className="truncate">{candidate.firstChapterTitle}</dd>
                    </div>
                    <div className="col-span-2 flex flex-col gap-0.5">
                        <dt className="text-muted-foreground text-xs">末章</dt>
                        <dd className="truncate">{candidate.lastChapterTitle}</dd>
                    </div>
                </dl>
                {candidate.warnings.length > 0 ? (
                    <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-4 text-xs">
                        {candidate.warnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                        ))}
                    </ul>
                ) : null}
                <FieldGroup>
                    <Field>
                        <FieldLabel htmlFor="press-import-name">作品名</FieldLabel>
                        <Input
                            id="press-import-name"
                            value={name}
                            maxLength={60}
                            disabled={isImporting}
                            onChange={(event) => setName(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    void handleSubmit()
                                }
                            }}
                        />
                    </Field>
                    <Field>
                        <FieldLabel>目标读者</FieldLabel>
                        <ToggleGroup
                            type="single"
                            variant="outline"
                            size="lg"
                            value={audience}
                            disabled={isImporting}
                            aria-label="目标读者"
                            className="w-full"
                            onValueChange={(value) => {
                                // single 允许再次点击取消选中；目标读者是必选项，空串时沿用当前值
                                if (value.length > 0) {
                                    setAudience(readPressAudience(value))
                                }
                            }}
                        >
                            {PRESS_AUDIENCES.map((item) => (
                                <ToggleGroupItem key={item} value={item} className="flex-1">
                                    {item}
                                </ToggleGroupItem>
                            ))}
                        </ToggleGroup>
                    </Field>
                </FieldGroup>
                <div className="flex items-start gap-2">
                    <Checkbox
                        id="press-import-summary"
                        checked={shouldSummarize}
                        disabled={isImporting}
                        onCheckedChange={(checked) => onSummaryChange(checked === true)}
                    />
                    <label htmlFor="press-import-summary" className="text-muted-foreground text-xs leading-5">
                        导入后分批生成章节摘要（消耗 AI 调用次数；失败不影响已导入的正文）
                    </label>
                </div>
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
