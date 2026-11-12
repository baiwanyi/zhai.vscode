/**
 * 编辑区文档同步：从宿主拉取块快照渲染到 TipTap，编辑后只把发生变化的块回写 TextDocument。
 * 复用约定：协议走 @shared/utils/bridge 的 request / onState，类型与守卫取 @shared/types/editor；
 * 块序列化用 ProseMirror 的 DOMSerializer，宿主侧按同样的下标定位 mdast 顶层节点。
 * 关键约束：baseline 必须在 setContent 之后重新采样——宿主的 HTML 与 PM 序列化结果不同，
 * 拿宿主 HTML 当基准会把所有块误判为变化；只读快照绝不发起回写，收到 stale 立即重拉快照并放弃本次修改。
 */
import { DOMSerializer } from '@tiptap/pm/model'
import { useCallback, useEffect, useRef, useState } from 'react'
import { isEditorDocSnapshot } from '@shared/types/editor'
import type { EditorBlock, EditorChangeResult, EditorDocSnapshot } from '@shared/types/editor'
import { onState, request } from '@shared/utils/bridge'
import type { Editor } from '@tiptap/react'

/** 回写防抖：与文档同步口径一致，避免每次按键都产生一次 WorkspaceEdit */
const SYNC_DEBOUNCE_MS = 500

/** 状态文案：同步失败与只读都必须让用户看见，不能静默 */
const STATUS_LOADING = '载入中'
const STATUS_READY = '富文本模式'
const STATUS_READONLY = '只读预览：文档含暂不支持的语法'
const STATUS_FAILED = '同步失败，请改用文本编辑器确认'
const STATUS_REJECTED = '修改含暂不支持的语法，已阻止保存并回滚'

/** 把当前文档的顶层节点序列化为 HTML 数组：下标即宿主 blocks 下标 */
function serializeBlocks(editor: Editor): string[] {
    const serializer = DOMSerializer.fromSchema(editor.schema)
    const blocks: string[] = []
    editor.state.doc.content.forEach((node) => {
        const container = document.createElement('div')
        container.append(serializer.serializeNode(node))
        blocks.push(container.innerHTML)
    })
    return blocks
}

export interface EditorDocumentState {
    status: string
    /** 是否允许编辑：宿主判定为 false 时前端必须置只读 */
    isEditable: boolean
    /** 当前文档相对路径：标注协议用它做路径校验 */
    path: string
    /** 块偏移快照：标注存全文偏移时用于换算 */
    blocks: EditorBlock[]
}

export function useEditorDocument(editor: Editor | null): EditorDocumentState {
    const [state, setState] = useState<EditorDocumentState>({
        status: STATUS_LOADING,
        isEditable: false,
        path: '',
        blocks: [],
    })
    const baselineRef = useRef<string[]>([])
    const pathRef = useRef('')
    const versionRef = useRef(0)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    /** 应用快照：先灌内容再采样基准，最后按宿主的 editable 决定是否可写 */
    const applySnapshot = useCallback(
        (snapshot: EditorDocSnapshot, force: boolean): void => {
            if (editor === null || (!force && snapshot.version <= versionRef.current)) {
                return
            }
            editor.commands.setContent(snapshot.blocks.map((block) => block.html).join(''), { emitUpdate: false })
            editor.setEditable(snapshot.editable)
            pathRef.current = snapshot.path
            versionRef.current = snapshot.version
            setState({
                status: snapshot.editable ? STATUS_READY : STATUS_READONLY,
                isEditable: snapshot.editable,
                path: snapshot.path,
                blocks: snapshot.blocks,
            })
            // 下一帧再采样：setContent 的 DOM 同步完成后序列化结果才稳定
            requestAnimationFrame(() => {
                baselineRef.current = serializeBlocks(editor)
            })
        },
        [editor],
    )

    /** 拉取最新快照：首次进入与 stale / 自检拦截后共用；force 用于同版本内容回滚 */
    const loadSnapshot = useCallback(
        async (force: boolean): Promise<void> => {
            try {
                const snapshot = await request<EditorDocSnapshot>('editor/snapshot')
                applySnapshot(snapshot, force)
            } catch {
                setState((prev) => ({ ...prev, status: STATUS_FAILED, isEditable: false }))
            }
        },
        [applySnapshot],
    )

    useEffect(() => {
        if (editor === null) {
            return
        }
        void loadSnapshot(false)
    }, [editor, loadSnapshot])

    // 宿主推送：外部修改、保存后刷新、只读判定变化
    useEffect(() => {
        return onState((message) => {
            if (message.channel !== 'editor' || !isEditorDocSnapshot(message.payload)) {
                return
            }
            if (message.payload.version === versionRef.current) {
                return
            }
            applySnapshot(message.payload, false)
        })
    }, [applySnapshot])

    /** 收集变化块并回写：无变化不发请求，只读状态直接跳过 */
    const flush = useCallback(async (): Promise<void> => {
        if (editor === null || pathRef.current.length === 0 || !editor.isEditable) {
            return
        }
        const blocks = serializeBlocks(editor)
        const changes = blocks
            .map((html, index) => ({ html, index }))
            .filter((item) => item.html !== baselineRef.current[item.index])
        if (changes.length === 0) {
            return
        }
        try {
            const result = await request<EditorChangeResult>('editor/change', {
                path: pathRef.current,
                version: versionRef.current,
                blocks: changes,
            })
            if (result.stale) {
                // 外部已改动：放弃本次输入，以宿主内容为准，避免覆盖别人的修改
                await loadSnapshot(true)
                return
            }
            if (result.rejected === 'unsupported-syntax') {
                // 写入前自检拦下：宿主未落盘，本地必须回滚到宿主版本，并明确告知原因
                await loadSnapshot(true)
                setState((prev) => ({ ...prev, status: STATUS_REJECTED }))
                return
            }
            baselineRef.current = blocks
            versionRef.current = result.version
            setState((prev) => ({ ...prev, status: STATUS_READY }))
        } catch {
            setState((prev) => ({ ...prev, status: STATUS_FAILED }))
        }
    }, [editor, loadSnapshot])

    useEffect(() => {
        if (editor === null) {
            return
        }
        const handleUpdate = (): void => {
            if (timerRef.current !== null) {
                clearTimeout(timerRef.current)
            }
            timerRef.current = setTimeout((): void => {
                timerRef.current = null
                void flush()
            }, SYNC_DEBOUNCE_MS)
        }
        editor.on('update', handleUpdate)
        return (): void => {
            editor.off('update', handleUpdate)
            if (timerRef.current !== null) {
                clearTimeout(timerRef.current)
                timerRef.current = null
            }
        }
    }, [editor, flush])

    return state
}
