/**
 * 手机屏幕内容：状态栏与聊天气泡的静态占位，加载态与正常态共用外壳但内容互斥。
 * 复用约定：骨架取 components/ui/skeleton，加载态自带底部菜单条占位；
 * 关键约束：只渲染屏幕内部，外层 PhoneFrame 与正常态的底部菜单条由调用方负责。
 */
import { Skeleton } from '@components/ui/skeleton'
import type { JSX } from 'react'

interface PhoneScreenProps {
    status: 'loading' | 'ready'
}

export function PhoneScreen({ status }: PhoneScreenProps): JSX.Element {
    if (status === 'loading') {
        return (
            <>
                <div className="flex items-center justify-between px-2 py-1 text-[9px] text-muted-foreground">
                    <Skeleton className="h-2 w-8" />
                    <Skeleton className="h-2 w-8" />
                </div>
                <div className="flex flex-1 flex-col gap-2 p-3">
                    <Skeleton className="h-8 w-2/3 rounded-xl" />
                    <Skeleton className="ml-auto h-8 w-3/5 rounded-xl" />
                    <Skeleton className="h-8 w-1/2 rounded-xl" />
                </div>
                <div className="flex h-12 shrink-0 items-center justify-center gap-2 border-t border-border bg-muted">
                    <Skeleton className="h-6 w-1/3 rounded-md" />
                    <Skeleton className="h-6 w-1/3 rounded-md" />
                </div>
            </>
        )
    }
    return (
        <>
            <div className="flex items-center justify-between px-2 py-1 text-[9px] text-muted-foreground">
                <span>0:00</span>
                <span>●●●</span>
            </div>
            <div className="flex flex-1 flex-col gap-2 p-3">
                <div className="h-8 w-2/3 rounded-xl bg-muted" />
                <div className="ml-auto h-8 w-3/5 rounded-xl bg-primary/10" />
                <div className="h-8 w-1/2 rounded-xl bg-muted" />
            </div>
        </>
    )
}
