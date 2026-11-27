/**
 * 手机外壳：机身、刘海、Home 键与屏幕区，加载骨架与正常预览共用。
 * 复用约定：children 为屏幕内容，尺寸与层级由本组件固定；
 * 关键约束：机身取父容器高度 80% 并垂直居中，父容器须用 AppContent 的非滚动模式。
 */
import type { JSX, ReactNode } from 'react'

interface PhoneFrameProps {
    children: ReactNode
}

export function PhoneFrame({ children }: PhoneFrameProps): JSX.Element {
    return (
        <div className="flex h-full w-full items-center justify-center">
            <div className="relative h-[80%] w-80 max-w-full rounded-4xl border-2 border-foreground/20 bg-muted shadow">
                <div
                    className="absolute left-1/2 top-[8%] h-[2%] w-[22%] -translate-x-1/2 rounded-full bg-foreground/25"
                    aria-hidden="true"
                />
                <div
                    className="absolute bottom-[3.5%] left-1/2 aspect-square h-[10%] -translate-x-1/2 rounded-full border-2 border-foreground/25"
                    aria-hidden="true"
                />
                <div className="absolute inset-x-[7%] top-[12%] bottom-[18%] flex flex-col overflow-hidden rounded-md bg-card">
                    {children}
                </div>
            </div>
        </div>
    )
}
