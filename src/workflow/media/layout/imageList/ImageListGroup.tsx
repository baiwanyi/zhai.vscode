/**
 * 图片列表分组壳：吸顶显示年月与总数，内容由调用方以 children 注入。
 * 复用约定：结构取原生 section + aria-label，与 AppContent 的滚动容器配合实现 sticky 吸顶；
 * 文案、计数与单位由调用方传入，本组件不认识月份与领域条目，也不产生额外滚动容器。
 * 关键约束：计数取分组总数而非分批后的已渲染数；分组头样式与列表其余部件共用一处定义，
 * 避免媒体、已下载与上传三处逐字复制导致的视觉漂移。
 */
import type { JSX, ReactNode } from 'react'

/** 分组头：吸顶显示年月与张数，滚动时始终能定位当前月份 */
const GROUP_HEADER_CLASS =
    'bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-10 px-4 py-2 text-xs font-medium text-muted-foreground backdrop-blur'

interface ImageListGroupProps {
    label: string
    /** 该组总数：分批时仍显示全量 */
    total: number
    unit?: '张' | '个'
    children: ReactNode
}

export function ImageListGroup({ label, total, unit = '张', children }: ImageListGroupProps): JSX.Element {
    return (
        <section aria-label={label}>
            <div className={GROUP_HEADER_CLASS}>
                {label}
                <span className="ml-1.5 tabular-nums">
                    · {total} {unit}
                </span>
            </div>
            {children}
        </section>
    )
}
