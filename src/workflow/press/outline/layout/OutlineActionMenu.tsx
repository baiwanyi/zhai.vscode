/**
 * 大纲页头动作菜单：把新增卷、新增章节、生成大纲与素材提取收进同一个下拉，页头只留一个入口。
 * 复用约定：下拉取 @components/ui/dropdown-menu，提取范围由同目录的 OutlineExtractPanel 承担，
 * 外层是受控 Dialog——菜单项只负责打开它，对话框不依赖触发器，因此不会与下拉争夺焦点。
 * 关键约束：菜单项选中即收起菜单，提取项随后打开对话框，两套浮层的开合都留在本组件内，页面只接回调；
 * 菜单项只负责打开对话框，文案与可用性不随提取状态变化——是否可提交由面板按 isExtracting 判断；
 * 新增项只长大纲草稿，不创建章节文件；提取范围由面板自行读取作品列表，本组件只转交作品目录。
 */
import { BookUp2, Ellipsis, Plus, Wand2 } from 'lucide-react'
import { useState } from 'react'
import { Dialog, DialogContent } from '@components/ui/dialog'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { Button } from '@webview/components/Button'
import { OutlineExtractPanel } from './OutlineExtractPanel'
import type { OutlineExtractTarget } from '../../types'
import type { JSX } from 'react'

interface OutlineActionMenuProps {
    /** 当前作品目录：提取范围据此读取仪表盘里的作品章节 */
    dirPath: string
    isExtracting: boolean
    onExtract: (target: OutlineExtractTarget) => void
    onCreateVolume: () => void
    onCreateChapter: () => void
    onOpenWizard: () => void
}

export function OutlineActionMenu({
    dirPath,
    isExtracting,
    onExtract,
    onCreateVolume,
    onCreateChapter,
    onOpenWizard,
}: OutlineActionMenuProps): JSX.Element {
    const [isExtractOpen, setIsExtractOpen] = useState(false)

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="outline"
                        size="icon"
                        tooltip="大纲操作：新增卷章、生成大纲或按素材提取"
                        aria-label="大纲操作"
                    >
                        <Ellipsis />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuGroup>
                        <DropdownMenuItem onSelect={onCreateVolume}>
                            <Plus />
                            新增卷
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={onCreateChapter}>
                            <Plus />
                            新增章节
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                        <DropdownMenuItem onSelect={onOpenWizard}>
                            <Wand2 />
                            生成大纲
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setIsExtractOpen(true)}>
                            <BookUp2 />
                            素材提取
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                </DropdownMenuContent>
            </DropdownMenu>
            {/* 受控对话框：没有触发器，只随菜单项的选中打开，避开与下拉的焦点竞争 */}
            <Dialog open={isExtractOpen} onOpenChange={setIsExtractOpen}>
                <DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto sm:max-w-md">
                    <OutlineExtractPanel
                        dirPath={dirPath}
                        isExtracting={isExtracting}
                        onExtract={onExtract}
                        onClose={() => setIsExtractOpen(false)}
                    />
                </DialogContent>
            </Dialog>
        </>
    )
}
