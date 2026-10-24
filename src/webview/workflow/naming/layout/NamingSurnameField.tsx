/**
 * 姓氏字段：输入框承载用户指定姓氏，内嵌随机按钮抽取姓氏，右侧「单姓 / 复姓」切换并即时随机填充。
 * 复用约定：输入复用 ui/input-group 的输入 + 内嵌按钮组合；单姓 / 复姓由业务公共层的 SegmentedRail
 * （outline 形态、非等分，嵌在横向 flex 行内）承载，随机取样来自宿主下发的 surnameSamples。
 * 关键约束：单姓 / 复姓点击即写入一个随机姓氏（需求约定），输入框仍可手工改写；再次点击同一项不取消选中。
 */
import { Dices } from 'lucide-react'
import { Field, FieldLabel } from '@components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@components/ui/input-group'
import type { NamingSurnameKind } from '@shared/types/naming'
import { SegmentedRail } from '@webview/components/SegmentedRail'
import type { SegmentedRailItem } from '@webview/components/SegmentedRail'
import type { JSX } from 'react'
import { MAX_SURNAME_LENGTH } from '../constants'

interface NamingSurnameFieldProps {
    surname: string
    surnameKind: NamingSurnameKind
    onSurnameChange: (surname: string) => void
    /** 切换单姓 / 复姓：由页面在该回调内随机填充姓氏 */
    onKindChange: (kind: NamingSurnameKind) => void
    onRandomSurname: () => void
}

/** 两种姓氏形态：顺序与界面一致，单姓在前 */
const SURNAME_KIND_ITEMS: readonly SegmentedRailItem<NamingSurnameKind>[] = [
    { value: 'single', label: '单姓' },
    { value: 'compound', label: '复姓' },
]

export function NamingSurnameField({
    surname,
    surnameKind,
    onSurnameChange,
    onKindChange,
    onRandomSurname,
}: NamingSurnameFieldProps): JSX.Element {
    return (
        <Field>
            <FieldLabel htmlFor="naming-surname">姓氏</FieldLabel>
            <div className="flex items-center gap-2">
                <InputGroup className="h-8 flex-1">
                    <InputGroupInput
                        id="naming-surname"
                        value={surname}
                        maxLength={MAX_SURNAME_LENGTH}
                        placeholder="选填，仅支持汉字"
                        onChange={(event) => onSurnameChange(event.target.value)}
                    />
                    <InputGroupAddon align="inline-end">
                        <InputGroupButton size="icon-xs" aria-label="随机姓氏" onClick={onRandomSurname}>
                            <Dices data-icon="inline-start" />
                        </InputGroupButton>
                    </InputGroupAddon>
                </InputGroup>
                <SegmentedRail
                    items={SURNAME_KIND_ITEMS}
                    value={surnameKind}
                    onChange={onKindChange}
                    ariaLabel="姓氏类型"
                    variant="outline"
                    isStretched={false}
                />
            </div>
        </Field>
    )
}
