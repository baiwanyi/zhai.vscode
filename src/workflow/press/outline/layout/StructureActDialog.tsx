/**
 * 结构纲阶段编辑对话框：编辑阶段名、转折类型、卷位、叙事作用、关键事件与主角变化。
 * 复用约定：骨架取 @webview/components/Dialog，字段取 @components/ui/field，输入取 ui/input / textarea，下拉取 components/OptionSelect。
 * 关键约束：编辑期只在本地草稿改，保存才回传；调用方以阶段 id 作 key，避免草稿串到上一次编辑的阶段。
 */
import { useState } from 'react'
import { Field, FieldGroup, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { Textarea } from '@components/ui/textarea'
import { Dialog } from '@webview/components/Dialog'
import { OptionSelect } from '@webview/components/OptionSelect'
import type { OutlineAct } from '../../types'
import type { JSX } from 'react'
import { ACT_KIND_OPTIONS } from '../../constants'

/** 卷位下拉的空值：受控 Select 不接受空串 */
const NO_VOLUME = 'none'

interface StructureActDialogProps {
    isOpen: boolean
    onOpenChange: (isOpen: boolean) => void
    act: OutlineAct
    /** 卷位选项：value 为卷序字符串，label 为「第N卷 卷名」 */
    volumeOptions: readonly { value: string; label: string }[]
    onSave: (act: OutlineAct) => void
}

/** 结构阶段编辑：本地草稿与父级列表隔离，确认后一次性回传 */
export function StructureActDialog({
    isOpen,
    onOpenChange,
    act,
    volumeOptions,
    onSave,
}: StructureActDialogProps): JSX.Element {
    const [draft, setDraft] = useState<OutlineAct>(act)

    const patch = (changes: Partial<OutlineAct>): void => {
        setDraft((current) => ({ ...current, ...changes }))
    }

    const handleConfirm = (): void => {
        onSave(draft)
        onOpenChange(false)
    }

    return (
        <Dialog size="full"
            open={isOpen}
            title="编辑结构阶段"
            description="只记全书级转折，卷级转折见卷纲"
            onOpenChange={onOpenChange}
            onConfirm={handleConfirm}
        >
            <FieldGroup>
                <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-2.5">
                    <Field>
                        <FieldLabel htmlFor="outline-act-name">阶段名</FieldLabel>
                        <Input
                            id="outline-act-name"
                            value={draft.name}
                            placeholder="中点 / 低谷 / 高潮"
                            onChange={(event): void => patch({ name: event.target.value })}
                        />
                    </Field>
                    <Field>
                        <FieldLabel>转折类型</FieldLabel>
                        <OptionSelect
                            value={draft.kind}
                            options={ACT_KIND_OPTIONS}
                            ariaLabel="转折类型"
                            onChange={(kind): void => patch({ kind })}
                        />
                    </Field>
                </div>

                <Field>
                    <FieldLabel>卷位</FieldLabel>
                    <OptionSelect
                        value={draft.volumeOrder === null ? NO_VOLUME : String(draft.volumeOrder)}
                        options={[{ value: NO_VOLUME, label: '未定' }, ...volumeOptions]}
                        ariaLabel="卷位"
                        onChange={(value): void => {
                            const order = Number(value)
                            patch({
                                volumeOrder:
                                    value === NO_VOLUME || !Number.isInteger(order) || order <= 0 ? null : order,
                            })
                        }}
                    />
                </Field>

                <Field>
                    <FieldLabel htmlFor="outline-act-role">叙事作用</FieldLabel>
                    <Input
                        id="outline-act-role"
                        value={draft.narrativeRole}
                        placeholder="打破平衡 / 赌注升级 / 迫使选择"
                        onChange={(event): void => patch({ narrativeRole: event.target.value })}
                    />
                </Field>

                <Field>
                    <FieldLabel htmlFor="outline-act-event">关键事件</FieldLabel>
                    <Textarea
                        id="outline-act-event"
                        rows={3}
                        value={draft.event}
                        placeholder="这一阶段真正发生了什么"
                        onChange={(event): void => patch({ event: event.target.value })}
                    />
                </Field>

                <Field>
                    <FieldLabel htmlFor="outline-act-change">主角变化</FieldLabel>
                    <Textarea
                        id="outline-act-change"
                        rows={3}
                        value={draft.protagonistChange}
                        placeholder="这个转折让主角的弧光走到哪一步"
                        onChange={(event): void => patch({ protagonistChange: event.target.value })}
                    />
                </Field>
            </FieldGroup>
        </Dialog>
    )
}
