/**
 * 金手指字段组：类型、能力描述、代价、限制与升级体系。
 * 复用约定：字段组容器取 @components/ui 的 field 之 FieldGroup，单列排布、每个字段独占一行；
 * 类型取 ui/select 的两级联动（先选大类、再选具体类型），候选集中在 constants 的 GOLDEN_FINGER_TYPE_GROUPS；
 * 其余四项是多句描述，取 @webview/components/AiTextareaField（多行输入 + 字段级 AI 生成）。
 * 关键约束：大类只用于筛候选、不落库，落库的始终是具体类型；选大类即落到该组第一个类型，
 * 类型与大类因此永远互相自洽，界面不保留「选了组、二级却空着」的中间态（由同文件 GoldenTypePicker 承载）；
 * 历史作品存着旧版自由输入的自定义类型，不在任何分组内时以「当前取值」单独成组，避免下拉显示空白；
 * 类型不接 AI——它是其余四项生成时的输入约束，交给模型改写会让整组设定互相漂移；
 * 代价写「用了要付什么」、限制写「什么时候根本用不了」，两者分工不同，提示词与文案须一起维护；
 * 多行输入写盘时折成单行写在字段标题下（见 serialize.ts）。
 */
import { Field, FieldGroup, FieldLabel } from '@components/ui/field'
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTrigger,
    SelectValue,
} from '@components/ui/select'
import type { SettingFieldKey } from '@shared/types/press'
import { AiTextareaField } from '@webview/components/AiTextareaField'
import type { SettingFieldAi, SettingFieldsProps } from './sections'
import type { JSX } from 'react'
import { GOLDEN_FINGER_TYPE_GROUPS, SETTING_FIELD_MAX_LENGTH } from '../constants'
import { toSettingTextPatch } from '../utils'

/** 下拉里的「未设定」占位值：radix Select 不接受空字符串作为 value，选中后写回空串 */
const UNSET_VALUE = '__unset__'
/** 第一级里的「当前取值」虚拟分组：仅用于历史自定义类型 */
const CUSTOM_GROUP_VALUE = '__custom__'

interface GoldenTypePickerProps {
    /** 已落库的具体类型，空串表示未选 */
    value: string
    onChange: (value: string) => void
}

/**
 * 金手指类型的两级联动：第一级选大类，第二级只列该大类下的具体类型。
 * 关键约束：大类只用于筛候选、不落库，落库的始终是具体类型；选大类即落到该组第一个类型，
 * 由此类型与大类永远互相自洽——不会出现「选了大类、二级却显示未设定、库里还是旧值」的错位；
 * 历史自定义类型不属于任何分组，单独以「当前取值」成组显示，避免下拉把它抹成空白。
 */
function GoldenTypePicker({ value, onChange }: GoldenTypePickerProps): JSX.Element {
    const activeGroup = GOLDEN_FINGER_TYPE_GROUPS.find((group) => group.options.some((option) => option === value))
    /** 历史自定义类型：不属于任何分组，但仍要能显示与清空 */
    const isCustom = value.length > 0 && activeGroup === undefined
    /** 第二级候选：自定义类型自成一组，未选大类时为空（下拉禁用并提示先选大类） */
    const secondOptions = isCustom ? [value] : (activeGroup?.options ?? [])
    const firstValue = activeGroup !== undefined ? activeGroup.label : isCustom ? CUSTOM_GROUP_VALUE : UNSET_VALUE
    const secondValue = secondOptions.some((option) => option === value) ? value : UNSET_VALUE

    const handleGroupChange = (next: string): void => {
        if (next === CUSTOM_GROUP_VALUE) {
            return
        }
        if (next === UNSET_VALUE) {
            onChange('')
            return
        }
        const [firstOption] = GOLDEN_FINGER_TYPE_GROUPS.find((group) => group.label === next)?.options ?? []
        if (firstOption !== undefined) {
            onChange(firstOption)
        }
    }

    const handleTypeChange = (next: string): void => {
        onChange(next === UNSET_VALUE ? '' : next)
    }

    return (
        <FieldGroup className="grid grid-cols-1 gap-3 @md:grid-cols-2">
            <Field>
                <FieldLabel htmlFor="setting-golden-type-group">类型大类</FieldLabel>
                <Select value={firstValue} onValueChange={handleGroupChange}>
                    <SelectTrigger id="setting-golden-type-group" className="w-full">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                        {isCustom ? (
                            <SelectGroup>
                                <SelectLabel>当前取值</SelectLabel>
                                <SelectItem value={CUSTOM_GROUP_VALUE}>{value}</SelectItem>
                            </SelectGroup>
                        ) : null}
                        <SelectGroup>
                            {GOLDEN_FINGER_TYPE_GROUPS.map((group) => (
                                <SelectItem key={group.label} value={group.label}>
                                    {group.label}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                        <SelectGroup>
                            <SelectItem value={UNSET_VALUE}>未设定</SelectItem>
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </Field>
            <Field>
                <FieldLabel htmlFor="setting-golden-type">具体类型</FieldLabel>
                <Select value={secondValue} disabled={secondOptions.length === 0} onValueChange={handleTypeChange}>
                    <SelectTrigger id="setting-golden-type" className="w-full">
                        <SelectValue placeholder="先选大类" />
                    </SelectTrigger>
                    <SelectContent position="popper">
                        <SelectGroup>
                            {secondOptions.map((option) => (
                                <SelectItem key={option} value={option}>
                                    {option}
                                </SelectItem>
                            ))}
                            {/* 未选大类时不留「未设定」项：无匹配项时 Radix 会显示 placeholder，正好提示先选大类 */}
                            {secondOptions.length === 0 ? null : <SelectItem value={UNSET_VALUE}>未设定</SelectItem>}
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </Field>
        </FieldGroup>
    )
}

interface PowerFieldMeta {
    key: Extract<
        SettingFieldKey,
        'goldenFingerAbility' | 'goldenFingerCost' | 'goldenFingerLimit' | 'goldenFingerUpgrade'
    >
    label: string
    placeholder: string
    /** 字段下方说明：解释与其它字段的分工 */
    description?: string
}

/** 描述类字段的顺序与文案：能力 → 代价 → 限制 → 升级体系 */
const POWER_FIELDS: readonly PowerFieldMeta[] = [
    {
        key: 'goldenFingerAbility',
        label: '能力描述',
        placeholder: '金手指能给什么、怎么获得、与常规力量体系的差异',
    },
    {
        key: 'goldenFingerCost',
        label: '代价',
        placeholder: '寿命、气血、资源、好感或反噬',
        description: '写「用了要付什么」，代价要能反复制造冲突',
    },
    {
        key: 'goldenFingerLimit',
        label: '限制',
        placeholder: '次数、冷却、生效条件，以及做不到什么',
        description: '写「什么时候根本用不了」，与代价分工不同',
    },
    {
        key: 'goldenFingerUpgrade',
        label: '升级体系',
        placeholder: '分几级、先解锁什么、升级要满足什么条件',
        description: '金手指自身的成长线，不要与世界观的力量体系重复',
    },
]

interface PressSettingPowerFieldsProps extends SettingFieldsProps {
    fieldAi: SettingFieldAi
}

export function PressSettingPowerFields({ setting, onChange, fieldAi }: PressSettingPowerFieldsProps): JSX.Element {
    const { generatingField, onGenerate } = fieldAi
    /** 任一字段在生成时按钮全部禁用：一次只跑一项，避免并发请求 */
    const isBusy = generatingField !== null

    return (
        <FieldGroup className="grid grid-cols-1 gap-3">
            <GoldenTypePicker
                value={setting.goldenFingerType}
                onChange={(goldenFingerType) => onChange({ goldenFingerType })}
            />
            {POWER_FIELDS.map((field) => (
                <AiTextareaField
                    key={field.key}
                    id={`setting-${field.key}`}
                    label={field.label}
                    value={setting[field.key]}
                    placeholder={field.placeholder}
                    description={field.description}
                    maxLength={SETTING_FIELD_MAX_LENGTH[field.key]}
                    isGenerating={generatingField === field.key}
                    isDisabled={isBusy}
                    generateLabel={`AI 生成${field.label}`}
                    onChange={(value) => onChange(toSettingTextPatch(field.key, value))}
                    onGenerate={() => onGenerate(field.key)}
                />
            ))}
        </FieldGroup>
    )
}
