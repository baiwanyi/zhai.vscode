/**
 * 单文件快照页：对当前打开的 Markdown 文档展示一条正文时间线，笔记、公众号文章与散落 md 共用。
 * 复用约定：外壳取 @webview/components/AppPage，取数与动作由 hooks/useDocSnapshots 承担，
 * 版本列表复用 ChapterVersionList（两类条目同为「时间 + 来源 + 备注 + 体积」），
 * 备注框与恢复/删除确认分别复用 SnapshotCreateDialog 与 AlertDialog。
 * 关键约束：docPath 为空时不渲染本页，由调用方给引导空态；恢复前由宿主拒绝「编辑器里还有未保存修改」的情形，
 * 此处只如实提示宿主返回的错误，不自行判断脏状态。
 */
import { Archive, Camera } from 'lucide-react'
import { useState } from 'react'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card'
import type { DocSnapshotEntry } from '@shared/types/snapshot'
import { Empty } from '@webview/blocks/Empty'
import { AlertDialog } from '@webview/components/AlertDialog'
import { AppContent, AppDescription, AppHeader, AppPage, AppTitle } from '@webview/components/AppPage'
import { AppSummary } from '@webview/components/AppSummary'
import { Button } from '@webview/components/Button'
import { ChapterVersionList } from './ChapterVersionList'
import { useDocSnapshots } from './hooks/useDocSnapshots'
import { SnapshotCreateDialog } from './SnapshotCreateDialog'
import { formatSnapshotTime } from './snapshotFormat'
import type { JSX } from 'react'

interface SingleDocSnapshotPageProps {
    /** 当前文档的相对路径：单文件时间线以它为唯一键 */
    docPath: string
}

/** 展示标题：取文件名，路径整段交给摘要行，避免标题过长 */
function readDocTitle(docPath: string): string {
    const segments = docPath.split('/')
    const fileName = segments[segments.length - 1] ?? docPath
    return fileName.replace(/\.md$/iu, '')
}

export function SingleDocSnapshotPage({ docPath }: SingleDocSnapshotPageProps): JSX.Element {
    const { versions, isLoading, isBusy, capture, restore, remove } = useDocSnapshots(docPath)
    const [pendingRestore, setPendingRestore] = useState<DocSnapshotEntry | null>(null)
    const [pendingDelete, setPendingDelete] = useState<DocSnapshotEntry | null>(null)
    const [isCreateOpen, setIsCreateOpen] = useState(false)

    const restoreDescription =
        pendingRestore === null
            ? ''
            : `当前正文会覆盖为 ${formatSnapshotTime(pendingRestore.createdAt)} 的内容，恢复前会自动留一版当前正文。若该文档有未保存的修改，需先保存或撤销。`

    return (
        <AppPage>
            <AppHeader>
                <AppTitle>快照</AppTitle>
                <AppDescription>
                    保存文档后自动留一版，AI 写回前也会留底，公众号文章在群发成功后留底；恢复前同样先留一版。
                </AppDescription>
                <AppSummary title={readDocTitle(docPath)} path={docPath} />
            </AppHeader>
            <AppContent>
                <Card className="h-full">
                    <CardHeader>
                        <CardTitle>版本列表</CardTitle>
                        <CardDescription className="truncate">
                            {isLoading ? '正在读取…' : `共 ${versions.length} 版`}
                        </CardDescription>
                        <CardAction>
                            <Button variant="outline" disabled={isBusy} onClick={() => setIsCreateOpen(true)}>
                                <Camera />
                                立即快照
                            </Button>
                        </CardAction>
                    </CardHeader>
                    <CardContent className="min-h-0 flex-1 overflow-y-auto">
                        {versions.length === 0 ? (
                            <Empty
                                isLoading={isLoading}
                                icon={Archive}
                                title={isLoading ? '正在读取…' : '这份文档还没有历史版本'}
                                description="保存文档或让 AI 写回一次，就会在这里留下第一版。"
                                className="h-full border border-dashed border-border"
                            />
                        ) : (
                            <ChapterVersionList
                                versions={versions}
                                isBusy={isBusy}
                                onRestore={setPendingRestore}
                                onDelete={setPendingDelete}
                            />
                        )}
                    </CardContent>
                </Card>

                <AlertDialog
                    open={pendingRestore !== null}
                    title="恢复到这一版？"
                    description={restoreDescription}
                    confirmLabel="恢复"
                    size="sm"
                    onOpenChange={(isOpen) => {
                        if (!isOpen) {
                            setPendingRestore(null)
                        }
                    }}
                    onConfirm={() => {
                        const target = pendingRestore
                        setPendingRestore(null)
                        if (target !== null) {
                            void restore(target.id)
                        }
                    }}
                />

                <AlertDialog
                    open={pendingDelete !== null}
                    title="删除这一版快照？"
                    description="只删除所选版本，不影响文档正文与其它快照；删除后不可找回。"
                    confirmLabel="删除"
                    size="sm"
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
                            void remove(target.id)
                        }
                    }}
                />

                <SnapshotCreateDialog
                    open={isCreateOpen}
                    idPrefix="doc-snapshot"
                    title="立即保存文档快照"
                    description="把这份文档磁盘上的正文整份存为一版。"
                    placeholder="如：改完开头三段"
                    onOpenChange={setIsCreateOpen}
                    onSubmit={(label) => {
                        setIsCreateOpen(false)
                        void capture(label)
                    }}
                />
            </AppContent>
        </AppPage>
    )
}
