/**
 * 新增人物卡对话框：只收姓名、身份、角色、性别四个字段，细节留给人物卡的后续编辑。
 * 复用约定：骨架取业务公共层的 FormDialog，角色 / 性别切换取 SegmentedRail（chip 形态），
 * 文本状态与 trim 取 useTrimmedInput；枚举文案与顺序统一从 ../constants 读取，不再各处手写数组。
 * 关键约束：性别只有男女两项且必选，SegmentedRail 判空后回调，取消选择不会写回空值；
 * 姓名必填且仅空白字符不可提交；表单重置由页面在每次打开时更换组件 key 完成（重挂载即回到初始值）。
 */
import { useState } from 'react'
import { Field, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { FormDialog } from '@webview/components/FormDialog'
import { SegmentedRail } from '@webview/components/SegmentedRail'
import { useTrimmedInput } from '@webview/hooks/useTrimmedInput'
import type { CharacterGender, CharacterRole, CharacterSeed } from '../types'
import type { JSX } from 'react'
import {
    CHARACTER_GENDER_META,
    CHARACTER_GENDER_ORDER,
    CHARACTER_ROLE_META,
    CHARACTER_ROLE_ORDER,
} from '../constants'

interface CharacterCreateDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onCreate: (seed: CharacterSeed) => void
}

export function CharacterCreateDialog({ open, onOpenChange, onCreate }: CharacterCreateDialogProps): JSX.Element {
    const name = useTrimmedInput()
    const identity = useTrimmedInput()
    // 角色默认配角：多数新增是临时出场人物，主角由作者主动改选
    const [role, setRole] = useState<CharacterRole>('supporting')
    // 性别只有男女两项且必选：默认男，取消选择时保持原值，避免出现空性别
    const [gender, setGender] = useState<CharacterGender>('male')

    const handleRoleChange = (value: string): void => {
        const next = CHARACTER_ROLE_ORDER.find((item) => item === value)
        if (next) {
            setRole(next)
        }
    }

    const handleGenderChange = (value: string): void => {
        const next = CHARACTER_GENDER_ORDER.find((item) => item === value)
        if (next) {
            setGender(next)
        }
    }

    const handleSubmit = (): void => {
        if (name.isBlank) {
            return
        }
        onCreate({ name: name.trimmedValue, identity: identity.trimmedValue, role, gender })
        onOpenChange(false)
    }

    return (
        <FormDialog
            open={open}
            title="新增人物"
            description="先建卡再细化，欲望、弱点与关系在人物卡里继续补充"
            submitLabel="创建"
            isSubmitDisabled={name.isBlank}
            contentClassName="sm:max-w-md"
            onOpenChange={onOpenChange}
            onSubmit={handleSubmit}
        >
            <Field>
                <FieldLabel htmlFor="character-create-name">姓名</FieldLabel>
                <Input
                    id="character-create-name"
                    value={name.value}
                    placeholder="必填，建卡后可继续修改"
                    className="h-8 px-3 py-1 leading-5"
                    onChange={(event) => name.setValue(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            handleSubmit()
                        }
                    }}
                />
            </Field>
            <Field>
                <FieldLabel htmlFor="character-create-role">角色</FieldLabel>
                <SegmentedRail
                    items={CHARACTER_ROLE_ORDER.map((item) => ({
                        value: item,
                        label: CHARACTER_ROLE_META[item].label,
                    }))}
                    value={role}
                    onChange={handleRoleChange}
                    ariaLabel="角色"
                    variant="chip"
                />
            </Field>
            <Field>
                <FieldLabel htmlFor="character-create-gender">性别</FieldLabel>
                <SegmentedRail
                    items={CHARACTER_GENDER_ORDER.map((item) => ({
                        value: item,
                        label: CHARACTER_GENDER_META[item].label,
                    }))}
                    value={gender}
                    onChange={handleGenderChange}
                    ariaLabel="性别"
                    variant="chip"
                />
            </Field>
            <Field>
                <FieldLabel htmlFor="character-create-identity">身份</FieldLabel>
                <Input
                    id="character-create-identity"
                    value={identity.value}
                    placeholder="如：落魄剑客、商会掌柜"
                    className="h-8 px-3 py-1 leading-5"
                    onChange={(event) => identity.setValue(event.target.value)}
                />
            </Field>
        </FormDialog>
    )
}
