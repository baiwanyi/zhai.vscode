/**
 * 笔记列表标题行操作：常态提供搜索入口与进入多选，多选态只提供退出。
 * 复用 @webview/components/Button 承载图标入口（悬停提示由该组件提供），搜索输入取 @components/ui/input-group；
 * 展开态与关键词由 useNotesList 统一持有，本组件只按 search 分支渲染并上抛变更。
 * 关键约束：多选态只渲染退出按钮，避免两个模式的操作相互干扰；
 * 展开后的输入框以覆盖层占满标题行，依赖宿主给标题行加 relative 定位；
 * 覆盖层底色须与卡片同色并显式给出 dark 变体——input-group 自带 dark 半透明底色，
 * 只写普通 bg-* 会被它覆盖，标题会从覆盖层下透出；收起入口除输入框右侧的关闭按钮外还有 Esc 与失焦；
 * 焦点交由 autoFocus 承接，打开动作只切状态不手动 focus；
 * Esc 与关闭按钮均为显式取消（连同关键词清空），失焦只在关键词为空时收起。
 */
import { ListChecks, Search, X } from 'lucide-react'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@components/ui/input-group'
import { Button } from '@webview/components/Button'
import type { NotesSearchState } from '../hooks/useNotesList'
import type { JSX, KeyboardEvent } from 'react'

/** 搜索入口文案：按钮可读名与输入框占位共用，避免两处措辞漂移 */
const SEARCH_LABEL = '搜索笔记'

interface NotesHeaderActionsProps {
    isSelecting: boolean
    /** 搜索入口的展开态与关键词，由 useNotesList 下发 */
    search: NotesSearchState
    onToggleSelecting: () => void
}

export function NotesHeaderActions({ isSelecting, search, onToggleSelecting }: NotesHeaderActionsProps): JSX.Element {
    /** Esc 显式取消：收起输入框并清空关键词，列表回到未搜索状态 */
    function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
        if (event.key === 'Escape') {
            search.dismiss()
        }
    }

    if (isSelecting) {
        return (
            <Button
                variant="destructive"
                size="icon"
                aria-label="退出多选"
                tooltip="退出多选"
                onClick={onToggleSelecting}
            >
                <X />
            </Button>
        )
    }

    if (search.isOpen) {
        return (
            <InputGroup className="absolute inset-0 z-10 bg-card dark:bg-card has-[[data-slot=input-group-control]:focus-visible]:ring-0">
                <InputGroupAddon align="inline-start">
                    <Search />
                </InputGroupAddon>
                <InputGroupInput
                    autoFocus
                    value={search.query}
                    placeholder={SEARCH_LABEL}
                    aria-label={SEARCH_LABEL}
                    onChange={(event) => search.changeQuery(event.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={search.collapse}
                />
                <InputGroupAddon align="inline-end">
                    <InputGroupButton size="icon-xs" aria-label="关闭搜索" onClick={search.dismiss}>
                        <X />
                    </InputGroupButton>
                </InputGroupAddon>
            </InputGroup>
        )
    }

    return (
        <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="icon" aria-label={SEARCH_LABEL} tooltip={SEARCH_LABEL} onClick={search.open}>
                <Search />
            </Button>
            <Button variant="ghost" size="icon" aria-label="多选" tooltip="多选" onClick={onToggleSelecting}>
                <ListChecks />
            </Button>
        </div>
    )
}
