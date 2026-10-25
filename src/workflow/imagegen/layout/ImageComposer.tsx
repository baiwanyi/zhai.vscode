/**
 * 生图输入卡片：命令动作与角色以芯片内联在正文流中；画风在底部操作行点选，与比例同处一行。
 * 复用约定：外壳沿用 aichat 的两层底色（bg-composer / bg-composer-input），输入区取 RichChipInput，
 * 工具栏与底部操作行取本目录 ImageComposerToolbar / ImageComposerActions；提示词拼装、比例探测与词条插入
 * 取 ../prompt 下的纯函数，芯片集合与会话状态分别由 ../hooks 的 usePromptChips / useImageComposer 持有。
 * 关键约束：比例与画风各只落一份 state，手动改动经 onSettingsChange 上报，正文里的比例字面量只自动切换
 * 本次会话的选择、不写回作品配置；封面画风与普通出图分开存，切换模式时换用对应一侧、改动写回各自配置。
 * 参数未读完只渲染同高占位，读完才挂载正文，确保正文内 state 以真实参数初始化。
 */
import { Sparkles, UserRound } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Skeleton } from '@components/ui/skeleton'
import type { ImageGenerateKind, ImageGenerateResult, ImageRatio } from '@shared/types/imagegen'
import type { PortraitStyle } from '@shared/types/press'
import { RichChipInput, type RichChipInputHandle } from '@webview/components/RichChipInput'
import { ImageComposerActions } from './ImageComposerActions'
import { ImageComposerToolbar } from './ImageComposerToolbar'
import type { JSX } from 'react'
import { useImageComposer } from '../hooks/useImageComposer'
import { usePromptChips, type PromptChip } from '../hooks/usePromptChips'
import { composeInsertion } from '../prompt/insertFragment'
import {
    composePromptSections,
    type PromptCharacterSnapshot,
    type PromptSettingSnapshot,
} from '../prompt/promptSections'
import { detectImageRatio } from '../prompt/ratioIntent'

export type { PromptCharacterSnapshot, PromptSettingSnapshot }

interface ImageComposerProps {
    dirPath: string
    characters: ReadonlyArray<PromptCharacterSnapshot>
    setting: PromptSettingSnapshot
    /** 顶栏选中的角色：既是生成目标，也是角色徽标的来源 */
    activeCharacterId: string | null
    /** 初始比例与画风：来自作品级配置，缺省项由页面回落到默认值 */
    defaultRatio: ImageRatio
    /** 普通/角色图默认画风 */
    defaultStyle: PortraitStyle
    /** 封面画风：与普通出图各记一套，切换封面模式时自动换用 */
    coverStyle: PortraitStyle
    /** 比例与画风改动：由页面写入作品配置，本组件只负责上报 */
    onSettingsChange: (patch: {
        defaultRatio?: ImageRatio
        portraitStyle?: PortraitStyle
        coverStyle?: PortraitStyle
    }) => void
    /** 生成成功后的回调：由页面负责插入列表并刷新 */
    onGenerated: (result: ImageGenerateResult) => void
    /** 迟到落盘的回调：请求已取消或被取代但宿主仍出了图，页面只静默刷新列表，不认领封面等副作用 */
    onLateGenerated: () => void
    /**
     * 生成中状态上报：页面据此在列表首位挂骨架占位。
     * 成功、失败、取消、超时都会经过 setIsGenerating(false)，卸载时再补发一次，页面不会停在占位上。
     */
    onGeneratingChange?: (isGenerating: boolean) => void
    /** 作品参数是否已读到：false 时只渲染同高占位，读完才挂载正文 */
    isLoaded: boolean
}

/** 正文入参：正文只在参数读完后挂载，自身不需要感知加载状态 */
type ComposerBodyProps = Omit<ImageComposerProps, 'isLoaded'>

/** 占位高度：与正文卡片一致，读完前后底部输入区不发生高度跳动 */
const PLACEHOLDER_CLASS = 'h-32 w-full rounded-2xl'

/**
 * 生图输入卡片入口：作品参数未读完时只渲染同高占位，读完才挂载正文。
 * 关键约束：正文中的比例、画风等 state 以 props 初值初始化，必须等真实参数到位再挂载，
 * 否则会先按默认值落一份状态，读完也不会被 props 改写，界面与实际配置就此不一致。
 */
export function ImageComposer({
    isLoaded,
    dirPath,
    characters,
    setting,
    activeCharacterId,
    defaultRatio,
    defaultStyle,
    coverStyle,
    onSettingsChange,
    onGenerated,
    onLateGenerated,
    onGeneratingChange,
}: ImageComposerProps): JSX.Element {
    if (!isLoaded) {
        return (
            <div className="p-2">
                <Skeleton className={PLACEHOLDER_CLASS} />
            </div>
        )
    }

    return (
        <ComposerBody
            dirPath={dirPath}
            characters={characters}
            setting={setting}
            activeCharacterId={activeCharacterId}
            defaultRatio={defaultRatio}
            defaultStyle={defaultStyle}
            coverStyle={coverStyle}
            onSettingsChange={onSettingsChange}
            onGenerated={onGenerated}
            onLateGenerated={onLateGenerated}
            onGeneratingChange={onGeneratingChange}
        />
    )
}

/** 正文卡片：参数就绪后挂载，持有比例、画风、封面模式等作品相关选择，其余会话状态在 useImageComposer 内 */
function ComposerBody({
    dirPath,
    characters,
    setting,
    activeCharacterId,
    defaultRatio,
    defaultStyle,
    coverStyle,
    onSettingsChange,
    onGenerated,
    onLateGenerated,
    onGeneratingChange,
}: ComposerBodyProps): JSX.Element {
    /** 封面模式：生成结果落统一图库并自动设为作品封面，与角色图互斥 */
    const [isCoverMode, setIsCoverMode] = useState(false)
    const [ratio, setRatio] = useState<ImageRatio>(defaultRatio)
    /** 当前画风：不再以芯片展示，只作为请求参数，发送时由宿主并入提示词 */
    const [style, setStyle] = useState<PortraitStyle>(defaultStyle)
    /** 上次探测到的比例意图：只比较前后两次探测结果，同一关键字持续存在时不重复切 */
    const detectedRatioRef = useRef<ImageRatio | null>(null)

    const richInputRef = useRef<RichChipInputHandle | null>(null)

    const activeCharacter = useMemo(
        () => characters.find((character) => character.id === activeCharacterId) ?? null,
        [characters, activeCharacterId],
    )

    const {
        chips,
        settingChip,
        characterChip,
        toggleSetting,
        toggleCharacter,
        ensureSetting,
        removeChip,
        clearChips,
        restoreChips,
    } = usePromptChips({ activeCharacter })

    /** 生成目标：封面模式优先，其次按顶栏是否选中角色区分角色图与普通图 */
    let targetKind: ImageGenerateKind = 'photo'
    if (isCoverMode) {
        targetKind = 'cover'
    } else if (activeCharacter !== null) {
        targetKind = 'portrait'
    }

    /**
     * 拼装提示词：芯片只承载「引用意图」，正文、角色段与设定段在发送瞬间合成。
     * 关键约束：封面不绑定角色，即使还挂着角色徽标也不并入；设定段只在作品设定芯片存在时并入。
     */
    const composePrompt = (source: { text: string; chips: readonly PromptChip[] }): string => {
        const characterId = source.chips.find((chip) => chip.kind === 'character')?.value ?? null
        const character =
            isCoverMode || characterId === null ? null : (characters.find((item) => item.id === characterId) ?? null)
        return composePromptSections({
            text: source.text,
            character,
            setting: source.chips.some((chip) => chip.kind === 'setting') ? setting : null,
        })
    }

    /** 随请求下发的目标：封面与普通图不带角色，角色图才绑定顶栏选中的角色 */
    const generateTarget = {
        kind: targetKind,
        characterId: targetKind === 'portrait' ? (activeCharacter?.id ?? null) : null,
    }

    const { text, setText, isGenerating, isEnhancing, enhancedFrom, onEnhance, onRestore, onSend, onAbort } =
        useImageComposer({
            dirPath,
            composePrompt,
            target: generateTarget,
            ratio,
            style,
            chips,
            onClearChips: clearChips,
            onRestoreChips: restoreChips,
            onGenerated: (result) => {
                onGenerated(result)
                // 封面是一次性动作：成功即退出封面模式，回到普通出图
                if (isCoverMode) {
                    setIsCoverMode(false)
                    toast.success('作品封面已更新')
                }
            },
            onLateGenerated,
            onGeneratingChange,
        })

    /** 能否发送：正文、角色段与设定段任一有内容即可，输入框与发送按钮共用同一判定 */
    const canSend = composePrompt({ text, chips }).length > 0

    /**
     * 封面模式：与角色图互斥；切换时画风换用对应一侧的作品配置（封面画风与普通出图分开记），
     * 进入时顺带挂上作品设定，避免空提示词无法发送。
     */
    const toggleCoverMode = (): void => {
        const willEnable = !isCoverMode
        setIsCoverMode(willEnable)
        setStyle(willEnable ? coverStyle : defaultStyle)
        if (willEnable) {
            ensureSetting()
        }
    }

    /** 选画风：只记 state 并写回作品配置，输入框不出现徽标，发送时才随请求并入提示词 */
    const pickStyle = (value: PortraitStyle): void => {
        setStyle(value)
        onSettingsChange(isCoverMode ? { coverStyle: value } : { portraitStyle: value })
    }

    /** 切换比例并记住：作品级配置随作品走，下次打开沿用 */
    const handleRatioChange = (value: ImageRatio): void => {
        setRatio(value)
        onSettingsChange({ defaultRatio: value })
    }

    /**
     * 正文变化：写入文本，并在比例意图「刚出现或刚变化」时自动切换比例。
     * 关键约束：只比较前后两份探测结果——否则用户手动改完比例，随手再打一个字就会被打回关键字那一档；
     * 自动切换只改本次会话的比例选择，不写回作品配置，免得一句话把作品默认比例永久改掉。
     */
    const handleTextChange = (next: string): void => {
        const detected = detectImageRatio(next)
        setText(next)
        if (detected !== null && detected !== detectedRatioRef.current) {
            setRatio(detected)
        }
        detectedRatioRef.current = detected
    }

    /** 把词条插入光标处：保留已有内容，插入后光标停在片段末尾，便于连续点击累加 */
    const insertPrompt = (fragment: string): void => {
        richInputRef.current?.insertText(composeInsertion(text, fragment))
    }

    /** 芯片渲染项：id 取 kind（同一 kind 只允许一枚），图标按类型区分 */
    const richChips = chips.map((chip) => ({
        id: chip.kind,
        label: chip.label,
        icon:
            chip.kind === 'character' ? (
                <UserRound className="size-3 shrink-0 text-muted-foreground" />
            ) : (
                <Sparkles className="size-3 shrink-0 text-muted-foreground" />
            ),
    }))

    return (
        <div className="flex flex-col gap-0.5 rounded-2xl bg-composer p-1.5">
            <ImageComposerToolbar
                isSettingActive={settingChip !== null}
                isCharacterActive={characterChip !== null}
                isCoverMode={isCoverMode}
                isGenerating={isGenerating}
                canPickCharacter={activeCharacter !== null && !isCoverMode}
                onToggleSetting={toggleSetting}
                onToggleCharacter={toggleCharacter}
                onToggleCoverMode={toggleCoverMode}
                onInsertPrompt={insertPrompt}
            />

            <div className="rounded-xl bg-composer-input p-3">
                <RichChipInput
                    ref={richInputRef}
                    value={text}
                    chips={richChips}
                    placeholder="描述画面：人物、动作、场景、光线与氛围…"
                    canSend={canSend}
                    className="max-h-40 min-h-17 w-full overflow-y-auto whitespace-pre-wrap wrap-break-word text-sm leading-5 outline-none"
                    onChange={handleTextChange}
                    onSend={onSend}
                    onRemoveChip={removeChip}
                />
                <ImageComposerActions
                    ratio={ratio}
                    style={style}
                    isCoverMode={isCoverMode}
                    isGenerating={isGenerating}
                    isEnhancing={isEnhancing}
                    isEnhanced={enhancedFrom !== null}
                    canEnhance={!isEnhancing && !isGenerating && text.trim().length > 0}
                    canSend={canSend}
                    onRatioChange={handleRatioChange}
                    onStyleChange={pickStyle}
                    onEnhance={onEnhance}
                    onRestore={onRestore}
                    onSend={onSend}
                    onAbort={onAbort}
                />
            </div>
        </div>
    )
}
