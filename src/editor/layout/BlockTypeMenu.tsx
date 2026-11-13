/**
 * 选区工具条的块类型菜单：把当前块在正文、标题、列表、引用与代码块之间互转。
 * 复用约定：目标清单与转换命令全部取自 blocks/blockCommands，图标存组件引用，
 * 菜单壳用 @components/ui/dropdown-menu，与块把手的「转换类型」共用同一套语义。
 * 关键约束：目标块位置由外层在浮层打开时冻结后传入，菜单内不再现读选区——
 * 菜单夺焦期间选区会变，现读会把转换落到别的块上；不可转换的块整组置灰；
 * 转换成功后必须把焦点还给正文，否则浮层收起后用户无法直接继续输入；
 * 必须 modal={false}：本菜单挂在选区浮层内部，模态会在 body 上挂 pointer-events: none，
 * 浮层内外的按钮与正文会一起失去点击响应。
 */
import { Check, ChevronDown } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@components/ui/dropdown-menu'
import { Button } from '@webview/components/Button'
import type { BlockTargetId } from '../blocks/blockCommands'
import type { Editor } from '@tiptap/core'
import type { JSX } from 'react'
import { BLOCK_TARGETS, canConvertBlock, convertBlock, isCurrentTarget, readBlockNode } from '../blocks/blockCommands'

export interface BlockTypeMenuProps {
    editor: Editor
    /** 目标块起始位置：由外层冻结，null 时整组置灰 */
    pos: number | null
    /** 当前块类型标签：按钮上直接显示 */
    label: string
    isOpen: boolean
    onOpenChange: (isOpen: boolean) => void
    /** 转换成功：外层据此收起整个浮层 */
    onConverted: () => void
}

export function BlockTypeMenu({
    editor,
    pos,
    label,
    isOpen,
    onOpenChange,
    onConverted,
}: BlockTypeMenuProps): JSX.Element {
    const node = pos === null ? null : readBlockNode(editor, pos)
    const isConvertible = node !== null && canConvertBlock(node)

    const handleConvert = (target: BlockTargetId): void => {
        if (pos === null) {
            return
        }
        const isConverted = convertBlock(editor, pos, target)
        // 焦点必须交回正文：菜单与浮层随后都会被卸载
        editor.view.focus()
        if (isConverted) {
            onConverted()
        }
    }

    return (
        // 与「更多」菜单同理：嵌在选区浮层里的菜单不能走模态，否则 body 上的
        // pointer-events: none 会让整片界面（含浮层本身）失去点击响应
        <DropdownMenu modal={false} open={isOpen} onOpenChange={onOpenChange}>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" aria-expanded={isOpen} aria-haspopup="menu">
                    <span className="max-w-24 truncate">{label.length === 0 ? '块类型' : label}</span>
                    <ChevronDown className="size-3" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                side="bottom"
                align="start"
                className="w-44"
                onCloseAutoFocus={(event): void => {
                    // 焦点由转换流程自己交给正文，菜单不许抢回
                    event.preventDefault()
                }}
            >
                {BLOCK_TARGETS.map((target) => {
                    const Icon = target.icon
                    const isCurrent = node !== null && isCurrentTarget(node, target.id)
                    return (
                        <DropdownMenuItem
                            key={target.id}
                            disabled={!isConvertible || isCurrent}
                            onSelect={(): void => {
                                handleConvert(target.id)
                            }}
                        >
                            <Icon />
                            <span className="flex-1">{target.label}</span>
                            {isCurrent ? <Check /> : null}
                        </DropdownMenuItem>
                    )
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
