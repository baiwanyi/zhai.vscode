/**
 * 全书结构纲面板：只记 3~5 个全书级大转折，卷级转折归各卷卷纲。
 * 复用约定：列表取 block/StructureActItem（ui/item），编辑取 StructureActDialog，空态取 @webview/blocks/Empty；
 * 结构模板取 constants 的 STRUCTURE_TEMPLATES，套用交互由 StructureTemplateDialog 承担。
 * 关键约束：卷位存卷序不存卷 id；编辑期只在弹窗草稿里改，确认后一次性回传整个列表；
 * 模板只预填阶段名、转折类型与叙事作用，覆盖模式由作者在弹窗里显式选择。
 */
import { LayoutTemplate, Milestone } from 'lucide-react'
import { useState } from 'react'
import { ItemGroup } from '@components/ui/item'
import { Empty } from '@webview/blocks/Empty'
import { Button } from '@webview/components/Button'
import { StructureActDialog } from './StructureActDialog'
import { StructureTemplateDialog } from './StructureTemplateDialog'
import type { StructureTemplate } from '../../constants'
import type { OutlineAct } from '../../types'
import type { StructureTemplateMode } from './StructureTemplateDialog'
import type { JSX } from 'react'
import { createAct } from '../../utils'
import { StructureActItem } from '../block/StructureActItem'

interface StructurePanelProps {
    acts: OutlineAct[]
    /** 卷位选项：value 为卷序字符串，label 为「第N卷 卷名」 */
    volumeOptions: readonly { value: string; label: string }[]
    onChange: (acts: OutlineAct[]) => void
}

/** 全书结构纲：阶段列表 + 编辑弹窗 + 模板入口 */
export function StructurePanel({ acts, volumeOptions, onChange }: StructurePanelProps): JSX.Element {
    const [editingActId, setEditingActId] = useState<string | null>(null)
    const [isTemplateOpen, setIsTemplateOpen] = useState(false)
    const editingAct = acts.find((act) => act.id === editingActId) ?? null

    const handleRemove = (actId: string): void => {
        onChange(acts.filter((act) => act.id !== actId))
    }

    const handleSave = (nextAct: OutlineAct): void => {
        onChange(acts.map((act) => (act.id === nextAct.id ? nextAct : act)))
    }

    /** 套用模板：按模板顺序生成阶段，追加到末尾或整批替换现有阶段 */
    const handleApplyTemplate = (template: StructureTemplate, mode: StructureTemplateMode): void => {
        const generated = template.acts.map((item) => ({ ...createAct(item.name, item.narrativeRole), kind: item.kind }))
        onChange(mode === 'replace' ? generated : [...acts, ...generated])
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
            <div className="flex items-center justify-between gap-2 py-3">
                <p className="min-w-0 text-muted-foreground text-sm">
                    全书只记 3~5 个转折，卷级转折写在卷纲里
                </p>
                <Button variant="outline" size="sm" tooltip="套用结构模板" onClick={(): void => setIsTemplateOpen(true)}>
                    <LayoutTemplate />
                    套用模板
                </Button>
            </div>
            {acts.length === 0 ? (
                <Empty
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
            <StructureTemplateDialog
                isOpen={isTemplateOpen}
                onOpenChange={setIsTemplateOpen}
                hasExistingActs={acts.length > 0}
                onApply={handleApplyTemplate}
            />
        </>
    )
}
