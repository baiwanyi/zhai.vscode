/**
 * 笔记动作：新建、打开、置顶与批量删除（移入回收站）。
 * 复用 ../core/actionRunner 的请求与提示基础设施、../note/utils 的失败文案，在途态由调用方注入。
 * 关键约束：打开笔记不占在途态，避免顶栏操作区被整体禁用；
 * 批量删除按固定批大小串行提交，汇总后只刷新一次快照、只提示一次，避免长列表把单次请求拖成无反馈的等待；
 * 某批请求整体异常时已提示并返回 null，由调用方保留待处理项供原地重试。
 */
import { useCallback } from 'react'
import { toast } from 'sonner'
import type {
    CreateNoteRequest,
    CreatedNote,
    DeleteNotesResult,
    OpenNoteRequest,
    PinNotesRequest,
} from '@shared/types/note'
import type { PendingScope } from './usePendingAction'
import { callHostRequest } from '../core/actionRunner'
import { formatNoteDeleteFailure } from '../note/utils'

/** 批量删除的单批条数：宿主逐条搬移并读标题，一次提交过多会让单次请求长时间占用通道 */
const DELETE_BATCH_SIZE = 50

export interface NoteActionsOptions {
    tracker: PendingScope
    /** 动作落定后的快照刷新：成功才调用 */
    onCompleted: () => Promise<void>
}

export interface NoteActionsState {
    createNote: (notebookId?: string) => Promise<CreatedNote | null>
    openNote: (path: string) => Promise<void>
    setPinned: (paths: string[], isPinned: boolean) => Promise<void>
    deleteNotes: (paths: string[]) => Promise<DeleteNotesResult | null>
}

export function useNoteActions(options: NoteActionsOptions): NoteActionsState {
    const { onCompleted, tracker } = options

    /** 新建空笔记：可指定落点笔记本，成功后刷新统计并回报提示，返回值供页面选中新条目 */
    const createNote = useCallback(
        async (notebookId?: string): Promise<CreatedNote | null> => {
            tracker.begin('create')
            try {
                const payload: CreateNoteRequest = notebookId === undefined ? {} : { notebookId }
                const created = await callHostRequest<CreatedNote>('note/create', payload)
                if (created === null) {
                    return null
                }
                await onCompleted()
                toast.success(`已创建笔记：${created.title}`)
                return created
            } finally {
                tracker.end('create')
            }
        },
        [onCompleted, tracker],
    )

    /** 打开笔记：路径存在性由宿主按索引库校验，失败仅提示，不改动列表与统计，也不占在途态 */
    const openNote = useCallback(async (path: string): Promise<void> => {
        const payload: OpenNoteRequest = { path }
        await callHostRequest('note/open', payload)
    }, [])

    /** 置顶切换：结果由数据层提示，成功后刷新快照让列表顺序收敛 */
    const setPinned = useCallback(
        async (paths: string[], isPinned: boolean): Promise<void> => {
            const payload: PinNotesRequest = { paths, isPinned }
            tracker.begin('pin')
            try {
                const result = await callHostRequest('note/pin', payload)
                if (result === null) {
                    return
                }
                await onCompleted()
            } finally {
                tracker.end('pin')
            }
        },
        [onCompleted, tracker],
    )

    /**
     * 批量删除笔记：宿主把笔记移入应用内回收站并以 failures 回传失败原因，本层分别提示后刷新列表与统计。
     * 关键约束：成功与失败分别提示，全部失败时不做成功提示；部分成功仍返回已处理路径供页面清理选中态；
     * 全选可能上千条，按 DELETE_BATCH_SIZE 串行切批提交，结果汇总后只刷新一次快照、只提示一次。
     */
    const deleteNotes = useCallback(
        async (paths: string[]): Promise<DeleteNotesResult | null> => {
            if (paths.length === 0) {
                return null
            }
            tracker.begin('delete')
            try {
                const result: DeleteNotesResult = { trashedPaths: [], failures: [] }
                for (let start = 0; start < paths.length; start += DELETE_BATCH_SIZE) {
                    const batch = await callHostRequest<DeleteNotesResult>('note/delete', {
                        paths: paths.slice(start, start + DELETE_BATCH_SIZE),
                    })
                    if (batch === null) {
                        return null
                    }
                    result.trashedPaths.push(...batch.trashedPaths)
                    result.failures.push(...batch.failures)
                }
                await onCompleted()
                if (result.trashedPaths.length > 0) {
                    toast.success(`已移入回收站 ${String(result.trashedPaths.length)} 篇笔记`)
                }
                if (result.failures.length > 0) {
                    toast.error(formatNoteDeleteFailure(result.failures))
                }
                return result
            } finally {
                tracker.end('delete')
            }
        },
        [onCompleted, tracker],
    )

    return { createNote, openNote, setPinned, deleteNotes }
}
