/**
 * 封面图展示：统一「回读骨架 → 空态 → 成品图」三态，供人物设定图与作品封面等 3/4 竖版封面复用。
 * 复用约定：骨架与空态取 @components/ui 的 skeleton、empty，成品图复用同目录 Image（3/4 比例 + lg 圆角 + 描边）。
 * 关键约束：数据来源由调用方提供，本组件不含 hook、不决定从哪个目录回读；isLoading 优先于 src 判断，
 * 避免先闪一次空态；空态文案必须由调用方给出，本组件不猜测业务语义；出图、换图与删除都在生图页完成。
 */
import { ImagePlus } from 'lucide-react'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@components/ui/empty'
import { Skeleton } from '@components/ui/skeleton'
import { Image } from './Image'
import type { JSX } from 'react'

export interface CoverFigureProps {
    /** 图片地址：回读结束仍为 null 时渲染空态 */
    src: string | null
    /** 是否仍在回读：为 true 时一律显示骨架，不看 src */
    isLoading: boolean
    /** 图片替代文本 */
    alt: string
    /** 空态标题，如「还没有作品封面」 */
    emptyTitle: string
    /** 空态说明，写清去哪里生成 */
    emptyDescription: string
}

export function CoverFigure({ src, isLoading, alt, emptyTitle, emptyDescription }: CoverFigureProps): JSX.Element {
    if (isLoading) {
        return <Skeleton className="aspect-3/4 w-full rounded-lg" />
    }
    if (src === null) {
        return (
            <Empty className="border py-4">
                <EmptyHeader>
                    <EmptyMedia variant="icon">
                        <ImagePlus />
                    </EmptyMedia>
                    <EmptyTitle>{emptyTitle}</EmptyTitle>
                    <EmptyDescription>{emptyDescription}</EmptyDescription>
                </EmptyHeader>
            </Empty>
        )
    }
    return <Image src={src} alt={alt} aspect="3/4" size="lg" className="border border-border" />
}
