/**
 * 基本信息字段组：作品名、笔名、预计字数、目标读者与题材类型。
 * 复用约定：控件取自 @components/ui 的 field、input 与 select，标签型题材由 TagField 承载；
 * 目标读者与字数在本地完成类型收窄，只向上抛出合法补丁。
 * 关键约束：作品名与目录名一一对应，只能在此修改展示名；数字输入清空时回退为 0 而不是 NaN。
 */
import { Field, FieldDescription, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import { TagField } from './TagField'
import type { SettingFieldsProps } from './sections'
import type { Audience } from '../types'
import type { JSX } from 'react'
import { AUDIENCE_OPTIONS, GENRE_OPTIONS } from '../constants'

export function PressSettingBasicFields({ setting, onChange }: SettingFieldsProps): JSX.Element {
    const handleAudienceChange = (value: string): void => {
        if (value.length === 0) {
            return
        }
        const next: Audience | undefined = AUDIENCE_OPTIONS.find((option) => option.value === value)?.value
        if (next) {
            onChange({ audience: next })
        }
    }

    const handleWordGoalChange = (value: string): void => {
        const parsed = Number(value)
        onChange({ wordGoal: Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0 })
    }

    return (
        <div className="grid grid-cols-1 gap-3 @md:grid-cols-2">
            <Field>
                <FieldLabel htmlFor="setting-title">作品名</FieldLabel>
                <Input
                    id="setting-title"
                    value={setting.title}
                    className="h-7"
                    onChange={(event) => onChange({ title: event.target.value })}
                />
                <FieldDescription>与作品目录名保持一致，重命名需在文件系统完成</FieldDescription>
            </Field>
            <Field>
                <FieldLabel htmlFor="setting-pen-name">笔名</FieldLabel>
                <Input
                    id="setting-pen-name"
                    value={setting.penName}
                    className="h-7"
                    onChange={(event) => onChange({ penName: event.target.value })}
                />
            </Field>
            <Field>
                <FieldLabel htmlFor="setting-word-goal">预计字数</FieldLabel>
                <Input
                    id="setting-word-goal"
                    type="number"
                    min={0}
                    step={10000}
                    value={setting.wordGoal > 0 ? setting.wordGoal : ''}
                    className="h-7 tabular-nums"
                    onChange={(event) => handleWordGoalChange(event.target.value)}
                />
            </Field>
            <Field>
                <FieldLabel htmlFor="setting-audience">目标读者</FieldLabel>
                <Select value={setting.audience} onValueChange={handleAudienceChange}>
                    <SelectTrigger id="setting-audience" className="h-7 w-full">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            {AUDIENCE_OPTIONS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </Field>
            <Field className="@md:col-span-2">
                <FieldLabel htmlFor="setting-genres">题材类型</FieldLabel>
                <TagField
                    inputId="setting-genres"
                    value={setting.genres}
                    options={GENRE_OPTIONS}
                    placeholder="自定义题材，回车添加"
                    onChange={(genres) => onChange({ genres })}
                />
            </Field>
        </div>
    )
}
