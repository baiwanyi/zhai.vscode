/**
 * 实体条件区：地点 / 势力 / 招式 / 装备 / 怪物 / 道具的位置或类型切换，以及后缀输入。
 * 复用约定：位置 / 类型由业务公共层的 SegmentedRail（outline 形态，整行等分）承载，
 * 与人物-性别 / 字数同一套尺寸；后缀输入复用 ui/input-group（内嵌随机按钮）。
 * 关键约束：后缀输入只保留汉字并在宿主侧再次收窄，前端限长仅用于输入体验。
 */
import { Dices } from 'lucide-react'
import { Field, FieldGroup, FieldLabel } from '@components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@components/ui/input-group'
import type { NamingCatalog, NamingRequest } from '@shared/types/naming'
import { SegmentedRail } from '@webview/components/SegmentedRail'
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
                            <Dices />
                        </InputGroupButton>
                    </InputGroupAddon>
                </InputGroup>
            </Field>
        </FieldGroup>
    )
}
