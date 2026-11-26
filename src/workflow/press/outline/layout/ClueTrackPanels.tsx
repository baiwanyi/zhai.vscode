/**
 * 大纲伏笔面板：伏笔表负责「埋什么、第几章埋、何时回收、由谁触发」，独立成段、与卷章互不覆盖。
 * 复用约定：列表取 block/ClueTrackItem（ui/item），编辑取 ClueTrackEditDialog（业务 Dialog），预警取 Alert、空态取 Empty；
 * 章节引用选项由 utils 的 createChapterRefOptions 统一生成，取值形如「1-2」，人物下拉取 CharacterCard。
 * 关键约束：回收状态由作者显式切换（写后回填也会改这一项，但需用户确认）；逾期预警只做提示，不自动改状态、不阻止保存；
 * 添加伏笔的入口在页头第二行，这里只做展示、编排、编辑与删除的挂载。
 */
import { Lightbulb } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ItemGroup } from '@components/ui/item'
import { Empty } from '@webview/blocks/Empty'
import { Alert } from '@webview/components/Alert'
import { ClueTrackEditDialog } from './ClueTrackEditDialog'
import type { CharacterCard, OutlineClue } from '../../types'
import type { ChapterRefOption, ClueWarning } from '../../utils'
import type { JSX } from 'react'
import { ClueTrackItem } from '../block/ClueTrackItem'

interface ClueTrackPanelsProps {
    clues: OutlineClue[]
    characters: CharacterCard[]
    refOptions: ChapterRefOption[]
    warnings: ClueWarning[]
    onChange: (clues: OutlineClue[]) => void
}

/** 伏笔表：条目列表 + 预警 + 编辑弹窗 */
export function ClueTrackPanels({
    clues,
    characters,
    refOptions,
    warnings,
    onChange,
}: ClueTrackPanelsProps): JSX.Element {
    const [editingClueId, setEditingClueId] = useState<string | null>(null)
    const editingClue = clues.find((clue) => clue.id === editingClueId) ?? null
    const cluesRef = useRef(clues)
    useEffect((): void => {
        cluesRef.current = clues
    }, [clues])

    const handleRemove = (clueId: string): void => {
        onChange(cluesRef.current.filter((clue) => clue.id !== clueId))
    }

    const handleSave = (nextClue: OutlineClue): void => {
        onChange(cluesRef.current.map((clue) => (clue.id === nextClue.id ? nextClue : clue)))
    }

    return (
        <>
            {warnings.length > 0 ? (
                <div className="flex flex-col gap-2">
                    {warnings.map((warning) => (
                        <Alert
                            key={`${warning.clue.id}-${warning.message}`}
                            title={warning.message}
                            variant={warning.severity === 'warning' ? 'destructive' : 'default'}
                        />
                    ))}
                </div>
            ) : null}

            {clues.length === 0 ? (
                <Empty
                    icon={Lightbulb}
                    title="还没有伏笔"
                    description="记下埋设点与回收章，写完正文再回填状态。"
                />
            ) : (
                <ItemGroup className="gap-2 py-3">
                    {clues.map((clue, index) => (
                        <ClueTrackItem
                            key={clue.id}
                            clue={clue}
                            index={index}
                            onEdit={setEditingClueId}
                            onRemove={handleRemove}
                        />
                    ))}
                </ItemGroup>
            )}

            {editingClue === null ? null : (
                <ClueTrackEditDialog
                    key={editingClue.id}
                    isOpen={true}
                    onOpenChange={(isOpen): void => {
                        if (!isOpen) {
                            setEditingClueId(null)
                        }
                    }}
                    clue={editingClue}
                    characters={characters}
                    refOptions={refOptions}
                    warnings={warnings}
                    onSave={handleSave}
                />
            )}
        </>
    )
}
