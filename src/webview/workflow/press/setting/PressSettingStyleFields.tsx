/**
 * 写作风格字段组：叙事人称、语言风格、参考作品与禁写清单。
 * 复用约定：控件取自 @components/ui 的 field、input 与 toggle-group，标签型雷点由 TagField 承载。
 * 关键约束：人称切换为单选且不允许取消，空值直接丢弃，避免把空字符串写回设定；
 * 禁写清单会参与续写与改写的排除条件，新增项须保持为可枚举的短语。
 */
import { Field, FieldDescription, FieldLabel, FieldTitle } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@components/ui/toggle-group'
import { TagField } from './TagField'
import type { SettingFieldsProps } from './sections'
import type { JSX } from 'react'
import { BANNED_OPTIONS, PERSPECTIVE_OPTIONS } from '../constants'

export function PressSettingStyleFields({ setting, onChange }: SettingFieldsProps): JSX.Element {
    return (
        <div className="grid grid-cols-1 gap-3 @md:grid-cols-2">
            <Field>
                <FieldTitle>叙事人称</FieldTitle>
                <ToggleGroup
                    type="single"
                    aria-label="叙事人称"
                    value={setting.perspective}
                    className="flex-wrap"
                    onValueChange={(value) => {
                        if (value.length > 0) {
                            onChange({ perspective: value })
                        }
                    }}
                >
                    {PERSPECTIVE_OPTIONS.map((option) => (
                        <ToggleGroupItem key={option} value={option} variant="outline">
                            {option}
                        </ToggleGroupItem>
                    ))}
                </ToggleGroup>
            </Field>
            <Field>
                <FieldLabel htmlFor="setting-tone">语言风格</FieldLabel>
                <Input
                    id="setting-tone"
                    value={setting.tone}
                    className="h-7"
                    onChange={(event) => onChange({ tone: event.target.value })}
                />
            </Field>
            <Field className="@md:col-span-2">
                <FieldLabel htmlFor="setting-references">参考作品</FieldLabel>
                <Input
                    id="setting-references"
                    value={setting.references}
                    className="h-7"
                    onChange={(event) => onChange({ references: event.target.value })}
                />
            </Field>
            <Field className="@md:col-span-2">
                <FieldLabel htmlFor="setting-banned">禁写清单</FieldLabel>
                <TagField
                    inputId="setting-banned"
                    value={setting.banned}
                    options={BANNED_OPTIONS}
                    placeholder="自定义雷点，回车添加"
                    onChange={(banned) => onChange({ banned })}
                />
                <FieldDescription>续写与改写会避开清单内的元素</FieldDescription>
            </Field>
        </div>
    )
}
