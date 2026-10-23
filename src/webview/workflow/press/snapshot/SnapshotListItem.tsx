/**
 * 快照时间线单条：展示创建时间、来源、本次变动范围与体积，并提供恢复与删除两个入口。
 * 复用约定：条目容器取 @components/ui 的 item，徽标取 badge，动作用 button；
 * 来源与变动文档的中文标签集中在本文件，页面只负责编排与确认。
 * 关键约束：删除按钮带可访问名称且不触发条目本身的点击；恢复按钮在写操作进行中一并禁用，避免重复提交。
 */
import { RotateCcw, Trash2 } from 'lucide-react'
import { Badge } from '@components/ui/badge'
import { Button } from '@components/ui/button'
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@components/ui/item'
import type { PressSnapshotEntry, PressSnapshotFileKey, PressSnapshotReason } from '@shared/types/press'
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

/** 补零：时间与体积都需要两位对齐 */
function pad(value: number): string {
    return String(value).padStart(2, '0')
}

/** 格式化创建时间：本地时间到分钟，跨年份不影响可读性 */
function formatSnapshotTime(value: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
        return value
    }
    const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 格式化体积：不足 1KB 显示字节，其余保留一位小数 */
function formatSize(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`
    }
    return `${(bytes / 1024).toFixed(1)} KB`
}

interface SnapshotListItemProps {
    snapshot: PressSnapshotEntry
    /** 写操作进行中：禁用本条的恢复与删除 */
    isBusy: boolean
    onRestore: (snapshot: PressSnapshotEntry) => void
    onDelete: (snapshot: PressSnapshotEntry) => void
}

export function SnapshotListItem({ snapshot, isBusy, onRestore, onDelete }: SnapshotListItemProps): JSX.Element {
    const changed = snapshot.changed.length === 0 ? '内容未变' : snapshot.changed.map((key) => FILE_LABELS[key]).join('、')
    const trigger = snapshot.trigger.length === 0 ? '手动留版' : `改写 ${snapshot.trigger.map((key) => FILE_LABELS[key]).join('、')}`
    const detail = snapshot.label.length > 0 ? `${snapshot.label} · ${formatSize(snapshot.sizeBytes)}` : `${trigger} · ${formatSize(snapshot.sizeBytes)}`
    return (
        <Item size="sm">
            <ItemContent>
                <ItemTitle>
                    <span className="tabular-nums">{formatSnapshotTime(snapshot.createdAt)}</span>
                    <Badge variant="outline">{REASON_LABELS[snapshot.reason]}</Badge>
                    <span className="text-muted-foreground">{changed}</span>
                </ItemTitle>
                <ItemDescription className="text-xs">{detail}</ItemDescription>
            </ItemContent>
            <ItemActions>
                <Button size="sm" variant="outline" disabled={isBusy} onClick={() => onRestore(snapshot)}>
                    <RotateCcw />
                    恢复
                </Button>
                <Button
                    size="icon"
                    variant="ghost"
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
