/**
 * 右侧标题导航：常驻一列细横线表示标题层级（层级越深线越短），悬停展开标题列表，点击跳到对应标题。
 * 复用约定：大纲由 useHeadingOutline 提供，组件只负责渲染与回调；条目用 @webview/components/Button。
 * 关键约束：必须挂在 .zhai-editor 下（position: relative）而不是滚动区里，否则会随正文滚走；
 * 导航贴右上角摆放（顶部对齐），标题多时超出的部分裁掉，不挤压正文区域；
 * 展开收起交给 group-hover，不引入开合状态——滚走或点击空白处自然收起，不会与选区浮层抢焦点。
 */
import { Button } from '@webview/components/Button'
import type { HeadingItem } from '../hooks/useHeadingOutline'
import type { JSX } from 'react'

export interface HeadingNavProps {
    items: readonly HeadingItem[]
    onSelect: (item: HeadingItem) => void
}

/** 细线宽度：层级越深越短，视觉上即目录缩进 */
const BAR_WIDTH_BASE = 34
const BAR_WIDTH_STEP = 8
const BAR_WIDTH_MIN = 10
/** 列表缩进：每深一级右移 12px */
const LIST_INDENT_STEP = 12

export function HeadingNav({ items, onSelect }: HeadingNavProps): JSX.Element | null {
    if (items.length === 0) {
        return null
    }

    return (
        <div className="group absolute right-2 top-4 z-10">
            {/* 常驻细线：贴右上角排列，标题过多时裁掉多余部分，不压住正文 */}
            <div className="flex max-h-[70vh] flex-col items-end gap-1.5 overflow-hidden py-2">
                {items.map((item) => (
                    <span
                        key={`${String(item.pos)}-${item.text}`}
                        aria-hidden="true"
                        className="h-0.5 shrink-0 rounded-full bg-muted-foreground/40 transition-colors group-hover:bg-muted-foreground/70"
                        style={{
                            width: Math.max(BAR_WIDTH_MIN, BAR_WIDTH_BASE - (item.level - 1) * BAR_WIDTH_STEP),
                        }}
                    />
                ))}
            </div>
            {/* 展开的目录面板：与细线顶部对齐、贴在左侧，避免遮住正文右边缘的操作按钮 */}
            <div className="invisible absolute right-full top-0 max-h-[70vh] w-56 overflow-auto rounded-lg border bg-popover p-1.5 opacity-0 shadow-widget transition-opacity group-hover:visible group-hover:opacity-100">
                {items.map((item) => (
                    <Button
                        key={`${String(item.pos)}-${item.text}`}
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start"
                        style={{ paddingLeft: `${String((item.level - 1) * LIST_INDENT_STEP + 8)}px` }}
                        onClick={(): void => {
                            onSelect(item)
                        }}
                    >
                        <span className="truncate">{item.text}</span>
                    </Button>
                ))}
            </div>
        </div>
    )
}
