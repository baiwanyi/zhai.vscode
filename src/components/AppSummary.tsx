/**
 * 页头摘要：把「目标信息徽标行」收敛为一个槽位，说明文案仍由页面自己用 AppDescription 给出。
 * 复用约定：结构照 AppPage 的槽位写法——ComponentProps 透传、cn 合并类名、data-slot 标记部件；
 * 徽标按语义映射 ui/badge 的 outline / secondary / destructive，行尾摘要用正文态文字；
 * 标题图标由 path 的一级目录自动判定，调用方只给结构化数据，不必各自维护来源图标映射。
 * 关键约束：须置于 AppDescription 之后且容器占满整行（col-span-full），行尾摘要靠 ml-auto 顶到最右；
 * 空串一律按缺省处理——title 为空即视为目标未就绪、徽标行整行不渲染，避免空行在标题区留出额外间距；
 * 图标判定只看存储根一级目录并与目录名全等，避免 notes-old 之类的同前缀误判。
 */
import { cn } from 'cn'
import { File, MessagesCircle, Notebook, SquareBookmark } from 'lucide-react'
import { Badge } from '@components/ui/badge'
import { NOTES_MODULE_KEY } from '@shared/types/workflow'
import type { ComponentProps, JSX } from 'react'

/** 装饰图标样式：尺寸与收缩行为固定在这里，四处来源图标共用，避免各自漂移 */
const TITLE_ICON_CLASS = 'size-3 shrink-0'

interface SummaryTitleIconProps {
    /** 目标相对存储根的路径：只取一级目录判定来源 */
    path: string
}

/** 标题来源图标：笔记 / 作品 / 公众号各有专属图标，其余文档（含顶层文件）回落通用文件图标 */
function SummaryTitleIcon({ path }: SummaryTitleIconProps): JSX.Element {
    const [dir = ''] = path.split('/')

    switch (dir) {
        case NOTES_MODULE_KEY:
            return <Notebook data-icon="inline-start" className={TITLE_ICON_CLASS} aria-hidden />
        case 'press':
            return <SquareBookmark data-icon="inline-start" className={TITLE_ICON_CLASS} aria-hidden />
        case 'wechat':
            return <MessagesCircle data-icon="inline-start" className={TITLE_ICON_CLASS} aria-hidden />
        default:
            return <File data-icon="inline-start" className={TITLE_ICON_CLASS} aria-hidden />
    }
}

export interface AppSummaryProps extends ComponentProps<'div'> {
    /** 目标标题：缺省或空串即视为目标未就绪，徽标行整行不渲染 */
    title?: string
    /** 目标相对存储根的路径：据此选标题图标，缺省或空串时不渲染图标 */
    path?: string
    /** 统计徽标：字数、条数等次级信息，排在标题之后，空串按缺省处理 */
    meta?: string
    /** 告警徽标：截断、超限等需要强调的信息，排在统计徽标之后，空串按缺省处理 */
    alerts?: string
    /** 行尾摘要：词库命中、剩余额度等补充文字，不占徽标位，空串按缺省处理 */
    note?: string
}

export function AppSummary({ title, path, meta, alerts, note, className, ...props }: AppSummaryProps): JSX.Element {
    const hasTitle = title !== undefined && title.length > 0
    const hasMeta = meta !== undefined && meta.length > 0
    const hasAlert = alerts !== undefined && alerts.length > 0
    const hasNote = note !== undefined && note.length > 0
    const hasBadges = hasTitle || hasMeta || hasAlert || hasNote

    return (
        <>
            {hasBadges && (
                <div data-slot="app-summary" className={cn('flex w-full items-center gap-2', className)} {...props}>
                    {hasTitle && (
                        <Badge variant="outline" className="max-w-full">
                            {path !== undefined && path.length > 0 && <SummaryTitleIcon path={path} />}
                            <span className="min-w-0 truncate">{title}</span>
                        </Badge>
                    )}
                    {hasMeta && <Badge variant="secondary">{meta}</Badge>}
                    {hasAlert && <Badge variant="destructive">{alerts}</Badge>}
                    {hasNote && <span className="ms-auto text-right text-xs text-muted-foreground">{note}</span>}
                </div>
            )}
        </>
    )
}
