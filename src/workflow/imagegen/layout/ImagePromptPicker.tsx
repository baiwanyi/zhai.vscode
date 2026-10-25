/**
 * 提示词选择：工具栏图标按钮弹出三级面板——一级分类、二级分类、词条；有关键词时词条区跨分组平铺命中项。
 * 复用约定：Popover / ToggleGroup / Input 取 @components/ui，触发器与操作按钮取 @webview/components/Button，
 * 缩略图取 @webview/components/Image，分类与词条取 prompt/promptLibrary，图库基址取 hooks/usePromptImages。
 * 关键约束：两级分类都是必选单选，Radix 重复点击会回传空串，须判空后再落状态；
 * 切换一级分类不手动清二级分类，由「当前值不在新分组内即回落到首项」的派生规则兜住；
 * baseUrl 为 null（本地图库为空）时整体隐藏缩略图并把网格切成三列，不做逐张失败降级；
 * 插入只回传词条文本，与已有正文之间的分隔符由输入卡片补齐；面板自身不持有输入框状态。
 */
import { cn } from 'cn'
import { WandSparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Input } from '@components/ui/input'
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@components/ui/popover'
import { ToggleGroup, ToggleGroupItem } from '@components/ui/toggle-group'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import { Button } from '@webview/components/Button'
import { Image } from '@webview/components/Image'
import type { PromptTag } from '../prompt/promptLibrary'
import type { JSX } from 'react'
import { usePromptImages } from '../hooks/usePromptImages'
import { PROMPT_OBJECTS, promptAttributesOf, promptTagsOf, searchPromptTags } from '../prompt/promptLibrary'

/** 搜索结果上限：命中过多时先给一批，提示用户细化关键词，避免一次挂载上千个按钮 */
const MAX_SEARCH_RESULTS = 120

/** 打开图库目录的宿主命令：白名单登记在 modules/common/webviewCommands */
const OPEN_IMAGE_DIR_COMMAND = 'zhai.prompt.openImageDir'

interface ImagePromptPickerProps {
    /** 词条插入回调：调用方负责写入光标位置 */
    onInsert: (text: string) => void
}

export function ImagePromptPicker({ onInsert }: ImagePromptPickerProps): JSX.Element {
    const { baseUrl, dirPath, reload } = usePromptImages()
    const [isOpen, setIsOpen] = useState(false)
    const [activeObject, setActiveObject] = useState(PROMPT_OBJECTS[0]?.name ?? '')
    const [activeAttribute, setActiveAttribute] = useState('')
    const [keyword, setKeyword] = useState('')

    const attributes = promptAttributesOf(activeObject)
    /** 当前二级分类：换一级分类后旧值不在新分组里即回落到首项，不必手动同步两份状态 */
    const currentAttribute = attributes.some((item) => item.name === activeAttribute)
        ? activeAttribute
        : (attributes[0]?.name ?? '')

    const isSearching = keyword.trim().length > 0
    const matchedTags = useMemo(() => (isSearching ? searchPromptTags(keyword) : []), [isSearching, keyword])
    const tags = isSearching ? matchedTags.slice(0, MAX_SEARCH_RESULTS) : promptTagsOf(activeObject, currentAttribute)
    const isTruncated = isSearching && matchedTags.length > MAX_SEARCH_RESULTS
    const hasPreview = baseUrl !== null

    /** 一级分类是必选单选：Radix 允许再点一次取消、回传空串，判空丢弃以保持始终有一类生效 */
    const handleObjectChange = (next: string): void => {
        if (next.length > 0) {
            setActiveObject(next)
        }
    }

    const handleAttributeChange = (next: string): void => {
        if (next.length > 0) {
            setActiveAttribute(next)
        }
    }

    /** 打开即刷新图库基址：用户中途往目录里放图后，重新打开面板就能看到缩略图 */
    const handleOpenChange = (next: boolean): void => {
        setIsOpen(next)
        if (next) {
            void reload()
        }
    }

    const handleOpenImageDir = async (): Promise<void> => {
        try {
            await request('host/command', OPEN_IMAGE_DIR_COMMAND)
        } catch (cause) {
            toastError(cause)
        }
    }

    /** 词条缩略图地址：无基址或无文件名时返回 null，由 Image 组件自行渲染占位 */
    const previewUrlOf = (tag: PromptTag): string | null =>
        baseUrl === null || tag.preview.length === 0 ? null : `${baseUrl}/${tag.preview}`

    return (
        <Popover open={isOpen} onOpenChange={handleOpenChange}>
            <PopoverTrigger asChild>
                <Button size="icon" variant="ghost" aria-label="提示词" tooltip="提示词">
                    <WandSparkles />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-150">
                <PopoverHeader>
                    <PopoverTitle>提示词</PopoverTitle>
                </PopoverHeader>
                <Input
                    value={keyword}
                    placeholder="搜索中文名或英文提示词"
                    aria-label="搜索提示词"
                    className="h-7 text-xs"
                    onChange={(event) => {
                        setKeyword(event.target.value)
                    }}
                />
                <div className="flex max-h-80 gap-2">
                    <ToggleGroup
                        type="single"
                        orientation="vertical"
                        spacing={0.5}
                        value={activeObject}
                        onValueChange={handleObjectChange}
                        aria-label="提示词分类"
                        className="w-22 shrink-0 overflow-y-auto bg-muted p-1.5"
                    >
                        {PROMPT_OBJECTS.map((item) => {
                            const Icon = item.icon
                            return (
                                <ToggleGroupItem
                                    key={item.name}
                                    value={item.name}
                                    className="justify-start text-muted-foreground hover:bg-white/5 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                                >
                                    <Icon className="size-4 shrink-0" />
                                    <span className="truncate">{item.name}</span>
                                </ToggleGroupItem>
                            )
                        })}
                    </ToggleGroup>
                    <ToggleGroup
                        type="single"
                        orientation="vertical"
                        spacing={0.5}
                        value={currentAttribute}
                        onValueChange={handleAttributeChange}
                        aria-label="提示词二级分类"
                        className="w-32 shrink-0 overflow-y-auto bg-muted/50 p-1.5"
                    >
                        {attributes.map((item) => (
                            <ToggleGroupItem
                                key={item.name}
                                value={item.name}
                                className="justify-between gap-1 text-muted-foreground data-[state=on]:bg-secondary data-[state=on]:text-foreground"
                            >
                                <span className="truncate">{item.name}</span>
                                <span className="shrink-0 text-[10px] opacity-70">{item.count}</span>
                            </ToggleGroupItem>
                        ))}
                    </ToggleGroup>
                    <div
                        className={cn(
                            'grid min-w-0 flex-1 content-start gap-1.5 overflow-y-auto',
                            hasPreview ? 'grid-cols-2' : 'grid-cols-3',
                        )}
                    >
                        {tags.map((tag) => {
                            const previewUrl = previewUrlOf(tag)
                            return (
                                <Button
                                    key={tag.prompt}
                                    size="sm"
                                    variant="outline"
                                    className={cn(
                                        'min-w-0 justify-start overflow-hidden',
                                        hasPreview ? 'h-auto gap-1.5 px-1 py-1' : null,
                                    )}
                                    title={tag.prompt}
                                    onClick={() => {
                                        onInsert(tag.text)
                                    }}
                                >
                                    {hasPreview ? (
                                        <Image
                                            src={previewUrl ?? ''}
                                            alt={tag.name}
                                            aspect="square"
                                            className="size-8 shrink-0 rounded"
                                        />
                                    ) : null}
                                    <span className="truncate text-xs">{tag.name}</span>
                                </Button>
                            )
                        })}
                    </div>
                </div>
                {isTruncated ? (
                    <p className="text-[11px] text-muted-foreground">
                        命中 {matchedTags.length} 条，仅显示前 {MAX_SEARCH_RESULTS} 条，请细化关键词
                    </p>
                ) : null}
                {hasPreview || dirPath.length === 0 ? null : (
                    <div className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
                        <span className="truncate" title={dirPath}>
                            本地暂无预览图：{dirPath}
                        </span>
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                                void handleOpenImageDir()
                            }}
                        >
                            打开目录
                        </Button>
                    </div>
                )}
            </PopoverContent>
        </Popover>
    )
}
