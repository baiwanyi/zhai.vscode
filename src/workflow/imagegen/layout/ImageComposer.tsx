/**
 * 生图输入卡片：上下文、参考图、角色、词条与规则以芯片内联在正文流中；画风在底部操作行点选，与比例同处一行。
 * 复用约定：外壳沿用 aichat 的两层底色（bg-composer / bg-composer-input），输入区取 RichChipInput，
 * 工具栏与底部操作行取本目录 ImageComposerToolbar / ImageComposerActions；提示词拼装与比例探测
 * 取 ../prompt 下的纯函数，芯片集合与会话状态分别由 ../hooks 的 usePromptChips / useImageComposer 持有。
 * 关键约束：角色芯片是角色选择的唯一数据源——选择器选中即挂「图标 + 姓名」徽标，移除即回到不使用角色，
 * 生成目标与增强时的角色段都由它派生；顶栏筛选的角色只作初值，之后不与其联动；
 * 参考图芯片挂「缩略图 + 文件名」徽标，悬停文件名预览大图，只带宿主回传的路径与预览地址；
 * 词条芯片只承载「选了哪些词条」，规则芯片只承载「选了哪些规则」，「添加上下文」里的作品设定展开为上下文段；
 * 四者都不写进输入框，随请求的 contexts / referenceImages / promptTags / promptRules 提交，由宿主在出图时按段并入；
 * 生成意图只有两种：挂着角色芯片即角色图，否则是普通图片；生成不碰作品封面，封面在图库里手动指定；
 * 比例与画风各只落一份 state，手动改动经 onSettingsChange 上报，正文里的比例字面量只自动切换
 * 本次会话的选择、不写回作品配置。
 * 生成中外扩一圈光晕取 @webview/components/ComposerGlow（与对话页共用，样式在 globals.css 的 composer-glow 段），
 * 它挂在卡片外侧的兄弟层上——卡片底色不透明，移进卡片内部就会被盖住，装饰层不得承载任何状态或交互；
 * 参数未读完只渲染同高占位，读完才挂载正文，确保正文内 state 以真实参数初始化。
 */
import { BookText, ContactRound, PencilRuler, WandSparkles } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Skeleton } from '@components/ui/skeleton'
import type { ImageGenerateKind, ImageGenerateResult, ImageRatio } from '@shared/types/imagegen'
import type { PortraitStyle } from '@shared/types/press'
import { ComposerGlow } from '@webview/components/ComposerGlow'
import { Image } from '@webview/components/Image'
import { RichChipInput, type RichChip } from '@webview/components/RichChipInput'
import { ImageComposerActions } from './ImageComposerActions'
import { ImageComposerToolbar } from './ImageComposerToolbar'
import type { LucideIcon } from 'lucide-react'
import type { JSX } from 'react'
import { useImageComposer } from '../hooks/useImageComposer'
import { usePromptChips, type PromptChip, type PromptChipKind } from '../hooks/usePromptChips'
import {
    composePromptSections,
    composeSettingContext,
    type PromptCharacterSnapshot,
    type PromptSettingSnapshot,
} from '../prompt/promptSections'
import { detectImageRatio } from '../prompt/ratioIntent'

export type { PromptCharacterSnapshot, PromptSettingSnapshot }

/** 参考图上限：与宿主读取上限一致，达到后按钮禁用，避免挂上却被宿主丢弃 */
const MAX_REFERENCE_IMAGES = 3

/** 芯片前置图标：与工具栏各入口的图标保持一致，人物卡、设定与规则语义由图标表达；参考图改用缩略图 */
const CHIP_ICONS: Readonly<Record<Exclude<PromptChipKind, 'reference'>, LucideIcon>> = {
    setting: BookText,
    character: ContactRound,
    prompt: WandSparkles,
    rule: PencilRuler,
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
        ruleChips,
        referenceChips,
        toggleSetting,
        setCharacter,
        togglePrompt,
        renamePrompt,
        removePrompt,
        toggleRule,
        renameRule,
        removeRule,
        addReference,
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
     * 拼装提示词正文：芯片只承载「引用意图」，正文与角色段在发送瞬间合成。
     * 关键约束：角色段按芯片指向的人物实时查快照；作品设定不进正文，由下面的 composeContexts 单独提交。
     */
    const composePrompt = (source: { text: string; chips: readonly PromptChip[] }): string => {
        const characterId = source.chips.find((chip) => chip.kind === 'character')?.value ?? null
        const character = characterId === null ? null : (characters.find((item) => item.id === characterId) ?? null)
        return composePromptSections({ text: source.text, character })
    }

    /**
     * 收集上下文段：「添加上下文」菜单挂上的内容作为背景随请求提交，不写进正文。
     * 关键约束：设定段只在作品设定芯片存在时展开，空设定不占位；顺序即芯片顺序。
     */
    const composeContexts = (source: readonly PromptChip[]): string[] => {
        if (!source.some((chip) => chip.kind === 'setting')) {
            return []
        }
        const context = composeSettingContext(setting)
        return context.length > 0 ? [context] : []
    }

    /**
     * 收集词条标识：词条文本不进正文，只把「分类::分组::名称」交给宿主回查 md。
     * 关键约束：顺序即芯片顺序，宿主按同一顺序并入提示词，选中多枚时画面元素的前后关系保持稳定；
     * 词条被改名或删除时由芯片侧同步，本函数只做取值，不校验存在性。
     */
    const composePromptTags = (source: readonly PromptChip[]): string[] =>
        source.filter((chip) => chip.kind === 'prompt').map((chip) => chip.value)

    /**
     * 收集规则标识：规则正文留在磁盘，只把文件名主干交给宿主读取。
     * 关键约束：顺序即芯片顺序，宿主按同一顺序并入提示词，多条规则之间的先后关系保持稳定。
     */
    const composePromptRules = (source: readonly PromptChip[]): string[] =>
        source.filter((chip) => chip.kind === 'rule').map((chip) => chip.value)

    /**
     * 收集参考图路径：路径由宿主选择流程产出并登记，前端只按芯片顺序回传。
     * 关键约束：图片字节不进前端请求，宿主据此读取并作为多模态输入提交。
     */
    const composeReferenceImages = (source: readonly PromptChip[]): string[] =>
        source.filter((chip) => chip.kind === 'reference').map((chip) => chip.value)

    /** 随请求下发的目标：普通图不带角色，角色图才绑定角色芯片指向的人物 */
    const generateTarget = {
        kind: targetKind,
        characterId: targetKind === 'portrait' ? (activeCharacter?.id ?? null) : null,
        characterName: targetKind === 'portrait' ? (activeCharacter?.name ?? null) : null,
    }

    /**
     * 增强源：把角色段并进待改写的正文，让模型知道角色长相与身份。
     * 关键约束：设定段仍不并（作品信息会让模型复述进正文）；
     * 结果回填后角色芯片保留，因此正文与角色段可能各出现一次同类信息，属于可接受的重复。
     */
    const composeEnhanceSource = (source: string): string =>
        composePromptSections({ text: source, character: activeCharacter })

    /**
     * 增强后回收词条芯片：词条原文已随改写结果进入正文，保留会被宿主在发送时二次合并。
     * 关键约束：只摘词条，角色、设定、规则与参考图仍归用户控制；还原时由 hook 用快照补回。
     */
    const consumePromptChips = (): void => {
        promptChips.forEach((chip) => {
            removeChip(chip.id)
        })
    }

    const { text, setText, isGenerating, stage, isEnhancing, enhancedFrom, onEnhance, onRestore, onSend, onAbort } =
        useImageComposer({
            dirPath,
            composePrompt,
            composeContexts,
            composePromptTags,
            composePromptRules,
            composeReferenceImages,
            composeEnhanceSource,
            onConsumePromptChips: consumePromptChips,
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

    /** 能否发送：正文或角色段有内容，或挂了上下文 / 参考图 / 词条 / 规则芯片，输入框与发送按钮共用同一判定 */
    const canSend =
        composePrompt({ text, chips }).length > 0 ||
        composeContexts(chips).length > 0 ||
        referenceChips.length > 0 ||
        promptChips.length > 0 ||
        ruleChips.length > 0

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

    /**
     * 芯片渲染项：id 由 hook 保证唯一（设定与角色按 kind，词条按上游原文，参考图按磁盘路径）。
     * 参考图用缩略图代替前置图标，并把预览地址交给输入区做悬停大图。
     */
    const richChips = chips.map((chip): RichChip => {
        if (chip.kind === 'reference') {
            const previewUrl = chip.previewUrl
            return {
                id: chip.id,
                label: chip.label,
                icon: <Image src={previewUrl} alt={chip.label} size="sm" className="size-3.5 shrink-0 object-cover" />,
                ...(previewUrl === undefined ? {} : { preview: { src: previewUrl, alt: chip.label } }),
            }
        }
        const Icon = CHIP_ICONS[chip.kind]
        return {
            id: chip.id,
            label: chip.label,
            icon: <Icon className="size-3 shrink-0 text-muted-foreground" />,
        }
    })

    return (
        // isolate 给光晕划定层叠边界：-z-10 只在卡片之下，不会沉到页面背景后面
        <div className="relative isolate flex-1">
            <ComposerGlow isGenerating={isGenerating} />

            <div className="flex flex-col gap-0.5 rounded-2xl bg-composer p-1.5">
                <ImageComposerToolbar
                    isSettingActive={settingChip !== null}
                    isReferenceFull={referenceChips.length >= MAX_REFERENCE_IMAGES}
                    characters={characters}
                    activeCharacterId={activeCharacter?.id ?? null}
                    selectedPrompts={promptChips.map((chip) => chip.value)}
                    selectedRules={ruleChips.map((chip) => chip.value)}
                    onToggleSetting={toggleSetting}
                    onSelectCharacter={setCharacter}
                    onTogglePrompt={togglePrompt}
                    onRenamePrompt={renamePrompt}
                    onRemovePrompt={removePrompt}
                    onToggleRule={toggleRule}
                    onRenameRule={renameRule}
                    onRemoveRule={removeRule}
                    onPickReference={addReference}
                />

                <div className="rounded-xl bg-composer-input p-3">
                    <RichChipInput
                        value={text}
                        chips={richChips}
                        placeholder="描述画面：人物、动作、场景、光线与氛围…"
                        canSend={canSend}
                        onChange={handleTextChange}
                        onSend={onSend}
                        onRemoveChip={removeChip}
                    />
                    <ImageComposerActions
                        ratio={ratio}
                        style={style}
                        isGenerating={isGenerating}
                        stage={stage}
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
        </div>
    )
}
