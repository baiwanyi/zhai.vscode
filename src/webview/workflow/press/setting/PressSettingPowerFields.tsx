/**
 * 金手指字段组：类型、能力描述与代价限制。
 * 复用约定：控件取自 @components/ui 的 field 与 input，类型字段用原生 datalist 提供预设候选，不引入额外弹层。
 * 关键约束：datalist 的 id 与 input 的 list 必须成对维护，类型允许自由输入，预设仅作加速填写。
 */
import { Field, FieldDescription, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import type { SettingFieldsProps } from './sections'
import type { JSX } from 'react'
import { GOLDEN_FINGER_TYPES } from '../constants'

export function PressSettingPowerFields({ setting, onChange }: SettingFieldsProps): JSX.Element {
    return (
        <div className="grid grid-cols-1 gap-3 @md:grid-cols-2">
            <Field>
                <FieldLabel htmlFor="setting-golden-type">类型</FieldLabel>
                <Input
                    id="setting-golden-type"
                    value={setting.goldenFingerType}
                    list="golden-finger-types"
                    className="h-7"
                    onChange={(event) => onChange({ goldenFingerType: event.target.value })}
                />
                <datalist id="golden-finger-types">
                    {GOLDEN_FINGER_TYPES.map((type) => (
                        <option key={type} value={type} />
                    ))}
                </datalist>
            </Field>
            <Field>
                <FieldLabel htmlFor="setting-golden-ability">能力描述</FieldLabel>
                <Input
                    id="setting-golden-ability"
                    value={setting.goldenFingerAbility}
                    className="h-7"
                    onChange={(event) => onChange({ goldenFingerAbility: event.target.value })}
                />
            </Field>
            <Field className="@md:col-span-2">
                <FieldLabel htmlFor="setting-golden-cost">代价与限制</FieldLabel>
                <Input
                    id="setting-golden-cost"
                    value={setting.goldenFingerCost}
                    className="h-7"
                    onChange={(event) => onChange({ goldenFingerCost: event.target.value })}
                />
                <FieldDescription>没有代价的金手指会削弱冲突，建议至少写一条限制</FieldDescription>
            </Field>
        </div>
    )
}
