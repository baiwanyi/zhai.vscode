/**
 * 编辑区文档同步：从宿主拉取块快照渲染到 TipTap，编辑后只把发生变化的区间回写 TextDocument。
 * 复用约定：协议走 @shared/utils/bridge 的 request / onState，类型与守卫取 @shared/types/editor；
 * 块序列化用 ProseMirror 的 DOMSerializer，回写区间由 blockDiff 用快照偏移算出来。
 * 关键约束：baseline 必须在 setContent 之后重新采样——宿主的 HTML 与 PM 序列化结果不同，
 * 拿宿主 HTML 当基准会把所有块误判为变化；只读快照绝不发起回写，收到 stale 立即重拉快照并放弃本次修改；
 * 空文本块（编辑器尾部恒有一个）不产生 Markdown，采集时必须跳过，否则块序列会与宿主整体错位；
 * 只读与同步失败不走常驻状态栏，一律用 sonner 提示，同一类提示用固定 id 去重不叠加。
 */
import { DOMSerializer } from '@tiptap/pm/model'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { isEditorSnapshotMessage } from '@shared/types/editor'
import type { EditorBlock, EditorChangeResult, EditorSnapshotMessage } from '@shared/types/editor'
import { onState, request } from '@shared/utils/bridge'
import type { BlockBaseline } from '../blocks/blockDiff'
import type { Editor } from '@tiptap/react'
import { buildBlockChanges, pairBaseline } from '../blocks/blockDiff'
import { setAssetPrefix } from '../marks/imageAsset'

/** 回写防抖：与文档同步口径一致，避免每次按键都产生一次 WorkspaceEdit */
const SYNC_DEBOUNCE_MS = 500

/** 提示文案与去重 id：同步失败、只读、自检拦截都必须让用户看见，不能静默 */
const MESSAGE_READONLY = '只读预览：文档含暂不支持的语法，可切换到文本编辑器继续编辑'
const MESSAGE_FAILED = '同步失败，请切换到文本编辑器确认'
const MESSAGE_REJECTED = '修改含暂不支持的语法，已阻止保存并回滚'
const TOAST_ID_READONLY = 'zhai-editor-readonly'
const TOAST_ID_FAILED = 'zhai-editor-failed'
const TOAST_ID_REJECTED = 'zhai-editor-rejected'

/** 采集顶层块 HTML：跳过空文本块，它们不产生 Markdown 块，留着会让块序列与宿主错位 */
function collectBlocks(editor: Editor): string[] {
    const serializer = DOMSerializer.fromSchema(editor.schema)
    const blocks: string[] = []
    editor.state.doc.content.forEach((node) => {
        if (node.isTextblock && node.content.size === 0) {
            return
        }
        const container = document.createElement('div')
        container.append(serializer.serializeNode(node))
        blocks.push(container.innerHTML)
    })
    return blocks
}

/** 快照状态：随推送变化的部分，与动作分开，避免 useState 被迫持有函数 */
export interface EditorDocumentSnapshotState {
    /** 是否允许编辑：宿主判定为 false 时前端必须置只读 */
    isEditable: boolean
    /** 当前文档相对路径：标注协议用它做路径校验 */
    path: string
    /** 块偏移快照：标注存全文偏移时用于换算 */
    blocks: EditorBlock[]
}

export interface EditorDocumentState extends EditorDocumentSnapshotState {
    /** 强制重载快照：内容被外部整篇改写后需要按最新原文重建 */
    reload: () => Promise<void>
    /** 立即同步未提交的编辑：切换编辑器或离开页面前调用，避免最后 500ms 的输入被漏掉 */
    flush: () => Promise<void>
}

export function useEditorDocument(editor: Editor | null): EditorDocumentState {
    const [state, setState] = useState<EditorDocumentSnapshotState>({
        isEditable: false,
        path: '',
        blocks: [],
    })
    const baselineRef = useRef<BlockBaseline[]>([])
    const pathRef = useRef('')
    const versionRef = useRef(0)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    /** 只读提示只在「变为只读」时弹一次，恢复可编辑后复位 */
    const readonlyNotifiedRef = useRef(false)

    /** 应用快照：先灌内容再采样基准，最后按宿主的 editable 决定是否可写 */
    const applySnapshot = useCallback(
        (snapshot: EditorSnapshotMessage, force: boolean): void => {
            // 图片资源前缀与文档版本无关：即使这次内容被版本去重跳过，也要先更新，
            // 否则图片会一直挂在空前缀上显示为裂图
            setAssetPrefix(snapshot.assetPrefix)
            if (editor === null || (!force && snapshot.version <= versionRef.current)) {
                return
            }
            editor.commands.setContent(snapshot.blocks.map((block) => block.html).join(''), { emitUpdate: false })
            editor.setEditable(snapshot.editable)
            pathRef.current = snapshot.path
            versionRef.current = snapshot.version
            if (snapshot.editable) {
                readonlyNotifiedRef.current = false
            } else if (!readonlyNotifiedRef.current) {
                readonlyNotifiedRef.current = true
                toast.warning(MESSAGE_READONLY, { id: TOAST_ID_READONLY })
            }
            setState({
                isEditable: snapshot.editable,
                path: snapshot.path,
                blocks: snapshot.blocks,
            })
            // 下一帧再采样：setContent 的 DOM 同步完成后序列化结果才稳定
            requestAnimationFrame(() => {
                baselineRef.current = pairBaseline(collectBlocks(editor), snapshot.blocks)
            })
        },
        [editor],
    )

    /** 拉取最新快照：首次进入与 stale / 自检拦截后共用；force 用于同版本内容回滚 */
    const loadSnapshot = useCallback(
        async (force: boolean): Promise<void> => {
            try {
                const snapshot = await request<EditorSnapshotMessage>('editor/snapshot')
                applySnapshot(snapshot, force)
            } catch {
                toast.error(MESSAGE_FAILED, { id: TOAST_ID_FAILED })
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
            if (message.channel !== 'editor' || !isEditorSnapshotMessage(message.payload)) {
                return
            }
            if (message.payload.version === versionRef.current) {
                return
            }
            applySnapshot(message.payload, false)
        })
    }, [applySnapshot])

    /** 收集变化区间并回写：无变化不发请求，只读状态直接跳过 */
    const flush = useCallback(async (): Promise<void> => {
        if (editor === null || pathRef.current.length === 0 || !editor.isEditable) {
            return
        }
        const blocks = collectBlocks(editor)
        const edits = buildBlockChanges(blocks, baselineRef.current)
        if (edits.length === 0) {
            return
        }
        try {
            const result = await request<EditorChangeResult>('editor/change', {
                path: pathRef.current,
                version: versionRef.current,
                edits,
            })
            if (result.stale) {
                // 外部已改动：放弃本次输入，以宿主内容为准，避免覆盖别人的修改
                await loadSnapshot(true)
                return
            }
            if (result.rejected === 'unsupported-syntax') {
                // 写入前自检拦下：宿主未落盘，本地必须回滚到宿主版本，并明确告知原因
                await loadSnapshot(true)
                toast.error(MESSAGE_REJECTED, { id: TOAST_ID_REJECTED })
                return
            }
            // 偏移基准必须跟着宿主刷新：写入会改变正文长度，旧区间再也对不上新内容
            if (result.blocks !== undefined) {
                baselineRef.current = pairBaseline(blocks, result.blocks)
            }
            versionRef.current = result.version
            // 回写成功即收起上一次的同步失败提示，避免旧错误一直挂在屏幕上
            toast.dismiss(TOAST_ID_FAILED)
        } catch {
            toast.error(MESSAGE_FAILED, { id: TOAST_ID_FAILED })
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

    /** 强制重载：外部整篇改写原文后，富文本侧必须按新原文重建，不能靠版本去重跳过 */
    const reload = useCallback(async (): Promise<void> => {
        await loadSnapshot(true)
    }, [loadSnapshot])

    return { ...state, reload, flush }
}
