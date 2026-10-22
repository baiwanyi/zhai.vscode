/**
 * 角色卡面板：在编辑弹窗内选画风、生成、采用、设封面与删除角色设定图。
 * 复用约定：按钮与下拉复用 ui 基础组件，错误走 ui/alert 行内提示，生成与删除由 useCharacterPortrait 承担，
 * 人物数据只经 onChange 补丁回传（草稿），面板不持有角色副本。
 * 关键约束：每次只保留一张「待采用」预览，重新生成或放弃时会先删掉上一张未采用的图片，避免磁盘残留；
 * 采用后才进入图库；删除封面时自动回退到图库第一张，图库为空则清空封面；
 * 画风随人物卡保存，切换只影响后续生成，已采用的图片不会重绘。
 */
import { cn } from 'cn'
import { ImagePlus, Sparkles, Star, Trash2 } from 'lucide-react'
import { useState } from 'react'
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
import { Spinner } from '@components/ui/spinner'
import type { CharacterPortrait } from '@shared/types/press'
import { useCharacterPortrait } from './useCharacterPortrait'
import type { AppearanceContext } from './useCharacterAppearance'
import type { CharacterCard } from '../types'
import type { JSX } from 'react'
import { PORTRAIT_STYLE_OPTIONS } from '../constants'

interface CharacterPortraitPanelProps {
    character: CharacterCard
    aiContext: AppearanceContext
    onChange: (patch: Partial<CharacterCard>) => void
}

export function CharacterPortraitPanel({ character, aiContext, onChange }: CharacterPortraitPanelProps): JSX.Element {
    const { isGenerating, error, generate, remove, abort } = useCharacterPortrait()
    /** 已生成但尚未采用的图片 */
    const [pending, setPending] = useState<CharacterPortrait | null>(null)
    /** 正在删除的图片路径，用于禁用重复点击 */
    const [busyPath, setBusyPath] = useState<string | null>(null)
    /** 待确认删除的图片：非空时弹出二次确认 */
    const [deleting, setDeleting] = useState<CharacterPortrait | null>(null)

    const handleStyleChange = (value: string): void => {
        const next = PORTRAIT_STYLE_OPTIONS.find((option) => option.value === value)
        if (next) {
            onChange({ portraitStyle: next.value })
        }
    }

    const handleGenerate = async (): Promise<void> => {
        // 重新生成前先清掉上一张未采用的图，避免文件越堆越多
        if (pending !== null) {
            const previous = pending
            setPending(null)
            void remove(previous.path)
        }
        const portrait = await generate(character, aiContext)
        if (portrait !== null) {
            setPending(portrait)
        }
    }

    const handleReject = async (): Promise<void> => {
        if (pending === null) {
            return
        }
        const target = pending
        setPending(null)
        await remove(target.path)
    }

    const handleAdopt = (): void => {
        if (pending === null) {
            return
        }
        onChange({
            portraits: [...character.portraits, pending],
            // 第一张采用即成为封面，后续由用户手动切换
            coverPortraitId: character.coverPortraitId ?? pending.id,
        })
        setPending(null)
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
                    <p className="text-xs text-muted-foreground">
                        {isGenerating
                            ? '生成中，出图通常需要 1~3 分钟，请保持弹窗打开'
                            : '每次生成一张，采用后加入图库；可设封面或删除，文件保存在本地目录'}
                    </p>
                </div>
                <div className="flex items-center justify-between gap-2">
                    <Select value={character.portraitStyle} disabled={isGenerating} onValueChange={handleStyleChange}>
                        <SelectTrigger size="sm" className="h-7 w-24 text-xs" aria-label="角色卡画风">
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
                    {isGenerating ? (
                        <Button
                            size="xs"
                            variant="ghost"
                            className="shrink-0"
                            onClick={() => {
                                void abort()
                            }}
                        >
                            <Spinner data-icon="inline-start" />
                            取消
                        </Button>
                    ) : (
                        <Button
                            size="xs"
                            variant="outline"
                            className="shrink-0"
                            onClick={() => {
                                void handleGenerate()
                            }}
                        >
                            <Sparkles data-icon="inline-start" />
                            {pending === null ? '生成' : '重新生成'}
                        </Button>
                    )}
                </div>
            </div>

            {pending !== null ? (
                <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/30 p-2">
                    <img
                        src={pending.url}
                        alt="角色卡预览"
                        className="mx-auto max-h-64 w-auto rounded-lg object-contain"
                    />
                    <div className="flex items-center justify-end gap-2">
                        <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => {
                                void handleReject()
                            }}
                        >
                            放弃
                        </Button>
                        <Button size="xs" onClick={handleAdopt}>
                            采用
                        </Button>
                    </div>
                </div>
            ) : null}

            {character.portraits.length === 0 && pending === null ? (
                <div className="flex flex-col items-center gap-1 rounded-xl border border-dashed border-border py-6 text-center">
                    <ImagePlus className="size-5 text-muted-foreground" aria-hidden="true" />
                    <p className="text-xs text-muted-foreground">还没有角色卡，生成前建议先补全外貌与身份</p>
                </div>
            ) : (
                <div className="flex flex-col gap-1.5">
                    {character.portraits.length > 0 ? (
                        <p className="text-xs text-muted-foreground">已采用 {character.portraits.length} 张</p>
                    ) : null}
                    <div className="grid grid-cols-3 gap-2">
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
                                            className="aspect-[3/4] w-full object-cover"
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
