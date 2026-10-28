/**
 * 输入卡片生成态光晕：conic 旋转描边 + 模糊背光的纯装饰层，样式定义在 globals.css 的 composer-glow 段。
 * 复用约定：结构照 components 的槽位写法——ComponentProps 透传、cn 合并类名、data-slot 标记部件；
 * 对话与生图两处输入卡片共用，调用方只给 isGenerating，不再各自维护两层装饰节点。
 * 关键约束：必须挂在卡片外侧的兄弟层上——卡片底色不透明，移进卡片内部就会被盖住；
 * 父级需自带 isolate，把 -z-10 限制在卡片层叠边界内，否则会沉到页面背景之后；
 * 仅切换透明度与 data-glow 控制动画启停，不参与布局与交互，也不得承载任何状态。
 */
import { cn } from 'cn'
import type { ComponentProps, JSX } from 'react'

interface ComposerGlowProps extends ComponentProps<'div'> {
    /** 是否处于生成态：true 时淡入并启动描边旋转 / 背光呼吸 */
    isGenerating: boolean
}

export function ComposerGlow({ isGenerating, className, ...props }: ComposerGlowProps): JSX.Element {
    return (
        <div
            aria-hidden
            data-slot="composer-glow"
            data-glow={isGenerating ? 'on' : 'off'}
            className={cn(
                'pointer-events-none absolute inset-0 -z-10 transition-opacity duration-500',
                isGenerating ? 'opacity-100' : 'opacity-0',
                className,
            )}
            {...props}
        >
            {/* 背光在外、描边在内，二者尺寸与圆角对齐卡片 */}
            <div className="composer-glow-halo absolute -inset-0.5 rounded-2xl opacity-60 blur-sm" />
            {/* 外扩量与 CSS 里的 padding（线宽）保持一致，描边才刚好贴在卡片边界外 */}
            <div className="composer-glow-edge absolute -inset-px rounded-2xl" />
        </div>
    )
}
