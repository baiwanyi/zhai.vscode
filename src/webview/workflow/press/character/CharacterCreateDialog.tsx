/**
 * 新增人物弹窗：只收拢建卡必需的四项输入，其余字段留到人物卡里继续补。
 * 复用约定：弹层复用 ui/dialog（含 DialogTitle / DialogDescription 的无障碍结构），字段布局复用 ui/field，
 * 定位选择复用 ui/toggle-group，标签文案与顺序取自 constants 的 CHARACTER_ROLE_META。
 * 关键约束：姓名为空时禁用创建按钮、不弹错误提示；组件不持有角色数据副本，提交只回抛初始值；
 * 调用方须把 key 绑定到展开状态以重建表单，本组件不写重置副作用，避免上次输入残留到下一次新增。
 */
import { useState } from 'react'
import { Button } from '@components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@components/ui/dialog'
import { Field, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@components/ui/toggle-group'
import type { CharacterRole, CharacterSeed } from '../types'
import type { JSX } from 'react'
import { CHARACTER_ROLE_META, CHARACTER_ROLE_ORDER } from '../constants'

interface CharacterCreateDialogProps {
    isOpen: boolean
    onOpenChange: (isOpen: boolean) => void
    /** 提交初始值：id 由调用方生成，弹窗不参与主键 */
    onCreate: (seed: CharacterSeed) => void
}

export function CharacterCreateDialog({ isOpen, onOpenChange, onCreate }: CharacterCreateDialogProps): JSX.Element {
    const [name, setName] = useState('')
    const [identity, setIdentity] = useState('')
    const [alias, setAlias] = useState('')
    // 定位默认配角：多数新增是临时出场人物，主角由作者主动改选
    const [role, setRole] = useState<CharacterRole>('supporting')

    const canSubmit = name.trim().length > 0

    const handleRoleChange = (value: string): void => {
        const next = CHARACTER_ROLE_ORDER.find((item) => item === value)
        if (next) {
            setRole(next)
        }
    }

    const handleSubmit = (): void => {
        if (!canSubmit) {
            return
        }
        onCreate({ name: name.trim(), identity: identity.trim(), alias: alias.trim(), role })
        onOpenChange(false)
    }

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>新增人物</DialogTitle>
                    <DialogDescription>先建卡再细化，欲望、弱点与关系在人物卡里继续补充</DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-3">
                    <Field>
                        <FieldLabel htmlFor="character-create-name">姓名</FieldLabel>
                        <Input
                            id="character-create-name"
                            value={name}
                            placeholder="必填，建卡后可继续修改"
                            className="h-7 text-xs"
                            onChange={(event) => setName(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    handleSubmit()
                                }
                            }}
                        />
                    </Field>
                    <Field>
                        <FieldLabel htmlFor="character-create-role">定位</FieldLabel>
                        <ToggleGroup type="single" value={role} className="flex-wrap" onValueChange={handleRoleChange}>
                            {CHARACTER_ROLE_ORDER.map((item) => (
                                <ToggleGroupItem key={item} value={item} size="sm" variant="outline">
                                    {CHARACTER_ROLE_META[item].label}
                                </ToggleGroupItem>
                            ))}
                        </ToggleGroup>
                    </Field>
                    <Field>
                        <FieldLabel htmlFor="character-create-identity">身份</FieldLabel>
                        <Input
                            id="character-create-identity"
                            value={identity}
                            placeholder="如：落魄剑客、商会掌柜"
                            className="h-7 text-xs"
                            onChange={(event) => setIdentity(event.target.value)}
                        />
                    </Field>
                    <Field>
                        <FieldLabel htmlFor="character-create-alias">别名 / 称号</FieldLabel>
                        <Input
                            id="character-create-alias"
                            value={alias}
                            placeholder="如：剑痴、三少爷"
                            className="h-7 text-xs"
                            onChange={(event) => setAlias(event.target.value)}
                        />
                    </Field>
                </div>
                <DialogFooter>
                    <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
                        取消
                    </Button>
                    <Button size="sm" disabled={!canSubmit} onClick={handleSubmit}>
                        创建
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
