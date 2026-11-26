/**
 * 人物选择字段：把人物卡按角色分组，交给 SearchCombobox 做单选或多选。
 * 复用约定：字段取 @components/ui/field，下拉取 @webview/components/SearchCombobox；
 * 角色分组顺序与显示名复用 press/constants 的 CHARACTER_ROLE_ORDER 与 CHARACTER_ROLE_META。
 * 关键约束：单选内部以哨兵表示未指定并回传空串，多选回传全部勾选 id；
 * 只提交人物 id、不改动人物卡；定位容器由调用方可选传入，缺省按视口定位。
 */
import { useMemo } from 'react'
import { Field, FieldLabel } from '@components/ui/field'
import { SearchCombobox } from '@webview/components/SearchCombobox'
import type { SearchableGroup, SearchableOption } from '@webview/components/SearchCombobox'
import type { CharacterCard } from '../types'
import type { JSX, RefObject } from 'react'
import { CHARACTER_ROLE_META, CHARACTER_ROLE_ORDER } from '../constants'

/** 未指定哨兵：避免受控组合框出现空串 value，仅组件内部使用 */
const NO_CHARACTER = 'none'

interface CharacterSelectFieldBaseProps {
    characters: readonly CharacterCard[]
    label: string
    placeholder?: string
    emptyText?: string
    /** 可选定位容器，透传给组合框 */
    dialogRef?: RefObject<HTMLDivElement | null>
}

export interface CharacterSelectFieldSingleProps extends CharacterSelectFieldBaseProps {
    multiple?: false
    /** 单选人物 id，空串表示未指定 */
    value: string
    onChange: (characterId: string) => void
}

export interface CharacterSelectFieldMultipleProps extends CharacterSelectFieldBaseProps {
    multiple: true
    value: readonly string[]
    onChange: (characterIds: string[]) => void
}

export type CharacterSelectFieldProps = CharacterSelectFieldSingleProps | CharacterSelectFieldMultipleProps

/** 人物选择字段：勾选态由 value 决定，分组与展示文案由 characters 决定 */
export function CharacterSelectField(props: CharacterSelectFieldProps): JSX.Element {
    const { characters, label, placeholder, emptyText, dialogRef } = props
    const isMultiple = props.multiple === true
    const groups = useMemo<SearchableGroup[]>(() => {
        const result: SearchableGroup[] = isMultiple
            ? []
            : [{ label: '', options: [{ value: NO_CHARACTER, label: '未指定' }] }]
        CHARACTER_ROLE_ORDER.forEach((role) => {
            const options: SearchableOption[] = characters
                .filter((character) => character.role === role)
                .map((character) => ({ value: character.id, label: character.name }))
            if (options.length > 0) {
                result.push({ label: CHARACTER_ROLE_META[role].label, options })
            }
        })
        return result
    }, [characters, isMultiple])

    const handleChange = (values: string[]): void => {
        if (props.multiple === true) {
            props.onChange(values)
            return
        }
        const selected = values[values.length - 1]
        props.onChange(selected === undefined || selected === NO_CHARACTER ? '' : selected)
    }

    const comboboxValue = props.multiple === true
        ? props.value
        : (props.value.length > 0 ? [props.value] : [NO_CHARACTER])

    return (
        <Field>
            <FieldLabel>{label}</FieldLabel>
            <SearchCombobox
                label={label}
                value={comboboxValue}
                groups={groups}
                placeholder={placeholder ?? '搜索人物…'}
                emptyText={emptyText ?? '没有匹配的人物'}
                dialogRef={dialogRef}
                onChange={handleChange}
            />
        </Field>
    )
}
