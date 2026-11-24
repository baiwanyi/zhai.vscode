/**
 * 大纲页头「更多」菜单：把生成卷纲与素材提取收进同一个下拉，按钮与新增、打开文档并列在 AppAction 里。
 * 复用约定：下拉取 @components/ui/dropdown-menu，提取对话框取同目录 OutlineExtractDialog（自带通用 Dialog 外壳）。
 * 关键约束：打开文档与新增卷 / 章 / 阶段 / 伏笔都不在这里，由页面直接渲染在 AppAction 里；
 * 菜单项选中即收起菜单，开合状态留在本组件；「生成卷纲」只上报点击，确认与预览由页面编排；
 * 新作品骨架已铺好卷纲与首章，这里不再提供「套用模板」；提取对话框自行读作品列表，本组件只转交目录。
 */
import { BookUp2, Ellipsis, Wand2 } from 'lucide-react'
import { useState } from 'react'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { Button } from '@webview/components/Button'
import { OutlineExtractDialog } from './OutlineExtractDialog'
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
            <OutlineExtractDialog
                isOpen={isExtractOpen}
                onOpenChange={setIsExtractOpen}
                dirPath={dirPath}
                isExtracting={isExtracting}
                onExtract={onExtract}
            />
        </>
    )
}
