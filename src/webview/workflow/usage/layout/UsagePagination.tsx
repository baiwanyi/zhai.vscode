/**
 * 用量分页：上一页 / 下一页与「第 N / M 页、共 X 条」，分页本身由宿主完成。
 * 复用约定：外层结构复用 @components/ui/pagination，页码计算只依赖当前页、页大小与总数。
 * 关键约束：首页与末页的翻页入口用不可点样式而不是 disabled 属性（链接语义需保留可访问名）；
 * 总数为 0 时仍显示「第 1 / 1 页」，避免出现 0 页的空白状态。
 */
import { Pagination, PaginationContent, PaginationItem, PaginationLink } from '@components/ui/pagination'
import type { JSX, MouseEvent } from 'react'

interface UsagePaginationProps {
    page: number
    pageSize: number
    total: number
    onChangePage: (page: number) => void
}

export function UsagePagination({ page, pageSize, total, onChangePage }: UsagePaginationProps): JSX.Element {
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const isFirstPage = page <= 1
    const isLastPage = page >= totalPages
    /** 翻页前阻止链接默认跳转：webview 内不接管 hash 导航 */
    const goToPrev = (event: MouseEvent<HTMLAnchorElement>): void => {
        event.preventDefault()
        if (!isFirstPage) {
            onChangePage(page - 1)
        }
    }
    const goToNext = (event: MouseEvent<HTMLAnchorElement>): void => {
        event.preventDefault()
        if (!isLastPage) {
            onChangePage(page + 1)
        }
    }

    return (
        <Pagination className="justify-between">
            <PaginationContent>
                <PaginationItem>
                    <PaginationLink
                        size="default"
                        aria-label="上一页"
                        aria-disabled={isFirstPage}
                        className={isFirstPage ? 'pointer-events-none opacity-50' : undefined}
                        onClick={goToPrev}
                    >
                        上一页
                    </PaginationLink>
                </PaginationItem>
                <PaginationItem>
                    <span className="text-muted-foreground px-2">
                        第 {page} / {totalPages} 页 · 共 {total} 条
                    </span>
                </PaginationItem>
                <PaginationItem>
                    <PaginationLink
                        size="default"
                        aria-label="下一页"
                        aria-disabled={isLastPage}
                        className={isLastPage ? 'pointer-events-none opacity-50' : undefined}
                        onClick={goToNext}
                    >
                        下一页
                    </PaginationLink>
                </PaginationItem>
            </PaginationContent>
        </Pagination>
    )
}
