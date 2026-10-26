/**
 * 生图输入卡片：命令动作、角色与词条以芯片内联在正文流中；画风在底部操作行点选，与比例同处一行。
 * 复用约定：外壳沿用 aichat 的两层底色（bg-composer / bg-composer-input），输入区取 RichChipInput，
 * 工具栏与底部操作行取本目录 ImageComposerToolbar / ImageComposerActions；提示词拼装与比例探测
 * 取 ../prompt 下的纯函数，芯片集合与会话状态分别由 ../hooks 的 usePromptChips / useImageComposer 持有。
 * 关键约束：角色芯片是角色选择的唯一数据源——选择器选中即挂「图标 + 姓名」徽标，移除即回到不使用角色，
 * 生成目标与增强时的角色段都由它派生；顶栏筛选的角色只作初值，之后不与其联动；
 * 词条芯片只承载「选了哪些词条」，文本不写进正文，由宿主在出图时按标识换取后并入提示词；
 * 生成意图只有两种：挂着角色芯片即角色图，否则是普通图片；生成不碰作品封面，封面在图库里手动指定；
 * 比例与画风各只落一份 state，手动改动经 onSettingsChange 上报，正文里的比例字面量只自动切换
 * 本次会话的选择、不写回作品配置。
 * 参数未读完只渲染同高占位，读完才挂载正文，确保正文内 state 以真实参数初始化。
 */
import { BookText, ContactRound, WandSparkles } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Skeleton } from '@components/ui/skeleton'
import type { ImageGenerateKind, ImageGenerateResult, ImageRatio } from '@shared/types/imagegen'
import type { PortraitStyle } from '@shared/types/press'
import { RichChipInput } from '@webview/components/RichChipInput'
import { ImageComposerActions } from './ImageComposerActions'
import { ImageComposerToolbar } from './ImageComposerToolbar'
import type { LucideIcon } from 'lucide-react'
import type { JSX } from 'react'
import { useImageComposer } from '../hooks/useImageComposer'
import { usePromptChips, type PromptChip, type PromptChipKind } from '../hooks/usePromptChips'
import {
    composePromptSections,
    type PromptCharacterSnapshot,
    type PromptSettingSnapshot,
} from '../prompt/promptSections'
import { detectImageRatio } from '../prompt/ratioIntent'

export type { PromptCharacterSnapshot, PromptSettingSnapshot }

/** 芯片前置图标：与工具栏各入口的图标保持一致，人物卡与设定语义由图标表达 */
const CHIP_ICONS: Readonly<Record<PromptChipKind, LucideIcon>> = {
    setting: BookText,
    character: ContactRound,
    prompt: WandSparkles,
}

interface ImageComposerProps {
    dirPath: string
    characters: ReadonlyArray<PromptCharacterSnapshot>
    setting: PromptSettingSnapshot
    /** 初始角色：顶栏筛选值只作角色芯片的初值，之后以工具栏角色菜单的选择为准 */
    initialCharacterId: string | null
    /** 初始比例与画风：来自作品级配置，缺省项由页面回落到默认值 */
    defaultRatio: ImageRatio
    /** 角色图与普通图默认画风 */
    defaultStyle: PortraitStyle
    /** 比例与画风改动：由页面写入作品配置，本组件只负责上报 */
    onSettingsChange: (patch: { defaultRatio?: ImageRatio; portraitStyle?: PortraitStyle }) => void
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
    initialCharacterId,
    defaultRatio,
    defaultStyle,
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
            initialCharacterId={initialCharacterId}
            defaultRatio={defaultRatio}
            defaultStyle={defaultStyle}
            onSettingsChange={onSettingsChange}
            onGenerated={onGenerated}
            onLateGenerated={onLateGenerated}
            onGeneratingChange={onGeneratingChange}
        />
    )
}

/** 正文卡片：参数就绪后挂载，持有比例、画风等作品相关选择，其余会话状态在 useImageComposer 内 */
function ComposerBody({
    dirPath,
    characters,
    setting,
    initialCharacterId,
    defaultRatio,
    defaultStyle,
    onSettingsChange,
    onGenerated,
    onLateGenerated,
    onGeneratingChange,
}: ComposerBodyProps): JSX.Element {
    const [ratio, setRatio] = useState<ImageRatio>(defaultRatio)
    /** 当前画风：不再以芯片展示，只作为请求参数，发送时由宿主并入提示词 */
    const [style, setStyle] = useState<PortraitStyle>(defaultStyle)
    /** 上次探测到的比例意图：只比较前后两次探测结果，同一关键字持续存在时不重复切 */
    const detectedRatioRef = useRef<ImageRatio | null>(null)

    /** 初始角色：只用于给芯片落初值，之后顶栏再改筛选也不改写会话内的选择 */
    const initialCharacter = useMemo(
        () => characters.find((character) => character.id === initialCharacterId) ?? null,
        [characters, initialCharacterId],
    )

    const {
        chips,
        settingChip,
        characterChip,
        promptChips,
        toggleSetting,
        setCharacter,
        togglePrompt,
        removeChip,
        clearChips,
        restoreChips,
    } = usePromptChips({ initialCharacter })

    /** 当前角色：由角色芯片派生，芯片被移除即视为不使用角色，不另落一份 state */
    const activeCharacter = useMemo(
        () =>
            characterChip === null
                ? null
                : (characters.find((character) => character.id === characterChip.value) ?? null),
        [characters, characterChip],
    )

    /** 生成意图：挂着角色芯片即角色图，否则是普通图片 */
    const targetKind: ImageGenerateKind = activeCharacter === null ? 'photo' : 'portrait'

    /**
     * 拼装提示词：芯片只承载「引用意图」，正文、角色段与设定段在发送瞬间合成。
     * 关键约束：设定段只在作品设定芯片存在时并入；角色段按芯片指向的人物实时查快照。
     */
    const composePrompt = (source: { text: string; chips: readonly PromptChip[] }): string => {
        const characterId = source.chips.find((chip) => chip.kind === 'character')?.value ?? null
        const character = characterId === null ? null : (characters.find((item) => item.id === characterId) ?? null)
        return composePromptSections({
            text: source.text,
            character,
            setting: source.chips.some((chip) => chip.kind === 'setting') ? setting : null,
        })
    }

    /**
     * 收集词条标识：词条文本不进正文，只把上游原文交给宿主换取。
     * 关键约束：顺序即芯片顺序，宿主按同一顺序并入提示词，选中多枚时画面元素的前后关系保持稳定。
     */
    const composePromptTags = (source: readonly PromptChip[]): string[] =>
        source.filter((chip) => chip.kind === 'prompt').map((chip) => chip.value)

    /** 随请求下发的目标：普通图不带角色，角色图才绑定角色芯片指向的人物 */
    const generateTarget = {
        kind: targetKind,
        characterId: targetKind === 'portrait' ? (activeCharacter?.id ?? null) : null,
    }

    /**
     * 增强源：把角色段并进待改写的正文，让模型知道角色长相与身份。
     * 关键约束：设定段仍不并（作品信息会让模型复述进正文）；
     * 结果回填后角色芯片保留，因此正文与角色段可能各出现一次同类信息，属于可接受的重复。
     */
    const composeEnhanceSource = (source: string): string =>
        composePromptSections({ text: source, character: activeCharacter, setting: null })

    const { text, setText, isGenerating, isEnhancing, enhancedFrom, onEnhance, onRestore, onSend, onAbort } =
        useImageComposer({
            dirPath,
            composePrompt,
            composePromptTags,
            composeEnhanceSource,
            target: generateTarget,
            ratio,
            style,
            chips,
            onClearChips: clearChips,
            onRestoreChips: restoreChips,
            onGenerated,
            onLateGenerated,
            onGeneratingChange,
        })

    /** 能否发送：正文、角色段与设定段任一有内容，或至少挂了一枚词条芯片，输入框与发送按钮共用同一判定 */
    const canSend = composePrompt({ text, chips }).length > 0 || promptChips.length > 0

    /** 选画风：只记 state 并写回作品配置，输入框不出现徽标，发送时才随请求并入提示词 */
    const pickStyle = (value: PortraitStyle): void => {
        setStyle(value)
        onSettingsChange({ portraitStyle: value })
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

    /** 芯片渲染项：id 由 hook 保证唯一（设定与角色按 kind，词条按上游原文），图标与各入口保持一致 */
    const richChips = chips.map((chip) => {
        const Icon = CHIP_ICONS[chip.kind]
        return {
            id: chip.id,
            label: chip.label,
            icon: <Icon className="size-3 shrink-0 text-muted-foreground" />,
        }
    })

    return (
        <div className="flex flex-col gap-0.5 rounded-2xl bg-composer p-1.5">
            <ImageComposerToolbar
                isSettingActive={settingChip !== null}
                characters={characters}
                activeCharacterId={activeCharacter?.id ?? null}
                selectedPrompts={promptChips.map((chip) => chip.value)}
                onToggleSetting={toggleSetting}
                onSelectCharacter={setCharacter}
                onTogglePrompt={togglePrompt}
            />

            <div className="rounded-xl bg-composer-input p-3">
                <RichChipInput
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
