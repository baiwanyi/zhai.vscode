/**
 * 右侧标题导航：常驻一列细横线表示标题层级（层级越深线越短），悬停展开标题列表，点击跳到对应标题；
 * 仅渲染二至四级标题，一级与五六级标题不进入导航。
 * 复用约定：大纲由 useHeadingOutline 提供，组件只负责渲染与回调；条目用 @webview/components/Button。
 * 关键约束：必须挂在 .zhai-editor 下（position: relative）而不是滚动区里，否则会随正文滚走；
 * 导航贴右上角摆放（顶部对齐），标题多时超出的部分裁掉，不挤压正文区域；
 * 展开收起交给 group-hover，不引入开合状态——滚走或点击空白处自然收起，不会与选区浮层抢焦点；
 * 展开面板覆盖在细线上（右对齐）并自右向左渐入，保证鼠标从细线移入面板时 hover 不中断。
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
/** 导航只收录二至四级标题：一级多为文档大标题、五六级过细，皆不作为跳转入口 */
const MIN_NAV_LEVEL = 2
const MAX_NAV_LEVEL = 4

export function HeadingNav({ items, onSelect }: HeadingNavProps): JSX.Element | null {
    const navItems = items.filter((item) => item.level >= MIN_NAV_LEVEL && item.level <= MAX_NAV_LEVEL)
    if (navItems.length === 0) {
        return null
    }

    return (
        <div className="group absolute right-4 top-4 z-10">
            {/* 常驻细线：贴右上角排列，标题过多时裁掉多余部分，不压住正文 */}
            <div className="flex max-h-[70vh] flex-col items-end gap-1.5 overflow-hidden py-2">
                {navItems.map((item) => (
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
            {/* 展开的目录面板：覆盖在细线上并与之右对齐，自右向左滑入，鼠标可直接从细线移入面板 */}
            <div className="invisible absolute top-0 right-0 max-h-[70vh] w-56 translate-x-3 overflow-auto rounded-xl bg-popover p-2 opacity-0 shadow-widget transition-[opacity,translate,visibility] duration-200 ease-out group-hover:visible group-hover:translate-x-0 group-hover:opacity-100">
                {navItems.map((item) => (
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
