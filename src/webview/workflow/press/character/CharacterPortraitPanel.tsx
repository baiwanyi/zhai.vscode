/**
 * 角色卡面板：在编辑弹窗内选画面风格、生成、设封面与删除角色设定图。
 * 复用约定：按钮复用 ui/button，画面风格选择复用 ui/select，加载态复用 ui/spinner / ui/skeleton，
 * 无图空态复用 ui/empty，封面标记复用 ui/badge 的 secondary 变体；
 * 生成、列举与删除由 useCharacterPortrait 承担，人物数据只经 onChange 补丁回传（草稿）。
 * 关键约束：磁盘是图片的唯一事实来源——打开面板按人物目录回读，关闭弹窗期间完成的生成也能读到；
 * 生成成功即写入草稿图库（新图置顶并自动设封面），生成期间隐藏生成按钮、网格首位显示同构占位框；
 * 卡片无底栏：设为封面在左上、删除在右下，均随悬停显现并支持键盘聚焦，封面图左上常显「封面」；
 * 悬停时叠 5% 黑遮罩压暗画面（不拦截点击）；双击卡片用 Dialog 打开大图，可复制到剪贴板或插入编辑器光标；
 * 浮层按钮需拦截双击冒泡；无编辑器光标时插入静默忽略；删除封面时自动回退到图库第一张；
 * 画风随人物卡保存，切换只影响后续生成；生成、复制、插入与删除的结果统一经 sonner 提示。
 */
import { cn } from 'cn'
import { Copy, Image as ImageIcon, ImagePlus, Sparkles, TextCursorInput, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@components/ui/alert-dialog'
import { Badge } from '@components/ui/badge'
import { Button } from '@components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@components/ui/empty'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import { Skeleton } from '@components/ui/skeleton'
import { Spinner } from '@components/ui/spinner'
import type { CharacterPortrait } from '@shared/types/press'
import { useCharacterPortrait } from './useCharacterPortrait'
import type { AppearanceContext } from './useCharacterAppearance'
import type { CharacterCard } from '../types'
import type { JSX } from 'react'
import { PORTRAIT_STYLE_OPTIONS } from '../constants'
import { mergePortraits } from '../utils'

interface CharacterPortraitPanelProps {
    character: CharacterCard
    aiContext: AppearanceContext
    /** 当前作品目录：角色卡读写限定在该作品的 Portraits 下 */
    dirPath: string
    onChange: (patch: Partial<CharacterCard>) => void
}

export function CharacterPortraitPanel({
    character,
    aiContext,
    dirPath,
    onChange,
}: CharacterPortraitPanelProps): JSX.Element {
    const { isGenerating, generate, list, copy, insert, remove } = useCharacterPortrait(dirPath)
    /** 正在删除的图片路径，用于禁用重复点击 */
    const [busyPath, setBusyPath] = useState<string | null>(null)
    /** 待确认删除的图片：非空时弹出二次确认 */
    const [deleting, setDeleting] = useState<CharacterPortrait | null>(null)
    /** 大图预览的图片：双击卡片时打开，只读 */
    const [previewing, setPreviewing] = useState<CharacterPortrait | null>(null)
    /** 已完成回读的人物 id：与当前人物不一致时视为加载中，避免「没有图」闪一下 */
    const [loadedId, setLoadedId] = useState<string | null>(null)

    // 回读结果返回时人物卡可能已被本次编辑改动，用 ref 取最新值，避免 effect 依赖草稿导致反复扫盘
    const latestRef = useRef({ character, onChange })
    latestRef.current = { character, onChange }

    // 磁盘是唯一事实来源：每次打开面板（或切换人物）都按角色目录回读，关闭弹窗期间完成的生成同样可见
    useEffect(() => {
        let cancelled = false
        void list(character.id).then((items) => {
            if (cancelled) {
                return
            }
            const current = latestRef.current.character
            const portraits = mergePortraits(items, current.portraits)
            const hasCover = portraits.some((item) => item.id === current.coverPortraitId)
            latestRef.current.onChange({
                portraits,
                coverPortraitId: hasCover ? current.coverPortraitId : (portraits[0]?.id ?? null),
            })
            setLoadedId(character.id)
        })
        return (): void => {
            cancelled = true
        }
    }, [character.id, list])

    const handleStyleChange = (value: string): void => {
        const next = PORTRAIT_STYLE_OPTIONS.find((option) => option.value === value)
        if (next) {
            onChange({ portraitStyle: next.value })
        }
    }

    /** 生成成功即写入草稿：新图排在最前（占位框所在格）并直接成为封面，用户不满意再删除 */
    const handleGenerate = async (): Promise<void> => {
        const portrait = await generate(character, aiContext)
        if (portrait === null) {
            return
        }
        onChange({
            portraits: [portrait, ...character.portraits],
            coverPortraitId: portrait.id,
        })
        toast.success('角色设定图已生成，保存人物卡后生效')
    }

    /** 复制图片到系统剪贴板：webview 内写图片受 CSP 与权限限制，交由宿主按平台写入 */
    const handleCopyImage = async (): Promise<void> => {
        if (previewing === null) {
            return
        }
        const result = await copy(previewing.path)
        if (result === null) {
            return
        }
        if (result.copied) {
            toast.success('图片已复制到剪贴板')
            return
        }
        toast.error(
            result.reason === 'unsupported' ? '当前系统不支持复制图片，可改用文件管理器保存' : '复制失败，请重试',
        )
    }

    /** 插入到文章：无编辑器光标时按要求静默忽略，其余失败原因给出提示 */
    const handleInsertImage = async (): Promise<void> => {
        if (previewing === null) {
            return
        }
        const result = await insert(previewing.path)
        if (result !== null && result.inserted) {
            setPreviewing(null)
            toast.success('已插入到当前文档光标处')
            return
        }
        const reason = result?.reason
        if (reason === undefined || reason === 'no-editor') {
            setPreviewing(null)
            return
        }
        toast.error(reason === 'not-markdown' ? '仅在 Markdown 文件中支持插入' : '插入失败，请重试')
    }

    /**
     * 删除图片后按磁盘重建图库：文件可能已在别处被删掉，只做本地过滤会把失效项留在列表里（表现为破图）。
     * 因此无论删除是否成功，都以 list 的回读结果为准；封面指向被删图时顺延到重建后的第一张。
     */
    const handleDelete = async (portrait: CharacterPortrait): Promise<void> => {
        setBusyPath(portrait.path)
        const isRemoved = await remove(portrait.path)
        const items = await list(character.id)
        setBusyPath(null)
        // list 读取失败会返回空数组，与「目录确实空了」无法区分，故本地还有其它图时按读取失败处理，避免误清图库
        const rest = character.portraits.filter((item) => item.path !== portrait.path)
        const portraits = items.length === 0 && rest.length > 0 ? rest : items
        const hasCover = portraits.some((item) => item.id === character.coverPortraitId)
        onChange({
            portraits,
            coverPortraitId: hasCover ? character.coverPortraitId : (portraits[0]?.id ?? null),
        })
        if (!isRemoved) {
            toast.error('图片已不在磁盘上，图库已按当前目录重建')
            return
        }
        toast.success('角色设定图已删除')
    }

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
                <div className="min-w-0">
                    <p className="font-medium">角色设定图</p>
                    <p className="text-muted-foreground py-1">
                        {isGenerating
                            ? '生成中，出图通常需要 1~3 分钟；关闭弹窗也会继续，结果下次打开自动读取'
                            : '图片自动保存到角色目录，关闭弹窗不丢结果；可设封面或删除'}
                    </p>
                </div>
                <div className="flex items-center justify-between gap-2">
                    <Select value={character.portraitStyle} disabled={isGenerating} onValueChange={handleStyleChange}>
                        <SelectTrigger className="h-8 w-24" aria-label="角色卡画面风格">
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
                    {/* 生成期间隐藏生成按钮，避免重复提交；宿主侧无法真正中断出图，故不提供取消 */}
                    {isGenerating ? null : (
                        <Button
                            variant="outline"
                            className="shrink-0"
                            onClick={() => {
                                void handleGenerate()
                            }}
                        >
                            <Sparkles data-icon="inline-start" />
                            生成
                        </Button>
                    )}
                </div>
            </div>

            {loadedId !== character.id ? null : character.portraits.length === 0 && !isGenerating ? (
                <Empty className="border py-4">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <ImagePlus />
                        </EmptyMedia>
                        <EmptyTitle>还没有角色卡</EmptyTitle>
                        <EmptyDescription>生成前建议先补全外貌与身份。</EmptyDescription>
                    </EmptyHeader>
                </Empty>
            ) : (
                <div className="flex flex-col gap-1.5">
                    {character.portraits.length > 0 ? (
                        <p className="text-muted-foreground">已生成 {character.portraits.length} 张</p>
                    ) : null}
                    {/* 外留 2px：封面用外描边包住整张卡片（含操作栏），靠 padding 避免被滚动容器横向裁掉 */}
                    <div className="grid grid-cols-3 gap-2 p-0.5">
                        {/* 占位插在首位：与真实卡片同为 3:4，出图后就落在这一格 */}
                        {isGenerating ? (
                            <div className="relative overflow-hidden rounded-lg border border-border">
                                <Skeleton className="aspect-3/4 w-full rounded-none" />
                                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted-foreground">
                                    <Spinner />
                                    <span>生成中</span>
                                </div>
                            </div>
                        ) : null}
                        {character.portraits.map((portrait) => {
                            const isCover = portrait.id === character.coverPortraitId
                            return (
                                <div
                                    key={portrait.id}
                                    className={cn(
                                        'group relative cursor-zoom-in overflow-hidden rounded-lg border border-border',
                                        isCover && 'ring-2 ring-ring',
                                    )}
                                    onDoubleClick={() => setPreviewing(portrait)}
                                >
                                    <img
                                        src={portrait.url}
                                        alt={`${character.name} 的角色卡`}
                                        className="aspect-3/4 w-full object-cover"
                                    />
                                    {/* 悬停压暗 5%：只做视觉提示，不拦截点击；键盘聚焦时同样显现操作 */}
                                    <div
                                        className="pointer-events-none absolute inset-0 bg-black/5 opacity-0 transition-opacity group-hover:opacity-100"
                                        aria-hidden="true"
                                    />
                                    {isCover ? (
                                        <Badge variant="secondary" className="absolute top-1 left-1">
                                            封面
                                        </Badge>
                                    ) : (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="absolute top-1 left-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                                            aria-label="设为封面"
                                            onClick={() => onChange({ coverPortraitId: portrait.id })}
                                            onDoubleClick={(event) => event.stopPropagation()}
                                        >
                                            <ImageIcon />
                                        </Button>
                                    )}
                                    <Button
                                        variant="destructive"
                                        size="icon"
                                        className="absolute top-1 right-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                                        aria-label="删除角色卡"
                                        disabled={busyPath === portrait.path}
                                        onClick={() => setDeleting(portrait)}
                                        onDoubleClick={(event) => event.stopPropagation()}
                                    >
                                        <Trash2 />
                                    </Button>
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}

            <AlertDialog
                open={deleting !== null}
                onOpenChange={(isOpen) => {
                    if (!isOpen) {
                        setDeleting(null)
                    }
                }}
            >
                <AlertDialogContent size="sm">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-lg">删除这张角色卡？</AlertDialogTitle>
                        <AlertDialogDescription>
                            文件会移入系统回收站；若它是封面，封面将自动回退到图库中的第一张。
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction
                            variant="destructive"
                            onClick={() => {
                                const target = deleting
                                setDeleting(null)
                                if (target !== null) {
                                    void handleDelete(target)
                                }
                            }}
                        >
                            删除角色卡
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* 双击卡片看大图：可复制到剪贴板，或插入到编辑器光标处 */}
            <Dialog
                open={previewing !== null}
                onOpenChange={(isOpen) => {
                    if (!isOpen) {
                        setPreviewing(null)
                    }
                }}
            >
                <DialogContent>
                    <DialogTitle className="text-lg">角色设定图预览</DialogTitle>
                    <div className="p-3">
                        {previewing !== null ? (
                            <img
                                src={previewing.url}
                                alt={`${character.name} 的角色卡大图`}
                                className="max-h-[72vh] w-full rounded-lg object-contain"
                            />
                        ) : null}
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => {
                                void handleCopyImage()
                            }}
                        >
                            <Copy data-icon="inline-start" />
                            复制图片
                        </Button>
                        <Button
                            onClick={() => {
                                void handleInsertImage()
                            }}
                        >
                            <TextCursorInput data-icon="inline-start" />
                            插入到文章
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
