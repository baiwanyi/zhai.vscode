/**
 * 角色卡面板：在编辑弹窗内选画面风格、生成、设封面与删除角色设定图。
 * 复用约定：按钮复用 ui/button，画面风格选择复用 ui/select，图库宫格、空态与生成中占位统一由
 * 业务公共层的 CoverGallery 承担；生成、列举与删除由 useCharacterPortrait 承担，
 * 人物数据只经 onChange 补丁回传（草稿）。
 * 关键约束：磁盘是图片的唯一事实来源——打开面板按人物目录回读，关闭弹窗期间完成的生成也能读到；
 * 生成成功即写入草稿图库（新图置顶并自动设封面），生成期间隐藏生成按钮、网格首位显示同构占位框；
 * 双击卡片用 Dialog 打开大图，可复制到剪贴板或插入编辑器光标；无编辑器光标时插入静默忽略；
 * 删除封面时自动回退到图库第一张；画风随人物卡保存，切换只影响后续生成；
 * 生成、复制、插入与删除的结果统一经 sonner 提示。
 */
import { Copy, Sparkles, TextCursorInput } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@components/ui/dialog'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import type { CharacterPortrait } from '@shared/types/press'
import { Button } from '@webview/components/Button'
import { ConfirmDialog } from '@webview/components/ConfirmDialog'
import { CoverGallery } from '@webview/components/CoverGallery'
import { Image } from '@webview/components/Image'
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
                            <Sparkles />
                            生成
                        </Button>
                    )}
                </div>
            </div>

            <CoverGallery
                items={character.portraits}
                coverId={character.coverPortraitId}
                variant="portrait"
                isLoading={loadedId !== character.id}
                isGenerating={isGenerating}
                busyPath={busyPath}
                emptyTitle="还没有角色卡"
                emptyDescription="生成前建议先补全外貌与身份。"
                altPrefix={`${character.name} 的角色卡`}
                deleteLabel="删除角色卡"
                countLabel={(count) => `已生成 ${count} 张`}
                onSetCover={(item) => onChange({ coverPortraitId: item.id })}
                onDelete={(item) => {
                    const target = character.portraits.find((portrait) => portrait.id === item.id)
                    if (target !== undefined) {
                        setDeleting(target)
                    }
                }}
                onPreview={(item) => {
                    const target = character.portraits.find((portrait) => portrait.id === item.id)
                    if (target !== undefined) {
                        setPreviewing(target)
                    }
                }}
            />

            <ConfirmDialog
                open={deleting !== null}
                title="删除这张角色卡？"
                description="文件会移入系统回收站；若它是封面，封面将自动回退到图库中的第一张。"
                confirmLabel="删除角色卡"
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
                        <Image
                            src={(previewing !== null && previewing?.url) || ''}
                            alt={`${character.name} 的角色卡大图`}
                            aspect="9/16"
                            size="lg"
                            className="min-h-40 max-h-[72vh]"
                        />
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => {
                                void handleCopyImage()
                            }}
                        >
                            <Copy />
                            复制图片
                        </Button>
                        <Button
                            onClick={() => {
                                void handleInsertImage()
                            }}
                        >
                            <TextCursorInput />
                            插入到文章
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
