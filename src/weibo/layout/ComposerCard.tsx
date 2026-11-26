/**
 * 微博发布框：受控编辑 + 表情 / 话题插入 + 图片选择与粘贴上传 + AI 优化 + 字数与发布。
 * 复用约定：卡片取 @components/ui/card，正文输入取 @components/ui/input-group
 * （InputGroup / InputGroupTextarea / InputGroupAddon / InputGroupText，字数统计是框内顶部附件），
 * 表情与话题面板取同目录 WeiboEmoticonPicker / WeiboTopicPicker，图片面板取通用 ImagePickerPopover（Popover + Tabs），
 * 选区插入的纯逻辑走 utils/weiboComposer，发布框的上传清单与粘贴上传走 hooks/useWeiboComposerImages，
 * 生图与在线图库两栏走 hooks/useImagePickerSources，发布请求走 hooks/useWeiboPublish，AI 改写走 hooks/useWeiboEnhance。
 * 关键约束：草稿与已选图片都由调用方持有（首页内容随视图卸载，二者不能跟着丢）；
 * 发布只接受 uploads/ 下的路径，生图与在线图库两栏仅供浏览，选中时提示先上传；
 * 插入文本后由 effect 把光标落回插入位置，受控更新不打断连续输入；
 * 粘贴只拦剪贴板里的图片文件，落盘到 uploads/ 后直接加入已选，文本粘贴完全不动默认行为；
 * AI 优化以输入框实际内容为准、成功后整体替换并把光标落到末尾，改写中禁止发布；
 * 改写期间整张卡片发光：Card 补 relative isolate overflow-visible，套 ComposerGlow（CARD_GLOW_CLASS），
 * 并用同色底衬压住卡内背光，只留边缘与外侧雾光；ui/card 自带的 overflow-hidden 会裁掉外扩背光，必须覆盖；
 * 发布成功后清空草稿与已选图片，再由 onPublished 把新微博交给面板层前插。
 */
import { ImagePlus, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@components/ui/card'
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupText,
    InputGroupTextarea,
} from '@components/ui/input-group'
import { Spinner } from '@components/ui/spinner'
import type { UploadFileItem } from '@shared/types/upload'
import { MAX_PUBLISH_CONTENT_LENGTH, MAX_PUBLISH_IMAGE_COUNT } from '@shared/types/weibo'
import type { WeiboTimelinePost } from '@shared/types/weibo'
import { ButtonLoadingContent } from '@webview/blocks/ButtonLoadingContent'
import { CARD_GLOW_CLASS, ComposerGlow } from '@webview/components/AppComposer'
import { Button } from '@webview/components/Button'
import { ImagePickerPopover } from '@webview/components/ImagePicker'
import { useImagePickerSources } from '@webview/hooks/useImagePickerSources'
import type { ImagePickerItem, ImageSourceKind } from '@webview/hooks/useImagePickerSources'
import { WeiboEmoticonPicker } from './WeiboEmoticonPicker'
import { WeiboTopicPicker } from './WeiboTopicPicker'
import type { ClipboardEvent, JSX } from 'react'
import { useWeiboComposerImages } from '../hooks/useWeiboComposerImages'
import { useWeiboEnhance } from '../hooks/useWeiboEnhance'
import { useWeiboPublish } from '../hooks/useWeiboPublish'
import { insertAtSelection } from '../utils/weiboComposer'

/** 微博面板只需要生图与在线图库两栏，上传清单由 useWeiboComposerImages 提供 */
const BROWSE_KINDS: readonly ImageSourceKind[] = ['generate', 'stock']

/** UploadFileItem 的 url 对图片非空，转成通用条目供 ImagePickerPopover 渲染 */
function toPickerItem(item: UploadFileItem): ImagePickerItem {
    return { id: item.path, path: item.path, url: item.url ?? '', alt: item.name }
}

interface ComposerCardProps {
    /** 是否已配置凭证：表情与话题接口同样依赖登录 Cookie */
    isEnabled: boolean
    /** 正文草稿：由面板层持有，切换视图卸载本组件后仍能保留 */
    draft: string
    onDraftChange: (draft: string) => void
    /** 已选图片：同样由面板层持有，切走再回来不丢 */
    images: UploadFileItem[]
    onImagesChange: (images: UploadFileItem[]) => void
    /** 发布成功：把归一化后的新微博交给面板层前插到时间线首位 */
    onPublished?: (post: WeiboTimelinePost | null) => void
}

export function ComposerCard({
    isEnabled,
    draft,
    onDraftChange,
    images,
    onImagesChange,
    onPublished,
}: ComposerCardProps): JSX.Element {
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    // 插入后待恢复的光标位置：受控 textarea 的值更新后由 effect 落回选区
    const pendingCaretRef = useRef<number | null>(null)
    const {
        images: libraryImages,
        isLoading: isLibraryLoading,
        isUploading,
        reload: reloadLibrary,
        pickFiles,
        uploadFiles,
    } = useWeiboComposerImages()
    /** 生图与在线图库两栏：发布只接受 uploads 路径，这两栏只做浏览 */
    const { sources: browseSources } = useImagePickerSources(undefined, BROWSE_KINDS)
    const [isPickerOpen, setIsPickerOpen] = useState(false)
    const { isPublishing, publish } = useWeiboPublish()
    const { isEnhancing, enhance } = useWeiboEnhance()
    const canPublish = (draft.trim().length > 0 || images.length > 0) && !isPublishing && !isEnhancing

    const pickerSources: Record<ImageSourceKind, { items: readonly ImagePickerItem[]; isLoading: boolean }> = {
        generate: browseSources.generate,
        stock: browseSources.stock,
        upload: { items: libraryImages.map(toPickerItem), isLoading: isLibraryLoading },
    }

    useEffect(() => {
        const caret = pendingCaretRef.current
        const textarea = textareaRef.current
        if (caret === null || textarea === null) {
            return
        }
        pendingCaretRef.current = null
        textarea.focus()
        textarea.setSelectionRange(caret, caret)
    }, [draft])

    /**
     * 在光标处插入文本：表情与话题共用同一条通道。
     * 受控 textarea 的 value 就是草稿，直接读 DOM 省掉对 draft 的依赖，
     * 否则每敲一个字都会重建回调，连表情网格一起重渲染。
     */
    const handleInsert = useCallback(
        (insert: string, subject: string): void => {
            const textarea = textareaRef.current
            if (textarea === null) {
                return
            }
            const result = insertAtSelection({
                value: textarea.value,
                start: textarea.selectionStart,
                end: textarea.selectionEnd,
                insert,
                maxLength: MAX_PUBLISH_CONTENT_LENGTH,
            })
            if (result === null) {
                toast.info(`正文最多 ${MAX_PUBLISH_CONTENT_LENGTH} 字，无法再插入${subject}`)
                return
            }
            pendingCaretRef.current = result.caret
            onDraftChange(result.value)
        },
        [onDraftChange],
    )

    const handleInsertEmoticon = useCallback(
        (phrase: string): void => {
            handleInsert(phrase, '表情')
        },
        [handleInsert],
    )

    /** 话题按微博正文口径插成 #话题# */
    const handleInsertTopic = useCallback(
        (topic: string): void => {
            handleInsert(`#${topic}#`, '话题')
        },
        [handleInsert],
    )

    /** 追加图片：按单条微博上限截断，超出的忽略并提示，避免攒到发布时被宿主整条拒绝 */
    const appendImages = useCallback(
        (incoming: readonly UploadFileItem[]): void => {
            const remaining = MAX_PUBLISH_IMAGE_COUNT - images.length
            if (remaining <= 0) {
                toast.info(`最多 ${String(MAX_PUBLISH_IMAGE_COUNT)} 张图片`)
                return
            }
            const accepted = incoming.slice(0, remaining)
            if (accepted.length > 0) {
                onImagesChange([...images, ...accepted])
            }
            if (accepted.length < incoming.length) {
                toast.info(`最多 ${String(MAX_PUBLISH_IMAGE_COUNT)} 张图片，多余的已忽略`)
            }
        },
        [images, onImagesChange],
    )

    /** 面板选中：只有上传栏的图片有 uploads 路径可直接发布，其余两栏提示先上传 */
    const handleSelectImage = useCallback(
        (item: ImagePickerItem, kind: ImageSourceKind): void => {
            if (kind !== 'upload') {
                toast.info('生图与在线图库图片请先上传，再在「上传图片」里选择')
                return
            }
            const original = libraryImages.find((image) => image.path === item.path)
            if (original !== undefined) {
                appendImages([original])
            }
        },
        [appendImages, libraryImages],
    )

    const handleRemoveImage = useCallback(
        (path: string): void => {
            onImagesChange(images.filter((image) => image.path !== path))
        },
        [images, onImagesChange],
    )

    /** 面板开合：打开时静默重拉上传清单，上传页与编辑器里新增的图片要能立刻选到 */
    const handlePickerOpenChange = useCallback(
        (open: boolean): void => {
            setIsPickerOpen(open)
            if (open) {
                void reloadLibrary()
            }
        },
        [reloadLibrary],
    )

    /** 从磁盘选图上传：回执里的新图片直接加入已选并返回给面板切到上传栏 */
    const handlePickFiles = useCallback(async (): Promise<ImagePickerItem[]> => {
        const uploaded = await pickFiles()
        if (uploaded.length > 0) {
            appendImages(uploaded)
        }
        return uploaded.map(toPickerItem)
    }, [appendImages, pickFiles])

    /** 粘贴上传：只拦剪贴板里的图片文件，文本粘贴完全不干预默认行为 */
    const handlePaste = useCallback(
        (event: ClipboardEvent<HTMLTextAreaElement>): void => {
            const files = [...event.clipboardData.files].filter((file) => file.type.startsWith('image/'))
            if (files.length === 0) {
                return
            }
            event.preventDefault()
            // 只把还能放下的张数交给上传：一次粘贴十几张时不必把整批读成 base64 再上传，
            // 截断后的收尾提示由 appendImages 统一给，这里不重复弹
            const remaining = MAX_PUBLISH_IMAGE_COUNT - images.length
            if (remaining <= 0) {
                toast.info(`最多 ${String(MAX_PUBLISH_IMAGE_COUNT)} 张图片`)
                return
            }
            void uploadFiles(files.slice(0, remaining)).then((uploaded) => {
                if (uploaded.length > 0) {
                    appendImages(uploaded)
                }
            })
        },
        [appendImages, images.length, uploadFiles],
    )

    /**
     * AI 优化：把当前草稿按微博文案口径改写后整体替换。
     * 关键约束：以输入框实际内容为准（受控值可能落后一个事件），空内容只提示不改写；
     * 成功后光标落到末尾，失败保留原文（错误已由 hook toast）。
     */
    function handleEnhance(): void {
        // 发布在途时改写结果会污染已清空的草稿：按钮虽已禁用，这里再守一道
        if (isPublishing) {
            return
        }
        const textarea = textareaRef.current
        const source = textarea?.value ?? draft
        if (source.trim().length === 0) {
            toast.info('先写点内容再优化')
            return
        }
        void enhance(source).then((text) => {
            if (text === null) {
                return
            }
            pendingCaretRef.current = text.length
            onDraftChange(text)
        })
    }

    /**
     * 发布：正文与已选图片交给宿主（宿主先传图床换 pid，再提交正文）。
     * 关键约束：成功后才清空草稿与图片，失败保留内容供直接重试；
     * 成功后把宿主归一化的新微博交给面板层前插，而不是让时间线整页刷新。
     */
    function handlePublish(): void {
        if (!canPublish) {
            return
        }
        void publish(draft, images).then((result) => {
            if (result === null) {
                return
            }
            onDraftChange('')
            onImagesChange([])
            onPublished?.(result.post)
        })
    }

    return (
        <Card className="relative isolate overflow-visible">
            {/* 改写期间整张卡片发光：光晕在 -z-20、底衬在 -z-10，二者都压在内容之下，标题与正文不受影响 */}
            <ComposerGlow isGenerating={isEnhancing} className={CARD_GLOW_CLASS} />
            <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 rounded-xl bg-card" />
            <CardHeader>
                <CardTitle className="text-lg">分享你的新鲜事…</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
                <InputGroup>
                    {/* 发布在途时禁编辑：成功回调会清空草稿，此时新输入的内容会被一并抹掉 */}
                    <InputGroupTextarea
                        ref={textareaRef}
                        value={draft}
                        rows={4}
                        placeholder="随便说些什么"
                        aria-label="微博正文"
                        maxLength={MAX_PUBLISH_CONTENT_LENGTH}
                        disabled={isPublishing}
                        className="min-h-24 leading-relaxed"
                        onChange={(event) => {
                            onDraftChange(event.target.value)
                        }}
                        onPaste={handlePaste}
                    />
                    <InputGroupAddon align="block-end" className="justify-between">
                        <InputGroupText className="text-xs tabular-nums">
                            {draft.length} / {MAX_PUBLISH_CONTENT_LENGTH}
                        </InputGroupText>
                        {/* AI 优化：改写期间转圈并连带禁用发布，避免把半成品发出去；
                            发布在途时也禁用——否则改写回包会在草稿清空后把旧内容写回来 */}
                        <InputGroupButton
                            disabled={isEnhancing || isPublishing || draft.trim().length === 0}
                            aria-label="AI 优化正文"
                            tooltip="AI 优化正文"
                            onClick={handleEnhance}
                        >
                            <ButtonLoadingContent label={<Sparkles />} isLoading={isEnhancing} icon={<Spinner />} />
                        </InputGroupButton>
                    </InputGroupAddon>
                </InputGroup>
                {/* 已选图片：缩略图列表，右上角移除；发布接口接入前只作排版预览 */}
                {images.length > 0 ? (
                    <div className="flex flex-wrap gap-2" aria-label="已选图片">
                        {images.map((image) => (
                            <div
                                key={image.path}
                                className="relative size-16 overflow-hidden rounded-md border border-border bg-muted"
                            >
                                {image.url === null ? null : (
                                    <img src={image.url} alt={image.name} className="size-full object-cover" />
                                )}
                                <button
                                    type="button"
                                    title="移除这张图片"
                                    aria-label={`移除图片：${image.name}`}
                                    className="absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                                    onClick={() => {
                                        handleRemoveImage(image.path)
                                    }}
                                >
                                    <X className="size-3" aria-hidden="true" />
                                </button>
                            </div>
                        ))}
                    </div>
                ) : null}
            </CardContent>
            <CardFooter className="justify-between bg-transparent py-2">
                <div className="flex items-center gap-1">
                    <WeiboEmoticonPicker isEnabled={isEnabled} onSelect={handleInsertEmoticon} />
                    <ImagePickerPopover
                        open={isPickerOpen}
                        onOpenChange={handlePickerOpenChange}
                        trigger={
                            <Button variant="ghost" title="添加图片" className="h-auto flex-col gap-0.5 px-2 py-1">
                                <ImagePlus className="size-4" aria-hidden="true" />
                                <span className="text-xs">图片</span>
                            </Button>
                        }
                        title="添加图片"
                        description="上传图片勾选后显示在发布框下方；生图与在线图库请先上传。"
                        sources={pickerSources}
                        selectedPaths={images.map((image) => image.path)}
                        isUploading={isUploading}
                        onUpload={handlePickFiles}
                        onSelect={handleSelectImage}
                    />
                    <WeiboTopicPicker isEnabled={isEnabled} onSelect={handleInsertTopic} />
                </div>
                <Button variant="primary" disabled={!canPublish} isLoading={isPublishing} onClick={handlePublish}>
                    发布
                </Button>
            </CardFooter>
        </Card>
    )
}
