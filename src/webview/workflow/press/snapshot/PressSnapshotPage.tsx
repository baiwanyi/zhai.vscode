/**
 * 作品快照页：按时间倒序列出设定、角色、大纲的历次留版，支持手动留版、整版恢复与删除单版。
 * 复用约定：取数与动作由 usePressSnapshots 承担，单条渲染由 SnapshotListItem 承担，空态由 SnapshotEmpty 承担；
 * 容器与徽标全部取自 @components/ui，页面只做编排、二次确认与文案说明。
 * 关键约束：恢复与删除都必须二次确认，确认框要写清影响范围——恢复会整版覆盖四份文档，
 * 删除只影响该版本；写操作进行中禁用入口，防止同一动作被连点提交两次。
 */
import { Camera } from 'lucide-react'
import { useState } from 'react'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@components/ui/alert-dialog'
import { Button } from '@components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@components/ui/dialog'
import { Field, FieldDescription, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { ItemGroup } from '@components/ui/item'
import type { PressSnapshotEntry } from '@shared/types/press'
import { usePressSnapshots } from './hooks/usePressSnapshots'
import { SnapshotEmpty } from './SnapshotEmpty'
import { SnapshotListItem } from './SnapshotListItem'
import type { JSX } from 'react'

interface PressSnapshotPageProps {
    /** 当前作品目录：快照与作品文档同目录下的 Snapshots 子目录 */
    dirPath: string
}

export function PressSnapshotPage({ dirPath }: PressSnapshotPageProps): JSX.Element {
    const { snapshots, isLoading, isBusy, createSnapshot, restoreSnapshot, deleteSnapshot } = usePressSnapshots(dirPath)
    const [pendingRestore, setPendingRestore] = useState<PressSnapshotEntry | null>(null)
    const [pendingDelete, setPendingDelete] = useState<PressSnapshotEntry | null>(null)
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [label, setLabel] = useState('')

    const handleCreate = (): void => {
        const value = label.trim()
        setLabel('')
        setIsCreateOpen(false)
        void createSnapshot(value.length > 0 ? value : undefined)
    }

    return (
        <div className="flex h-full min-h-0 flex-col gap-3 p-4">
            <header className="flex flex-col gap-2">
                <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                        <h2 className="truncate font-heading font-semibold">快照</h2>
                        <p className="truncate text-muted-foreground">
                            设定、角色、大纲有改动时自动留一版，可回到任意时间点
                        </p>
                    </div>
                    <Button className="shrink-0" disabled={isBusy} onClick={() => setIsCreateOpen(true)}>
                        <Camera />
                        立即快照
                    </Button>
                </div>
                <p className="text-muted-foreground text-xs">
                    快照保存在作品的 Snapshots 目录，不参与索引；恢复前会自动把当前内容也留一版。
                </p>
            </header>

            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-0.5">
                {snapshots.length === 0 ? (
                    <SnapshotEmpty isLoading={isLoading} />
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
            </div>

            <AlertDialog
                open={pendingRestore !== null}
                onOpenChange={(isOpen) => {
                    if (!isOpen) {
                        setPendingRestore(null)
                    }
                }}
            >
                <AlertDialogContent size="sm">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-lg">恢复到这一版？</AlertDialogTitle>
                        <AlertDialogDescription>
                            作品信息、设定、角色与大纲会整版覆盖为所选快照的内容。恢复前会先自动留一版当前内容，误操作也能回退。
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                const target = pendingRestore
                                setPendingRestore(null)
                                if (target !== null) {
                                    void restoreSnapshot(target.id)
                                }
                            }}
                        >
                            恢复
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog
                open={pendingDelete !== null}
                onOpenChange={(isOpen) => {
                    if (!isOpen) {
                        setPendingDelete(null)
                    }
                }}
            >
                <AlertDialogContent size="sm">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-lg">删除这一版快照？</AlertDialogTitle>
                        <AlertDialogDescription>
                            只删除所选版本，不影响作品文档与其它快照；删除后不可找回。
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction
                            variant="destructive"
                            onClick={() => {
                                const target = pendingDelete
                                setPendingDelete(null)
                                if (target !== null) {
                                    void deleteSnapshot(target.id)
                                }
                            }}
                        >
                            删除
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <Dialog
                open={isCreateOpen}
                onOpenChange={(isOpen) => {
                    if (!isOpen) {
                        setIsCreateOpen(false)
                    }
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="text-lg">立即快照</DialogTitle>
                        <DialogDescription>把当前的作品信息、设定、角色与大纲整份存为一版。</DialogDescription>
                    </DialogHeader>
                    <Field>
                        <FieldLabel htmlFor="snapshot-label">备注（可选）</FieldLabel>
                        <Input
                            id="snapshot-label"
                            value={label}
                            maxLength={60}
                            placeholder="如：改完第三章大纲"
                            onChange={(event) => setLabel(event.target.value)}
                        />
                        <FieldDescription>留空表示只记时间，不影响快照内容。</FieldDescription>
                    </Field>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                            取消
                        </Button>
                        <Button onClick={handleCreate}>保存快照</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
