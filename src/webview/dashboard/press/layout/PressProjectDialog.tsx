/**
 * 添加作品弹窗：收集作品名与目标读者（男频/女频），提交后由页面层调用宿主创建作品。
 * 复用 @components/ui 的 dialog、field、input、toggle-group，选项与取值取自 shared/types/press，不重复定义。
 * 关键约束：目标读者为必选项，ToggleGroup 再次点击取消选中（空串）时沿用当前值，不回落；
 * 表单重置由页面在每次打开时更换组件 key 完成（重挂载即回到初始值），本组件不在 effect 中同步写状态；
 * 前端只做 trim 与空值判定，完整名称白名单由宿主校验；提交中禁用全部控件防止重复提交。
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
import { Field, FieldGroup, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@components/ui/toggle-group'
import type { PressAudience } from '@shared/types/press'
import { DEFAULT_PRESS_AUDIENCE, PRESS_AUDIENCES, readPressAudience } from '@shared/types/press'
import type { JSX } from 'react'

interface PressProjectDialogProps {
    open: boolean
    isSubmitting: boolean
    onOpenChange: (open: boolean) => void
    onSubmit: (name: string, audience: PressAudience) => Promise<boolean>
}

export function PressProjectDialog({
    open,
    isSubmitting,
    onOpenChange,
    onSubmit,
}: PressProjectDialogProps): JSX.Element {
    const [name, setName] = useState('')
    const [audience, setAudience] = useState<PressAudience>(DEFAULT_PRESS_AUDIENCE)
    const trimmedName = name.trim()
    const isSubmitDisabled = isSubmitting || trimmedName.length === 0

    const handleSubmit = async (): Promise<void> => {
        if (isSubmitDisabled) {
            return
        }
        await onSubmit(trimmedName, audience)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>添加作品</DialogTitle>
                    <DialogDescription>
                        将在 press/ 下生成作品目录，并附带背景、大纲、角色设定与设定文档。
                    </DialogDescription>
                </DialogHeader>
                <FieldGroup>
                    <Field>
                        <FieldLabel htmlFor="press-project-name">作品名</FieldLabel>
                        <Input
                            id="press-project-name"
                            value={name}
                            maxLength={60}
                            placeholder="例如：凡人修仙传"
                            disabled={isSubmitting}
                            onChange={(event) => setName(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    void handleSubmit()
                                }
                            }}
                        />
                    </Field>
                    <Field>
                        <FieldLabel>目标读者</FieldLabel>
                        <ToggleGroup
                            type="single"
                            variant="outline"
                            size="lg"
                            value={audience}
                            disabled={isSubmitting}
                            aria-label="目标读者"
                            className="w-full"
                            onValueChange={(value) => {
                                // single 允许再次点击取消选中；目标读者是必选项，空串时沿用当前值
                                if (value.length > 0) {
                                    setAudience(readPressAudience(value))
                                }
                            }}
                        >
                            {PRESS_AUDIENCES.map((item) => (
                                <ToggleGroupItem key={item} value={item} className="flex-1">
                                    {item}
                                </ToggleGroupItem>
                            ))}
                        </ToggleGroup>
                    </Field>
                </FieldGroup>
                <DialogFooter>
                    <Button variant="outline" disabled={isSubmitting} onClick={() => onOpenChange(false)}>
                        取消
                    </Button>
                    <Button disabled={isSubmitDisabled} onClick={() => void handleSubmit()}>
                        创建
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
