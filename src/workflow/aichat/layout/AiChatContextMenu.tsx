/**
 * 「添加上下文」入口：按钮弹出下拉菜单，一级是内容分类，每项展开一个子菜单承载对应来源的选择页。
 * 复用约定：入口浮层取 @components/ui 的 dropdown-menu，触发器取 @webview/components/Button；
 * 四个来源入口整块交给 AiChatContextSourceMenu——入口清单、文案、图标与子菜单壳都由它维护，
 * 本组件只决定它们落在菜单的哪一段；规则子菜单取同目录 AiChatContextRuleMenu（与生图侧的上下文菜单同一份实现），
 * 规则数据与增删改统一由 @webview/hooks/useRuleMenu 编排，规则弹窗取同目录 AiChatContextRuleDialog。
 * 骨架与 AiChatReferenceMenu 对齐：入口菜单取 align=start / w-56 与默认弹出侧，顶部 Label 加分隔线分组。
 * 关键约束：一、菜单必须非模态（参考资料菜单无此设置）——模态菜单会给页面挂 pointer-events:none
 * 并锁住焦点，子菜单里的搜索框与候选列表会失效；二、规则弹窗必须渲染在浮层之外，菜单收起不会连带卸载它；
 * 三、每次打开都从根菜单开始，收起即复位，下次仍从头开始；
 * 四、作品面板是独立 Popover：选中作品时收起入口菜单并打开浮层（章节 / 人物 / 大纲 / 设定），
 * 浮层只由 Esc / 点外部关闭，关闭后下次打开仍从入口清单开始；浮层内容不进菜单上下文，故整层只用普通按钮。
 */
import { Command } from 'lucide-react'
import { useRef, useState } from 'react'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { Popover, PopoverAnchor, PopoverContent } from '@components/ui/popover'
import type { AiContextScope } from '@shared/types/aiChat'
import type { PromptRule } from '@shared/types/promptLibrary'
import { Button } from '@webview/components/Button'
import { useRuleMenu } from '@webview/hooks/useRuleMenu'
import { AiChatContextProjectPicker } from './AiChatContextProjectPicker'
import { AiChatContextRuleDialog } from './AiChatContextRuleDialog'
import { AiChatContextRuleMenu } from './AiChatContextRuleMenu'
import { AiChatContextSourceMenu } from './AiChatContextSourceMenu'
import type { JSX } from 'react'

interface AiChatContextMenuProps {
    disabled: boolean
    /** 待发送上下文作用域：对话按会话隔离，生图面板固定一份；缺省按对话 */
    scope?: AiContextScope
    /** 上下文添加成功后刷新会话快照 */
    onContextAdded: () => void
    /** 上下文添加失败的提示出口 */
    onContextError: (error: string) => void
    /** 已挂规则名：规则面板据此回显挂载态 */
    ruleNames: readonly string[]
    onToggleRule: (rule: PromptRule) => void
    onRenameRule: (previousName: string, rule: PromptRule) => void
    onRemoveRule: (ruleName: string) => void
}

export function AiChatContextMenu({
    disabled,
    scope = 'chat',
    onContextAdded,
    onContextError,
    ruleNames,
    onToggleRule,
    onRenameRule,
    onRemoveRule,
}: AiChatContextMenuProps): JSX.Element {
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    /** 作品面板的作品目录：非空即把菜单内容换成作品面板，null 为入口清单 */
    const [projectDirPath, setProjectDirPath] = useState<string | null>(null)

    // 锁定（生成中 / 输入禁用）时不允许继续选上下文：渲染期直接修正，比 effect 少一帧，
    // 解锁后也不会自动弹回；否则会出现「触发器已禁用、面板仍可点」的空档
    if (disabled && (isMenuOpen || projectDirPath !== null)) {
        setIsMenuOpen(false)
        setProjectDirPath(null)
    }

    /** 收起菜单并复位：添加成功、点外部与 Esc 都收在这条路径上，下次打开仍从入口清单开始 */
    const closeMenu = (): void => {
        setIsMenuOpen(false)
        setProjectDirPath(null)
    }

    /** 选中作品：收起入口菜单，另开作品浮层 */
    const handlePickProject = (dirPath: string): void => {
        // 空 id 不开空面板：来源 id 由宿主产生，正常不会为空，这里只做防御
        if (dirPath.length === 0) {
            return
        }
        setProjectDirPath(dirPath)
        setIsMenuOpen(false)
    }

    /** 作品浮层开合：点外部或 Esc 只收起浮层，下次打开仍从入口清单开始 */
    const handleProjectOpenChange = (isOpen: boolean): void => {
        if (!isOpen) {
            setProjectDirPath(null)
        }
    }

    // 关闭动画期间仍渲染上一份内容：目录置空后立刻跟手清空 children，浮层会先变空再消失
    const lastProjectDirPathRef = useRef<string | null>(null)
    if (projectDirPath !== null) {
        lastProjectDirPathRef.current = projectDirPath
    }
    const renderedDirPath = projectDirPath ?? lastProjectDirPathRef.current

    const ruleMenu = useRuleMenu({
        onToggleRule,
        onRenameRule,
        onRemoveRule,
        // 编辑与删除要先收起菜单再弹窗，否则两层浮层会叠在一起
        onCloseMenu: closeMenu,
    })

    /** 菜单开合：打开时重读规则目录；收起只关菜单，作品浮层的开关由它自己管 */
    const handleMenuOpenChange = (isOpen: boolean): void => {
        if (!isOpen) {
            setIsMenuOpen(false)
            return
        }
        setIsMenuOpen(true)
        void ruleMenu.reload()
    }

    return (
        <>
            <Popover open={projectDirPath !== null} onOpenChange={handleProjectOpenChange}>
                <PopoverAnchor asChild>
                    <div className="inline-flex">
                        <DropdownMenu open={isMenuOpen} modal={false} onOpenChange={handleMenuOpenChange}>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="secondary"
                                    size="icon"
                                    tooltip="添加上下文"
                                    aria-label="添加上下文"
                                    disabled={disabled}
                                >
                                    <Command />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="w-56">
                                <DropdownMenuLabel>添加上下文</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <AiChatContextSourceMenu
                                    scope={scope}
                                    onClose={closeMenu}
                                    onAdded={onContextAdded}
                                    onError={onContextError}
                                    onPickProject={handlePickProject}
                                />
                                <DropdownMenuSeparator />
                                <AiChatContextRuleMenu
                                    rules={ruleMenu.rules}
                                    isLoading={ruleMenu.isLoading}
                                    selectedRules={ruleNames}
                                    onToggle={onToggleRule}
                                    onEdit={ruleMenu.edit}
                                    onDelete={ruleMenu.requestDelete}
                                    onCreate={ruleMenu.create}
                                    onOpenDir={ruleMenu.openDir}
                                />
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </PopoverAnchor>
                <PopoverContent
                    align="center"
                    collisionPadding={8}
                    // 高度交给内容区（Picker 里固定 h-80），外层再限高会叠加成溢出
                    className="w-[calc(100vw-1rem)]"
                    // 入口菜单关闭会把焦点归还按钮，而按钮不是 Popover 的 Trigger：
                    // 不拦这一下，浮层会因 focus-outside 在打开瞬间自我关闭
                    onOpenAutoFocus={(event): void => {
                        event.preventDefault()
                    }}
                    onFocusOutside={(event): void => {
                        event.preventDefault()
                    }}
                >
                    {renderedDirPath === null ? null : (
                        <AiChatContextProjectPicker
                            // 换作品即重新挂载：页签与勾选状态一并复位
                            key={renderedDirPath}
                            dirPath={renderedDirPath}
                            scope={scope}
                            onClose={closeMenu}
                            onAdded={onContextAdded}
                            onError={onContextError}
                            onPickProject={handlePickProject}
                        />
                    )}
                </PopoverContent>
            </Popover>
            <AiChatContextRuleDialog
                form={ruleMenu.formState}
                pendingDelete={ruleMenu.pendingDelete}
                dirPath={ruleMenu.dirPath}
                isSaving={ruleMenu.isSaving}
                onFormClose={ruleMenu.closeForm}
                onFormSubmit={ruleMenu.submit}
                onDeleteClose={ruleMenu.closeDelete}
                onConfirmDelete={ruleMenu.confirmDelete}
            />
        </>
    )
}
