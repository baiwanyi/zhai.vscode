/**
 * 人物条件区：地域、时代、参考典籍、性别、字数与姓氏六个维度，两列排布在条件卡片内。
 * 复用约定：下拉复用 ui/select（选项来自宿主 catalog），互斥选项复用 ui/toggle-group，姓氏行复用同目录 NamingSurnameField。
 * 关键约束：所有取值以宿主 catalog 的选项为准；点击已选中的单选按钮不改变状态（避免空值回写）。
 */
import { Field, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type {
    NamingCatalog,
    NamingEra,
    NamingGender,
    NamingNameLength,
    NamingReference,
    NamingRequest,
    NamingSurnameKind,
} from '@/shared/types/naming'
import { NamingSurnameField } from './NamingSurnameField'
import type { JSX } from 'react'
import { readCategoryMeta } from '../utils'

interface NamingPersonFieldsProps {
    catalog: NamingCatalog
    request: NamingRequest
    onChange: (patch: Partial<NamingRequest>) => void
    onSurnameKindChange: (kind: NamingSurnameKind) => void
    onRandomSurname: () => void
}

export function NamingPersonFields({
    catalog,
    request,
    onChange,
    onSurnameKindChange,
    onRandomSurname,
}: NamingPersonFieldsProps): JSX.Element | null {
    const meta = readCategoryMeta(catalog, request.category)
    if (!meta) {
        return null
    }
    return (
        <div className="grid grid-cols-2 gap-3">
            <Field>
                <FieldLabel htmlFor="naming-person-region">{meta.variantLabel}</FieldLabel>
                <Select value={request.variant} onValueChange={(value) => onChange({ variant: value })}>
                    <SelectTrigger id="naming-person-region" className="w-full" size="sm">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            {meta.variants.map((variant) => (
                                <SelectItem key={variant.value} value={variant.value}>
                                    {variant.label}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </Field>
            <Field>
                <FieldLabel htmlFor="naming-person-era">时代</FieldLabel>
                <Select
                    value={request.era}
                    onValueChange={(value) => onChange({ era: value as NamingEra })}
                >
                    <SelectTrigger id="naming-person-era" className="w-full" size="sm">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            {catalog.eras.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </Field>
            <Field className="col-span-2">
                <FieldLabel htmlFor="naming-person-reference">参考</FieldLabel>
                <Select
                    value={request.reference}
                    onValueChange={(value) => onChange({ reference: value as NamingReference })}
                >
                    <SelectTrigger id="naming-person-reference" className="w-full" size="sm">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            {catalog.references.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </Field>
            <Field className="col-span-2">
                <FieldLabel>性别</FieldLabel>
                <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    spacing={0}
                    value={request.gender}
                    onValueChange={(value) => {
                        if (value) {
                            onChange({ gender: value as NamingGender })
                        }
                    }}
                    className="w-full"
                >
                    {catalog.genders.map((option) => (
                        <ToggleGroupItem key={option.value} value={option.value} className="flex-1">
                            {option.label}
                        </ToggleGroupItem>
                    ))}
                </ToggleGroup>
            </Field>
            <Field className="col-span-2">
                <FieldLabel>字数（不含姓氏）</FieldLabel>
                <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    spacing={0}
                    value={request.length}
                    onValueChange={(value) => {
                        if (value) {
                            onChange({ length: value as NamingNameLength })
                        }
                    }}
                    className="w-full"
                >
                    {catalog.lengths.map((option) => (
                        <ToggleGroupItem key={option.value} value={option.value} className="flex-1">
                            {option.label}
                        </ToggleGroupItem>
                    ))}
                </ToggleGroup>
            </Field>
            <div className="col-span-2">
                <NamingSurnameField
                    surname={request.surname}
                    surnameKind={request.surnameKind}
                    onSurnameChange={(surname) => onChange({ surname })}
                    onKindChange={onSurnameKindChange}
                    onRandomSurname={onRandomSurname}
                />
            </div>
        </div>
    )
}
