/**
 * 全书结构纲面板：只记 3~5 个全书级大转折，卷级转折归各卷卷纲。
 * 复用约定：列表取 block/StructureActItem（ui/item），编辑取 StructureActDialog，空态取 @webview/blocks/StateEmpty。
 * 关键约束：卷位存卷序不存卷 id；编辑期只在弹窗草稿里改，确认后一次性回传整个列表。
 */
import { Milestone } from 'lucide-react'
import { useState } from 'react'
import { ItemGroup } from '@components/ui/item'
import { StateEmpty } from '@webview/blocks/StateEmpty'
import { StructureActDialog } from './StructureActDialog'
import type { OutlineAct } from '../../types'
import type { JSX } from 'react'
import { StructureActItem } from '../block/StructureActItem'

interface StructurePanelProps {
    acts: OutlineAct[]
    /** 卷位选项：value 为卷序字符串，label 为「第N卷 卷名」 */
    volumeOptions: readonly { value: string; label: string }[]
    onChange: (acts: OutlineAct[]) => void
}

/** 全书结构纲：阶段列表 + 编辑弹窗 */
export function StructurePanel({ acts, volumeOptions, onChange }: StructurePanelProps): JSX.Element {
    const [editingActId, setEditingActId] = useState<string | null>(null)
    const editingAct = acts.find((act) => act.id === editingActId) ?? null

    const handleRemove = (actId: string): void => {
        onChange(acts.filter((act) => act.id !== actId))
    }

    const handleSave = (nextAct: OutlineAct): void => {
        onChange(acts.map((act) => (act.id === nextAct.id ? nextAct : act)))
    }

    const readVolumeLabel = (volumeOrder: number | null): string | null => {
        if (volumeOrder === null) {
            return null
        }
        return (
            volumeOptions.find((option) => option.value === String(volumeOrder))?.label ?? `第${String(volumeOrder)}卷`
        )
    }

    return (
        <>
            {acts.length === 0 ? (
                <StateEmpty
                    icon={Milestone}
                    title="还没有结构阶段"
                    description="点页头「添加阶段」，记录全书转折"
                />
            ) : (
                <ItemGroup className="gap-2">
                    {acts.map((act, index) => (
                        <StructureActItem
                            key={act.id}
                            act={act}
                            index={index}
                            volumeLabel={readVolumeLabel(act.volumeOrder)}
                            onEdit={setEditingActId}
                            onRemove={handleRemove}
                        />
                    ))}
                </ItemGroup>
            )}
            {editingAct === null ? null : (
                <StructureActDialog
                    key={editingAct.id}
                    isOpen={true}
                    onOpenChange={(isOpen): void => {
                        if (!isOpen) {
                            setEditingActId(null)
                        }
                    }}
                    act={editingAct}
                    volumeOptions={volumeOptions}
                    onSave={handleSave}
                />
            )}
        </>
    )
}
