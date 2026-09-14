/**
 * 加载指示：表达进行中的不确定进度。
 * 复用约定：图标取自 lucide-react，样式经 cn 合并主题令牌。
 * 关键约束：按钮内展示时应配合 disabled 阻止重复提交；确定进度场景改用 Progress。
 */
import { cn } from 'cn'
import { Loader2Icon } from 'lucide-react'

function Spinner({ className, ...props }: React.ComponentProps<'svg'>) {
    return (
        <Loader2Icon
            data-slot="spinner"
            role="status"
            aria-label="Loading"
            className={cn('size-4 animate-spin', className)}
            {...props}
        />
    )
}

export { Spinner }
