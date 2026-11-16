/**
 * AI 对话底部输入卡片：按 AppComposer 骨架拼装顶栏工具行、富文本输入区与底部操作行。
 * 复用约定：外壳取 @webview/components/AppComposer 族（双层底色、生成态光晕与分层留白均由骨架承担），
 * 顶栏 / 操作行取同目录 AiChatComposerToolbar 与 AiChatComposerActions，富文本输入取 RichChipInput，
 * 芯片映射取 ./composerChips，粘贴引用取 ../hooks/useZhaiPasteRefs，增强态取 @webview/hooks/usePromptEnhance，
 * 门禁（生成 / 锁定 / 可发送 / 可增强 / 占位）取 ../utils 的 resolveComposerGate。
 * 本层只做装配：提示文案与禁用态由门禁派生，增强与粘贴两条异步流程各自收敛在独立 hook 内。
 * 关键约束：输入卡片不读会话状态，上下文、写入范围、用量、命令与模型控制均由此层透传；
 * sending 与等待连续生成授权都按锁定态处理（前者给停止入口，后者不给），避免等待期的改动在确认发送后被清空；
 * 增强结果只在正文仍是发起时那一份时才套用（归属校验在 usePromptEnhance 内）；
 * 粘贴的 `@zhai\` 路径改由宿主添加为引用，剩余正文优先回光标、输入区锁定时回落受控值，不丢内容；
 * 命令芯片的移除语义是「取消命令」，由 chip.onRemove 承担，不走统一的移除引用回调；
 * 操作行是 AppComposerFooter 的唯一子项，撑满与左右贴边由 AiChatComposerActions 自带的 flex-1 承担。
 */
import { Loader2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { AiContextRef, AiContextUsage, AiWriteGrant } from '@shared/types/aiChat'
import type { PromptRule } from '@shared/types/imagegen'
import {
    AppComposer,
    AppComposerContent,
    AppComposerFooter,
    AppComposerHeader,
} from '@webview/components/AppComposer'
import { RichChipInput, type RichChipInputHandle } from '@webview/components/RichChipInput'
import { usePromptEnhance } from '@webview/hooks/usePromptEnhance'
import { AiChatComposerActions } from './AiChatComposerActions'
import { AiChatComposerToolbar } from './AiChatComposerToolbar'
import { buildComposerChips } from './composerChips'
import type { AiCommand, AiReferenceAction } from '../constants'
import type { AiPastedRefTarget } from '../hooks/useAiChatMention'
import type { AiChatModelControl } from '../hooks/useAiChatModelControl'
import type { JSX } from 'react'
import { useZhaiPasteRefs } from '../hooks/useZhaiPasteRefs'
import { describeTool, resolveComposerGate, type Phase } from '../utils'

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
    /** 已挂规则名：输入区以规则芯片展示，发送时随请求下发 */
    ruleNames: readonly string[]
    onToggleRule: (rule: PromptRule) => void
    onRenameRule: (previousName: string, rule: PromptRule) => void
    onRemoveRule: (ruleName: string) => void
    onSend: () => void
    onStop: () => void
    onRemoveContext: (id: string) => void
    onCommand: (command: AiCommand) => void
    onClearCommand: () => void
    onReference: (action: AiReferenceAction) => void
    /** 打开提及检索：引用笔记 / 章节 */
    onMention: () => void
    /** 上下文添加成功后刷新会话快照 */
    onContextAdded: () => void
    /** 上下文添加失败的提示出口 */
    onContextError: (error: string) => void
    /** 增强请求：由页面 hook 走宿主协议，失败返回 null；进行态由 usePromptEnhance 自己维护 */
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
    ruleNames,
    onToggleRule,
    onRenameRule,
    onRemoveRule,
    onSend,
    onStop,
    onRemoveContext,
    onCommand,
    onClearCommand,
    onReference,
    onMention,
    onContextAdded,
    onContextError,
    onEnhanceRequest,
    onAddZhaiRef,
}: AiChatComposerProps): JSX.Element {
    /** 输入区句柄：粘贴引用后把剩余文本插回光标处 */
    const inputRef = useRef<RichChipInputHandle>(null)
    /**
     * 正文的最新值：粘贴引用是异步流程，回来时正文可能已被发送清空，
     * 回落追加必须以当前值为基准，不能只信闭包里的旧值。
     */
    const currentInputRef = useRef(input)

    useEffect(() => {
        currentInputRef.current = input
    }, [input])

    /** 生成态、锁定态、可发送、可增强与占位文案：规则集中在 resolveComposerGate，本层只取结果 */
    const { isGenerating, isLocked, canSend, canEnhance, placeholder } = resolveComposerGate({
        phase,
        isAwaitingApproval,
        hasApiKey,
        hasWritableScope,
        command,
        input,
    })

    const chips = buildComposerChips({ command, ruleNames, contexts, onClearCommand, onRemoveRule })
    /** 增强态：请求期间继续输入或已发送清空时，结果会被丢弃，不覆盖新内容 */
    const promptEnhance = usePromptEnhance({ value: input, setValue: setInput, request: onEnhanceRequest })
    /** 粘贴拦截：命中 @zhai 令牌时改由宿主添加为引用，剩余正文回落到光标或受控值 */
    const { capturePaste } = useZhaiPasteRefs({
        addRef: onAddZhaiRef,
        insertAtCaret: (rest) => inputRef.current?.insertText(rest) === true,
        appendToInput: (rest) => {
            const current = currentInputRef.current
            setInput(current.length === 0 ? rest : `${current}\n${rest}`)
        },
    })

    /** 手动输入或修改即退出增强态，避免「还原」把用户新写的内容覆盖 */
    const handleInputChange = (value: string): void => {
        // 同步记下最新正文：粘贴回落与增强归属判断都依赖它
        currentInputRef.current = value
        promptEnhance.reset()
        setInput(value)
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
                    onContextAdded={onContextAdded}
                    onContextError={onContextError}
                    ruleNames={ruleNames}
                    onToggleRule={onToggleRule}
                    onRenameRule={onRenameRule}
                    onRemoveRule={onRemoveRule}
                />
            </AppComposerHeader>

            {/* 粘贴拦截挂在内层内容区上：芯片与正文都在这一层，拦截时机先于 RichChipInput 的默认粘贴 */}
            <AppComposerContent onPasteCapture={capturePaste}>
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
                        writeGrant={writeGrant}
                        isGenerating={isGenerating}
                        isLocked={isLocked}
                        canSend={canSend}
                        canEnhance={canEnhance}
                        isEnhanced={promptEnhance.isEnhanced}
                        isEnhancing={promptEnhance.isEnhancing}
                        contextUsage={contextUsage}
                        contextWindowTokens={contextWindowTokens}
                        modelControl={modelControl}
                        onWriteGrantChange={onWriteGrantChange}
                        onEnhance={promptEnhance.enhance}
                        onUndoEnhance={promptEnhance.restore}
                        onSend={onSend}
                        onStop={onStop}
                    />
                </AppComposerFooter>
            </AppComposerContent>
        </AppComposer>
    )
}
