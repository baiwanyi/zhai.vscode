/**
 * 生图命令动作菜单：工具栏左一触发器的下拉，目前收纳「作品设定」一项。
 * 复用约定：外壳取 @components/ui 的 dropdown-menu，触发器取 @webview/components/Button
 * （尺寸 icon，作品设定挂上时切 secondary 底色）。
 * 关键约束：开关语义用 CheckboxItem 承载勾选态，选中与否由输入卡片按芯片算好传入；
 * 命令动作在生成中仍可切换（只影响下一次请求）；本组件只上抛开关动作，芯片集合由输入卡片承担。
 */
import { Command, BookText } from 'lucide-react'
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

interface ImageCommandMenusProps {
    /** 作品设定芯片是否已挂上 */
    isSettingActive: boolean
    onToggleSetting: () => void
}

export function ImageCommandMenus({ isSettingActive, onToggleSetting }: ImageCommandMenusProps): JSX.Element {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    size="icon"
                    variant={isSettingActive ? 'secondary' : 'ghost'}
                    tooltip="命令动作"
                    aria-label="命令动作"
                >
                    <Command />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuCheckboxItem checked={isSettingActive} onCheckedChange={() => onToggleSetting()}>
                    <BookText />
                    <span className="flex-1">作品设定</span>
                </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
