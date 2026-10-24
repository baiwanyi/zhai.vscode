/**
 * 快照时间线单条：展示创建时间、来源、本次变动范围与体积，并提供恢复与删除两个入口。
 * 复用约定：条目容器取 @components/ui 的 item，徽标取 badge，动作用 button；
 * 来源与变动文档的中文标签集中在本文件，页面只负责编排与确认。
 * 关键约束：删除按钮带可访问名称且不触发条目本身的点击；恢复按钮在写操作进行中一并禁用，避免重复提交。
 */
import { InboxIcon, RotateCcw, Trash2 } from 'lucide-react'
import { Badge } from '@components/ui/badge'
import { Button } from '@components/ui/button'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@components/ui/item'
import type { PressSnapshotEntry, PressSnapshotFileKey, PressSnapshotReason } from '@shared/types/press'
import { formatSize, formatSnapshotTime } from './snapshotFormat'
import type { JSX } from 'react'

/** 来源中文标签：手动与恢复前留底要和自动快照区分开，避免用户误删人工留的版本 */
const REASON_LABELS: Readonly<Record<PressSnapshotReason, string>> = {
    auto: '自动',
    manual: '手动',
    restore: '恢复前',
}

/** 文档中文标签：与写作管理的分区命名保持一致 */
const FILE_LABELS: Readonly<Record<PressSnapshotFileKey, string>> = {
    readme: '作品信息',
    setting: '设定',
    characters: '角色',
    outline: '大纲',
}

interface SnapshotListItemProps {
    snapshot: PressSnapshotEntry
    /** 写操作进行中：禁用本条的恢复与删除 */
    isBusy: boolean
    onRestore: (snapshot: PressSnapshotEntry) => void
    onDelete: (snapshot: PressSnapshotEntry) => void
}

export function SnapshotListItem({ snapshot, isBusy, onRestore, onDelete }: SnapshotListItemProps): JSX.Element {
    const changed =
        snapshot.changed.length === 0 ? '内容未变' : snapshot.changed.map((key) => FILE_LABELS[key]).join('、')
    const trigger =
        snapshot.trigger.length === 0
            ? '手动留版'
            : `改写 ${snapshot.trigger.map((key) => FILE_LABELS[key]).join('、')}`
    const detail =
        snapshot.label.length > 0
            ? `${snapshot.label} · ${formatSize(snapshot.sizeBytes)}`
            : `${trigger} · ${formatSize(snapshot.sizeBytes)}`
    return (
        <Item variant="outline">
            <ItemMedia variant="icon">
                <InboxIcon />
            </ItemMedia>
            <ItemContent>
                <ItemTitle>
                    <span className="tabular-nums">{formatSnapshotTime(snapshot.createdAt)}</span>
                    <Badge variant="outline">{REASON_LABELS[snapshot.reason]}</Badge>
                    <span className="text-muted-foreground">{changed}</span>
                </ItemTitle>
                <ItemDescription className="text-xs">{detail}</ItemDescription>
            </ItemContent>
            <ItemActions>
                <Button size="icon" variant="outline" disabled={isBusy} onClick={() => onRestore(snapshot)}>
                    <RotateCcw />
                </Button>
                <Button
                    size="icon"
                    variant="destructive"
                    disabled={isBusy}
                    aria-label={`删除 ${formatSnapshotTime(snapshot.createdAt)} 的快照`}
                    onClick={() => onDelete(snapshot)}
                >
                    <Trash2 />
                </Button>
            </ItemActions>
        </Item>
    )
}
