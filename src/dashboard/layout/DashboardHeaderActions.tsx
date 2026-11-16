/**
 * 仪表盘头部操作：页头首行常驻的搜索输入框与「添加笔记」按钮。
 * 复用 @components/ui/input-group 承载搜索框、@webview/components/Button 承载图标入口；
 * 关键词与清空动作由页面 useNoteQuery 下发，本组件不持有状态，只上抛变更。
 * 关键约束：清空按钮仅有关键词时渲染，避免空输入框右侧留下带内边距的空位；
 * 搜索框取 flex-1 撑满首行剩余宽度，关键词按 SEARCH_QUERY_MAX_LENGTH 截断——宿主只校验非空、不设上限；
 * 「添加笔记」按 isBusy 禁用，避免在途重复提交；
 * 回收站入口不占页头，随笔记区块的「更多」下拉收纳；
 * 「添加笔记」落点是默认笔记本，具体笔记本内的新建入口在分组行上。
 */
import { Plus, Search, X } from 'lucide-react'
import { useRef, type JSX } from 'react'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@components/ui/input-group'
import { Button } from '@webview/components/Button'
import type { NotesSearchState } from '../hooks/useNoteQuery'

/** 搜索框文案：输入框占位与可读名共用，避免两处措辞漂移 */
export const SEARCH_LABEL = '搜索笔记'

/** 关键词长度上限：宿主只校验非空，误粘贴长文时挡住无意义的全表匹配（instr 逐行比对） */
const SEARCH_QUERY_MAX_LENGTH = 100

interface DashboardHeaderActionsProps {
    /** 有操作在途时禁用「添加笔记」，避免重复提交 */
    isBusy: boolean
    /** 搜索框的关键词与变更、清空动作，由 useNoteQuery 下发 */
    search: NotesSearchState
    onCreate: () => void
}

export function DashboardHeaderActions({ isBusy, search, onCreate }: DashboardHeaderActionsProps): JSX.Element {
    /** 输入框引用：清空后要把焦点交回这里，键盘触发时按钮会一直持着焦点 */
    const inputRef = useRef<HTMLInputElement>(null)

    return (
        <div className="mb-3 flex min-h-8 flex-1 items-center gap-2">
            <InputGroup className="flex-1 rounded-full">
                <InputGroupAddon align="inline-start">
                    <Search />
                </InputGroupAddon>
                <InputGroupInput
                    ref={inputRef}
                    value={search.query}
                    placeholder={SEARCH_LABEL}
                    aria-label={SEARCH_LABEL}
                    maxLength={SEARCH_QUERY_MAX_LENGTH}
                    onChange={(event) => search.changeQuery(event.target.value)}
                />
                {search.query.length > 0 ? (
                    <InputGroupAddon align="inline-end">
                        <InputGroupButton
                            size="icon-xs"
                            aria-label="清空搜索"
                            onMouseDown={(event) => {
                                // 保住输入框焦点：清空后可直接继续输入，不必再点一次输入框
                                event.preventDefault()
                            }}
                            onClick={() => {
                                search.clear()
                                // 键盘（Enter / 空格）不触发 mousedown，清空后把焦点交回输入框
                                inputRef.current?.focus()
                            }}
                        >
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
                aria-label="添加笔记"
                onClick={onCreate}
                className="rounded-full"
            >
                <Plus />
            </Button>
        </div>
    )
}
