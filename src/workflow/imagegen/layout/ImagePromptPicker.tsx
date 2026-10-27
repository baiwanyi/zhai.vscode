/**
 * 提示词选择：工具栏图标按钮弹出三级面板——一级分类、二级分组、词条；有关键词时词条区跨分组平铺命中项。
 * 复用约定：Popover / ToggleGroup / Input / HoverCard / Alert 取 @components/ui，
 * 触发按钮与操作按钮取 @webview/components/Button，预览大图取 @webview/components/Image，
 * 空态取 @webview/components/StateEmpty，词库数据与增删改取 hooks/usePromptLibrary，
 * 图库基址取 hooks/usePromptImages，表单与删除确认取本目录 ImagePromptTagDialogs。
 * 关键约束：词库来自存储根的 md，面板只做展示与点选，不持有词条文本；
 * 两级分类都是必选单选，Radix 允许再点一次回传空串，须判空丢弃以保持始终有一项生效；
 * 切换一级分类不手动清二级分类，由「旧值不在新分组内即回落到首项」的派生规则兜住；
 * 编辑与删除收在预览浮层内，指针在浮层里移到按钮上不会让预览收起，词条按钮只负责点选；
 * 无预览图的词条同样挂浮层（只出词条名与两个操作按钮），保证增删改入口不丢；
 * 弹窗必须渲染在 Popover 之外，浮层收起会卸载其内部子树；
 * baseUrl 为 null（图库目录为空）时只在底部提示目录与「打开目录」，面板其余部分照常可用。
 */
import { cn } from 'cn'
import { Plus, SquarePen, Trash2, WandSparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Alert, AlertDescription } from '@components/ui/alert'
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
import { StateEmpty } from '@webview/components/StateEmpty'
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

/** 一级分类栏：窄且底色深，选中态取主色，与右侧分组栏拉开层级 */
const OBJECT_RAIL_CLASS = 'w-32 shrink-0 overflow-y-auto bg-muted p-1.5'

/** 一级分类项：选中态用主色实心 */
const OBJECT_ITEM_CLASS = 'hover:bg-white/5 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground'

/** 二级分组栏：略宽、浅一档底色，与一级分类栏区分主次 */
const ATTRIBUTE_RAIL_CLASS = 'w-40 shrink-0 overflow-y-auto bg-muted/50 p-1.5'

/** 二级分组项：右端带该组词条数，选中态用次级色块 */
const ATTRIBUTE_ITEM_CLASS = 'data-[state=on]:bg-secondary data-[state=on]:text-foreground'

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

/** 分类回落：当前值不在新列表里（词库增删后）就取首项，保证两级分类始终有一项生效 */
function resolveActive(items: readonly { readonly name: string }[], active: string): string {
    return items.some((item) => item.name === active) ? active : (items[0]?.name ?? '')
}

/** 搜索态提示：命中被截断时引导细化关键词，命中为空时给出空结果文案，其余情况不提示 */
function searchHintOf(isSearching: boolean, matched: number, visible: number): string | null {
    if (!isSearching) {
        return null
    }
    if (matched > MAX_SEARCH_RESULTS) {
        return `命中 ${matched} 条，仅显示前 ${MAX_SEARCH_RESULTS} 条，请细化关键词`
    }
    return visible === 0 ? '没有匹配的提示词' : null
}

interface PromptCategoryRailItem {
    readonly name: string
    /** 该分组下的词条数：一级分类不传，省略计数徽标 */
    readonly count?: number
}

interface PromptCategoryRailProps {
    /** 读屏用的分类层级名：一级与二级各一条 */
    ariaLabel: string
    items: readonly PromptCategoryRailItem[]
    /** 当前生效项：由面板按「旧值不在列表里即回落首项」算好传入 */
    value: string
    /** 栏体宽高、底色与滚动：两级各有一套视觉 */
    className: string
    /** 选中态配色：一级用主色，二级用次级色 */
    itemClassName: string
    onSelect: (name: string) => void
}

/** 分类栏：垂直单选列表，一级分类与二级分组共用同一套结构与「判空丢弃」逻辑 */
function PromptCategoryRail({
    ariaLabel,
    items,
    value,
    className,
    itemClassName,
    onSelect,
}: PromptCategoryRailProps): JSX.Element {
    /** Radix 允许再点一次已选项回传空串：丢弃空值，让当前项始终保持选中 */
    function handleValueChange(next: string): void {
        if (next.length > 0) {
            onSelect(next)
        }
    }

    return (
        <ToggleGroup
            type="single"
            orientation="vertical"
            spacing={0.5}
            value={value}
            aria-label={ariaLabel}
            className={className}
            onValueChange={handleValueChange}
        >
            {items.map((item) => (
                <ToggleGroupItem
                    key={item.name}
                    value={item.name}
                    className={cn('justify-between gap-1 text-muted-foreground', itemClassName)}
                >
                    <span className="min-w-0 truncate">{item.name}</span>
                    {item.count === undefined ? null : <Badge variant="secondary">{item.count}</Badge>}
                </ToggleGroupItem>
            ))}
        </ToggleGroup>
    )
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
    return (
        <HoverCard openDelay={250} closeDelay={80}>
            <HoverCardTrigger asChild>
                {/* min-w-0 覆盖 grid 子项的 min-width:auto，名称过长时才能按列宽截断 */}
                <Button
                    size="sm"
                    variant={isSelected ? 'default' : 'outline'}
                    aria-pressed={isSelected}
                    className="w-full min-w-0"
                    onClick={() => {
                        onToggle(tag)
                    }}
                >
                    <span className="truncate">{tag.name}</span>
                </Button>
            </HoverCardTrigger>
            <HoverCardContent side="top" sideOffset={6} className="w-48 space-y-2 text-center">
                {previewUrl === null ? null : <Image src={previewUrl} alt={tag.name} aspect="3/4" size="md" />}
                <div className="flex items-center justify-between">
                    <Button
                        size="icon-xs"
                        variant="secondary"
                        aria-label={`编辑${tag.name}`}
                        onClick={() => {
                            onEdit(tag)
                        }}
                    >
                        <SquarePen />
                    </Button>
                    <p className="flex-1 text-xs line-clamp-3 text-muted-foreground wrap-break-word">{tag.name}</p>
                    <Button
                        size="icon-xs"
                        variant="destructive"
                        aria-label={`删除${tag.name}`}
                        onClick={() => {
                            onDelete(tag)
                        }}
                    >
                        <Trash2 />
                    </Button>
                </div>
            </HoverCardContent>
        </HoverCard>
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
    const { baseUrl, dirPath: imageDirPath, reload: reloadImages } = usePromptImages()
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
    const currentObject = resolveActive(library.objects, activeObject)
    /** 当前一级分类下的分组：换分类后旧值不在新分组里即回落到首项，不必手动同步两份状态 */
    const attributes = useMemo(() => attributesOf(library.objects, currentObject), [library.objects, currentObject])
    const currentAttribute = resolveActive(attributes, activeAttribute)
    const matchedTags = useMemo(() => searchTags(library.tags, query), [library.tags, query])
    /** 词条区数据：搜索态跨分组平铺命中项并截断，非搜索态只取当前两级分类下的词条 */
    const tags = useMemo(
        () =>
            isSearching
                ? matchedTags.slice(0, MAX_SEARCH_RESULTS)
                : tagsOf(library.tags, currentObject, currentAttribute),
        [isSearching, matchedTags, library.tags, currentObject, currentAttribute],
    )
    /** 预览图地址按词条标识预算一次：逐段编码不必随每次点选或输入重算 */
    const previewUrls = useMemo(
        () =>
            new Map(
                library.tags.map((tag): [string, string | null] => [tag.id, buildPreviewUrl(baseUrl, tag.preview)]),
            ),
        [library.tags, baseUrl],
    )
    /** 已挂标识转集合：逐个词条查 Set 比在每个按钮上跑 includes 少一次线性扫描 */
    const selectedIds = useMemo(() => new Set(selectedPrompts), [selectedPrompts])
    const searchHint = library.tags.length === 0 ? null : searchHintOf(isSearching, matchedTags.length, tags.length)

    /**
     * 打开即刷新词库与图库基址：用户在目录里手改 md 或放图后，重新打开面板就能看到。
     * 词库侧只有首次会显示加载态，之后是静默刷新——面板直接用缓存渲染，回包后再覆盖，不闪空态。
     */
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
        const saved = original === null ? library.save(input) : library.update({ ...input, previousId: original.id })
        void saved.then((tag) => {
            if (tag === null) {
                return
            }
            // 改名或换组等于换标识：已挂的芯片必须跟着走，否则下次发送会被宿主当作已删除词条跳过
            if (original !== null && tag.id !== original.id) {
                onRenamePrompt(original.id, tag)
            }
            setForm(null)
        })
    }

    const handleEdit = (tag: PromptTag): void => {
        setForm({ original: tag })
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
                    <div className="flex items-center gap-2">
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
                    {library.isLoading ? (
                        <StateEmpty className="h-80" isLoading loadingLabel="正在加载词库…" title="词库" />
                    ) : library.tags.length === 0 ? (
                        <StateEmpty
                            className="h-80 rounded-md bg-muted/40 p-3"
                            title="词库为空"
                            description="添加第一条提示词"
                        >
                            <div className="flex flex-wrap justify-center gap-2">
                                <Button
                                    onClick={() => {
                                        setForm({ original: null })
                                    }}
                                >
                                    新建词条
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        void library.openDir()
                                    }}
                                >
                                    打开词库目录
                                </Button>
                            </div>
                        </StateEmpty>
                    ) : (
                        <div className="flex h-80 gap-2">
                            <PromptCategoryRail
                                ariaLabel="提示词分类"
                                items={library.objects}
                                value={currentObject}
                                className={OBJECT_RAIL_CLASS}
                                itemClassName={OBJECT_ITEM_CLASS}
                                onSelect={setActiveObject}
                            />
                            <PromptCategoryRail
                                ariaLabel="提示词二级分类"
                                items={attributes}
                                value={currentAttribute}
                                className={ATTRIBUTE_RAIL_CLASS}
                                itemClassName={ATTRIBUTE_ITEM_CLASS}
                                onSelect={setActiveAttribute}
                            />
                            <div className="grid min-w-0 flex-1 grid-cols-2 content-start gap-1.5 overflow-y-auto">
                                {tags.map((tag) => (
                                    <PromptTagButton
                                        key={tag.id}
                                        tag={tag}
                                        previewUrl={previewUrls.get(tag.id) ?? null}
                                        isSelected={selectedIds.has(tag.id)}
                                        onToggle={onToggle}
                                        onEdit={handleEdit}
                                        onDelete={setPendingDelete}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                    {searchHint === null ? null : <p className="text-xs text-muted-foreground">{searchHint}</p>}
                    {baseUrl === null && imageDirPath.length > 0 ? (
                        <Alert className="flex items-center justify-between gap-2 px-2 py-1">
                            <AlertDescription className="min-w-0 truncate text-xs" title={imageDirPath}>
                                本地暂无预览图：{imageDirPath}
                            </AlertDescription>
                            <Button
                                variant="outline"
                                onClick={() => {
                                    void handleOpenImageDir()
                                }}
                            >
                                打开目录
                            </Button>
                        </Alert>
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
