/**
 * 故事内核字段组：一句话梗概、核心冲突与结局倾向。
 * 复用约定：控件取自 @components/ui 的 field、textarea 与 select，结局取值经 ENDING_OPTIONS 收窄后回传。
 * 关键约束：梗概限 120 字，字数余量随输入实时变化，超长由 maxLength 阻断而不是事后校验。
 */
import { Field, FieldDescription, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import { Textarea } from '@components/ui/textarea'
import type { SettingFieldsProps } from './sections'
import type { EndingKind } from '../types'
import type { JSX } from 'react'
import { ENDING_OPTIONS } from '../constants'

/** 梗概字数上限：与下方计数器共用，避免两处各写一个数字 */
const LOGLINE_MAX_LENGTH = 120

export function PressSettingStoryFields({ setting, onChange }: SettingFieldsProps): JSX.Element {
    const handleEndingChange = (value: string): void => {
        const next: EndingKind | undefined = ENDING_OPTIONS.find((option) => option.value === value)?.value
        if (next) {
            onChange({ ending: next })
        }
    }

    return (
        <div className="flex flex-col gap-3">
            <Field>
                <FieldLabel htmlFor="setting-logline">一句话梗概</FieldLabel>
                <Textarea
                    id="setting-logline"
                    value={setting.logline}
                    placeholder="谁，在什么处境下，要做什么，代价是什么"
                    className="min-h-16"
                    maxLength={LOGLINE_MAX_LENGTH}
                    onChange={(event) => onChange({ logline: event.target.value })}
                />
                <FieldDescription className="tabular-nums">
                    还可输入 {LOGLINE_MAX_LENGTH - setting.logline.length} 字
                </FieldDescription>
            </Field>
            <div className="grid grid-cols-1 gap-3 @md:grid-cols-2">
                <Field>
                    <FieldLabel htmlFor="setting-conflict">核心冲突</FieldLabel>
                    <Input
                        id="setting-conflict"
                        value={setting.conflict}
                        className="h-7"
                        onChange={(event) => onChange({ conflict: event.target.value })}
                    />
                </Field>
                <Field>
                    <FieldLabel htmlFor="setting-ending">结局倾向</FieldLabel>
                    <Select value={setting.ending} onValueChange={handleEndingChange}>
                        <SelectTrigger id="setting-ending" className="h-7 w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {ENDING_OPTIONS.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                        {option.label}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </Field>
            </div>
        </div>
    )
}
