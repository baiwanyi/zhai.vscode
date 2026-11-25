/**
 * 大纲页头「更多」菜单：生成卷纲、写后回填与素材提取共用下拉，按钮与新增、打开文档并列在 AppAction 里。
 * 复用约定：下拉取 @components/ui/dropdown-menu；回填、提取对话框取同目录组件，各自持有开合与表单状态。
 * 关键约束：打开文档与新增卷 / 章 / 阶段 / 伏笔都不在这里，由页面直接渲染在 AppAction 里；
 * 菜单项选中即收起菜单，开合状态留在本组件；「生成卷纲」只上报点击，确认与预览由页面编排；
 * 回填只覆盖章纲与伏笔、不改正文，数据由页面传入，本组件只转交目录与写盘回调。
 */
import { BookUp2, Ellipsis, FilePenLine, Wand2 } from 'lucide-react'
import { useState } from 'react'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { Button } from '@webview/components/Button'
import { BackfillClueDialog } from './BackfillClueDialog'
import { OutlineExtractDialog } from './OutlineExtractDialog'
import type { CharacterCard, OutlineExtractTarget, OutlinePlan, OutlineVolume } from '../../types'
import type { JSX } from 'react'

interface OutlineActionMenuProps {
    /** 当前作品目录：提取范围与回填事实据此读取 */
    dirPath: string
    volumes: OutlineVolume[]
    plan: OutlinePlan
    characters: CharacterCard[]
    isExtracting: boolean
    onExtract: (target: OutlineExtractTarget) => void
    /** 按作品设定生成卷纲（已有卷纲时由页面先确认覆盖） */
    onGenerateVolumeOutlines: () => void
    onApplyBackfill: (next: { volumes: OutlineVolume[]; plan: OutlinePlan }) => void
}

export function OutlineActionMenu({
    dirPath,
    volumes,
    plan,
    characters,
    isExtracting,
    onExtract,
    onGenerateVolumeOutlines,
    onApplyBackfill,
}: OutlineActionMenuProps): JSX.Element {
    const [isExtractOpen, setIsExtractOpen] = useState(false)
    const [isBackfillOpen, setIsBackfillOpen] = useState(false)

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
                        <DropdownMenuItem onSelect={() => setIsBackfillOpen(true)}>
                            <FilePenLine />
                            写后回填
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setIsExtractOpen(true)}>
                            <BookUp2 />
                            素材提取
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                </DropdownMenuContent>
            </DropdownMenu>
            <BackfillClueDialog
                isOpen={isBackfillOpen}
                onOpenChange={setIsBackfillOpen}
                dirPath={dirPath}
                volumes={volumes}
                plan={plan}
                characters={characters}
                onApply={onApplyBackfill}
            />
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
