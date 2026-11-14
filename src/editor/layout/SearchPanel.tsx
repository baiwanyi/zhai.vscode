/**
 * 查找条：关键字输入 + 命中计数 + 上一个 / 下一个 + 关闭。
 * 复用约定：状态与动作整包取自 useDocumentSearch，本组件不再逐字段声明 props；
 * 浮层用 shadcn Popover（零尺寸锚点贴在内容区右上角），输入区用 InputGroup 统一承载
 * 前缀图标、计数与三个操作按钮，边框与底色都交给 InputGroup，浮层只负责定位与层级。
 * 关键约束：查找条必须常驻——Popover 恒为 open 且忽略外部点击与 Esc，否则去正文核对命中时
 * 输入框会失焦、整条消失；打开时的焦点由 onOpenAutoFocus 拦下，改用输入框自身 autoFocus；
 * Enter 下一个、Shift+Enter 上一个、Esc 关闭，这三条是查找条的默认预期，
 * 缺任何一个用户都会试图用鼠标点按钮，长文里效率立刻下降。
 */
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput,
    InputGroupText,
} from '@components/ui/input-group'
import { Popover, PopoverAnchor, PopoverContent } from '@components/ui/popover'
import type { UseDocumentSearchResult } from '../search/useDocumentSearch'
import type { JSX } from 'react'
import { FLOATING_POPOVER_CLASS } from '../core/domContracts'

/** 查找条常驻：Popover 只作为浮层壳，外部点击与 Esc 都不收起（Esc 由输入框自己处理） */
const IGNORE_OPEN_CHANGE = (): void => undefined

export interface SearchPanelProps {
    /** 查找状态与动作：由 useDocumentSearch 提供，父层只传整包，新增字段不必改这里 */
    state: UseDocumentSearchResult
}

/** 计数文案：空查询不显示（还没查不等于查不到），无命中说「无结果」，命中上限时提示细化关键词 */
function readCounterLabel(query: string, matchCount: number, activeIndex: number, isCapped: boolean): string {
    if (query.length === 0) {
        return ''
    }
    if (matchCount === 0) {
        return '无结果'
    }
    const label = `${String(activeIndex + 1)} / ${String(matchCount)}`
    return isCapped ? `${label}+` : label
}

export function SearchPanel({ state }: SearchPanelProps): JSX.Element {
    const { query, matchCount, activeIndex, isCapped, setQuery, goNext, goPrev, close } = state
    return (
        <Popover open onOpenChange={IGNORE_OPEN_CHANGE}>
            <PopoverAnchor asChild>
                {/* 零尺寸锚点：贴在内容区右上角，浮层以它的右下角为基准展开 */}
                <div className="pointer-events-none absolute top-2 right-4 h-0 w-0" />
            </PopoverAnchor>
            <PopoverContent
                side="bottom"
                align="end"
                sideOffset={0}
                // 浮层壳让位给 InputGroup：去掉自带的底色、内边距、阴影与描边，避免双层边框
                className={FLOATING_POPOVER_CLASS}
                onOpenAutoFocus={(event): void => {
                    // 焦点交给输入框自身 autoFocus：Popover 默认聚焦内容容器会让输入框拿不到焦点
                    event.preventDefault()
                }}
            >
                <InputGroup className="w-80 bg-background/95 shadow-sm backdrop-blur">
                    <InputGroupAddon>
                        <Search aria-hidden="true" />
                    </InputGroupAddon>
                    <InputGroupInput
                        autoFocus
                        aria-label="查找"
                        placeholder="查找"
                        value={query}
                        className="text-sm"
                        onChange={(event): void => {
                            setQuery(event.target.value)
                        }}
                        onKeyDown={(event): void => {
                            if (event.key === 'Enter') {
                                event.preventDefault()
                                if (event.shiftKey) {
                                    goPrev()
                                    return
                                }
                                goNext()
                                return
                            }
                            if (event.key === 'Escape') {
                                event.preventDefault()
                                close()
                            }
                        }}
                    />
                    <InputGroupAddon align="inline-end">
                        <InputGroupText className="min-w-14 justify-end text-xs tabular-nums">
                            {readCounterLabel(query, matchCount, activeIndex, isCapped)}
                        </InputGroupText>
                        <InputGroupButton
                            size="icon-xs"
                            aria-label="上一个"
                            disabled={matchCount === 0}
                            onClick={goPrev}
                        >
                            <ChevronUp />
                        </InputGroupButton>
                        <InputGroupButton
                            size="icon-xs"
                            aria-label="下一个"
                            disabled={matchCount === 0}
                            onClick={goNext}
                        >
                            <ChevronDown />
                        </InputGroupButton>
                        <InputGroupButton size="icon-xs" aria-label="关闭查找" onClick={close}>
                            <X />
                        </InputGroupButton>
                    </InputGroupAddon>
                </InputGroup>
            </PopoverContent>
        </Popover>
    )
}
