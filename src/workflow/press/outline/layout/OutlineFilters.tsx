/**
 * 大纲筛选栏：第一行是模块切换，第二行左侧是章纲的卷筛选与标题搜索、右侧是当前模块的新增按钮。
 * 复用约定：模块切换取 components/SegmentedRail（outline 形态、按内容宽度排布），卷下拉取 ui/select
 * （选项来自调用方派生的卷选项），搜索框取 ui/input-group，新增按钮取 components/Button 的 outline 变体。
 * 关键约束：模块只切视图，不改任何章节字段；卷筛选与标题搜索只作用于章纲页，其他模块不渲染这两项；
 * 「卷」既收窄列表也决定章纲右侧显示哪一卷的 AI 面板，切换卷的副作用（清空章节选中）由调用方处理；
 * 新增按钮按模块分派（新增卷 / 添加章节 / 添加阶段 / 添加线索），本组件只上报点击，不持有任何数据。
 */
import { Plus, Search } from 'lucide-react'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@components/ui/input-group'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import { AppMenu } from '@webview/components/AppPage'
import { Button } from '@webview/components/Button'
import { SegmentedRail } from '@webview/components/SegmentedRail'
import type { OutlineModuleKey } from '../../types'
import type { JSX } from 'react'
import { OUTLINE_MODULE_META } from '../../constants'

/** 各模块的新增入口文案：与页面上的数据层级一一对应 */
const ADD_LABELS: Readonly<Record<OutlineModuleKey, string>> = {
    volume: '新增卷',
    chapter: '添加章节',
    structure: '添加阶段',
    clue: '添加线索',
}

interface OutlineFiltersProps {
    module: OutlineModuleKey
    /** 卷筛选取值：'all' 为全部卷，否则为卷 id */
    volumeFilter: string
    /** 卷选项：由调用方按大纲树顺序去重，取值用卷 id */
    volumeOptions: readonly { value: string; label: string }[]
    /** 标题搜索关键词 */
    query: string
    onModuleChange: (module: OutlineModuleKey) => void
    onVolumeChange: (value: string) => void
    onQueryChange: (value: string) => void
    /** 当前模块的新增动作：新增卷 / 添加章节 / 添加阶段 / 添加线索 */
    onAdd: (module: OutlineModuleKey) => void
}

export function OutlineFilters({
    module,
    volumeFilter,
    volumeOptions,
    query,
    onModuleChange,
    onVolumeChange,
    onQueryChange,
    onAdd,
}: OutlineFiltersProps): JSX.Element {
    const isChapterModule = module === 'chapter'

    return (
        <AppMenu>
            <SegmentedRail
                items={OUTLINE_MODULE_META}
                value={module}
                onChange={onModuleChange}
                ariaLabel="大纲功能模块"
                isStretched={false}
            />
            <div className="flex w-full items-center gap-2">
                {isChapterModule ? (
                    <>
                        <Select value={volumeFilter} onValueChange={onVolumeChange}>
                            <SelectTrigger
                                className="h-8 w-28 shrink-0"
                                aria-label="当前卷"
                                title="只看这一卷的章节；切卷会清空当前选中的章"
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    <SelectItem value="all">全部卷</SelectItem>
                                    {volumeOptions.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                        <InputGroup className="min-w-0 max-w-64 flex-1">
                            <InputGroupAddon>
                                <Search />
                            </InputGroupAddon>
                            <InputGroupInput
                                value={query}
                                aria-label="搜索章节标题"
                                placeholder="搜索章节标题"
                                onChange={(event) => onQueryChange(event.target.value)}
                            />
                        </InputGroup>
                    </>
                ) : null}
                <Button variant="outline" className="ml-auto shrink-0" onClick={() => onAdd(module)}>
                    <Plus />
                    {ADD_LABELS[module]}
                </Button>
            </div>
        </AppMenu>
    )
}
