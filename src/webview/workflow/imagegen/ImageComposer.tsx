/**
 * 生图输入卡片：命令动作与画面风格以徽标形式进入输入区，底部选择比例并发送。
 * 复用约定：外壳沿用 aichat 的 composer 两层底色（bg-composer / bg-composer-input），
 * 徽标取 @components/ui/badge，按钮取 @components/ui/button，不手写卡片容器。
 * 关键约束：徽标只承载「引用意图」，其正文内容在发送瞬间拼装——设定与角色快照在此展开，
 * 画风描述由宿主按 style 字段注入（与 portraitPrompt 的 STYLE_HINTS 同一来源）；
 * 未选人物时不允许挂角色徽标，也不允许发送角色图；生成期间禁用发送，避免连点重复扣费。
 */
import { Send, Sparkles, UserRound, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Badge } from '@components/ui/badge'
import { Button } from '@components/ui/button'
import { IMAGE_RATIOS, type ImageGenerateResult, type ImageRatio } from '@shared/types/imagegen'
import type { PortraitStyle } from '@shared/types/press'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import { ImagePromptPopover } from './ImagePromptPopover'
import type { JSX } from 'react'

/** 作品设定快照：只取与画面相关的字段，缺省项不参与拼装 */
export interface PromptSettingSnapshot {
    title?: string
    genres?: string[]
    logline?: string
    worldview?: string
    tone?: string
    perspective?: string
}

/** 角色快照：当前只注入姓名，更丰富的字段待宿主提供上下文接口后补齐 */
export interface PromptCharacterSnapshot {
    id: string
    name: string
}

/** 徽标：setting 指作品设定，character 指某个人物，style 指当前画风 */
interface PromptChip {
    kind: 'setting' | 'character' | 'style'
    value: string
    label: string
}

/** 画风选项：value 与 portraitPrompt 的 STYLE_HINTS 键一一对应 */
const STYLE_OPTIONS: ReadonlyArray<{ value: PortraitStyle; label: string }> = [
    { value: 'auto', label: '自动' },
    { value: 'guofeng', label: '古风' },
    { value: 'anime', label: '日漫' },
    { value: 'realistic', label: '写实' },
    { value: 'photo', label: '人像' },
    { value: 'cinematic', label: '电影' },
    { value: 'gameart', label: '立绘' },
    { value: 'pixel', label: '像素' },
]

/** 比例展示文案 */
const RATIO_LABELS: ReadonlyArray<ImageRatio> = IMAGE_RATIOS

/** 把作品设定展开为一段提示词：只输出有值的字段 */
function formatSetting(setting: PromptSettingSnapshot): string {
    const lines: string[] = []
    if (setting.title !== undefined && setting.title.length > 0) {
        lines.push(`书名：${setting.title}`)
    }
    if (setting.genres !== undefined && setting.genres.length > 0) {
        lines.push(`题材：${setting.genres.join('、')}`)
    }
    if (setting.logline !== undefined && setting.logline.length > 0) {
        lines.push(`简介：${setting.logline}`)
    }
    if (setting.worldview !== undefined && setting.worldview.length > 0) {
        lines.push(`世界观：${setting.worldview}`)
    }
    if (setting.tone !== undefined && setting.tone.length > 0) {
        lines.push(`基调：${setting.tone}`)
    }
    if (setting.perspective !== undefined && setting.perspective.length > 0) {
        lines.push(`视角：${setting.perspective}`)
    }
    return lines.join('\n')
}

interface ImageComposerProps {
    dirPath: string
    characters: ReadonlyArray<PromptCharacterSnapshot>
    setting: PromptSettingSnapshot
    /** 顶栏选中的角色：既是生成目标，也是角色徽标的来源 */
    activeCharacterId: string | null
    defaultRatio: ImageRatio
    defaultStyle: PortraitStyle
    /** 生成成功后的回调：由页面负责插入列表并刷新 */
    onGenerated: (result: ImageGenerateResult) => void
}

export function ImageComposer({
    dirPath,
    characters,
    setting,
    activeCharacterId,
    defaultRatio,
    defaultStyle,
    onGenerated,
}: ImageComposerProps): JSX.Element {
    const [text, setText] = useState('')
    const [ratio, setRatio] = useState<ImageRatio>(defaultRatio)
    const [isStyleOpen, setIsStyleOpen] = useState(false)
    const [isGenerating, setIsGenerating] = useState(false)
    const [chips, setChips] = useState<PromptChip[]>([
        {
            kind: 'style',
            value: defaultStyle,
            label: STYLE_OPTIONS.find((item) => item.value === defaultStyle)?.label ?? '自动',
        },
    ])

    const textAreaRef = useRef<HTMLTextAreaElement | null>(null)

    const activeCharacter = useMemo(
        () => characters.find((character) => character.id === activeCharacterId) ?? null,
        [characters, activeCharacterId],
    )

    const styleChip = chips.find((chip) => chip.kind === 'style') ?? null
    const settingChip = chips.find((chip) => chip.kind === 'setting') ?? null
    const characterChip = chips.find((chip) => chip.kind === 'character') ?? null

    const toggleSetting = (): void => {
        setChips((current) =>
            current.some((chip) => chip.kind === 'setting')
                ? current.filter((chip) => chip.kind !== 'setting')
                : [...current, { kind: 'setting', value: 'setting', label: '作品设定' }],
        )
    }

    const toggleCharacter = (): void => {
        if (activeCharacter === null) {
            return
        }
        setChips((current) =>
            current.some((chip) => chip.kind === 'character')
                ? current.filter((chip) => chip.kind !== 'character')
                : [...current, { kind: 'character', value: activeCharacter.id, label: activeCharacter.name }],
        )
    }

    const pickStyle = (value: PortraitStyle, label: string): void => {
        setChips((current) => [...current.filter((chip) => chip.kind !== 'style'), { kind: 'style', value, label }])
        setIsStyleOpen(false)
    }

    const removeChip = (kind: PromptChip['kind']): void => {
        setChips((current) => current.filter((chip) => chip.kind !== kind))
    }

    /** 把词条插入光标处：保留已有内容，插入后把光标移到片段末尾，便于连续点击累加 */
    const insertPrompt = (fragment: string): void => {
        const area = textAreaRef.current
        if (area === null) {
            setText((current) => (current.length === 0 ? fragment : `${current} ${fragment}`))
            return
        }
        const start = area.selectionStart
        const end = area.selectionEnd
        const next = `${text.slice(0, start)}${fragment}${text.slice(end)}`
        setText(next)
        requestAnimationFrame(() => {
            const position = start + fragment.length
            area.focus()
            area.setSelectionRange(position, position)
        })
    }

    const buildPrompt = (): string => {
        const sections: string[] = []
        if (text.trim().length > 0) {
            sections.push(text.trim())
        }
        if (characterChip !== null) {
            const character = characters.find((item) => item.id === characterChip.value)
            if (character !== undefined) {
                sections.push(`角色：${character.name}`)
            }
        }
        if (settingChip !== null) {
            const snapshot = formatSetting(setting)
            if (snapshot.length > 0) {
                sections.push(snapshot)
            }
        }
        return sections.join('\n\n')
    }

    const handleSend = async (): Promise<void> => {
        const prompt = buildPrompt()
        if (prompt.length === 0) {
            return
        }
        setIsGenerating(true)
        try {
            const result = await request<ImageGenerateResult>('pressAi/generateImage', {
                dirPath,
                prompt,
                kind: activeCharacter === null ? 'photo' : 'portrait',
                characterId: activeCharacter === null ? null : activeCharacter.id,
                ratio,
                style: styleChip?.value ?? defaultStyle,
            })
            onGenerated(result)
            setText('')
            setChips((current) => current.filter((chip) => chip.kind === 'style'))
        } catch (cause) {
            toastError(cause)
        } finally {
            setIsGenerating(false)
        }
    }

    return (
        <div className="p-2">
            <div className="rounded-2xl bg-composer p-1.5">
                <div className="mb-1 flex items-center gap-1">
                    <Button
                        type="button"
                        size="sm"
                        variant={settingChip === null ? 'ghost' : 'secondary'}
                        onClick={toggleSetting}
                    >
                        <Sparkles />
                        命令动作
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant={isStyleOpen ? 'secondary' : 'ghost'}
                        onClick={() => setIsStyleOpen((open) => !open)}
                    >
                        画面风格
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant={characterChip === null ? 'ghost' : 'secondary'}
                        disabled={activeCharacter === null}
                        title={activeCharacter === null ? '先在筛选条选择人物' : undefined}
                        onClick={toggleCharacter}
                    >
                        <UserRound />
                        角色设定
                    </Button>
                    <ImagePromptPopover
                        trigger={
                            <Button type="button" size="sm" variant="ghost">
                                提示词
                            </Button>
                        }
                        onInsert={insertPrompt}
                    />
                </div>

                {isStyleOpen ? (
                    <div className="mb-1 flex flex-wrap gap-1 px-1">
                        {STYLE_OPTIONS.map((option) => (
                            <Button
                                key={option.value}
                                type="button"
                                size="xs"
                                variant={styleChip?.value === option.value ? 'secondary' : 'ghost'}
                                onClick={() => pickStyle(option.value, option.label)}
                            >
                                {option.label}
                            </Button>
                        ))}
                    </div>
                ) : null}

                <div className="rounded-xl bg-composer-input p-3">
                    {chips.length > 0 ? (
                        <div className="mb-2 flex flex-wrap gap-1.5">
                            {chips.map((chip) => (
                                <Badge key={`${chip.kind}-${chip.value}`} variant="secondary" className="gap-1 pr-1">
                                    {chip.label}
                                    <button
                                        type="button"
                                        aria-label={`移除${chip.label}`}
                                        className="rounded-sm opacity-60 hover:opacity-100"
                                        onClick={() => removeChip(chip.kind)}
                                    >
                                        <X className="size-3" />
                                    </button>
                                </Badge>
                            ))}
                        </div>
                    ) : null}
                    <textarea
                        ref={textAreaRef}
                        value={text}
                        onChange={(event) => setText(event.target.value)}
                        rows={3}
                        placeholder="描述画面：人物、动作、场景、光线与氛围…"
                        className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    />
                    <div className="mt-2 flex items-center gap-1">
                        {RATIO_LABELS.map((item) => (
                            <Button
                                key={item}
                                type="button"
                                size="xs"
                                variant={ratio === item ? 'secondary' : 'ghost'}
                                onClick={() => setRatio(item)}
                            >
                                {item}
                            </Button>
                        ))}
                        <Button
                            type="button"
                            size="sm"
                            className="ml-auto"
                            disabled={isGenerating || buildPrompt().length === 0}
                            onClick={() => void handleSend()}
                        >
                            <Send />
                            {isGenerating ? '生成中…' : '发送'}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    )
}
