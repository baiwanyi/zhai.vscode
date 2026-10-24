/**
 * 封面字段组：按作品设定用 AI 生成竖版封面，以图库形式展示并支持设为封面、书名合成、删除与重新生成。
 * 复用约定：画风选项复用 constants 的 PORTRAIT_STYLE_OPTIONS，书名排版选项与画布合成来自 ./coverCompose；
 * 控件取自 @components/ui 的 select、button、input 与 field，图库宫格、空态与生成中占位由业务公共层的
 * CoverGallery 承担；生成、回读、保存、设为封面与删除由 useSettingCover 承担。
 * 关键约束：画风与排版只影响本次产物、不写回作品设定；磁盘是唯一事实来源，切回本分组即按目录回读；
 * 生成期间禁用操作并显示同构占位框，避免连点重复扣费；书名合成在本地画布完成、不消耗出图次数，
 * 结果另存为新封面并自动选中，不满意可直接删除；删除当前封面由宿主回退到剩余最新一张。
 */
import { Sparkles, Type } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Field, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import type { PressCover, PortraitStyle } from '@shared/types/press'
import { Button } from '@webview/components/Button'
import { ConfirmDialog } from '@webview/components/ConfirmDialog'
import { CoverGallery } from '@webview/components/CoverGallery'
import { COVER_FONT_OPTIONS, COVER_POSITION_OPTIONS, COVER_TONE_OPTIONS, composeCover } from './coverCompose'
import { useSettingCover } from './useSettingCover'
import type { CoverTitlePosition, CoverTitleTone } from './coverCompose'
import type { SettingFieldsProps } from './sections'
import type { JSX } from 'react'
import { PORTRAIT_STYLE_OPTIONS } from '../constants'

export function PressSettingCoverFields({ setting, dirPath }: SettingFieldsProps): JSX.Element {
    const { covers, selectedId, isLoading, isGenerating, generate, save, select, remove } = useSettingCover(dirPath)
    const [style, setStyle] = useState<PortraitStyle>('auto')
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
    const isBusy = isComposing || isGenerating

    const handleStyleChange = (value: string): void => {
        const next = PORTRAIT_STYLE_OPTIONS.find((option) => option.value === value)
        if (next) {
            setStyle(next.value)
        }
    }

    const handleGenerate = async (): Promise<void> => {
        const cover = await generate({
            title: setting.title,
            genres: [...setting.genres],
            logline: setting.logline,
            worldview: setting.worldview,
            tone: setting.tone,
            perspective: setting.perspective,
            style,
        })
        if (cover !== null) {
            toast.success('封面已生成并设为作品封面')
        }
    }

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
            toast.error('先生成一张封面，再套用书名')
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
        toast.error('封面已不在磁盘上，请重新生成')
    }

    return (
        <div className="flex flex-col gap-3">
            <div className="min-w-0">
                <p className="font-medium">作品封面</p>
                <p className="text-muted-foreground py-1">
                    {isGenerating
                        ? '生成中，出图通常需要 1~3 分钟；关闭面板也会继续，重新打开会自动读取'
                        : '按基本信息、故事内核与世界观生成竖版封面；生成即成为作品封面，也可在下方另选一张'}
                </p>
            </div>

            <div className="flex items-center gap-2">
                <Select value={style} disabled={isBusy} onValueChange={handleStyleChange}>
                    <SelectTrigger className="h-8 w-28" aria-label="封面画风">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            {PORTRAIT_STYLE_OPTIONS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
                <Button
                    variant="outline"
                    disabled={isGenerating}
                    onClick={() => {
                        void handleGenerate()
                    }}
                >
                    <Sparkles data-icon="inline-start" />
                    {isGenerating ? '生成中' : covers.length === 0 ? '生成封面' : '重新生成'}
                </Button>
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
                        <Type data-icon="inline-start" />
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
                isGenerating={isGenerating}
                isBusy={isBusy}
                emptyTitle="还没有封面"
                emptyDescription="建议先补全题材、梗概与世界观，出图会更贴合故事。"
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
