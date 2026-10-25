/**
 * 封面字段组：展示作品的历史封面，支持设为当前封面、书名合成与删除。
 * 复用约定：书名排版选项与画布合成来自 ./coverCompose，控件取自 @components/ui 的 select、button、input 与 field，
 * 图库宫格与空态由业务公共层的 CoverGallery 承担，回读、保存、设为封面与删除由 useSettingCover 承担。
 * 关键约束：AI 出图统一在「生图」页的封面模式完成，本组不再调用图像通道，只做展示与本地合成；
 * 磁盘是唯一事实来源，切回本分组即按目录回读；书名合成在本地画布完成、不消耗出图次数，
 * 结果另存为新封面并自动选中；删除当前封面由宿主回退到剩余最新一张。
 */
import { Type } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Field, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import type { PressCover } from '@shared/types/press'
import { Button } from '@webview/components/Button'
import { ConfirmDialog } from '@webview/components/ConfirmDialog'
import { CoverGallery } from '@webview/components/CoverGallery'
import { COVER_FONT_OPTIONS, COVER_POSITION_OPTIONS, COVER_TONE_OPTIONS, composeCover } from './coverCompose'
import { useSettingCover } from './useSettingCover'
import type { CoverTitlePosition, CoverTitleTone } from './coverCompose'
import type { SettingFieldsProps } from './sections'
import type { JSX } from 'react'

export function PressSettingCoverFields({ setting, dirPath }: SettingFieldsProps): JSX.Element {
    const { covers, selectedId, isLoading, save, select, remove } = useSettingCover(dirPath)
    const [deleting, setDeleting] = useState<PressCover | null>(null)
    /** 书名与笔名留空时回落到作品名与笔名，避免初始值与后续修改脱节 */
    const [titleText, setTitleText] = useState('')
    const [authorText, setAuthorText] = useState('')
    const [font, setFont] = useState(COVER_FONT_OPTIONS[0]?.value ?? 'hei')
    const [position, setPosition] = useState<CoverTitlePosition>('bottom')
    const [tone, setTone] = useState<CoverTitleTone>('ink')
    const [isComposing, setIsComposing] = useState(false)

    /** 合成作用在选中的封面上：没有选中项时回落到最新一张 */
    const targetCover = covers.find((cover) => cover.id === selectedId) ?? covers[0] ?? null
    const isBusy = isComposing

    const handlePositionChange = (value: string): void => {
        const next = COVER_POSITION_OPTIONS.find((option) => option.value === value)
        if (next) {
            setPosition(next.value)
        }
    }

    const handleToneChange = (value: string): void => {
        const next = COVER_TONE_OPTIONS.find((option) => option.value === value)
        if (next) {
            setTone(next.value)
        }
    }

    /**
     * 套用书名：在选中封面上用画布叠加书名与笔名，另存为新封面并自动选中。
     * 关键约束：合成在本地完成，不调用图像通道，因此可反复调整而不重复计费；
     * 导出失败（底图跨源污染等）只提示，不改动已有封面。
     */
    const handleCompose = async (): Promise<void> => {
        if (targetCover === null) {
            toast.error('先在「生图」页生成一张封面，再套用书名')
            return
        }
        setIsComposing(true)
        try {
            const dataUrl = await composeCover(targetCover.url, {
                title: titleText.trim().length > 0 ? titleText : setting.title,
                author: authorText.trim().length > 0 ? authorText : setting.penName,
                font,
                position,
                tone,
            })
            const cover = await save(dataUrl)
            if (cover !== null) {
                toast.success('已生成带书名的封面')
            }
        } catch (cause) {
            toast.error(cause instanceof Error ? cause.message : '封面合成失败，请换一张底图后重试')
        } finally {
            setIsComposing(false)
        }
    }

    const handleSelect = async (cover: PressCover): Promise<void> => {
        const isSelected = await select(cover.path)
        if (isSelected) {
            toast.success('已设为作品封面')
        }
    }

    const handleDelete = async (cover: PressCover): Promise<void> => {
        const isRemoved = await remove(cover.path)
        if (isRemoved) {
            toast.success('封面已删除')
            return
        }
        toast.error('封面已不在磁盘上，可在「生图」页重新生成')
    }

    return (
        <div className="flex flex-col gap-3">
            <div className="min-w-0">
                <p className="font-medium">作品封面</p>
                <p className="text-muted-foreground py-1">
                    封面在「生图」页生成：打开「作品封面」后发送，新图会自动成为作品封面；这里可以套用书名，或从历史封面里另选一张。
                </p>
            </div>

            <div className="flex flex-col gap-2 rounded-lg border border-border p-2">
                <p className="font-medium">书名排版</p>
                <div className="grid grid-cols-1 gap-2 @md:grid-cols-2">
                    <Field>
                        <FieldLabel htmlFor="cover-title-text">书名</FieldLabel>
                        <Input
                            id="cover-title-text"
                            value={titleText}
                            placeholder={setting.title.length > 0 ? setting.title : '留空使用作品名'}
                            className="h-7"
                            disabled={isBusy}
                            onChange={(event) => setTitleText(event.target.value)}
                        />
                    </Field>
                    <Field>
                        <FieldLabel htmlFor="cover-author-text">笔名</FieldLabel>
                        <Input
                            id="cover-author-text"
                            value={authorText}
                            placeholder={setting.penName.length > 0 ? setting.penName : '留空不显示笔名'}
                            className="h-7"
                            disabled={isBusy}
                            onChange={(event) => setAuthorText(event.target.value)}
                        />
                    </Field>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Select value={font} disabled={isBusy} onValueChange={setFont}>
                        <SelectTrigger className="h-8 w-20" aria-label="书名字体">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {COVER_FONT_OPTIONS.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                        {option.label}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                    <Select value={position} disabled={isBusy} onValueChange={handlePositionChange}>
                        <SelectTrigger className="h-8 w-24" aria-label="书名位置">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {COVER_POSITION_OPTIONS.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                        {option.label}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                    <Select value={tone} disabled={isBusy} onValueChange={handleToneChange}>
                        <SelectTrigger className="h-8 w-24" aria-label="文字配色">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {COVER_TONE_OPTIONS.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                        {option.label}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                    <Button
                        variant="outline"
                        disabled={isBusy || targetCover === null}
                        onClick={() => {
                            void handleCompose()
                        }}
                    >
                        <Type />
                        {isComposing ? '合成中' : '套用书名'}
                    </Button>
                </div>
                <p className="text-muted-foreground">
                    在选中的封面上叠加书名另存一张，不消耗出图次数；不满意可直接删除这张再调。
                </p>
            </div>

            <CoverGallery
                items={covers}
                coverId={selectedId}
                variant="book"
                isLoading={isLoading}
                isBusy={isBusy}
                emptyTitle="还没有封面"
                emptyDescription="在「生图」页打开封面模式生成；先补全题材与世界观，出图会更贴合故事。"
                altPrefix={`《${setting.title}》的封面`}
                deleteLabel="删除封面"
                countLabel={(count) => `已生成 ${count} 张`}
                onSetCover={(item) => {
                    const target = covers.find((cover) => cover.id === item.id)
                    if (target !== undefined) {
                        void handleSelect(target)
                    }
                }}
                onDelete={(item) => {
                    const target = covers.find((cover) => cover.id === item.id)
                    if (target !== undefined) {
                        setDeleting(target)
                    }
                }}
            />

            <ConfirmDialog
                open={deleting !== null}
                title="删除这张封面？"
                description="文件会移入系统回收站；若它是作品封面，封面将自动回退到图库中的第一张。"
                confirmLabel="删除封面"
                isDestructive
                size="sm"
                onOpenChange={(isOpen) => {
                    if (!isOpen) {
                        setDeleting(null)
                    }
                }}
                onConfirm={() => {
                    const target = deleting
                    setDeleting(null)
                    if (target !== null) {
                        void handleDelete(target)
                    }
                }}
            />
        </div>
    )
}
