/**
 * 提示词选择：工具栏图标按钮弹出三级面板——一级分类、二级分组、词条；有关键词时词条区跨分组平铺命中项。
 * 复用约定：Popover / ToggleGroup / Input / HoverCard 取 @components/ui，触发按钮取 @webview/components/Button，
 * 预览大图取 @webview/components/Image，词库数据与增删改取 hooks/usePromptLibrary，
 * 图库基址取 hooks/usePromptImages，表单与删除确认取本目录 ImagePromptTagDialogs。
 * 关键约束：词库来自存储根的 md，面板只做展示与点选，不持有词条文本；
 * 两级分类都是必选单选，Radix 允许再点一次回传空串，须判空丢弃以保持始终有一项生效；
 * 切换一级分类不手动清二级分类，由「旧值不在新分组内即回落到首项」的派生规则兜住；
 * 编辑与删除按钮常驻 DOM、悬停才可点（pointer-events 同步切换），避免点词条时误触；
 * 弹窗必须渲染在 Popover 之外，浮层收起会卸载其内部子树；
 * baseUrl 为 null（图库目录为空）时只在底部提示目录与「打开目录」，面板其余部分照常可用。
 */
import { Plus, SquarePen, Trash2, WandSparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '@components/ui/badge'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@components/ui/hover-card'
import { Input } from '@components/ui/input'
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@components/ui/popover'
import { ToggleGroup, ToggleGroupItem } from '@components/ui/toggle-group'
import type { PromptTag, PromptTagSaveRequest } from '@shared/types/imagegen'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import { Button } from '@webview/components/Button'
import { Image } from '@webview/components/Image'
import { ImagePromptTagDialogs } from './ImagePromptTagDialogs'
import type { TagFormState } from '../hooks/usePromptLibrary'
import type { JSX } from 'react'
import { usePromptImages } from '../hooks/usePromptImages'
import { usePromptLibrary } from '../hooks/usePromptLibrary'
import { attributesOf, searchTags, tagsOf } from '../prompt/promptLibrary'

/** 搜索结果上限：命中过多时先给一批，引导用户细化关键词，避免一次挂载上千个按钮 */
const MAX_SEARCH_RESULTS = 120

/** 打开图片目录的宿主命令：白名单登记在 modules/common/webviewCommands */
const OPEN_IMAGE_DIR_COMMAND = 'zhai.prompt.openImageDir'

/**
 * 拼词条预览图地址：预览值可能是「分类/分组/名称.webp」或扁平的哈希名，
 * 逐段编码，避免中文与空格在 webview 资源地址里出问题。
 */
function buildPreviewUrl(baseUrl: string | null, relativePath: string | null): string | null {
    if (baseUrl === null || relativePath === null || relativePath.length === 0) {
        return null
    }
    const encoded = relativePath
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/')
    return `${baseUrl}/${encoded}`
}

interface PromptTagButtonProps {
    tag: PromptTag
    /** 预览图地址，null 表示该条没有图 */
    previewUrl: string | null
    /** 是否已挂到输入区：选中态据此切换按钮变体，不额外维护一份选中集合 */
    isSelected: boolean
    onToggle: (tag: PromptTag) => void
    onEdit: (tag: PromptTag) => void
    onDelete: (tag: PromptTag) => void
}

/** 单词条：有图时套一层悬停大图；编辑与删除常驻但只在悬停时可点 */
function PromptTagButton({
    tag,
    previewUrl,
    isSelected,
    onToggle,
    onEdit,
    onDelete,
}: PromptTagButtonProps): JSX.Element {
    // flex 覆盖底层的 inline-flex：让按钮成为块级，格子高度才等于按钮高度，
    // 右上角那组编辑/删除按 top/right 内缩定位才不会落到按钮外
    const button = (
        <Button
            size="sm"
            variant={isSelected ? 'secondary' : 'outline'}
            aria-pressed={isSelected}
            className="flex w-full justify-start"
            onClick={() => {
                onToggle(tag)
            }}
        >
            <span className="truncate">{tag.name}</span>
        </Button>
    )
    return (
        <div className="group relative min-w-0">
            {previewUrl === null ? (
                button
            ) : (
                <HoverCard openDelay={250} closeDelay={80}>
                    <HoverCardTrigger asChild>{button}</HoverCardTrigger>
                    <HoverCardContent side="top" sideOffset={6} className="w-48 text-center space-y-1">
                        <Image src={previewUrl} alt={tag.name} aspect="3/4" size="md" />
                        <p className="pt-1 line-clamp-3 text-muted-foreground wrap-break-word">{tag.name}</p>
                    </HoverCardContent>
                </HoverCard>
            )}
            {/* 未悬停时 pointer-events 关闭：点词条不会误触到右上角的编辑/删除；
                定位必须收在词条按钮内（顶/右各内缩 2px）：负偏移会让按钮悬到词条外，
                最右列的越界还会把滚动区撑宽，词条区因此冒出横向滚动条 */}
            <div className="pointer-events-none absolute top-0.5 right-0.5 flex gap-0.5 opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
                <Button
                    size="icon-xs"
                    variant="secondary"
                    aria-label={`编辑${tag.name}`}
                    tooltip="编辑词条"
                    onClick={() => {
                        onEdit(tag)
                    }}
                >
                    <SquarePen />
                </Button>
                <Button
                    size="icon-xs"
                    variant="secondary"
                    aria-label={`删除${tag.name}`}
                    tooltip="删除词条"
                    onClick={() => {
                        onDelete(tag)
                    }}
                >
                    <Trash2 />
                </Button>
            </div>
        </div>
    )
}

interface ImagePromptPickerProps {
    /** 当前已挂的词条标识（分类::分组::名称）：用于回显选中态 */
    selectedPrompts: readonly string[]
    /** 点选词条：由输入卡片切换芯片 */
    onToggle: (tag: PromptTag) => void
    /** 词条改名或换组：由输入卡片把已挂芯片换到新标识上 */
    onRenamePrompt: (previousId: string, tag: PromptTag) => void
    /** 词条被删除：由输入卡片摘掉对应芯片 */
    onRemovePrompt: (tagId: string) => void
}

export function ImagePromptPicker({
    selectedPrompts,
    onToggle,
    onRenamePrompt,
    onRemovePrompt,
}: ImagePromptPickerProps): JSX.Element {
    const { baseUrl, dirPath, reload: reloadImages } = usePromptImages()
    const library = usePromptLibrary()
    const [isOpen, setIsOpen] = useState(false)
    const [activeObject, setActiveObject] = useState('')
    const [activeAttribute, setActiveAttribute] = useState('')
    const [keyword, setKeyword] = useState('')
    const [form, setForm] = useState<TagFormState | null>(null)
    const [pendingDelete, setPendingDelete] = useState<PromptTag | null>(null)

    const query = keyword.trim()
    const isSearching = query.length > 0
    /** 当前一级分类：词库变化后旧值不在列表里即回落到首项 */
    const currentObject = library.objects.some((item) => item.name === activeObject)
        ? activeObject
        : (library.objects[0]?.name ?? '')
    const attributes = attributesOf(library.objects, currentObject)
    /** 当前二级分类：换一级分类后旧值不在新分组里即回落到首项，不必手动同步两份状态 */
    const currentAttribute = attributes.some((item) => item.name === activeAttribute)
        ? activeAttribute
        : (attributes[0]?.name ?? '')
    const matchedTags = useMemo(() => searchTags(library.tags, query), [library.tags, query])
    const tags = isSearching
        ? matchedTags.slice(0, MAX_SEARCH_RESULTS)
        : tagsOf(library.tags, currentObject, currentAttribute)
    const isTruncated = isSearching && matchedTags.length > MAX_SEARCH_RESULTS

    /** 打开即刷新词库与图库基址：用户在目录里手改 md 或放图后，重新打开面板就能看到 */
    const handleOpenChange = (next: boolean): void => {
        setIsOpen(next)
        if (next) {
            void reloadImages()
            void library.reload()
        }
    }

    const handleOpenImageDir = async (): Promise<void> => {
        try {
            await request('host/command', OPEN_IMAGE_DIR_COMMAND)
        } catch (cause) {
            toastError(cause)
        }
    }

    const handleFormSubmit = (input: PromptTagSaveRequest): void => {
        const original = form?.original ?? null
        if (original === null) {
            void library.save(input).then((tag) => {
                if (tag !== null) {
                    setForm(null)
                }
            })
            return
        }
        void library.update({ ...input, previousId: original.id }).then((tag) => {
            if (tag === null) {
                return
            }
            // 改名或换组等于换标识：已挂的芯片必须跟着走，否则下次发送会被宿主当作已删除词条跳过
            if (tag.id !== original.id) {
                onRenamePrompt(original.id, tag)
            }
            setForm(null)
        })
    }

    const handleConfirmDelete = (): void => {
        const target = pendingDelete
        if (target === null) {
            return
        }
        void library.remove(target.id).then((done) => {
            if (done) {
                onRemovePrompt(target.id)
                setPendingDelete(null)
            }
        })
    }

    return (
        <>
            <Popover open={isOpen} onOpenChange={handleOpenChange}>
                <PopoverTrigger asChild>
                    <Button size="icon" variant="secondary" aria-label="提示词" tooltip="提示词">
                        <WandSparkles />
                    </Button>
                </PopoverTrigger>
                {/* 宽度跟随宿主 webview：100vw 在 webview 内即面板宽度，两侧各留 8px 安全边距，
                    配合 collisionPadding 保证浮层不会被贴边裁切；align 取 center 使减宽后仍居中 */}
                <PopoverContent align="center" collisionPadding={8} className="w-[calc(100vw-1rem)]">
                    <PopoverHeader>
                        <PopoverTitle>提示词</PopoverTitle>
                    </PopoverHeader>
                    <div className="flex items-center gap-1">
                        <Input
                            value={keyword}
                            placeholder="搜索中文名或英文提示词"
                            aria-label="搜索提示词"
                            className="h-7 text-xs"
                            onChange={(event) => {
                                setKeyword(event.target.value)
                            }}
                        />
                        <Button
                            size="icon"
                            aria-label="新建词条"
                            tooltip="新建词条"
                            onClick={() => {
                                setForm({ original: null })
                            }}
                        >
                            <Plus />
                        </Button>
                    </div>
                    {library.tags.length === 0 ? (
                        <div className="space-y-2 rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
                            <p className="wrap-break-word">
                                词库为空：点上方 + 添加第一条，或把 md 放到{' '}
                                {library.dirPath.length > 0 ? library.dirPath : '存储根的 prompt/tags 目录'}
                            </p>
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => {
                                        setForm({ original: null })
                                    }}
                                >
                                    新建词条
                                </Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                        void library.openDir()
                                    }}
                                >
                                    打开词库目录
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex max-h-80 gap-2">
                            <ToggleGroup
                                type="single"
                                orientation="vertical"
                                spacing={0.5}
                                value={currentObject}
                                onValueChange={(next) => {
                                    if (next.length > 0) {
                                        setActiveObject(next)
                                    }
                                }}
                                aria-label="提示词分类"
                                className="w-32 shrink-0 overflow-y-auto bg-muted p-1.5"
                            >
                                {library.objects.map((item) => (
                                    <ToggleGroupItem
                                        key={item.name}
                                        value={item.name}
                                        className="justify-start text-muted-foreground hover:bg-white/5 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                                    >
                                        <span className="truncate">{item.name}</span>
                                    </ToggleGroupItem>
                                ))}
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
                                className="w-40 shrink-0 overflow-y-auto bg-muted/50 p-1.5"
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
                            <div className="grid min-w-0 flex-1 grid-cols-2 content-start gap-1.5 overflow-y-auto">
                                {tags.map((tag) => (
                                    <PromptTagButton
                                        key={tag.id}
                                        tag={tag}
                                        previewUrl={buildPreviewUrl(baseUrl, tag.preview)}
                                        isSelected={selectedPrompts.includes(tag.id)}
                                        onToggle={onToggle}
                                        onEdit={(target) => {
                                            setForm({ original: target })
                                        }}
                                        onDelete={setPendingDelete}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                    {isTruncated ? (
                        <p className="text-xs text-muted-foreground">
                            命中 {matchedTags.length} 条，仅显示前 {MAX_SEARCH_RESULTS} 条，请细化关键词
                        </p>
                    ) : null}
                    {isSearching && library.tags.length > 0 && tags.length === 0 ? (
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
            <ImagePromptTagDialogs
                form={form}
                pendingDelete={pendingDelete}
                dirPath={library.dirPath}
                objects={library.objects}
                isSaving={library.isSaving}
                onFormClose={() => {
                    setForm(null)
                }}
                onFormSubmit={handleFormSubmit}
                onDeleteClose={() => {
                    setPendingDelete(null)
                }}
                onConfirmDelete={handleConfirmDelete}
            />
        </>
    )
}
