/**
 * 世界观字段组：世界观总述、地理、时代、势力、力量体系、核心概念与禁忌设定。
 * 复用约定：控件取自 @components/ui 的 field、input 与 textarea，多行说明性字段用 textarea 承载。
 * 关键约束：核心概念用分号分隔多个名词，续写注入时按同一规则切分，改写分隔符须同步宿主侧解析。
 */
import { Field, FieldDescription, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { Textarea } from '@components/ui/textarea'
import type { SettingFieldsProps } from './sections'
import type { JSX } from 'react'

export function PressSettingWorldFields({ setting, onChange }: SettingFieldsProps): JSX.Element {
    return (
        <div className="grid grid-cols-1 gap-3 @md:grid-cols-2">
            <Field className="@md:col-span-2">
                <FieldLabel htmlFor="setting-worldview">世界观总述</FieldLabel>
                <Textarea
                    id="setting-worldview"
                    value={setting.worldview}
                    placeholder="世界的形态、历史沿革、种族与文明结构"
                    className="min-h-24"
                    onChange={(event) => onChange({ worldview: event.target.value })}
                />
                <FieldDescription>导入作品时会依据设定候选章归纳这一段，续写时的风格注入首先读它</FieldDescription>
            </Field>
            <Field>
                <FieldLabel htmlFor="setting-geography">地理格局</FieldLabel>
                <Input
                    id="setting-geography"
                    value={setting.geography}
                    placeholder="主要地域、场景与空间关系"
                    className="h-7"
                    onChange={(event) => onChange({ geography: event.target.value })}
                />
            </Field>
            <Field>
                <FieldLabel htmlFor="setting-era">时代舞台</FieldLabel>
                <Input
                    id="setting-era"
                    value={setting.era}
                    className="h-7"
                    onChange={(event) => onChange({ era: event.target.value })}
                />
            </Field>
            <Field>
                <FieldLabel htmlFor="setting-factions">势力格局</FieldLabel>
                <Input
                    id="setting-factions"
                    value={setting.factions}
                    className="h-7"
                    onChange={(event) => onChange({ factions: event.target.value })}
                />
            </Field>
            <Field>
                <FieldLabel htmlFor="setting-power-system">力量体系</FieldLabel>
                <Input
                    id="setting-power-system"
                    value={setting.powerSystem}
                    className="h-7"
                    onChange={(event) => onChange({ powerSystem: event.target.value })}
                />
            </Field>
            <Field className="@md:col-span-2">
                <FieldLabel htmlFor="setting-concepts">核心概念</FieldLabel>
                <Textarea
                    id="setting-concepts"
                    value={setting.concepts}
                    placeholder="作品独有的名词与规则，如「灵气：天地间的能量，可被修士吸纳」"
                    className="min-h-20"
                    onChange={(event) => onChange({ concepts: event.target.value })}
                />
                <FieldDescription>独有名词是续写时不跑偏的关键，多个概念用分号分隔</FieldDescription>
            </Field>
            <Field className="@md:col-span-2">
                <FieldLabel htmlFor="setting-taboo">禁忌设定</FieldLabel>
                <Input
                    id="setting-taboo"
                    value={setting.taboo}
                    className="h-7"
                    onChange={(event) => onChange({ taboo: event.target.value })}
                />
            </Field>
        </div>
    )
}
