/**
 * 人物条件区：地域、时代、参考典籍、性别、字数与姓氏六个维度，纵向排列在条件字段区内。
 * 复用约定：地域、时代、性别、字数统一由业务公共层的 SegmentedRail（outline 形态）承载，
 * 参考典籍复用 ui/select，姓氏行复用同目录 NamingSurnameField。
 * 关键约束：四组分段控件共用同一套尺寸与间距，改样式只改 SegmentedRail；点击已选中的分段不改变状态
 * （避免空值回写），取值一律以宿主 catalog 为准。
 */
import { Field, FieldGroup, FieldLabel } from '@components/ui/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import type {
    NamingCatalog,
    NamingEra,
    NamingGender,
    NamingNameLength,
    NamingReference,
    NamingRequest,
    NamingSurnameKind,
} from '@shared/types/naming'
import { SegmentedRail } from '@webview/components/SegmentedRail'
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
        <FieldGroup className="gap-3">
            <Field>
                <FieldLabel>{meta.variantLabel}</FieldLabel>
                <SegmentedRail
                    items={meta.variants}
                    value={request.variant}
                    onChange={(variant) => onChange({ variant })}
                    ariaLabel={meta.variantLabel}
                    variant="outline"
                />
            </Field>
            <Field>
                <FieldLabel>时代</FieldLabel>
                <SegmentedRail
                    items={catalog.eras}
                    value={request.era}
                    onChange={(era) => onChange({ era: era as NamingEra })}
                    ariaLabel="时代"
                    variant="outline"
                />
            </Field>
            <Field>
                <FieldLabel htmlFor="naming-person-reference">参考</FieldLabel>
                <Select
                    value={request.reference}
                    onValueChange={(value) => onChange({ reference: value as NamingReference })}
                >
                    <SelectTrigger id="naming-person-reference" className="w-full">
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
                <SegmentedRail
                    items={catalog.genders}
                    value={request.gender}
                    onChange={(gender) => onChange({ gender: gender as NamingGender })}
                    ariaLabel="性别"
                    variant="outline"
                />
            </Field>
            <Field>
                <FieldLabel>字数（不含姓氏）</FieldLabel>
                <SegmentedRail
                    items={catalog.lengths}
                    value={request.length}
                    onChange={(length) => onChange({ length: length as NamingNameLength })}
                    ariaLabel="字数"
                    variant="outline"
                />
            </Field>
            <NamingSurnameField
                surname={request.surname}
                surnameKind={request.surnameKind}
                onSurnameChange={(surname) => onChange({ surname })}
                onKindChange={onSurnameKindChange}
                onRandomSurname={onRandomSurname}
            />
        </FieldGroup>
    )
}
