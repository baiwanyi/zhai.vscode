/**
 * 正文时间线列表：列出某章或某份文档历次留版的来源、备注与体积，并提供恢复与删除入口。
 * 复用约定：条目容器取 @components/ui 的 item，徽标取 badge，恢复动作用 button，
 * 删除入口兼带二次确认，取 blocks/DeleteConfirmButton；时间、体积与来源文案统一取 snapshotFormat，
 * 泛型参数只要求 id / createdAt / reason / label / sizeBytes，章节条目与单文件条目共用本组件。
 * 关键约束：删除确认文案由调用方经 deleteConfirm 给出——章节与单文件的影响面不同，不能在本组件里写死；
 * 写操作进行中禁用入口，避免同一动作被连点提交两次。
 */
import { Camera, RotateCcw } from 'lucide-react'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@components/ui/item'
import type { ChapterSnapshotReason } from '@shared/types/press'
import type { DocSnapshotReason } from '@shared/types/snapshot'
import { Badge } from '@webview/blocks/Badge'
import { DeleteConfirmButton } from '@webview/blocks/DeleteConfirmButton'
import { Button } from '@webview/components/Button'
import { SNAPSHOT_REASON_LABELS, formatSize, formatSnapshotTime } from './snapshotFormat'
import type { JSX } from 'react'

/** 时间线条目的最小展示契约：章节快照与单文件快照都满足 */
export interface SnapshotVersionItem {
    id: string
    createdAt: string
    reason: ChapterSnapshotReason | DocSnapshotReason
    label: string
    sizeBytes: number
}

/** 删除确认文案：标题与说明都写清影响面，由承载页面按章节 / 单文件口径给出 */
export interface SnapshotDeleteConfirm {
    title: string
    description: string
}

interface ChapterVersionListProps<T extends SnapshotVersionItem> {
    versions: T[]
    isBusy: boolean
    deleteConfirm: SnapshotDeleteConfirm
    onRestore: (version: T) => void
    onDelete: (version: T) => void
}

export function ChapterVersionList<T extends SnapshotVersionItem>({
    versions,
    isBusy,
    deleteConfirm,
    onRestore,
    onDelete,
}: ChapterVersionListProps<T>): JSX.Element {
    return (
        <ItemGroup>
            {versions.map((version) => {
                const detail =
                    version.label.length > 0
                        ? `${version.label} · ${formatSize(version.sizeBytes)}`
                        : formatSize(version.sizeBytes)
                return (
                    <Item key={version.id} variant="outline">
                        <ItemMedia variant="icon">
                            <Camera />
                        </ItemMedia>
                        <ItemContent>
                            <ItemTitle>
                                <span className="tabular-nums">{formatSnapshotTime(version.createdAt)}</span>
                                <Badge variant="outline">{SNAPSHOT_REASON_LABELS[version.reason]}</Badge>
                            </ItemTitle>
                            <ItemDescription className="text-xs">{detail}</ItemDescription>
                        </ItemContent>
                        <ItemActions>
                            <Button
                                size="icon"
                                variant="outline"
                                disabled={isBusy}
                                aria-label={`恢复到 ${formatSnapshotTime(version.createdAt)} 的版本`}
                                onClick={() => onRestore(version)}
                            >
                                <RotateCcw />
                            </Button>
                            <DeleteConfirmButton
                                tooltip={`删除 ${formatSnapshotTime(version.createdAt)} 的版本`}
                                title={deleteConfirm.title}
                                description={deleteConfirm.description}
                                className="opacity-100"
                                props={{ disabled: isBusy }}
                                onConfirm={(): void => onDelete(version)}
                            />
                        </ItemActions>
                    </Item>
                )
            })}
        </ItemGroup>
    )
}
