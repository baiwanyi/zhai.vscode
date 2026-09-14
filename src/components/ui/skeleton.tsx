/**
 * 骨架屏：在数据到达前占位，降低内容跳动与等待感。
 * 复用约定：纯样式组件，类名经 cn 合并主题令牌。
 * 关键约束：占位尺寸应与最终内容结构一致；骨架内不要渲染真实文本，避免与加载后的内容重复朗读。
 */
import { cn } from 'cn'

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
    return <div data-slot="skeleton" className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />
}

export { Skeleton }
