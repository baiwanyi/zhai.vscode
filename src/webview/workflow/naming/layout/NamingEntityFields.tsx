/**
 * 实体条件区：地点 / 势力 / 招式 / 装备 / 怪物 / 道具的类型选择与后缀输入。
 * 复用约定：类型下拉复用 ui/select（选项来自宿主 catalog），后缀输入复用 ui/input-group（内嵌随机按钮）；
 * 后缀候选由宿主按「分类 × 类型」下发，前端只负责抽样填充。
 * 关键约束：后缀输入只保留汉字并在宿主侧再次收窄，前端限长仅用于输入体验。
 */
import { Dices } from 'lucide-react'
import { Field, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { NamingCatalog, NamingRequest } from '@/shared/types/naming'
import type { JSX } from 'react'
import { MAX_SUFFIX_LENGTH } from '../constants'
import { readCategoryMeta } from '../utils'

interface NamingEntityFieldsProps {
    catalog: NamingCatalog
    request: NamingRequest
    onChange: (patch: Partial<NamingRequest>) => void
    onRandomSuffix: () => void
}

export function NamingEntityFields({
    catalog,
    request,
    onChange,
    onRandomSuffix,
}: NamingEntityFieldsProps): JSX.Element | null {
    const meta = readCategoryMeta(catalog, request.category)
    if (!meta) {
        return null
    }
    return (
        <div className="flex flex-col gap-3">
            <Field>
                <FieldLabel htmlFor="naming-entity-variant">{meta.variantLabel}</FieldLabel>
                <Select value={request.variant} onValueChange={(value) => onChange({ variant: value })}>
                    <SelectTrigger id="naming-entity-variant" className="w-full" size="sm">
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
                <FieldLabel htmlFor="naming-suffix">后缀</FieldLabel>
                <InputGroup className="h-8">
                    <InputGroupInput
                        id="naming-suffix"
                        value={request.suffix}
                        maxLength={MAX_SUFFIX_LENGTH}
                        placeholder={meta.suffixPlaceholder}
                        onChange={(event) => onChange({ suffix: event.target.value })}
                    />
                    <InputGroupAddon align="inline-end">
                        <InputGroupButton size="icon-xs" aria-label="随机后缀" onClick={onRandomSuffix}>
                            <Dices data-icon="inline-start" />
                        </InputGroupButton>
                    </InputGroupAddon>
                </InputGroup>
            </Field>
        </div>
    )
}
