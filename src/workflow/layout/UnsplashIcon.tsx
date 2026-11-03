/**
 * Unsplash 图标：侧栏导航里代表「在线图库」的品牌标记，图形取自 resources/icons/unsplash.svg。
 * 复用约定：与 lucide 图标同签名——只接受 className，尺寸靠调用方传 size-*，颜色随 currentColor 走活动栏主题。
 * 关键约束：内联 SVG 而不是 <img> 引用资源文件——webview 的 localResourceRoots 只放行 dist/webview 与存储根，
 * 走图片地址需要额外放行 resources/icons 并注入基址；同时内联能跟随主题前景色，不需要两套资源。
 */
import type { JSX } from 'react'

interface UnsplashIconProps {
    className?: string
}

export function UnsplashIcon({ className }: UnsplashIconProps): JSX.Element {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden
            className={className}
        >
            <path d="M16 8v8H0V8h5v4h6V8h5zm-5-8H5v4h6V0z" />
        </svg>
    )
}
