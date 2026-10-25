/**
 * 生图输入卡片：命令动作、画风与角色以芯片内联在正文流中，底部选择比例并发送。
 * 复用约定：外壳沿用 aichat 的 composer 两层底色（bg-composer / bg-composer-input），芯片输入区取
 * @webview/components/RichChipInput（与 aichat 共用 richText 的 DOM 工具），按钮取 @components/ui/button。
 * 关键约束：芯片只承载「引用意图」，正文在发送瞬间拼装——角色段取人物卡的姓名、性别年龄、身份与外貌；
 * 画风由宿主按 style 注入（与 portraitPrompt 的 STYLE_HINTS 同源），封面模式忽略角色段且 kind 固定 cover；
 * 比例与画风改动只经 onSettingsChange 上报；出图前端兜底 15 分钟，超时或失败即 abort 释放并发锁；
 * 生成中发送按钮切换为「取消生成」，取消后立即复位，不等宿主回包。
 */
import { Send, Sparkles, UserRound, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@components/ui/button'
import { IMAGE_RATIOS, type ImageGenerateResult, type ImageRatio } from '@shared/types/imagegen'
import type { PortraitStyle } from '@shared/types/press'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import { RichChipInput, type RichChipInputHandle } from '@webview/components/RichChipInput'
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

/** 角色快照：姓名、性别年龄、身份与外貌，字段缺失时只拼姓名 */
export interface PromptCharacterSnapshot {
    id: string
    name: string
    /** 外貌白描：角色图的主体描述，缺失时只拼姓名 */
    appearance?: string
    /** 身份 / 职业：补足画面语义 */
    identity?: string
    /** 性别：人像的硬约束，只在 male / female 时拼入 */
    gender?: 'male' | 'female'
    /** 年龄：自由文本，缺失或「未知」时不拼 */
    age?: string
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

/** 性别文案：只在已知时拼入，避免把「未知」写成外貌 */
const GENDER_LABELS: Readonly<Record<'male' | 'female', string>> = {
    male: '男性',
    female: '女性',
}

/**
 * 角色段：姓名 + 性别年龄 + 身份 + 外貌，空项跳过。
 * 关键约束：每项独立成行，便于模型区分「外形硬约束」与「气质描述」；字段全部取自人物卡，此处不做推断。
 */
function composeCharacterSection(character: PromptCharacterSnapshot): string {
    const lines = [`角色：${character.name}`]
    const profile = [character.gender === undefined ? '' : GENDER_LABELS[character.gender], character.age ?? ''].filter(
        (part) => part.length > 0,
    )
    if (profile.length > 0) {
        lines.push(`外形：${profile.join('，')}`)
    }
    if (character.identity !== undefined && character.identity.length > 0) {
        lines.push(`身份：${character.identity}`)
    }
    if (character.appearance !== undefined && character.appearance.length > 0) {
        lines.push(`外貌：${character.appearance}`)
    }
    return lines.join('\n')
}

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

    const richInputRef = useRef<RichChipInputHandle | null>(null)

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

    /** 芯片 id 即 kind：芯片集合按 kind 唯一 */
    const removeChip = (id: string): void => {
        setChips((current) => current.filter((chip) => chip.kind !== id))
    }

    /** 把词条插入光标处：保留已有内容，插入后光标停在片段末尾，便于连续点击累加 */
    const insertPrompt = (fragment: string): void => {
        richInputRef.current?.insertText(fragment)
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
                sections.push(composeCharacterSection(character))
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

    /** 芯片渲染项：id 取 kind（同一 kind 只允许一枚），图标按类型区分 */
    const richChips = chips.map((chip) => ({
        id: chip.kind,
        label: chip.label,
        icon:
            chip.kind === 'character' ? (
                <UserRound className="size-3 shrink-0 text-muted-foreground" />
            ) : chip.kind === 'setting' ? (
                <Sparkles className="size-3 shrink-0 text-muted-foreground" />
            ) : undefined,
    }))

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
                    <RichChipInput
                        ref={richInputRef}
                        value={text}
                        chips={richChips}
                        placeholder="描述画面：人物、动作、场景、光线与氛围…"
                        canSend={buildPrompt().length > 0}
                        className="max-h-40 min-h-17 w-full overflow-y-auto whitespace-pre-wrap wrap-break-word text-sm leading-5 outline-none"
                        onChange={setText}
                        onSend={() => {
                            void handleSend()
                        }}
                        onRemoveChip={removeChip}
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
