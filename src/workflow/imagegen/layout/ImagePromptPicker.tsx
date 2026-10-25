/**
 * 提示词选择：工具栏图标按钮弹出三级面板——一级分类、二级分类、词条；有关键词时词条区跨分组平铺命中项。
 * 复用约定：Popover / ToggleGroup / Input / HoverCard 取 @components/ui，触发与插入按钮取 @webview/components/Button，
 * 预览大图取 @webview/components/Image，分类与词条取 prompt/promptLibrary，图库基址取 hooks/usePromptImages。
 * 关键约束：两级分类都是必选单选，Radix 允许再点一次回传空串，须判空丢弃以保持始终有一项生效；
 * 切换一级分类不手动清二级分类，由「旧值不在新分组内即回落到首项」的派生规则兜住；
 * 悬停预览只挂在确实有图的词条上，缺图条目退化为纯文字按钮，不弹只有图片占位的空浮层；
 * baseUrl 为 null（图库目录为空）时只在底部提示目录与「打开目录」，面板其余部分照常可用；
 * 插入只回传词条文本，与已有正文的分隔符由输入卡片补齐，本组件不持有输入框状态。
 */
import { WandSparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '@components/ui/badge'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@components/ui/hover-card'
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

/** 搜索结果上限：命中过多时先给一批，引导用户细化关键词，避免一次挂载上千个按钮 */
const MAX_SEARCH_RESULTS = 120

/** 打开图库目录的宿主命令：白名单登记在 modules/common/webviewCommands */
const OPEN_IMAGE_DIR_COMMAND = 'zhai.prompt.openImageDir'

/** 拼词条预览图地址：无基址或文件名为空时返回 null，调用方据此决定要不要挂浮层 */
function buildPreviewUrl(baseUrl: string | null, fileName: string): string | null {
    return baseUrl === null || fileName.length === 0 ? null : `${baseUrl}/${fileName}`
}

interface PromptTagButtonProps {
    tag: PromptTag
    /** 预览图地址，null 表示该条没有图 */
    previewUrl: string | null
    /** 点击插入：只回传词条文本，分隔符由输入卡片处理 */
    onInsert: (text: string) => void
}

/** 单词条：有图时套一层悬停大图，无图时只渲染按钮本身 */
function PromptTagButton({ tag, previewUrl, onInsert }: PromptTagButtonProps): JSX.Element {
    const button = (
        <Button
            size="sm"
            variant="outline"
            onClick={() => {
                onInsert(tag.text)
            }}
        >
            {tag.name}
        </Button>
    )
    if (previewUrl === null) {
        return button
    }
    return (
        <HoverCard openDelay={250} closeDelay={80}>
            <HoverCardTrigger asChild>{button}</HoverCardTrigger>
            <HoverCardContent side="top" sideOffset={6} className="w-48">
                <Image src={previewUrl} alt={tag.name} aspect="3/4" size="md" />
            </HoverCardContent>
        </HoverCard>
    )
}

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

    const query = keyword.trim()
    const isSearching = query.length > 0
    const attributes = promptAttributesOf(activeObject)
    /** 当前二级分类：换一级分类后旧值不在新分组里即回落到首项，不必手动同步两份状态 */
    const currentAttribute = attributes.some((item) => item.name === activeAttribute)
        ? activeAttribute
        : (attributes[0]?.name ?? '')
    const matchedTags = useMemo(() => searchPromptTags(query), [query])
    const tags = isSearching ? matchedTags.slice(0, MAX_SEARCH_RESULTS) : promptTagsOf(activeObject, currentAttribute)
    const isTruncated = isSearching && matchedTags.length > MAX_SEARCH_RESULTS

    /** 打开即刷新图库基址：用户中途往目录里放图后，重新打开面板就能看到预览 */
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

    return (
        <Popover open={isOpen} onOpenChange={handleOpenChange}>
            <PopoverTrigger asChild>
                <Button size="icon" variant="ghost" aria-label="提示词" tooltip="提示词">
                    <WandSparkles />
                </Button>
            </PopoverTrigger>
            {/* 宽度跟随宿主 webview：100vw 在 webview 内即面板宽度，两侧各留 8px 安全边距，
                配合 collisionPadding 保证浮层不会被贴边裁切；align 取 center 使减宽后仍居中 */}
            <PopoverContent align="center" collisionPadding={8} className="w-[calc(100vw-1rem)]">
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
                        onValueChange={(next) => {
                            if (next.length > 0) {
                                setActiveObject(next)
                            }
                        }}
                        aria-label="提示词分类"
                        className="w-32 shrink-0 overflow-y-auto bg-muted p-1.5"
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
                        onValueChange={(next) => {
                            if (next.length > 0) {
                                setActiveAttribute(next)
                            }
                        }}
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
                                <Badge variant="secondary">{item.count}</Badge>
                            </ToggleGroupItem>
                        ))}
                    </ToggleGroup>
                    <div className="grid min-w-0 flex-1 grid-cols-3 content-start gap-1.5 overflow-y-auto">
                        {tags.map((tag) => (
                            <PromptTagButton
                                key={tag.prompt}
                                tag={tag}
                                previewUrl={buildPreviewUrl(baseUrl, tag.preview)}
                                onInsert={onInsert}
                            />
                        ))}
                    </div>
                </div>
                {isTruncated ? (
                    <p className="text-xs text-muted-foreground">
                        命中 {matchedTags.length} 条，仅显示前 {MAX_SEARCH_RESULTS} 条，请细化关键词
                    </p>
                ) : null}
                {isSearching && tags.length === 0 ? (
                    <p className="text-xs text-muted-foreground">没有匹配的提示词</p>
                ) : null}
                {baseUrl === null && dirPath.length > 0 ? (
                    <div className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
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
                ) : null}
            </PopoverContent>
        </Popover>
    )
}
