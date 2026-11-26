/**
 * 结构模板对话框：从三套结构模板里挑一套，按「追加 / 覆盖」套用到结构纲。
 * 复用约定：骨架取 @webview/components/Dialog，字段取 @components/ui/field，下拉取 components/OptionSelect，
 * 模式切换取 components/SegmentedRail，模板清单取 constants 的 STRUCTURE_TEMPLATES。
 * 关键约束：模板只预填阶段名、转折类型与叙事作用，卷位与事件留给作者；已有阶段时默认不覆盖，
 * 由作者显式选择覆盖模式；套用结果一次性回传，对话框不持有结构纲数据。
 */
import { useState } from 'react'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@components/ui/field'
import { Dialog } from '@webview/components/Dialog'
import { OptionSelect } from '@webview/components/OptionSelect'
import { SegmentedRail } from '@webview/components/SegmentedRail'
import type { OptionMeta, StructureTemplate } from '../../constants'
import type { JSX } from 'react'
import { STRUCTURE_TEMPLATES } from '../../constants'

/** 套用模式：追加到现有阶段之后，或整批替换 */
export type StructureTemplateMode = 'append' | 'replace'

/** 模式选项：覆盖是破坏性动作，文案里直接写清后果 */
const MODE_OPTIONS: readonly OptionMeta<StructureTemplateMode>[] = [
    { value: 'append', label: '追加' },
    { value: 'replace', label: '覆盖' },
]

interface StructureTemplateDialogProps {
    isOpen: boolean
    onOpenChange: (isOpen: boolean) => void
    /** 是否已有阶段：覆盖前必须由作者确认 */
    hasExistingActs: boolean
    onApply: (template: StructureTemplate, mode: StructureTemplateMode) => void
}

/** 结构模板：选模板 + 选模式 + 一次套用 */
export function StructureTemplateDialog({
    isOpen,
    onOpenChange,
    hasExistingActs,
    onApply,
}: StructureTemplateDialogProps): JSX.Element {
    const [templateId, setTemplateId] = useState(STRUCTURE_TEMPLATES[0]?.id ?? '')
    const [mode, setMode] = useState<StructureTemplateMode>(hasExistingActs ? 'append' : 'replace')
    const template = STRUCTURE_TEMPLATES.find((item) => item.id === templateId) ?? STRUCTURE_TEMPLATES[0]

    const handleConfirm = (): void => {
        if (template === undefined) {
            return
        }
        onApply(template, mode)
        onOpenChange(false)
    }

    return (
        <Dialog
            open={isOpen}
            onOpenChange={onOpenChange}
            title="套用结构模板"
            description="预填一组全书转折，套用后仍可逐项修改"
            confirmLabel="套用"
            isDisabled={template === undefined}
            onConfirm={handleConfirm}
        >
            <FieldGroup>
                <Field>
                    <FieldLabel>模板</FieldLabel>
                    <OptionSelect
                        value={templateId}
                        options={STRUCTURE_TEMPLATES.map((item) => ({ value: item.id, label: item.label }))}
                        ariaLabel="结构模板"
                        onChange={setTemplateId}
                    />
                    <FieldDescription>{template?.description ?? ''}</FieldDescription>
                </Field>
                <Field>
                    <FieldLabel>套用方式</FieldLabel>
                    <SegmentedRail
                        items={MODE_OPTIONS}
                        value={mode}
                        onChange={setMode}
                        ariaLabel="套用方式"
                        isStretched={false}
                    />
                    <FieldDescription>
                        {hasExistingActs
                            ? '追加保留现有阶段；覆盖会清空当前全部阶段，确认后不可撤销'
                            : '当前还没有阶段，套用即写入模板内容'}
                    </FieldDescription>
                </Field>
                <Field>
                    <FieldLabel>将写入的阶段</FieldLabel>
                    <ol className="flex flex-col gap-1 text-muted-foreground text-sm">
                        {(template?.acts ?? []).map((act) => (
                            <li key={act.name}>
                                {act.name}
                                {act.narrativeRole.length > 0 ? ` · ${act.narrativeRole}` : ''}
                            </li>
                        ))}
                    </ol>
                </Field>
            </FieldGroup>
        </Dialog>
    )
}
