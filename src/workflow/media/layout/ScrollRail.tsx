/**
 * 单行横向滑动壳：装一排不换行的内容，两端箭头按滚动位置显隐，边缘叠背景色渐隐遮罩。
 * 复用约定：箭头取 @webview/components/Button（幽灵图标按钮），内容由 children 注入，壳不认识具体条目；
 * 选中项回滚靠约定——内容里标了 data-state="on" 的节点会在 activeValue 变化时滚回可视区。
 * 关键约束：箭头只在该方向还有内容时才渲染，到头即隐藏（隐藏后行宽回缩、内容随之回弹，属预期观感）；
 * 显隐由 scroll + ResizeObserver 实时判定（1px 容差防亚像素抖动），卸载时解绑事件并断开观察；
 * 滚动条隐藏但滚轮与触摸仍可用。
 */
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@webview/components/Button'
import type { JSX, ReactNode } from 'react'

/** 单次滑动步长上限：约一屏的八成，两三下就能滑到底 */
const STEP_RATIO = 0.8

interface ScrollRailProps {
    /** 滚动区无障碍名称：同页出现多个滑动壳时用于区分 */
    ariaLabel: string
    /** 选中项键值：变化时把内容里的 [data-state="on"] 滚回可视区，省略则不处理 */
    activeValue?: string
    /** 滑动内容：必须是单行排布、自身不换行 */
    children: ReactNode
}

export function ScrollRail({ ariaLabel, activeValue, children }: ScrollRailProps): JSX.Element {
    /** 横向滚动容器：测量与滚动的唯一入口 */
    const scrollRef = useRef<HTMLDivElement | null>(null)
    const [canScrollLeft, setCanScrollLeft] = useState(false)
    const [canScrollRight, setCanScrollRight] = useState(false)

    /** 滚动与容器、内容尺寸变化都汇到这里重算两端显隐 */
    useEffect(() => {
        const container = scrollRef.current
        if (container === null) {
            return
        }
        const update = (): void => {
            setCanScrollLeft(container.scrollLeft > 1)
            setCanScrollRight(container.scrollLeft + container.clientWidth < container.scrollWidth - 1)
        }
        update()
        container.addEventListener('scroll', update, { passive: true })
        const observer = new ResizeObserver(update)
        observer.observe(container)
        if (container.firstElementChild !== null) {
            observer.observe(container.firstElementChild)
        }
        return (): void => {
            container.removeEventListener('scroll', update)
            observer.disconnect()
        }
    }, [])

    /** 选中项变化时滚回可视区 */
    useEffect(() => {
        scrollRef.current?.querySelector('[data-state="on"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }, [activeValue])

    /** 按可视宽度折算步长，最小 120px 保证窄容器也滑得动 */
    function scrollByStep(direction: 'left' | 'right'): void {
        const container = scrollRef.current
        if (container === null) {
            return
        }
        const step = Math.max(container.clientWidth * STEP_RATIO, 120)
        container.scrollBy({ left: direction === 'left' ? -step : step, behavior: 'smooth' })
    }

    return (
        <div className="flex w-full items-center gap-1">
            {canScrollLeft ? (
                <Button
                    size="icon"
                    variant="ghost"
                    className="size-6 shrink-0"
                    tooltip="向左滑动"
                    aria-label="向左滑动"
                    onClick={() => {
                        scrollByStep('left')
                    }}
                >
                    <ChevronLeft className="size-4" />
                </Button>
            ) : null}
            <div className="relative min-w-0 flex-1">
                <div
                    ref={scrollRef}
                    aria-label={ariaLabel}
                    className="overflow-x-auto scrollbar-none! [&::-webkit-scrollbar]:hidden!"
                >
                    {children}
                </div>
                {/* 边缘渐隐遮罩：与同侧箭头同起同落，暗示可滑方向 */}
                {canScrollLeft ? (
                    <div className="pointer-events-none absolute inset-y-0 left-0 w-3 bg-linear-to-r from-background to-transparent" />
                ) : null}
                {canScrollRight ? (
                    <div className="pointer-events-none absolute inset-y-0 right-0 w-3 bg-linear-to-l from-background to-transparent" />
                ) : null}
            </div>
            {canScrollRight ? (
                <Button
                    size="icon"
                    variant="ghost"
                    className="size-6 shrink-0"
                    tooltip="向右滑动"
                    aria-label="向右滑动"
                    onClick={() => {
                        scrollByStep('right')
                    }}
                >
                    <ChevronRight className="size-4" />
                </Button>
            ) : null}
        </div>
    )
}
