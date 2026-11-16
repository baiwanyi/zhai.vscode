/**
 * AI 对话底部输入卡片：按 AppComposer 骨架拼装顶栏工具行、富文本输入区与底部操作行。
 * 复用约定：外壳取 @webview/components/AppComposer 族（双层底色、生成态光晕与分层留白均由骨架承担），
 * 顶栏 / 操作行取同目录 AiChatComposerToolbar 与 AiChatComposerActions，富文本输入取 RichChipInput；
 * 命令与上下文在此折算为 RichChip：图标取 ./commandIcons，文件名与摘要取 ../utils。
 * 本层负责提示文案、禁用态与增强状态，可发送判定取 ../utils 的 resolveSendGate（与页面层同口径）。
 * 关键约束：输入卡片不读会话状态，上下文、写入范围、用量、命令与模型控制均由此层透传；
 * sending 与等待连续生成授权都按锁定态处理（前者给停止入口，后者不给），避免等待期的改动在确认发送后被清空；
 * 粘贴内容里的 `@zhai\` 路径改由宿主添加为上下文引用（成功即变成芯片），只有剩余文本落回输入区；
 * 命令芯片的移除语义是「取消命令」，由 chip.onRemove 承担，不走统一的移除引用回调；
 * 操作行是 AppComposerFooter 的唯一子项，须带 flex-1 才能让左右两组分别贴住两侧。
 */
import { FileText, Loader2, TextSelect } from 'lucide-react'
import { useRef, useState } from 'react'
import type { AiContextRef, AiContextUsage, AiWriteGrant } from '@shared/types/aiChat'
import { readZhaiTargets, toZhaiDisplayPath } from '@shared/utils/zhaiPath'
import {
    AppComposer,
    AppComposerContent,
    AppComposerFooter,
    AppComposerHeader,
} from '@webview/components/AppComposer'
import { RichChipInput, type RichChip, type RichChipInputHandle } from '@webview/components/RichChipInput'
import { AiChatComposerActions } from './AiChatComposerActions'
import { AiChatComposerToolbar } from './AiChatComposerToolbar'
import { COMMAND_ICONS } from './commandIcons'
import type { AiCommand, AiReferenceAction } from '../constants'
import type { AiPastedRefTarget } from '../hooks/useAiChatMention'
import type { AiChatModelControl } from '../hooks/useAiChatModelControl'
import type { Phase } from '../hooks/useAiChatSession'
import type { ClipboardEvent, JSX } from 'react'
import { describeContext, describeTool, resolveSendGate, toContextFileName, toContextLineRange } from '../utils'

/** 命令芯片的保留 id：只用于 React key 与退格查找，移除语义由 onRemove 承担 */
const COMMAND_CHIP_ID = 'ai-command'

/** 命令芯片：图标取命令表，移除按钮即「取消命令」 */
function buildCommandChip(command: AiCommand, onClearCommand: () => void): RichChip {
    const Icon = COMMAND_ICONS[command.id]
    return {
        id: COMMAND_CHIP_ID,
        label: command.title,
        icon: <Icon className="size-3 shrink-0 text-muted-foreground" />,
        badgeClassName: 'max-w-40',
        removeLabel: '取消命令',
        onRemove: onClearCommand,
    }
}

/**
 * 粘贴的路径引用：逐个交给宿主添加，成功的令牌从文本中剥离，失败的留在正文里让用户看得见。
 * 关键约束：剥离按原始位置切片，令牌之外的空格与换行尽量保留；全部成功时返回空串。
 */
async function consumeZhaiTokens(
    text: string,
    matches: ReturnType<typeof readZhaiTargets>,
    addRef: (target: AiPastedRefTarget) => Promise<boolean>,
): Promise<string> {
    const handled: typeof matches = []
    for (const match of matches) {
        if (await addRef(match.target)) {
            handled.push(match)
        }
    }
    if (handled.length === 0) {
        return text
    }
    let rest = ''
    let cursor = 0
    for (const match of handled) {
        rest += text.slice(cursor, match.index)
        cursor = match.index + match.token.length
    }
    return `${rest}${text.slice(cursor)}`.replace(/[ \t]{2,}/gu, ' ').trim()
}

/** 上下文芯片：文件名悬停出 @zhai 存储根路径，尾部给字数 / 行数摘要，移除走页面回调 */
function buildContextChip(context: AiContextRef): RichChip {
    return {
        id: context.id,
        label: toContextFileName(context),
        tail: toContextLineRange(context),
        icon:
            context.kind === 'selection' ? (
                <TextSelect className="size-3 shrink-0 text-muted-foreground" />
            ) : (
                <FileText className="size-3 shrink-0 text-muted-foreground" />
            ),
        hint: toZhaiDisplayPath(context.displayPath),
        meta: describeContext(context),
        removeLabel: '移除该引用',
    }
}

interface AiChatComposerProps {
    /** 已添加的上下文引用：以内联芯片呈现在输入区首行 */
    contexts: AiContextRef[]
    input: string
    setInput: (input: string) => void
    hasApiKey: boolean
    /** 视图阶段：sending 待首字、streaming 逐字生成，两者都禁止再次发送 */
    phase: Phase
    /** 写入授权范围 */
    writeGrant: AiWriteGrant
    onWriteGrantChange: (grant: AiWriteGrant) => void
    /** 正在调用的工具名：null 表示当前没有工具执行 */
    activeTool: string | null
    /** 当前会话上下文占用：null 表示本轮还没有产出数据 */
    contextUsage: AiContextUsage | null
    /** 当前模型的上下文窗口：会话尚无占用数据时作为圆环分母 */
    contextWindowTokens: number
    /** 是否存在可写范围：编辑器目标或已绑定作品目录（连续生成章节无需选区） */
    hasWritableScope: boolean
    /** 连续生成授权等待确认：输入区与发送一并锁住，避免确认发送时清掉这期间新写的内容 */
    isAwaitingApproval: boolean
    /** 模型控制：当前值、展示名、菜单数据与四个选择动作，由 useAiChatModelControl 统一提供 */
    modelControl: AiChatModelControl
    /** 当前已选写作命令：输入区以芯片展示，指令模板不进入输入框 */
    command: AiCommand | null
    onSend: () => void
    onStop: () => void
    onRemoveContext: (id: string) => void
    onCommand: (command: AiCommand) => void
    onClearCommand: () => void
    onReference: (action: AiReferenceAction) => void
    /** 打开提及检索：引用笔记 / 章节 */
    onMention: () => void
    /** 增强请求进行中：按钮转圈并丢弃重复点击 */
    isEnhancing: boolean
    /** 增强请求：由页面 hook 走宿主协议，失败返回 null */
    onEnhanceRequest: (text: string) => Promise<string | null>
    /** 粘贴的 @zhai 引用：交给页面添加为上下文并返回是否成功；缺省时粘贴原样插入 */
    onAddZhaiRef?: (target: AiPastedRefTarget) => Promise<boolean>
}

export function AiChatComposer({
    contexts,
    input,
    setInput,
    hasApiKey,
    phase,
    writeGrant,
    onWriteGrantChange,
    activeTool,
    contextUsage,
    contextWindowTokens,
    hasWritableScope,
    isAwaitingApproval,
    modelControl,
    command,
    onSend,
    onStop,
    onRemoveContext,
    onCommand,
    onClearCommand,
    onReference,
    onMention,
    isEnhancing,
    onEnhanceRequest,
    onAddZhaiRef,
}: AiChatComposerProps): JSX.Element {
    /** 增强前的原文：非空表示当前输入处于增强态，可一键还原 */
    const [enhancedFrom, setEnhancedFrom] = useState<string | null>(null)
    /** 输入区句柄：粘贴引用后把剩余文本插回光标处 */
    const inputRef = useRef<RichChipInputHandle>(null)

    const canEnhance = input.trim().length > 0
    /**
     * 生成中：已提交待首字（sending）也算 —— 否则这段等待期既不能发送也没有停止入口；
     * 光晕与停止按钮都由此派生，避免与页面层重复持有同一状态。
     */
    const isGenerating = phase !== 'idle'
    /** 输入区与外层控件统一锁定：生成中，或正等一次连续生成授权 */
    const isLocked = isGenerating || isAwaitingApproval
    /** 可发送判定与页面层共用同一份纯函数，避免两处口径漂移；等待授权时一律禁止再发 */
    const canSend = resolveSendGate({ hasApiKey, phase, command, input, hasWritableScope }) && !isAwaitingApproval

    let placeholder = '提问或输入指令…'
    if (command !== null) {
        placeholder = `可补充「${command.title}」的要求，留空直接发送`
    }

    /** 芯片集合：命令在前、上下文按添加顺序随后，与输入区的展示顺序一致 */
    const chips: RichChip[] = [
        ...(command === null ? [] : [buildCommandChip(command, onClearCommand)]),
        ...contexts.map(buildContextChip),
    ]

    /** 手动输入或修改即退出增强态，避免还原时覆盖用户的新内容 */
    const handleInputChange = (value: string): void => {
        setEnhancedFrom(null)
        setInput(value)
    }

    /** 增强走后端改写：成功后记下原文供还原，失败由 hook 提示并保持原文 */
    const handleEnhance = (): void => {
        void onEnhanceRequest(input).then((next) => {
            if (next === null || next.length === 0 || next === input) {
                return
            }
            setEnhancedFrom(input)
            setInput(next)
        })
    }

    const handleUndoEnhance = (): void => {
        if (enhancedFrom === null) {
            return
        }
        setInput(enhancedFrom)
        setEnhancedFrom(null)
    }

    /** 粘贴拦截：命中 @zhai 路径时改由宿主添加为引用，剩余文本再插回输入区 */
    const handlePasteCapture = (event: ClipboardEvent<HTMLDivElement>): void => {
        if (onAddZhaiRef === undefined) {
            return
        }
        const text = event.clipboardData.getData('text/plain')
        if (!text.includes('@zhai')) {
            return
        }
        const matches = readZhaiTargets(text)
        if (matches.length === 0) {
            return
        }
        event.preventDefault()
        event.stopPropagation()
        void consumeZhaiTokens(text, matches, onAddZhaiRef).then((rest) => {
            if (rest.length > 0) {
                inputRef.current?.insertText(rest)
            }
        })
    }

    return (
        <AppComposer isGenerating={isGenerating}>
            <AppComposerHeader>
                <AiChatComposerToolbar
                    disabled={isLocked}
                    activeCommandId={command?.id ?? null}
                    onCommand={onCommand}
                    onReference={onReference}
                    onMention={onMention}
                />
            </AppComposerHeader>

            {/* 粘贴拦截挂在内层内容区上：芯片与正文都在这一层，拦截时机先于 RichChipInput 的默认粘贴 */}
            <AppComposerContent onPasteCapture={handlePasteCapture}>
                {activeTool === null ? null : (
                    <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Loader2 className="size-3 animate-spin" />
                        正在{describeTool(activeTool)}
                    </div>
                )}
                <RichChipInput
                    ref={inputRef}
                    value={input}
                    chips={chips}
                    placeholder={placeholder}
                    disabled={isLocked}
                    canSend={canSend}
                    onChange={handleInputChange}
                    onSend={onSend}
                    onRemoveChip={onRemoveContext}
                />

                <AppComposerFooter>
                    <AiChatComposerActions
                        className="flex-1"
                        writeGrant={writeGrant}
                        isGenerating={isGenerating}
                        isLocked={isLocked}
                        canSend={canSend}
                        canEnhance={canEnhance}
                        isEnhanced={enhancedFrom !== null}
                        isEnhancing={isEnhancing}
                        contextUsage={contextUsage}
                        contextWindowTokens={contextWindowTokens}
                        modelControl={modelControl}
                        onWriteGrantChange={onWriteGrantChange}
                        onEnhance={handleEnhance}
                        onUndoEnhance={handleUndoEnhance}
                        onSend={onSend}
                        onStop={onStop}
                    />
                </AppComposerFooter>
            </AppComposerContent>
        </AppComposer>
    )
}
