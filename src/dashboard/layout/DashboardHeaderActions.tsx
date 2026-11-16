/**
 * 仪表盘头部操作：页头首行常驻的搜索输入框与「添加笔记」按钮。
 * 复用 @components/ui/input-group 承载搜索框、@webview/components/Button 承载图标入口；
 * 关键词与清空动作由页面 useNotesList 下发，本组件不持有状态，只上抛变更。
 * 关键约束：清空按钮仅有关键词时渲染，避免空输入框右侧留下带内边距的空位；
 * 搜索框取 flex-1 撑满首行剩余宽度；「添加笔记」按钮按 isBusy 统一禁用。
 */
import { Plus, Search, X } from 'lucide-react'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@components/ui/input-group'
import { Button } from '@webview/components/Button'
import type { NotesSearchState } from '../hooks/useNotesList'
import type { JSX } from 'react'
import { SEARCH_LABEL } from '../note/NotesHeaderActions'

interface DashboardHeaderActionsProps {
    /** 有操作在途时禁用「添加笔记」，避免重复建笔记 */
    isBusy: boolean
    /** 搜索框的关键词与变更、清空动作，由 useNotesList 下发 */
    search: NotesSearchState
    onCreate: () => void
}

export function DashboardHeaderActions({ isBusy, search, onCreate }: DashboardHeaderActionsProps): JSX.Element {
    return (
        <div className="flex min-h-8 flex-1 items-center gap-2 mb-3">
            <InputGroup className="flex-1 rounded-full">
                <InputGroupAddon align="inline-start">
                    <Search />
                </InputGroupAddon>
                <InputGroupInput
                    value={search.query}
                    placeholder={SEARCH_LABEL}
                    aria-label={SEARCH_LABEL}
                    onChange={(event) => search.changeQuery(event.target.value)}
                />
                {search.query.length > 0 ? (
                    <InputGroupAddon align="inline-end">
                        <InputGroupButton size="icon-xs" aria-label="清空搜索" onClick={search.clear}>
                            <X />
                        </InputGroupButton>
                    </InputGroupAddon>
                ) : null}
            </InputGroup>
            <Button
                size="icon-xs"
                variant="primary"
                disabled={isBusy}
                tooltip="添加笔记"
                onClick={onCreate}
                className="rounded-full"
            >
                <Plus />
            </Button>
        </div>
    )
}
