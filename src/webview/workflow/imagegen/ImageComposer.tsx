/**
 * 生图输入卡片：命令动作与画面风格以徽标形式进入输入区，底部选择比例并发送。
 * 复用约定：外壳沿用 aichat 的 composer 两层底色（bg-composer / bg-composer-input），
 * 徽标取 @components/ui/badge，按钮取 @components/ui/button，不手写卡片容器。
 * 关键约束：徽标只承载「引用意图」，其正文内容在发送瞬间拼装——设定与角色快照在此展开，
 * 画风描述由宿主按 style 字段注入（与 portraitPrompt 的 STYLE_HINTS 同一来源）；
 * 未选人物时不允许挂角色徽标，也不允许发送角色图；
 * 封面模式与角色图互斥：开启后忽略角色徽标、kind 固定为 cover，成功后自动退出并提示；
 * 比例与画风的改动只经 onSettingsChange 上报，本组件不直接读写作品配置；
 * 出图常需 1~3 分钟，前端超时必须长于宿主上限（15 分钟），超时或失败后主动 abort 释放宿主并发锁；
 * 生成中发送按钮切换为「取消生成」，取消后立即恢复可编辑，不等宿主回包。
 */
import { Send, Sparkles, UserRound, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
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

/** 出图兜底超时：宿主内置 10 分钟上限，前端放宽到 15 分钟，避免前端先于宿主判超时 */
const GENERATE_TIMEOUT_MS = 900_000

/** 增强兜底超时：宿主 30 秒上限，前端留一倍余量 */
const ENHANCE_TIMEOUT_MS = 60_000

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
    /** 初始比例与画风：来自作品级配置，缺省项由页面回落到默认值 */
    defaultRatio: ImageRatio
    defaultStyle: PortraitStyle
    /** 比例与画风改动：由页面写入作品配置，本组件只负责上报 */
    onSettingsChange: (patch: { defaultRatio?: ImageRatio; portraitStyle?: PortraitStyle }) => void
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
    onSettingsChange,
    onGenerated,
}: ImageComposerProps): JSX.Element {
    const [text, setText] = useState('')
    /** 封面模式：生成结果落统一图库并自动设为作品封面，与角色图互斥 */
    const [isCoverMode, setIsCoverMode] = useState(false)
    const [ratio, setRatio] = useState<ImageRatio>(defaultRatio)
    const [isStyleOpen, setIsStyleOpen] = useState(false)
    const [isGenerating, setIsGenerating] = useState(false)
    const [isEnhancing, setIsEnhancing] = useState(false)
    /** 出图请求代号：取消或重新发送时自增，旧请求迟到的回包按代号丢弃 */
    const generationRef = useRef(0)
    /** 增强前的原文：非空即处于增强态，点按钮可还原 */
    const [enhancedFrom, setEnhancedFrom] = useState<string | null>(null)
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

    /** 封面模式：开启时自动挂上作品设定徽标，避免空提示词无法发送；与角色图互斥 */
    const toggleCoverMode = (): void => {
        const willEnable = !isCoverMode
        setIsCoverMode(willEnable)
        if (!willEnable || chips.some((chip) => chip.kind === 'setting')) {
            return
        }
        setChips([...chips, { kind: 'setting', value: 'setting', label: '作品设定' }])
    }

    const pickStyle = (value: PortraitStyle, label: string): void => {
        setChips((current) => [...current.filter((chip) => chip.kind !== 'style'), { kind: 'style', value, label }])
        setIsStyleOpen(false)
        onSettingsChange({ portraitStyle: value })
    }

    /** 切换比例并记住：作品级配置随作品走，下次打开沿用 */
    const handleRatioChange = (value: ImageRatio): void => {
        setRatio(value)
        onSettingsChange({ defaultRatio: value })
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

    /** 增强提示词：只改写输入框正文，chip 与设定留在发送时拼装，避免模型复述设定原文 */
    const handleEnhance = async (): Promise<void> => {
        const source = text.trim()
        if (source.length === 0) {
            return
        }
        setIsEnhancing(true)
        try {
            const result = await request<{ text: string }>(
                'pressAi/enhanceImagePrompt',
                { dirPath, text: source },
                ENHANCE_TIMEOUT_MS,
            )
            setEnhancedFrom(source)
            setText(result.text)
        } catch (cause) {
            toastError(cause)
        } finally {
            setIsEnhancing(false)
        }
    }

    const handleRestore = (): void => {
        if (enhancedFrom === null) {
            return
        }
        setText(enhancedFrom)
        setEnhancedFrom(null)
    }

    const buildPrompt = (): string => {
        const sections: string[] = []
        if (text.trim().length > 0) {
            sections.push(text.trim())
        }
        // 封面不绑定角色：封面模式下即使还挂着角色徽标也不并入提示词
        if (!isCoverMode && characterChip !== null) {
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

    /** 取消宿主的在途出图：尽力而为，宿主无进行中请求时忽略错误 */
    const abortGeneration = async (): Promise<void> => {
        try {
            await request('pressAi/generateImage/abort')
        } catch {
            // 取消失败不影响前端复位：下一次发送会由宿主返回「已有生成中」提示
        }
    }

    const handleSend = async (): Promise<void> => {
        const prompt = buildPrompt()
        if (prompt.length === 0) {
            return
        }
        const token = generationRef.current + 1
        generationRef.current = token
        setIsGenerating(true)
        try {
            const result = await request<ImageGenerateResult>(
                'pressAi/generateImage',
                {
                    dirPath,
                    prompt,
                    kind: isCoverMode ? 'cover' : activeCharacter === null ? 'photo' : 'portrait',
                    characterId: isCoverMode || activeCharacter === null ? null : activeCharacter.id,
                    ratio,
                    style: styleChip?.value ?? defaultStyle,
                    enhancedFrom: enhancedFrom ?? undefined,
                },
                GENERATE_TIMEOUT_MS,
            )
            // 已取消或被新请求取代：结果照常落盘，由下次列表刷新带出，这里不再写回界面
            if (generationRef.current !== token) {
                return
            }
            onGenerated(result)
            setText('')
            setChips((current) => current.filter((chip) => chip.kind === 'style'))
            // 封面是一次性动作：成功即退出封面模式，回到普通出图
            if (isCoverMode) {
                setIsCoverMode(false)
                toast.success('作品封面已更新')
            }
        } catch (cause) {
            if (generationRef.current !== token) {
                return
            }
            // 超时或失败后宿主可能仍在出图，主动取消以释放并发锁
            void abortGeneration()
            toastError(cause)
        } finally {
            if (generationRef.current === token) {
                setIsGenerating(false)
            }
        }
    }

    /** 取消生成：立即复位按钮，不等宿主回包，避免模型慢时界面卡在「生成中」 */
    const handleAbort = async (): Promise<void> => {
        generationRef.current += 1
        setIsGenerating(false)
        await abortGeneration()
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
                        disabled={activeCharacter === null || isCoverMode}
                        title={
                            isCoverMode
                                ? '封面不绑定角色，先关闭作品封面模式'
                                : activeCharacter === null
                                  ? '先在筛选条选择人物'
                                  : undefined
                        }
                        onClick={toggleCharacter}
                    >
                        <UserRound />
                        角色设定
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant={isCoverMode ? 'secondary' : 'ghost'}
                        disabled={isGenerating}
                        title="生成结果会落进图库并自动设为作品封面"
                        onClick={toggleCoverMode}
                    >
                        作品封面
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
                                onClick={() => handleRatioChange(item)}
                            >
                                {item}
                            </Button>
                        ))}
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="ml-auto"
                            disabled={isEnhancing || isGenerating || text.trim().length === 0}
                            onClick={() => {
                                if (enhancedFrom === null) {
                                    void handleEnhance()
                                    return
                                }
                                handleRestore()
                            }}
                        >
                            {isEnhancing ? '增强中…' : enhancedFrom === null ? '增强提示词' : '还原'}
                        </Button>
                        {isGenerating ? (
                            <Button type="button" size="sm" variant="outline" onClick={() => void handleAbort()}>
                                <X />
                                取消生成
                            </Button>
                        ) : (
                            <Button
                                type="button"
                                size="sm"
                                disabled={buildPrompt().length === 0}
                                onClick={() => void handleSend()}
                            >
                                <Send />
                                {isCoverMode ? '生成封面' : '发送'}
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
