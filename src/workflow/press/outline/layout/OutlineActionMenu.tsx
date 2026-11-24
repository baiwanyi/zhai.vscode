/**
 * 大纲页头「更多」菜单：把生成卷纲与素材提取收进同一个下拉，按钮与新增、打开文档并列在 AppAction 里。
 * 复用约定：下拉取 @components/ui/dropdown-menu，提取范围由同目录的 OutlineExtractPanel 承担，
 * 外层是受控 Dialog——菜单项只负责打开它，对话框不依赖触发器，因此不会与下拉争夺焦点。
 * 关键约束：打开文档与新增卷 / 章 / 阶段 / 线索都不在这里——它们由页面直接渲染在 AppAction 里；
 * 菜单项选中即收起菜单，提取项随后打开对话框，两套浮层的开合都留在本组件内，页面只接回调；
 * 菜单项只负责打开对话框，文案与可用性不随提取状态变化——是否可提交由面板按 isExtracting 判断；
 * 「生成卷纲」只上报点击，覆盖确认与预览对话框都由页面编排；
 * 新作品的卷纲与首章已由骨架铺好，因此这里不再提供「套用模板」；
 * 提取范围由面板自行读取作品列表，本组件只转交作品目录。
 */
import { BookUp2, Ellipsis, Wand2 } from 'lucide-react'
import { useState } from 'react'
import { Dialog, DialogContent } from '@components/ui/dialog'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
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
    /** 按作品设定生成卷纲（已有卷纲时由页面先确认覆盖） */
    onGenerateVolumeOutlines: () => void
}

export function OutlineActionMenu({
    dirPath,
    isExtracting,
    onExtract,
    onGenerateVolumeOutlines,
}: OutlineActionMenuProps): JSX.Element {
    const [isExtractOpen, setIsExtractOpen] = useState(false)

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" tooltip="大纲操作：生成卷纲或按素材提取" aria-label="大纲操作">
                        <Ellipsis />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuGroup>
                        <DropdownMenuItem onSelect={onGenerateVolumeOutlines}>
                            <Wand2 />
                            生成卷纲
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
