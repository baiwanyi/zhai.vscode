/**
 * 人物条件区：地域、时代、参考典籍、性别、字数与姓氏六个维度，纵向排列在条件卡片内。
 * 复用约定：地域、时代、性别、字数统一复用 ui/toggle-group 的 outline 分段样式（互斥单选、整行等分），
 * 参考典籍复用 ui/select，姓氏行复用同目录 NamingSurnameField。
 * 关键约束：四组分段控件共用同一套尺寸与间距（size=sm、spacing=0、w-full），保证视觉一致；
 * 点击已选中的分段不改变状态（避免空值回写），取值一律以宿主 catalog 为准。
 */
import { Field, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { NamingCatalog, NamingEra, NamingGender, NamingNameLength, NamingReference, NamingRequest, NamingSurnameKind } from '@/shared/types/naming'
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
        <div className="flex flex-col gap-3">
            <Field>
                <FieldLabel>{meta.variantLabel}</FieldLabel>
                <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    spacing={0}
                    value={request.variant}
                    onValueChange={(value) => {
                        if (value) {
                            onChange({ variant: value })
                        }
                    }}
                    className="w-full"
                >
                    {meta.variants.map((variant) => (
                        <ToggleGroupItem key={variant.value} value={variant.value} className="flex-1">
                            {variant.label}
                        </ToggleGroupItem>
                    ))}
                </ToggleGroup>
            </Field>
            <Field>
                <FieldLabel>时代</FieldLabel>
                <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    spacing={0}
                    value={request.era}
                    onValueChange={(value) => {
                        if (value) {
                            onChange({ era: value as NamingEra })
                        }
                    }}
                    className="w-full"
                >
                    {catalog.eras.map((option) => (
                        <ToggleGroupItem key={option.value} value={option.value} className="flex-1">
                            {option.label}
                        </ToggleGroupItem>
                    ))}
                </ToggleGroup>
            </Field>
            <Field>
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
            <Field>
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
            <Field>
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
            <NamingSurnameField
                surname={request.surname}
                surnameKind={request.surnameKind}
                onSurnameChange={(surname) => onChange({ surname })}
                onKindChange={onSurnameKindChange}
                onRandomSurname={onRandomSurname}
            />
        </div>
    )
}
