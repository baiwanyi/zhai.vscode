/**
 * 角色卡面板：在编辑弹窗内选画面风格、生成、设封面与删除角色设定图。
 * 复用约定：按钮复用 ui/button，画面风格选择复用 ui/select，加载态复用 ui/spinner / ui/skeleton，
 * 错误走 ui/alert 行内提示，生成、列举与删除由 useCharacterPortrait 承担，人物数据只经 onChange 补丁回传（草稿）。
 * 关键约束：磁盘是图片的唯一事实来源——打开面板按人物目录回读，关闭弹窗期间完成的生成也能读到；
 * 生成成功即写入草稿图库（首张自动设封面），生成期间隐藏生成按钮、网格尾部显示同构占位框；
 * 删除封面时自动回退到图库第一张，图库为空则清空封面；画风随人物卡保存，切换只影响后续生成。
 */
import { cn } from 'cn'
import { ImagePlus, Sparkles, Star, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Alert, AlertDescription } from '@components/ui/alert'
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
import { Button } from '@components/ui/button'
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
    onChange: (patch: Partial<CharacterCard>) => void
}

export function CharacterPortraitPanel({ character, aiContext, onChange }: CharacterPortraitPanelProps): JSX.Element {
    const { isGenerating, error, generate, list, remove } = useCharacterPortrait()
    /** 正在删除的图片路径，用于禁用重复点击 */
    const [busyPath, setBusyPath] = useState<string | null>(null)
    /** 待确认删除的图片：非空时弹出二次确认 */
    const [deleting, setDeleting] = useState<CharacterPortrait | null>(null)
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

    /** 生成成功即写入草稿：新图排在网格末尾，首张自动成为封面，用户不满意再删除 */
    const handleGenerate = async (): Promise<void> => {
        const portrait = await generate(character, aiContext)
        if (portrait === null) {
            return
        }
        onChange({
            portraits: [...character.portraits, portrait],
            coverPortraitId: character.coverPortraitId ?? portrait.id,
        })
    }

    const handleDelete = async (portrait: CharacterPortrait): Promise<void> => {
        setBusyPath(portrait.path)
        const isRemoved = await remove(portrait.path)
        setBusyPath(null)
        if (!isRemoved) {
            return
        }
        const rest = character.portraits.filter((item) => item.id !== portrait.id)
        onChange({
            portraits: rest,
            coverPortraitId:
                character.coverPortraitId === portrait.id ? (rest[0]?.id ?? null) : character.coverPortraitId,
        })
    }

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
                <div className="min-w-0">
                    <p className="text-xs font-medium">角色设定图</p>
                    <p className="text-xs text-muted-foreground py-1">
                        {isGenerating
                            ? '生成中，出图通常需要 1~3 分钟；关闭弹窗也会继续，结果下次打开自动读取'
                            : '图片自动保存到角色目录，关闭弹窗不丢结果；可设封面或删除'}
                    </p>
                </div>
                <div className="flex items-center justify-between gap-2">
                    <Select value={character.portraitStyle} disabled={isGenerating} onValueChange={handleStyleChange}>
                        <SelectTrigger size="sm" className="h-7 w-24 text-xs" aria-label="角色卡画面风格">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {PORTRAIT_STYLE_OPTIONS.map((option) => (
                                    <SelectItem key={option.value} value={option.value} className="text-xs">
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
                <div className="flex flex-col items-center gap-1 rounded-xl border border-dashed border-border py-6 text-center">
                    <ImagePlus className="size-5 text-muted-foreground" aria-hidden="true" />
                    <p className="text-xs text-muted-foreground">还没有角色卡，生成前建议先补全外貌与身份</p>
                </div>
            ) : (
                <div className="flex flex-col gap-1.5">
                    {character.portraits.length > 0 ? (
                        <p className="text-xs text-muted-foreground">已生成 {character.portraits.length} 张</p>
                    ) : null}
                    {/* 外留 2px：封面用外描边包住整张卡片（含操作栏），靠 padding 避免被滚动容器横向裁掉 */}
                    <div className="grid grid-cols-3 gap-2 p-0.5">
                        {character.portraits.map((portrait) => {
                            const isCover = portrait.id === character.coverPortraitId
                            return (
                                <div
                                    key={portrait.id}
                                    className={cn(
                                        'overflow-hidden rounded-lg border border-border',
                                        isCover && 'ring-2 ring-ring',
                                    )}
                                >
                                    <div className="relative">
                                        <img
                                            src={portrait.url}
                                            alt={`${character.name} 的角色卡`}
                                            className="aspect-3/4 w-full object-cover"
                                        />
                                        {isCover ? (
                                            <span className="absolute top-1 left-1 rounded bg-background/85 px-1 py-0.5 text-[10px] font-medium">
                                                封面
                                            </span>
                                        ) : null}
                                    </div>
                                    {/* 操作常显：不依赖 hover，键盘与触屏同样可用 */}
                                    <div className="flex items-center justify-center gap-1 border-t border-border p-1">
                                        <Button
                                            size="icon-xs"
                                            variant="ghost"
                                            aria-label="设为封面"
                                            title="设为封面"
                                            disabled={isCover}
                                            onClick={() => onChange({ coverPortraitId: portrait.id })}
                                        >
                                            <Star className={isCover ? 'fill-current' : undefined} />
                                        </Button>
                                        <Button
                                            size="icon-xs"
                                            variant="ghost"
                                            aria-label="删除角色卡"
                                            title="删除"
                                            disabled={busyPath === portrait.path}
                                            onClick={() => setDeleting(portrait)}
                                        >
                                            <Trash2 />
                                        </Button>
                                    </div>
                                </div>
                            )
                        })}
                        {/* 占位与真实卡片同构：3:4 图片区 + 底部操作栏，空列表时比例也不会走样 */}
                        {isGenerating ? (
                            <div className="overflow-hidden rounded-lg border border-border">
                                <div className="relative">
                                    <Skeleton className="aspect-3/4 w-full rounded-none" />
                                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted-foreground">
                                        <Spinner />
                                        <span className="text-[10px]">生成中</span>
                                    </div>
                                </div>
                                <div className="flex items-center justify-center gap-1 border-t border-border p-1">
                                    <Skeleton className="size-6" />
                                    <Skeleton className="size-6" />
                                </div>
                            </div>
                        ) : null}
                    </div>
                </div>
            )}

            {error !== null ? (
                <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            ) : null}

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
                        <AlertDialogTitle>删除这张角色卡？</AlertDialogTitle>
                        <AlertDialogDescription>
                            文件会移入系统回收站；若它是封面，封面将自动回退到图库中的第一张。
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel size="sm">取消</AlertDialogCancel>
                        <AlertDialogAction
                            size="sm"
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
        </div>
    )
}
