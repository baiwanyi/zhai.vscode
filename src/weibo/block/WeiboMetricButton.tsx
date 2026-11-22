/**
 * 底栏互动按钮：图标 + 计数，常态灰字无底，悬停由 tone 决定上色并浮出圆形色块，激活时色块常驻。
 * 复用约定：转发 / 评论 / 点赞三枚共用本组件，色调经静态类名表给出（Tailwind 只认静态类）；
 * 展开态与已赞态由调用方持有并回传，点击行为、禁用态与无障碍属性在此透传。
 * 关键约束：flex-1 / shrink 写在基础类里保持底栏三等分；调用方的 className 排在其后可覆盖。
 */
import { cn } from 'cn'
import { Button } from '@webview/components/Button'
import type { JSX, ReactNode } from 'react'

/** 互动色调：转发墨绿、评论天蓝、点赞品红 */
export type WeiboMetricTone = 'emerald' | 'sky' | 'pink'

interface ToneClass {
    activeText: string
    hoverText: string
    hoverHalo: string
    activeHalo: string
}

const TONE_CLASS: Record<WeiboMetricTone, ToneClass> = {
    emerald: {
        activeText: 'text-emerald-500',
        hoverText: 'hover:text-emerald-500',
        hoverHalo: 'group-hover:bg-emerald-500/15',
        activeHalo: 'bg-emerald-500/15',
    },
    sky: {
        activeText: 'text-sky-500',
        hoverText: 'hover:text-sky-500',
        hoverHalo: 'group-hover:bg-sky-500/15',
        activeHalo: 'bg-sky-500/15',
    },
    pink: {
        activeText: 'text-pink-500',
        hoverText: 'hover:text-pink-500',
        hoverHalo: 'group-hover:bg-pink-500/15',
        activeHalo: 'bg-pink-500/15',
    },
}

export interface WeiboMetricButtonProps {
    icon: ReactNode
    count: number
    ariaLabel: string
    /** 展开中或已赞：文字与圆底色块常驻 */
    isActive: boolean
    tone: WeiboMetricTone
    onClick: () => void
    /** 转发 / 评论用展开态语义 */
    ariaExpanded?: boolean
    /** 点赞用按下态语义 */
    ariaPressed?: boolean
    disabled?: boolean
    className?: string
}

export function WeiboMetricButton({
    icon,
    count,
    ariaLabel,
    isActive,
    tone,
    onClick,
    ariaExpanded,
    ariaPressed,
    disabled = false,
    className,
}: WeiboMetricButtonProps): JSX.Element {
    const toneClass = TONE_CLASS[tone]
    return (
        <Button
            variant="ghost"
            onClick={onClick}
            disabled={disabled}
            aria-expanded={ariaExpanded}
            aria-pressed={ariaPressed}
            aria-label={ariaLabel}
            className={cn(
                'group h-auto flex-1 shrink items-center justify-start gap-1.5 bg-transparent p-0 font-normal text-muted-foreground hover:bg-transparent disabled:opacity-60 dark:hover:bg-transparent',
                toneClass.hoverText,
                isActive && toneClass.activeText,
                className,
            )}
        >
            <span
                className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-full transition-colors',
                    toneClass.hoverHalo,
                    isActive && toneClass.activeHalo,
                )}
            >
                {icon}
            </span>
            {count}
        </Button>
    )
}
