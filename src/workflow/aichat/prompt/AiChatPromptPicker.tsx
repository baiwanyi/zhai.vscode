/**
 * 通用提示词选择：工具栏图标按钮弹出三级面板——一级分类、二级分组、词条；有关键词时词条区跨分组平铺命中项。
 * 复用约定：分类栏取同目录 PromptCategoryRail 与 ../utils/prompt/styles，词库数据与增删改取 ../hooks 的
 * usePromptLibrary(scope)，表单与删除确认取本目录 AiChatPromptTagDialogs，检索与分组取 ../utils/prompt/library。
 * 两种归属共用一套面板：imagegen 是生图词条——挂芯片、带预览图、预览浮层内编辑删除；
 * press 是 AI 对话的写作提示词——不挂图、行内编辑删除、点选把原文插入输入框。
 * 关键约束：词库来自存储根 md，面板只做展示与点选，不持有词条文本；两级分类都是必选单选，
 * Radix 允许再点一次回传空串，须判空丢弃；弹窗必须渲染在 Popover 之外，浮层收起会卸载其内部子树；
 * press 的点选回调返回 false（输入区锁定）时必须提示而不是静默丢弃；预览图只在生图词库下加载。
 */
import { Plus, SquarePen, Trash2, WandSparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@components/ui/alert'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@components/ui/hover-card'
import { Input } from '@components/ui/input'
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@components/ui/popover'
import type { PromptLibraryScope, PromptTag, PromptTagSaveRequest } from '@shared/types/promptLibrary'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import { Button } from '@webview/components/Button'
import { Image } from '@webview/components/Image'
import { StateEmpty } from '@webview/components/StateEmpty'
import { usePromptImages } from '@webview/workflow/aichat/hooks/usePromptImages'
import type { TagFormState } from '@webview/workflow/aichat/hooks/usePromptLibrary'
import { usePromptLibrary } from '@webview/workflow/aichat/hooks/usePromptLibrary'
import {
    attributesOf,
    resolveActivePromptCategory,
    searchTags,
    tagsOf,
} from '@webview/workflow/aichat/utils/prompt/library'
import { AiChatPromptTagDialogs } from './AiChatPromptTagDialogs'
import { PromptCategoryRail } from './PromptCategoryRail'
import type { JSX } from 'react'
import {
    PROMPT_ATTRIBUTE_ITEM_CLASS,
    PROMPT_ATTRIBUTE_RAIL_CLASS,
    PROMPT_OBJECT_ITEM_CLASS,
    PROMPT_OBJECT_RAIL_CLASS,
} from '../utils/prompt/styles'

/** 搜索结果上限：命中过多时先给一批，引导用户细化关键词，避免一次挂载上千个按钮 */
const MAX_SEARCH_RESULTS = 120

/** 打开图片目录的宿主命令：白名单登记在 modules/common/webviewCommands */
const OPEN_IMAGE_DIR_COMMAND = 'zhai.prompt.openImageDir'

/** 无选中项时共用的空数组：避免每次渲染新建引用 */
const EMPTY_PROMPTS: readonly string[] = []

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

/** 搜索态提示：命中被截断时引导细化关键词，命中为空时给出空结果文案，其余情况不提示 */
function searchHintOf(isSearching: boolean, matched: number, visible: number): string | null {
    if (!isSearching) {
        return null
    }
    if (matched > MAX_SEARCH_RESULTS) {
        return `命中 ${String(matched)} 条，仅显示前 ${String(MAX_SEARCH_RESULTS)} 条，请细化关键词`
    }
    return visible === 0 ? '没有匹配的提示词' : null
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

/** 生图词条：套一层悬停大图，编辑与删除收在浮层内，避免词条网格里堆满图标 */
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

interface PromptTagRowProps {
    tag: PromptTag
    onPick: (tag: PromptTag) => void
    onEdit: (tag: PromptTag) => void
    onDelete: (tag: PromptTag) => void
}

/** 写作提示词：不挂预览图，编辑与删除常驻行尾，点选即把原文插入正文 */
function PromptTagRow({ tag, onPick, onEdit, onDelete }: PromptTagRowProps): JSX.Element {
    return (
        <div className="flex min-w-0 items-center gap-1">
            <Button
                size="sm"
                variant="outline"
                className="min-w-0 flex-1 justify-start"
                tooltip={tag.prompt}
                onClick={() => {
                    onPick(tag)
                }}
            >
                <span className="truncate">{tag.name}</span>
            </Button>
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
    )
}

interface PromptPickerBaseProps {
    /** 输入区锁定（生成中）：面板不可打开 */
    disabled: boolean
    /** 词库归属：生图词条或写作提示词，决定预览图与点选语义 */
    scope: PromptLibraryScope
}

/** 生图词条：点选切换芯片，改名与删除要同步已挂芯片 */
interface ImagegenPromptPickerProps extends PromptPickerBaseProps {
    scope: 'imagegen'
    /** 当前已挂的词条标识（分类::分组::名称）：用于回显选中态 */
    selectedPrompts: readonly string[]
    onPick: (tag: PromptTag) => void
    onRenamePrompt: (previousId: string, tag: PromptTag) => void
    onRemovePrompt: (tagId: string) => void
}

/** 写作提示词：点选把原文插入输入框，返回 false 表示插入失败 */
interface PressPromptPickerProps extends PromptPickerBaseProps {
    scope: 'press'
    onPick: (prompt: string) => boolean
}

export type AiChatPromptPickerProps = ImagegenPromptPickerProps | PressPromptPickerProps

export function AiChatPromptPicker(props: AiChatPromptPickerProps): JSX.Element {
    const { scope, disabled: isDisabled } = props
    const isImagegen = scope === 'imagegen'
    const library = usePromptLibrary(scope)
    const { baseUrl, dirPath: imageDirPath, reload: reloadImages } = usePromptImages()
    const [isOpen, setIsOpen] = useState(false)
    const [activeObject, setActiveObject] = useState('')
    const [activeAttribute, setActiveAttribute] = useState('')
    const [keyword, setKeyword] = useState('')
    const [form, setForm] = useState<TagFormState | null>(null)
    const [pendingDelete, setPendingDelete] = useState<PromptTag | null>(null)

    const query = keyword.trim()
    const isSearching = query.length > 0
    /** 当前一级分类：词库变化后旧值不在列表里即回落到首项 */
    const currentObject = resolveActivePromptCategory(library.objects, activeObject)
    /** 当前一级分类下的分组：换分类后旧值不在新分组里即回落到首项，不必手动同步两份状态 */
    const attributes = useMemo(() => attributesOf(library.objects, currentObject), [library.objects, currentObject])
    const currentAttribute = resolveActivePromptCategory(attributes, activeAttribute)
    const matchedTags = useMemo(() => searchTags(library.tags, query), [library.tags, query])
    /** 词条区数据：搜索态跨分组平铺命中项并截断，非搜索态只取当前两级分类下的词条 */
    const tags = useMemo(
        () =>
            isSearching
                ? matchedTags.slice(0, MAX_SEARCH_RESULTS)
                : tagsOf(library.tags, currentObject, currentAttribute),
        [isSearching, matchedTags, library.tags, currentObject, currentAttribute],
    )
    /** 预览图地址按词条标识预算一次：逐段编码不必随每次点选或输入重算；写作词库不取图 */
    const previewUrls = useMemo(
        () =>
            new Map(
                library.tags.map((tag): [string, string | null] => [tag.id, buildPreviewUrl(baseUrl, tag.preview)]),
            ),
        [library.tags, baseUrl],
    )
    /** 已挂标识：写作词库没有芯片，恒为空数组 */
    const selectedPrompts = props.scope === 'imagegen' ? props.selectedPrompts : EMPTY_PROMPTS
    /** 已挂标识转集合：逐个词条查 Set 比在每个按钮上跑 includes 少一次线性扫描 */
    const selectedIds = useMemo(() => new Set(selectedPrompts), [selectedPrompts])
    const searchHint = library.tags.length === 0 ? null : searchHintOf(isSearching, matchedTags.length, tags.length)

    /**
     * 打开即刷新词库与图库基址：用户在目录里手改 md 或放图后，重新打开面板就能看到。
     * 词库侧只有首次会显示加载态，之后是静默刷新——面板直接用缓存渲染，回包后再覆盖，不闪空态。
     */
    const handleOpenChange = (next: boolean): void => {
        setIsOpen(next)
        if (!next) {
            return
        }
        void library.reload()
        if (isImagegen) {
            void reloadImages()
        }
    }

    const handleOpenImageDir = async (): Promise<void> => {
        try {
            await request('host/command', OPEN_IMAGE_DIR_COMMAND)
        } catch (cause) {
            toastError(cause)
        }
    }

    /** 点选：生图切换芯片；写作插入正文，插入失败时提示而不是静默丢弃 */
    const handlePick = (tag: PromptTag): void => {
        if (props.scope === 'imagegen') {
            props.onPick(tag)
            return
        }
        if (!props.onPick(tag.prompt)) {
            toast.info('输入区暂不可编辑：生成中或未就绪')
            return
        }
        setIsOpen(false)
    }

    const handleFormSubmit = (input: PromptTagSaveRequest): void => {
        const original = form?.original ?? null
        const saved = original === null ? library.save(input) : library.update({ ...input, previousId: original.id })
        void saved.then((tag) => {
            if (tag === null) {
                return
            }
            // 改名或换组等于换标识：生图词库已挂的芯片必须跟着走，写作词库没有芯片可同步
            if (original !== null && tag.id !== original.id && props.scope === 'imagegen') {
                props.onRenamePrompt(original.id, tag)
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
            if (!done) {
                return
            }
            if (props.scope === 'imagegen') {
                props.onRemovePrompt(target.id)
            }
            setPendingDelete(null)
        })
    }

    const handleEdit = (tag: PromptTag): void => {
        setForm({ original: tag })
    }

    /** 词条区：生图用两列网格（配合预览浮层），写作提示词用单列行（名称可见、操作常驻） */
    const tagList = isImagegen ? (
        <div className="grid min-w-0 flex-1 grid-cols-2 content-start gap-1.5 overflow-y-auto">
            {tags.map((tag) => (
                <PromptTagButton
                    key={tag.id}
                    tag={tag}
                    previewUrl={previewUrls.get(tag.id) ?? null}
                    isSelected={selectedIds.has(tag.id)}
                    onToggle={handlePick}
                    onEdit={handleEdit}
                    onDelete={setPendingDelete}
                />
            ))}
        </div>
    ) : (
        <div className="flex min-w-0 flex-1 flex-col gap-1 overflow-y-auto">
            {tags.map((tag) => (
                <PromptTagRow
                    key={tag.id}
                    tag={tag}
                    onPick={handlePick}
                    onEdit={handleEdit}
                    onDelete={setPendingDelete}
                />
            ))}
        </div>
    )

    return (
        <>
            <Popover open={isOpen} onOpenChange={handleOpenChange}>
                <PopoverTrigger asChild>
                    <Button size="icon" variant="secondary" aria-label="提示词" tooltip="提示词" disabled={isDisabled}>
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
                            placeholder={isImagegen ? '搜索中文名或英文提示词' : '搜索词条名或提示词原文'}
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
                        <StateEmpty className="h-80" isLoading title="正在加载词库…" />
                    ) : library.tags.length === 0 ? (
                        <StateEmpty
                            className="h-80 rounded-md bg-muted/40 p-3"
                            title="词库为空"
                            description={isImagegen ? '添加第一条提示词' : '添加第一条写作提示词'}
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
                                className={PROMPT_OBJECT_RAIL_CLASS}
                                itemClassName={PROMPT_OBJECT_ITEM_CLASS}
                                onSelect={setActiveObject}
                            />
                            <PromptCategoryRail
                                ariaLabel="提示词二级分类"
                                items={attributes}
                                value={currentAttribute}
                                className={PROMPT_ATTRIBUTE_RAIL_CLASS}
                                itemClassName={PROMPT_ATTRIBUTE_ITEM_CLASS}
                                onSelect={setActiveAttribute}
                            />
                            {tagList}
                        </div>
                    )}
                    {searchHint === null ? null : <p className="text-xs text-muted-foreground">{searchHint}</p>}
                    {isImagegen && baseUrl === null && imageDirPath.length > 0 ? (
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
            <AiChatPromptTagDialogs
                scope={scope}
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
