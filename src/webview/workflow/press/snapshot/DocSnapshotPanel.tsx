/**
 * 设定与大纲快照面板：按时间倒序列出四份结构化文档的历次留版，支持手动留版、整版恢复与删除单版。
 * 复用约定：取数与动作由 usePressSnapshots 承担，单条渲染由 SnapshotListItem 承担，空态由 SnapshotEmpty 承担；
 * 恢复与删除的确认框、创建备注对话框分别由 SnapshotConfirmDialog 与 SnapshotCreateDialog 承担，本组件只做编排与文案。
 * 关键约束：恢复会整版覆盖四份文档且不动章节正文，删除只影响该版本，两处文案必须写清边界；
 * 写操作进行中禁用入口，防止同一动作被连点提交两次。
 */
import { Camera } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@components/ui/card'
import { ItemGroup } from '@components/ui/item'
import type { PressSnapshotEntry } from '@shared/types/press'
import { usePressSnapshots } from './hooks/usePressSnapshots'
import { SnapshotConfirmDialog } from './SnapshotConfirmDialog'
import { SnapshotCreateDialog } from './SnapshotCreateDialog'
import { SnapshotEmpty } from './SnapshotEmpty'
import { SnapshotListItem } from './SnapshotListItem'
import type { JSX } from 'react'

interface DocSnapshotPanelProps {
    /** 当前作品目录：快照与作品文档同目录下的 Snapshots 子目录 */
    dirPath: string
}

export function DocSnapshotPanel({ dirPath }: DocSnapshotPanelProps): JSX.Element {
    const { snapshots, isLoading, isBusy, createSnapshot, restoreSnapshot, deleteSnapshot } = usePressSnapshots(dirPath)
    const [pendingRestore, setPendingRestore] = useState<PressSnapshotEntry | null>(null)
    const [pendingDelete, setPendingDelete] = useState<PressSnapshotEntry | null>(null)
    const [isCreateOpen, setIsCreateOpen] = useState(false)

    return (
        <>
            <Card className="h-full">
                <CardHeader>
                    <CardTitle>快照列表</CardTitle>
                    <CardAction>
                        <Button variant="outline" disabled={isBusy} onClick={() => setIsCreateOpen(true)}>
                            <Camera />
                            立即快照
                        </Button>
                    </CardAction>
                </CardHeader>
                <CardContent className="min-h-0 flex-1 overflow-y-auto">
                    {snapshots.length === 0 ? (
                        <SnapshotEmpty
                            isLoading={isLoading}
                            title="还没有快照"
                            description="设定、角色或大纲内容有改动时会自动留一版；也可以点上方「立即快照」手动留一版。"
                        />
                    ) : (
                        <ItemGroup>
                            {snapshots.map((snapshot) => (
                                <SnapshotListItem
                                    key={snapshot.id}
                                    snapshot={snapshot}
                                    isBusy={isBusy}
                                    onRestore={setPendingRestore}
                                    onDelete={setPendingDelete}
                                />
                            ))}
                        </ItemGroup>
                    )}
                </CardContent>
            </Card>

            <SnapshotConfirmDialog
                open={pendingRestore !== null}
                title="恢复到这一版？"
                description="作品信息、设定、角色与大纲会整版覆盖为所选快照的内容，章节正文不受影响。恢复前会先自动留一版当前内容，误操作也能回退。"
                confirmLabel="恢复"
                onOpenChange={(isOpen) => {
                    if (!isOpen) {
                        setPendingRestore(null)
                    }
                }}
                onConfirm={() => {
                    const target = pendingRestore
                    setPendingRestore(null)
                    if (target !== null) {
                        void restoreSnapshot(target.id)
                    }
                }}
            />

            <SnapshotConfirmDialog
                open={pendingDelete !== null}
                title="删除这一版快照？"
                description="只删除所选版本，不影响作品文档与其它快照；删除后不可找回。"
                confirmLabel="删除"
                isDestructive
                onOpenChange={(isOpen) => {
                    if (!isOpen) {
                        setPendingDelete(null)
                    }
                }}
                onConfirm={() => {
                    const target = pendingDelete
                    setPendingDelete(null)
                    if (target !== null) {
                        void deleteSnapshot(target.id)
                    }
                }}
            />

            <SnapshotCreateDialog
                open={isCreateOpen}
                idPrefix="doc-snapshot"
                title="立即快照"
                description="把当前的作品信息、设定、角色与大纲整份存为一版。"
                placeholder="如：改完第三章大纲"
                onOpenChange={setIsCreateOpen}
                onSubmit={(label) => {
                    setIsCreateOpen(false)
                    void createSnapshot(label)
                }}
            />
        </>
    )
}
