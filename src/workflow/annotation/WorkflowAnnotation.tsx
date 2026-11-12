/**
 * 标注总览页：跨文档查看所有划线与批注，支持类型筛选、失效筛选与关键词检索。
 * 复用约定：外壳取 AppPage 骨架，列表项由 layout/ 承担，数据编排在 hooks/useAnnotationList；
 * 提示条用 Alert、空态用 StateEmpty、按钮用 Button，不新写容器与状态组件。
 * 关键约束：跳转打开的是文本编辑器并选中区间（富文本 tab 需用户自行切回）；
 * 跳转失败必须给出可见提示——文档已删除与定位失效分开说明，不能让点击毫无反应。
 */
import { Highlighter } from 'lucide-react'
import { useState } from 'react'
import { Alert, AlertDescription } from '@components/ui/alert'
import { Input } from '@components/ui/input'
import { AppAction, AppContent, AppDescription, AppHeader, AppPage, AppTitle } from '@webview/components/AppPage'
import { Button } from '@webview/components/Button'
import { StateEmpty } from '@webview/components/StateEmpty'
import { useAnnotationList } from './hooks/useAnnotationList'
import { AnnotationListItem } from './layout/AnnotationListItem'
import type { AnnotationFilters } from './hooks/useAnnotationList'
import type { JSX } from 'react'

/** 类型选项：全部 / 划线 / 批注 */
const KIND_OPTIONS: ReadonlyArray<{ value: AnnotationFilters['kind']; label: string }> = [
    { value: null, label: '全部' },
    { value: 'highlight', label: '划线' },
    { value: 'note', label: '批注' },
]

/** 跳转失败与成功定位不到时的提示文案 */
const NOTICE_MISSING_FILE = '原文已删除，无法跳转'
const NOTICE_ORPHANED = '原文已修改，无法精确定位；已打开文档供你手动查找'

export function WorkflowAnnotation(): JSX.Element {
    const { items, total, isLoading, error, hasMore, filters, setFilters, loadMore, remove, reveal } =
        useAnnotationList()
    const [notice, setNotice] = useState<string | null>(null)

    const handleReveal = async (id: string): Promise<void> => {
        const outcome = await reveal(id)
        if (!outcome.revealed) {
            setNotice(outcome.reason === 'missing-file' ? NOTICE_MISSING_FILE : '这条标注已不存在')
            return
        }
        setNotice(outcome.orphaned === true ? NOTICE_ORPHANED : null)
    }

    const totalLabel = total === null ? '' : `共 ${total.toLocaleString('zh-CN')} 条`

    return (
        <AppPage>
            <AppHeader>
                <AppTitle>标注</AppTitle>
                <AppDescription>跨文档查看所有划线与批注，可搜索并跳回原文</AppDescription>
                <AppAction>{totalLabel}</AppAction>
            </AppHeader>
            <AppContent>
                <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1">
                        {KIND_OPTIONS.map((option) => (
                            <Button
                                key={option.label}
                                variant={filters.kind === option.value ? 'default' : 'ghost'}
                                size="sm"
                                onClick={(): void => {
                                    setFilters({ ...filters, kind: option.value })
                                }}
                            >
                                {option.label}
                            </Button>
                        ))}
                    </div>
                    <Input
                        value={filters.keyword}
                        placeholder="搜索划线 / 段落 / 批注（两字以上）"
                        className="max-w-xs"
                        onChange={(event): void => {
                            setFilters({ ...filters, keyword: event.target.value })
                        }}
                    />
                    <Button
                        variant={filters.orphanedOnly ? 'default' : 'ghost'}
                        size="sm"
                        onClick={(): void => {
                            setFilters({ ...filters, orphanedOnly: !filters.orphanedOnly })
                        }}
                    >
                        仅看失效
                    </Button>
                </div>
                {notice === null ? null : (
                    <Alert>
                        <AlertDescription>{notice}</AlertDescription>
                    </Alert>
                )}
                {error === null ? null : (
                    <Alert>
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}
                {items.length === 0 ? (
                    <StateEmpty
                        title={isLoading ? '正在读取标注' : '还没有标注'}
                        description={isLoading ? undefined : '在编辑区选中文字，即可划线或添加批注'}
                        icon={Highlighter}
                        isLoading={isLoading}
                    />
                ) : (
                    <div className="flex flex-col gap-2">
                        {items.map((item) => (
                            <AnnotationListItem key={item.id} item={item} onReveal={handleReveal} onRemove={remove} />
                        ))}
                    </div>
                )}
                {hasMore ? (
                    <Button variant="ghost" isLoading={isLoading} onClick={(): void => void loadMore()}>
                        加载更多
                    </Button>
                ) : null}
            </AppContent>
        </AppPage>
    )
}
