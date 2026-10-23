/**
 * 姓氏字段：输入框承载用户指定姓氏，内嵌随机按钮抽取姓氏，右侧「单姓 / 复姓」切换并即时随机填充。
 * 复用约定：输入复用 ui/input-group 的输入 + 内嵌按钮组合，选项复用 ui/toggle-group（单选分段）；
 * 随机取样来自宿主下发的 surnameSamples，不在前端内置姓氏表。
 * 关键约束：单姓 / 复姓点击即写入一个随机姓氏（需求约定），输入框仍可手工改写；再次点击同一项不取消选中。
 */
import { Dices } from 'lucide-react'
import { Field, FieldLabel } from '@components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@components/ui/input-group'
import { ToggleGroup, ToggleGroupItem } from '@components/ui/toggle-group'
import type { NamingSurnameKind } from '@shared/types/naming'
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
                <ToggleGroup
                    type="single"
                    variant="outline"
                    spacing={0}
                    value={surnameKind}
                    onValueChange={(value) => {
                        if (value === 'single' || value === 'compound') {
                            onKindChange(value)
                        }
                    }}
                >
                    <ToggleGroupItem value="single">单姓</ToggleGroupItem>
                    <ToggleGroupItem value="compound">复姓</ToggleGroupItem>
                </ToggleGroup>
            </div>
        </Field>
    )
}
