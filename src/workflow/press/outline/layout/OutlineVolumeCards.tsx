/**
 * 卷纲页：每卷一张卡片，卡内编辑卷标题、预计章节数、核心事件与主要情节，并按卷生成章纲。
 * 复用约定：卡片取 ui/card，主要情节条目取 ui/item，输入取 ui/input 与 ui/textarea，
 * 空态取 components/StateEmpty，按钮取 components/Button。
 * 关键约束：只回传当前卷的补丁（onUpdate 带卷 id），不复制卷状态；
 * 核心事件上限 200 字，预计章节数只接受 0~500 的整数（0 表示未填）；
 * 点卡片标题进入章纲页并按该卷筛选，生成章纲复用页面的对话框，本组件只负责发起；
 * 新增卷入口在页头第二行，这里不再重复放按钮。
 */
import { ListTree, Plus, Sparkles, Trash2 } from 'lucide-react'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card'
import { Field, FieldDescription, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { Item, ItemActions, ItemContent, ItemGroup } from '@components/ui/item'
import { Textarea } from '@components/ui/textarea'
import { Button } from '@webview/components/Button'
import { StateEmpty } from '@webview/components/StateEmpty'
import type { OutlineVolume } from '../../types'
import type { JSX } from 'react'

/** 核心事件字数上限：与卷纲卡片的展示口径一致 */
const CORE_EVENT_MAX_LENGTH = 200

/** 预计章节数上限：正常作品远低于该值，超出视为误输 */
const EXPECTED_CHAPTERS_MAX = 500

interface OutlineVolumeCardsProps {
    volumes: OutlineVolume[]
    onUpdate: (volumeId: string, patch: Partial<OutlineVolume>) => void
    /** 进入章纲页并按该卷筛选 */
    onOpenChapters: (volume: OutlineVolume) => void
    /** 打开「按卷生成章纲」对话框 */
    onGenerateChapters: (volume: OutlineVolume) => void
}

/** 读取预计章节数：留空或非法值按 0 处理，超出上限截断 */
function readExpectedChapters(value: string): number {
    const parsed = Number.parseInt(value, 10)
    if (Number.isNaN(parsed) || parsed <= 0) {
        return 0
    }
    return Math.min(parsed, EXPECTED_CHAPTERS_MAX)
}

export function OutlineVolumeCards({
    volumes,
    onUpdate,
    onOpenChapters,
    onGenerateChapters,
}: OutlineVolumeCardsProps): JSX.Element {
    /** 主要情节增删：返回新数组，不改传入的卷对象 */
    const updatePlot = (volume: OutlineVolume, index: number, value: string): void => {
        onUpdate(volume.id, {
            mainPlot: volume.mainPlot.map((item, itemIndex) => (itemIndex === index ? value : item)),
        })
    }

    const removePlot = (volume: OutlineVolume, index: number): void => {
        onUpdate(volume.id, { mainPlot: volume.mainPlot.filter((_, itemIndex) => itemIndex !== index) })
    }

    return (
        <div className="flex min-h-0 w-full flex-1 flex-col gap-3 overflow-y-auto p-3">
            {volumes.length === 0 ? (
                <StateEmpty
                    icon={ListTree}
                    title="还没有卷"
                    description="先新增一卷并写下核心事件，或到「结构」页套用最小模板"
                />
            ) : (
                <div className="grid grid-cols-1 gap-3 @3xl:grid-cols-2">
                    {volumes.map((volume) => (
                        <Card key={volume.id}>
                            <CardHeader>
                                <CardTitle>
                                    <button
                                        type="button"
                                        className="min-w-0 truncate text-left hover:text-primary"
                                        title="进入章纲页并只看这一卷"
                                        onClick={() => onOpenChapters(volume)}
                                    >
                                        {volume.name}
                                    </button>
                                </CardTitle>
                                <CardDescription>
                                    {volume.chapters.length} 章
                                    {volume.expectedChapters > 0
                                        ? ` · 预计 ${String(volume.expectedChapters)} 章`
                                        : ' · 预计章数未填'}
                                </CardDescription>
                                <CardAction className="flex items-center gap-1.5">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        tooltip="按卷纲生成这一卷的章纲与节拍"
                                        onClick={() => onGenerateChapters(volume)}
                                    >
                                        <Sparkles />
                                        生成章纲
                                    </Button>
                                </CardAction>
                            </CardHeader>
                            <CardContent className="flex flex-col gap-3">
                                <div className="grid grid-cols-1 gap-2.5 @md:grid-cols-[minmax(0,1fr)_8rem]">
                                    <Field>
                                        <FieldLabel htmlFor={`outline-volume-name-${volume.id}`}>卷标题</FieldLabel>
                                        <Input
                                            id={`outline-volume-name-${volume.id}`}
                                            value={volume.name}
                                            placeholder="第一卷 断线之始"
                                            onChange={(event) => onUpdate(volume.id, { name: event.target.value })}
                                        />
                                    </Field>
                                    <Field>
                                        <FieldLabel htmlFor={`outline-volume-expected-${volume.id}`}>
                                            预计章节数
                                        </FieldLabel>
                                        <Input
                                            id={`outline-volume-expected-${volume.id}`}
                                            type="number"
                                            min={0}
                                            max={EXPECTED_CHAPTERS_MAX}
                                            step={1}
                                            className="tabular-nums"
                                            value={volume.expectedChapters > 0 ? volume.expectedChapters : ''}
                                            placeholder="未填"
                                            onChange={(event) =>
                                                onUpdate(volume.id, {
                                                    expectedChapters: readExpectedChapters(event.target.value),
                                                })
                                            }
                                        />
                                    </Field>
                                </div>
                                <Field>
                                    <FieldLabel htmlFor={`outline-volume-core-${volume.id}`}>核心事件</FieldLabel>
                                    <Textarea
                                        id={`outline-volume-core-${volume.id}`}
                                        value={volume.coreEvent}
                                        maxLength={CORE_EVENT_MAX_LENGTH}
                                        className="min-h-20"
                                        placeholder="这一卷真正发生了什么：谁因为什么必须去做什么，代价是什么"
                                        onChange={(event) => onUpdate(volume.id, { coreEvent: event.target.value })}
                                    />
                                    <FieldDescription>
                                        {volume.coreEvent.length}/{CORE_EVENT_MAX_LENGTH} 字：写成一段能看清因果的事件，
                                        不要在章纲里重复
                                    </FieldDescription>
                                </Field>
                                <div className="flex flex-col gap-1.5">
                                    <div className="flex items-center justify-between">
                                        <span className="text-muted-foreground">主要情节</span>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => onUpdate(volume.id, { mainPlot: [...volume.mainPlot, ''] })}
                                        >
                                            <Plus />
                                            添加情节
                                        </Button>
                                    </div>
                                    {volume.mainPlot.length === 0 ? (
                                        <p className="text-muted-foreground">
                                            还没有情节条目。按发生顺序写：先发生什么、再发生什么。
                                        </p>
                                    ) : (
                                        <ItemGroup>
                                            {volume.mainPlot.map((plot, index) => (
                                                <Item key={`${volume.id}-plot-${String(index)}`}>
                                                    <ItemContent>
                                                        <Input
                                                            value={plot}
                                                            aria-label={`第 ${index + 1} 条主要情节`}
                                                            placeholder="情节：谁做了什么，导致什么"
                                                            onChange={(event) =>
                                                                updatePlot(volume, index, event.target.value)
                                                            }
                                                        />
                                                    </ItemContent>
                                                    <ItemActions>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            aria-label={`删除第 ${index + 1} 条主要情节`}
                                                            onClick={() => removePlot(volume, index)}
                                                        >
                                                            <Trash2 />
                                                        </Button>
                                                    </ItemActions>
                                                </Item>
                                            ))}
                                        </ItemGroup>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    )
}
