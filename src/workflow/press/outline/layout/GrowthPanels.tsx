/**
 * 成长线页：按卷分组展示主角与金手指的成长节点，支持逐条编辑与删除兜底修正。
 * 复用约定：卡片取 ui/card，空态取 blocks/Empty，徽标取 blocks/Badge，按钮取 @webview/components/Button，
 * 轨道文案与顺序取 constants 的 GROWTH_TRACK_META / GROWTH_TRACK_ORDER，卷序口径取 utils 的 readOutlineVolumeOrder。
 * 关键约束：以回填识别为主，页面不自带 AI 请求；只读聚合，增删改一律经 onChange 回传整表，
 * 卷级节点与章级节点共存，按章序升序排列，章序为空的节点排在前面。
 */
import { Pencil, TrendingUp, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card'
import { Badge } from '@webview/blocks/Badge'
import { Empty } from '@webview/blocks/Empty'
import { Button } from '@webview/components/Button'
import { GrowthEditDialog } from './GrowthEditDialog'
import type { GrowthPoint, OutlineVolume } from '../../types'
import type { JSX } from 'react'
import { GROWTH_TRACK_META, GROWTH_TRACK_ORDER } from '../../constants'
import { readOutlineVolumeOrder, volumeTitleLabel } from '../../utils'

interface GrowthPanelsProps {
    points: readonly GrowthPoint[]
    volumes: readonly OutlineVolume[]
    onChange: (points: GrowthPoint[]) => void
}

/** 同一轨道内的排序：卷级节点在前，其余按章序升序 */
function comparePoints(left: GrowthPoint, right: GrowthPoint): number {
    const leftOrder = left.chapterOrder ?? 0
    const rightOrder = right.chapterOrder ?? 0
    return leftOrder - rightOrder
}

/** 成长线：按卷分组、轨道分列的只读列表 + 编辑弹窗 */
export function GrowthPanels({ points, volumes, onChange }: GrowthPanelsProps): JSX.Element {
    const [editingPointId, setEditingPointId] = useState<string | null>(null)
    const editingPoint = points.find((point) => point.id === editingPointId) ?? null

    const volumeChoices = volumes.map((volume, index) => ({
        volume,
        order: readOutlineVolumeOrder(volume.name, index),
        label: volumeTitleLabel(volume.name, index),
    }))
    /** 卷序集合：现有卷与文档里已有节点的卷取并集，避免手写卷序的节点在页面上消失 */
    const orders = [
        ...new Set([...volumeChoices.map((item) => item.order), ...points.map((point) => point.volumeOrder)]),
    ].sort((left, right) => left - right)

    const handleSave = (nextPoint: GrowthPoint): void => {
        onChange(points.map((point) => (point.id === nextPoint.id ? nextPoint : point)))
    }

    const handleRemove = (pointId: string): void => {
        onChange(points.filter((point) => point.id !== pointId))
    }

    if (points.length === 0) {
        return (
            <Empty
                icon={TrendingUp}
                title="还没有成长记录"
                description="用页头「写后回填」识别成长节点，或点页头「添加节点」手动补一条"
            />
        )
    }

    return (
        <>
            <div className="flex flex-col gap-3 py-3">
                {orders.map((order) => {
                    const matched = volumeChoices.find((item) => item.order === order)
                    const groupPoints = points
                        .filter((point) => point.volumeOrder === order)
                        .sort((left, right) => comparePoints(left, right))
                    return (
                        <Card key={order} size="sm">
                            <CardHeader>
                                <CardTitle>{matched === undefined ? `第${String(order)}卷` : matched.label}</CardTitle>
                                <CardDescription>本卷的成长变化，按轨道分列</CardDescription>
                            </CardHeader>
                            <CardContent className="grid grid-cols-1 gap-3 @xl:grid-cols-2">
                                {GROWTH_TRACK_ORDER.map((track) => {
                                    const trackPoints = groupPoints.filter((point) => point.track === track)
                                    return (
                                        <div key={track} className="flex min-w-0 flex-col gap-1.5">
                                            <Badge variant={GROWTH_TRACK_META[track].tone} className="self-start">
                                                {GROWTH_TRACK_META[track].label}
                                            </Badge>
                                            {trackPoints.length === 0 ? (
                                                <p className="text-muted-foreground/70 text-sm">暂无记录</p>
                                            ) : (
                                                trackPoints.map((point) => (
                                                    <div key={point.id} className="flex items-start gap-1">
                                                        <div className="min-w-0 flex-1">
                                                            <p className="wrap-break-word text-sm">
                                                                {point.value}
                                                                {point.chapterOrder === null ? null : (
                                                                    <span className="text-muted-foreground">
                                                                        （第{String(point.chapterOrder)}章）
                                                                    </span>
                                                                )}
                                                            </p>
                                                            {point.note.length > 0 ? (
                                                                <p className="wrap-break-word text-muted-foreground text-xs">
                                                                    {point.note}
                                                                </p>
                                                            ) : null}
                                                        </div>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon-xs"
                                                            aria-label={`编辑成长节点：${point.value}`}
                                                            onClick={(): void => setEditingPointId(point.id)}
                                                        >
                                                            <Pencil />
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon-xs"
                                                            className="hover:text-destructive"
                                                            aria-label={`删除成长节点：${point.value}`}
                                                            onClick={(): void => handleRemove(point.id)}
                                                        >
                                                            <Trash2 />
                                                        </Button>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    )
                                })}
                            </CardContent>
                        </Card>
                    )
                })}
            </div>
            {editingPoint === null ? null : (
                <GrowthEditDialog
                    key={editingPoint.id}
                    isOpen={true}
                    onOpenChange={(isOpen): void => {
                        if (!isOpen) {
                            setEditingPointId(null)
                        }
                    }}
                    point={editingPoint}
                    volumes={volumes}
                    onSave={handleSave}
                />
            )}
        </>
    )
}
