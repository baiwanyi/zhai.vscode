/**
 * 卷纲 AI 字段：把核心事件与卷末结果两个字段的元数据和生成态推导收在一处。
 * 复用约定：底层取 components/AiTextareaField，字段元数据按 VolumeFieldKey 索引；
 * 调用方只传值、生成状态与回调，isGenerating / isDisabled / 按钮文案由 field 推导。
 * 关键约束：field 决定输入框 id 与文案，两个字段的 id 不能重复；maxLength 只对核心事件生效。
 */
import type { VolumeFieldKey } from '@shared/types/press'
import { AiTextareaField } from '@webview/components/AiTextareaField'
import type { JSX, ReactNode } from 'react'

interface VolumeEditAiFieldProps {
    field: VolumeFieldKey
    value: string
    description?: ReactNode
    maxLength?: number
    generatingField: VolumeFieldKey | null
    onChange: (value: string) => void
    onGenerate: (field: VolumeFieldKey) => void
}

/** 字段元数据：id 与文案按生成字段索引，避免两个调用点各写一遍后逐渐漂移 */
const FIELD_META: Record<VolumeFieldKey, { id: string; label: string; placeholder: string; generateLabel: string }> = {
    coreEvent: {
        id: 'outline-volume-edit-core',
        label: '核心事件',
        placeholder: '这一卷真正发生了什么：谁因为什么必须去做什么，代价是什么',
        generateLabel: 'AI 生成核心事件',
    },
    result: {
        id: 'outline-volume-edit-result',
        label: '卷末结果',
        placeholder: '目标达成 / 失败、付出的代价，以及留给下一卷的新问题',
        generateLabel: 'AI 生成卷末结果',
    },
}

export function VolumeEditAiField({
    field,
    value,
    description,
    maxLength,
    generatingField,
    onChange,
    onGenerate,
}: VolumeEditAiFieldProps): JSX.Element {
    const meta = FIELD_META[field]
    return (
        <AiTextareaField
            id={meta.id}
            label={meta.label}
            value={value}
            maxLength={maxLength}
            placeholder={meta.placeholder}
            description={description}
            isGenerating={generatingField === field}
            isDisabled={generatingField !== null}
            generateLabel={meta.generateLabel}
            onChange={onChange}
            onGenerate={(): void => onGenerate(field)}
        />
    )
}
