/**
 * 选区的行内格式按钮组：加粗、斜体、删除线与链接。
 * 复用约定：按钮清单与命令取自 toolbar/formatCommands，按钮用 @webview/components/Button
 * （自带 tooltip 与图标尺寸），按下态用 aria-pressed + bg-muted 表达。
 * 关键约束：命令一律按外层冻结的 range 执行，不现读选区——点按钮会让选区在浏览器侧塌陷；
 * 只放行 GFM 能回写的格式，下划线、上下标不在此列（写入即变内联 HTML，整篇会转只读）；
 * 链接按钮只负责开合地址面板，已有的链接会预填进面板供修改，摘链由面板里的「移除链接」完成；
 * 链接输入面板的内容由外层给，本组件只负责把它绝对定位居中挂在链接按钮下方。
 */
import { Fragment } from 'react'
import { Button } from '@webview/components/Button'
import type { FrozenRange, InlineFormatId } from '../toolbar/formatCommands'
import type { Editor } from '@tiptap/core'
import type { JSX, ReactNode } from 'react'
import { INLINE_FORMATS, toggleInlineFormat } from '../toolbar/formatCommands'

export interface InlineFormatGroupProps {
    editor: Editor
    /** 冻结的选区范围：所有命令都以它为准 */
    range: FrozenRange
    /** 选区已激活的格式 */
    activeFormats: readonly InlineFormatId[]
    /** 链接输入态是否打开：决定链接按钮的点亮状态与面板显隐 */
    isLinkEditing: boolean
    /** 切换链接输入态：具体输入与提交由外层负责 */
    onLinkToggle: () => void
    /** 链接输入面板：内容由外层渲染，本组件只负责定位与显隐 */
    linkPanel: ReactNode
}

export function InlineFormatGroup({
    editor,
    range,
    activeFormats,
    isLinkEditing,
    onLinkToggle,
    linkPanel,
}: InlineFormatGroupProps): JSX.Element {
    return (
        <>
            {INLINE_FORMATS.map((format) => {
                const Icon = format.icon
                const isActive =
                    format.id === 'link'
                        ? isLinkEditing || activeFormats.includes('link')
                        : activeFormats.includes(format.id)
                const button = (
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        tooltip={format.label}
                        aria-label={format.label}
                        aria-pressed={isActive}
                        className={isActive ? 'bg-muted text-foreground' : undefined}
                        onClick={(): void => {
                            if (format.id === 'link') {
                                onLinkToggle()
                                return
                            }
                            toggleInlineFormat(editor, range, format.id)
                        }}
                    >
                        <Icon className="size-3.5" />
                    </Button>
                )
                if (format.id !== 'link') {
                    return <Fragment key={format.id}>{button}</Fragment>
                }
                // 链接按钮自成定位基准：面板水平居中挂在它正下方，工具条其余部分不受影响
                return (
                    <div key={format.id} className="relative">
                        {button}
                        {isLinkEditing ? (
                            <div className="absolute top-full left-1/2 z-10 mt-2 -translate-x-1/2">{linkPanel}</div>
                        ) : null}
                    </div>
                )
            })}
        </>
    )
}
