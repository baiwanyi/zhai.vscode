/**
 * 添加作品弹窗：收集作品名与分类，提交后由页面层调用宿主创建作品。
 * 复用 @/components/ui 的 dialog、field、input、select，选项与分类值取自 shared/types/press，不重复定义。
 * 关键约束：表单重置由页面在每次打开时更换组件 key 完成（重挂载即回到初始值），
 * 本组件不在 effect 中同步写状态；前端只做 trim 与空值判定，完整名称白名单由宿主校验；
 * 提交中禁用全部控件防止重复提交。
 */
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DEFAULT_PRESS_CATEGORY, PRESS_CATEGORIES, readPressCategory } from '@/shared/types/press'
import type { PressCategory } from '@/shared/types/press'
import type { JSX } from 'react'

interface PressProjectDialogProps {
    open: boolean
    isSubmitting: boolean
    onOpenChange: (open: boolean) => void
    onSubmit: (name: string, category: PressCategory) => Promise<boolean>
}

export function PressProjectDialog({
    open,
    isSubmitting,
    onOpenChange,
    onSubmit,
}: PressProjectDialogProps): JSX.Element {
    const [name, setName] = useState('')
    const [category, setCategory] = useState<PressCategory>(DEFAULT_PRESS_CATEGORY)
    const trimmedName = name.trim()
    const isSubmitDisabled = isSubmitting || trimmedName.length === 0

    const handleSubmit = async (): Promise<void> => {
        if (isSubmitDisabled) {
            return
        }
        await onSubmit(trimmedName, category)
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
                        <FieldLabel htmlFor="press-project-category">分类</FieldLabel>
                        <Select
                            value={category}
                            disabled={isSubmitting}
                            onValueChange={(value) => setCategory(readPressCategory(value))}
                        >
                            <SelectTrigger id="press-project-category" className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {PRESS_CATEGORIES.map((item) => (
                                    <SelectItem key={item} value={item}>
                                        {item}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
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
