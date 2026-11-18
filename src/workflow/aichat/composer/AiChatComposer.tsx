/**
 * AI 对话底部输入卡片：按 AppComposer 骨架拼装顶栏工具行、富文本输入区与底部操作行。
 * 复用约定：外壳取 @webview/components/AppComposer 族（双层底色、生成态光晕与分层留白均由骨架承担），
 * 顶栏 / 操作行取同目录 AiChatComposerToolbar 与 AiChatComposerActions，富文本输入取 RichChipInput，
 * 芯片映射取同目录 composerChips（规则 / 参考图 / 上下文），参考图入口由工具栏挂载同目录 AiChatImageReferencePicker，
 * 粘贴引用取 ../hooks/useZhaiPasteRefs，增强态取 @webview/hooks/usePromptEnhance，
 * 门禁（生成 / 锁定 / 可发送 / 可增强 / 占位）取 ../utils/chat/gates 的 resolveComposerGate。
 * 本层只做装配：提示文案与禁用态由门禁派生，增强与粘贴两条异步流程各自收敛在独立 hook 内。
 * 关键约束：输入卡片不读会话状态，上下文、用量与模型控制均由此层透传；
 * sending 按锁定态处理并给停止入口，避免等待期的改动被清空；写入范围固定为当前文档，本层不提供范围切换；
 * 增强结果只在正文仍是发起时那一份时才套用（归属校验在 usePromptEnhance 内）；
 * 粘贴的 `@zhai\` 路径改由宿主添加为引用，剩余正文优先回光标、输入区锁定时回落受控值，不丢内容；
 * 操作行是 AppComposerFooter 的唯一子项，撑满与左右贴边由 AiChatComposerActions 自带的 flex-1 承担。
 */
import { Loader2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { AiContextRef, AiContextUsage } from '@shared/types/aiChat'
import type { ImageReferenceItem } from '@shared/types/imageReference'
import type { PromptRule } from '@shared/types/promptLibrary'
import { AppComposer, AppComposerContent, AppComposerFooter, AppComposerHeader } from '@webview/components/AppComposer'
import { usePromptEnhance } from '@webview/hooks/usePromptEnhance'
import { AiChatComposerActions } from './AiChatComposerActions'
import { AiChatComposerToolbar } from './AiChatComposerToolbar'
import { buildComposerChips } from './composerChips'
import { RichChipInput, type RichChipInputHandle } from './RichChipInput'
import type { AiPastedRefTarget } from '../hooks/useAiChatMention'
import type { AiChatModelControl } from '../hooks/useAiChatModelControl'
import type { Phase } from '../utils/chat/view'
import type { AiReferenceAction } from '../utils/context/types'
import type { JSX } from 'react'
import { useZhaiPasteRefs } from '../hooks/useZhaiPasteRefs'
import { describeTool } from '../utils/chat/format'
import { resolveComposerGate } from '../utils/chat/gates'

interface AiChatComposerProps {
    /** 已添加的上下文引用：以内联芯片呈现在输入区首行 */
    contexts: AiContextRef[]
    input: string
    setInput: (input: string) => void
    hasApiKey: boolean
    /** 视图阶段：sending 待首字、streaming 逐字生成，两者都禁止再次发送 */
    phase: Phase
    /** 正在调用的工具名：null 表示当前没有工具执行 */
    activeTool: string | null
    /** 当前会话上下文占用：null 表示本轮还没有产出数据 */
    contextUsage: AiContextUsage | null
    /** 当前模型的上下文窗口：会话尚无占用数据时作为圆环分母 */
    contextWindowTokens: number
    /** 是否存在可写目标：只认当前编辑器文档，未打开文档即不可发送 */
    hasWritableScope: boolean
    /** 模型控制：当前值、展示名、菜单数据与四个选择动作，由 useAiChatModelControl 统一提供 */
    modelControl: AiChatModelControl
    /** 已挂规则名：输入区以规则芯片展示，发送时随请求下发 */
    ruleNames: readonly string[]
    onToggleRule: (rule: PromptRule) => void
    onRenameRule: (previousName: string, rule: PromptRule) => void
    onRemoveRule: (ruleName: string) => void
    /** 待发送参考图：输入区以缩略图芯片展示，发送时随请求以图片块提交 */
    references: ImageReferenceItem[]
    /** 参考图已达上限：工具栏参考图按钮据此禁用 */
    isReferenceFull: boolean
    /** 选中参考图：由页面挂成芯片 */
    onPickReference: (reference: ImageReferenceItem) => void
    /** 摘下参考图：按路径移除对应芯片 */
    onRemoveReference: (path: string) => void
    onSend: () => void
    onStop: () => void
    onRemoveContext: (id: string) => void
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
    activeTool,
    contextUsage,
    contextWindowTokens,
    hasWritableScope,
    modelControl,
    ruleNames,
    onToggleRule,
    onRenameRule,
    onRemoveRule,
    references,
    isReferenceFull,
    onPickReference,
    onRemoveReference,
    onSend,
    onStop,
    onRemoveContext,
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
        hasApiKey,
        hasWritableScope,
        input,
    })

    const chips = buildComposerChips({ ruleNames, references, contexts, onRemoveRule, onRemoveReference })
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
                    mode="chat"
                    disabled={isLocked}
                    onReference={onReference}
                    onMention={onMention}
                    onContextAdded={onContextAdded}
                    onContextError={onContextError}
                    onPickPrompt={(prompt) => inputRef.current?.insertText(prompt) === true}
                    ruleNames={ruleNames}
                    onToggleRule={onToggleRule}
                    onRenameRule={onRenameRule}
                    onRemoveRule={onRemoveRule}
                    isReferenceFull={isReferenceFull}
                    onPickReference={onPickReference}
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
                        isGenerating={isGenerating}
                        isLocked={isLocked}
                        canSend={canSend}
                        canEnhance={canEnhance}
                        isEnhanced={promptEnhance.isEnhanced}
                        isEnhancing={promptEnhance.isEnhancing}
                        contextUsage={contextUsage}
                        contextWindowTokens={contextWindowTokens}
                        modelControl={modelControl}
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
