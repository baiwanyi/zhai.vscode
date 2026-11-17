/**
 * 通用输入卡片工具栏：添加上下文、参考图、参考资料、提示词四个入口，对话与生图共用同一套顺序。
 * 只有提示词面板按 mode 换 scope（press / imagegen），其余入口完全相同。
 * 复用约定：上下文菜单取同目录 AiChatContextMenu（scope 决定待发送清单），参考图取 AiChatImageReferencePicker，
 * 参考资料取 AiChatReferenceMenu，提示词取 AiChatPromptPicker（scope 决定词库与交互）。
 * 关键约束：本层不持有任何状态，选中与禁用由输入卡片按芯片算好传入；留白由外层 AppComposerHeader 的 p-1 提供；
 * 词条改名 / 删除只上抛标识，芯片改写留在输入卡片；
 * 参考图选择器两种模式通用：生图侧生成中仍可换图（只影响下一次请求），对话侧跟随输入锁定。
 */
import type { ImageReferenceItem } from '@shared/types/imageReference'
import type { PromptRule, PromptTag } from '@shared/types/promptLibrary'
import { AiChatContextMenu } from './AiChatContextMenu'
import { AiChatImageReferencePicker } from './AiChatImageReferencePicker'
import { AiChatPromptPicker } from './AiChatPromptPicker'
import { AiChatReferenceMenu } from './AiChatReferenceMenu'
import type { AiReferenceAction } from '../utils/context/types'
import type { JSX } from 'react'

/** 两种模式共用的入口与回调：上下文、参考图、参考资料与规则 */
interface ComposerToolbarBaseProps {
    disabled: boolean
    /** 参考图已达上限：参考图按钮据此禁用 */
    isReferenceFull: boolean
    /** 选中参考图：由输入卡片挂成参考图芯片，发送时随请求提交 */
    onPickReference: (reference: ImageReferenceItem) => void
    onReference: (action: AiReferenceAction) => void
    /** 打开提及检索：引用笔记 / 章节 */
    onMention: () => void
    /** 上下文添加成功后刷新清单 */
    onContextAdded: () => void
    /** 上下文添加失败的提示出口 */
    onContextError: (error: string) => void
    /** 已挂规则名：上下文菜单的规则视图据此回显挂载态 */
    ruleNames: readonly string[]
    onToggleRule: (rule: PromptRule) => void
    onRenameRule: (previousName: string, rule: PromptRule) => void
    onRemoveRule: (ruleName: string) => void
}

/** 对话输入卡片：提示词点选后把原文插入输入框 */
interface ChatComposerToolbarProps extends ComposerToolbarBaseProps {
    mode: 'chat'
    /** 选中提示词：把原文插入输入框光标处，返回是否插入成功 */
    onPickPrompt: (prompt: string) => boolean
}

/** 生图输入卡片：词条按标识挂芯片，画面风格在底部操作行 */
interface ImageModeToolbarProps extends ComposerToolbarBaseProps {
    mode: 'image'
    /** 已挂词条的标识（上游原文）：面板据此回显选中态 */
    selectedPrompts: readonly string[]
    /** 点选词条：由输入卡片切换对应芯片 */
    onTogglePrompt: (tag: PromptTag) => void
    /** 词条改名或换组：由输入卡片把已挂芯片换到新标识上 */
    onRenamePrompt: (previousId: string, tag: PromptTag) => void
    /** 词条被删除：由输入卡片摘掉对应芯片 */
    onRemovePrompt: (tagId: string) => void
}

export type AiChatComposerToolbarProps = ChatComposerToolbarProps | ImageModeToolbarProps

export function AiChatComposerToolbar(props: AiChatComposerToolbarProps): JSX.Element {
    /** 待发送上下文清单：两套互不干扰，生图侧固定 image */
    const contextScope = props.mode === 'image' ? 'image' : 'chat'

    return (
        <div className="flex items-center gap-0.5">
            <AiChatContextMenu
                disabled={props.disabled}
                scope={contextScope}
                onContextAdded={props.onContextAdded}
                onContextError={props.onContextError}
                ruleNames={props.ruleNames}
                onToggleRule={props.onToggleRule}
                onRenameRule={props.onRenameRule}
                onRemoveRule={props.onRemoveRule}
            />
            {/* 生图侧没有 disabled 语义：生成中仍可换图，只作用于下一次请求；对话侧跟随输入锁定 */}
            <AiChatImageReferencePicker
                disabled={props.isReferenceFull || (props.mode === 'chat' && props.disabled)}
                onPick={props.onPickReference}
            />
            <AiChatReferenceMenu
                disabled={props.disabled}
                onReference={props.onReference}
                onMention={props.onMention}
            />
            {props.mode === 'image' ? (
                // 生图词条在生成中仍可切换（只影响下一次请求），因此不跟随输入禁用
                <AiChatPromptPicker
                    scope="imagegen"
                    disabled={false}
                    selectedPrompts={props.selectedPrompts}
                    onPick={props.onTogglePrompt}
                    onRenamePrompt={props.onRenamePrompt}
                    onRemovePrompt={props.onRemovePrompt}
                />
            ) : (
                <AiChatPromptPicker scope="press" disabled={props.disabled} onPick={props.onPickPrompt} />
            )}
        </div>
    )
}
