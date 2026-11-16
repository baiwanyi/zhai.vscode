/**
 * 笔记操作族：打开、新建与条目动作分发（打开 / 置顶切换 / 送删除确认）。
 * 复用约定：宿主动作由页面从 useDashboardActions 注入，活跃选中态走 useActiveNote，删除入口走 useNotesDeleteDialog；
 * 本层只负责把「操作意图」翻译成宿主调用与选中态回填，不申请请求、不发提示。
 * 关键约束：打开先本地回填选中态再等宿主打开，避免高亮丢失；
 * 新建成功后回填选中态并在落点笔记本未展开时展开该组，保证新笔记立刻可见；
 * 删除只送入确认弹窗，不直接提交宿主。
 */
import { useCallback } from 'react'
import type { NoteAction } from '@shared/types/dashboard'
import type { CreatedNote } from '@shared/types/note'

export interface NoteActionsOptions {
    openNote: (path: string) => Promise<void>
    createNote: (notebookId?: string) => Promise<CreatedNote | null>
    setPinned: (paths: string[], isPinned: boolean) => Promise<void>
    setActiveId: (path: string | null) => void
    isNotebookOpen: (id: string) => boolean
    toggleNotebookOpen: (id: string) => void
    requestDelete: (paths: readonly string[]) => void
}

export interface NoteActionsState {
    open: (path: string) => void
    create: (notebookId?: string) => Promise<void>
    invoke: (path: string, action: NoteAction) => void
}

export function useDashboardNoteActions(options: NoteActionsOptions): NoteActionsState {
    const {
        createNote: hostCreateNote,
        isNotebookOpen,
        openNote: hostOpenNote,
        requestDelete,
        setActiveId,
        setPinned,
        toggleNotebookOpen,
    } = options

    /** 打开笔记：先本地回填选中态避免打开瞬间高亮丢失，随后由宿主按索引路径打开并以活跃编辑器收敛 */
    const open = useCallback(
        (path: string): void => {
            setActiveId(path)
            void hostOpenNote(path)
        },
        [hostOpenNote, setActiveId],
    )

    /** 新建笔记：默认落点由宿主决定；指定笔记本时顺带展开该组，让新笔记立刻可见 */
    const create = useCallback(
        async (notebookId?: string): Promise<void> => {
            const created = await hostCreateNote(notebookId)
            if (created === null) {
                return
            }
            setActiveId(created.path)
            if (notebookId !== undefined && !isNotebookOpen(notebookId)) {
                toggleNotebookOpen(notebookId)
            }
        },
        [hostCreateNote, isNotebookOpen, setActiveId, toggleNotebookOpen],
    )

    /** 条目动作分发：删除须二次确认，先把条目送入弹窗，确认后才提交宿主 */
    const invoke = useCallback(
        (path: string, action: NoteAction): void => {
            if (action === 'open') {
                open(path)
                return
            }
            if (action === 'pin' || action === 'unpin') {
                void setPinned([path], action === 'pin')
                return
            }
            requestDelete([path])
        },
        [open, requestDelete, setPinned],
    )

    return { open, create, invoke }
}
