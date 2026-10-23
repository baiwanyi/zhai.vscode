/**
 * 取名条件字段：一套条件表单，顺序为生成数量 → 人物 / 实体字段 → 具体要求。
 * 复用约定：字段布局复用 ui/field-group + ui/field，人物与实体字段分别委托 NamingPersonFields /
 * NamingEntityFields，数量复用 ui/toggle-group 的 outline 分段样式（与位置 / 类型、性别 / 字数同一套尺寸）。
 * 关键约束：本组件只收集条件，容器与留白由页面提供；生成方式开关与生成 / 取消按钮在页面底部操作区，
 * 数量只接受宿主下发的候选值，非法值不会写入条件。
 */
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@components/ui/field'
import { Textarea } from '@components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@components/ui/toggle-group'
import type { NamingCatalog, NamingRequest, NamingSurnameKind } from '@shared/types/naming'
import { NamingEntityFields } from './NamingEntityFields'
import { NamingPersonFields } from './NamingPersonFields'
import type { JSX } from 'react'
import { MAX_REQUIREMENT_LENGTH } from '../constants'
import { readCategoryMeta } from '../utils'

interface NamingConditionFieldsProps {
    catalog: NamingCatalog
    request: NamingRequest
    onChange: (patch: Partial<NamingRequest>) => void
    onSurnameKindChange: (kind: NamingSurnameKind) => void
    onRandomSurname: () => void
    onRandomSuffix: () => void
}

export function NamingConditionFields({
    catalog,
    request,
    onChange,
    onSurnameKindChange,
    onRandomSurname,
    onRandomSuffix,
}: NamingConditionFieldsProps): JSX.Element {
    const meta = readCategoryMeta(catalog, request.category)
    return (
        <FieldGroup className="gap-3">
            <Field>
                <FieldLabel>生成数量</FieldLabel>
                <ToggleGroup
                    type="single"
                    variant="outline"
                    spacing={0}
                    value={String(request.count)}
                    onValueChange={(value) => {
                        if (value) {
                            onChange({ count: Number(value) })
                        }
                    }}
                    className="w-full"
                >
                    {catalog.counts.map((count) => (
                        <ToggleGroupItem key={count} value={String(count)} className="flex-1">
                            {count} 个
                        </ToggleGroupItem>
                    ))}
                </ToggleGroup>
            </Field>
            {meta?.isPerson ? (
                <NamingPersonFields
                    catalog={catalog}
                    request={request}
                    onChange={onChange}
                    onSurnameKindChange={onSurnameKindChange}
                    onRandomSurname={onRandomSurname}
                />
            ) : (
                <NamingEntityFields
                    catalog={catalog}
                    request={request}
                    onChange={onChange}
                    onRandomSuffix={onRandomSuffix}
                />
            )}
            <Field>
                <FieldLabel htmlFor="naming-requirement">具体要求</FieldLabel>
                <Textarea
                    id="naming-requirement"
                    value={request.requirement}
                    maxLength={MAX_REQUIREMENT_LENGTH}
                    rows={3}
                    placeholder="选填，如「靠海、偏远、破败」"
                    className="resize-none"
                    onChange={(event) => onChange({ requirement: event.target.value })}
                />
                <FieldDescription className="text-right">
                    {request.requirement.length} / {MAX_REQUIREMENT_LENGTH}
                </FieldDescription>
            </Field>
        </FieldGroup>
    )
}
