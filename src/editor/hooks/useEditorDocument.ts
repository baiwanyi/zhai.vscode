/**
 * 编辑区文档同步：从宿主拉取块快照渲染到 TipTap，编辑后只把发生变化的区间回写 TextDocument。
 * 复用约定：协议走 @shared/utils/bridge 的 request / onState，类型与守卫取 @shared/types/editor；
 * 块序列化用 ProseMirror 的 DOMSerializer，回写区间由 blockDiff 用快照偏移算出来。
 * 关键约束：baseline 必须在 setContent 之后同步重新采样——宿主的 HTML 与 PM 序列化结果不同，
 * 拿宿主 HTML 当基准会把所有块误判为变化；只读快照绝不发起回写，收到 stale 立即重拉快照并放弃本次修改；
 * 空文本块（编辑器尾部恒有一个）不产生 Markdown，采集时必须跳过，否则块序列会与宿主整体错位；
 * 回写必须串行：并发请求会带同一版本发出，后到的一条必然 stale 并把用户刚敲进去的内容整篇回滚；
 * 宿主没有真正落盘（零写入/拒绝）时不能当成功——baseline 一旦按旧内容刷新，之后每次输入都会被同样丢弃；
 * 回写不再做语法自检拦截：渲染侧已把不认识的节点降级为纯文本，协议里也没有「不支持语法」的拒绝码；
 * 只读与同步失败不走常驻状态栏，一律用 sonner 提示，同一类提示用固定 id 去重不叠加。
 */
import { DOMSerializer } from '@tiptap/pm/model'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { isEditorSnapshotMessage } from '@shared/types/editor'
import type { EditorBlock, EditorChangeResult, EditorSnapshotMessage } from '@shared/types/editor'
import { HostRequestError, onState, request } from '@shared/utils/bridge'
import type { BlockBaseline } from '../blocks/blockDiff'
import type { Editor } from '@tiptap/react'
import { buildBlockChanges, pairBaseline } from '../blocks/blockDiff'
import { setAssetPrefix } from '../marks/imageAsset'

/** 回写防抖：与文档同步口径一致，避免每次按键都产生一次 WorkspaceEdit */
const SYNC_DEBOUNCE_MS = 500

/** 快照补拉的最小间隔：路径为空时每次按键都重试会把协议打满，又不该像旧版那样只放行一次 */
const RECOVERY_INTERVAL_MS = 2000

/** 提示文案与去重 id：同步失败与只读都必须让用户看见，不能静默 */
const MESSAGE_FAILED = '同步失败，请切换到文本编辑器确认'
const MESSAGE_DISCARDED = '改动未能写入磁盘：该段语法暂不支持回写，原文已保留'
const MESSAGE_STALE = '文档已被外部修改，已刷新为最新内容，请重新输入'
const MESSAGE_NO_SNAPSHOT = '尚未取到文档快照，改动暂无法保存'
const TOAST_ID_READONLY = 'zhai-editor-readonly'
const TOAST_ID_FAILED = 'zhai-editor-failed'
const TOAST_ID_DISCARDED = 'zhai-editor-discarded'
const TOAST_ID_STALE = 'zhai-editor-stale'
const TOAST_ID_NO_SNAPSHOT = 'zhai-editor-no-snapshot'

/** 失败原因摘要：只显示「同步失败」无法区分是参数非法、版本过期还是转换抛错 */
function describeError(error: unknown): string {
    if (error instanceof HostRequestError) {
        return `${error.code}：${error.message}`
    }
    return error instanceof Error ? error.message : '未知错误'
}

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
    /** 是否允许编辑：宿主现在恒为 true，保留字段只为兼容既有分支 */
    isEditable: boolean
    /** 当前文档相对路径：标注协议用它做路径校验 */
    path: string
    /** 块偏移快照：标注存全文偏移时用于换算 */
    blocks: EditorBlock[]
}

export interface EditorDocumentState extends EditorDocumentSnapshotState {
    /** 强制重载快照：内容被外部整篇改写后需要按最新原文重建 */
    reload: () => Promise<void>
    /** 立即同步未提交的编辑；返回是否真的写入（无变化、只读、失败均为 false） */
    flush: () => Promise<boolean>
}

export function useEditorDocument(editor: Editor | null): EditorDocumentState {
    const [state, setState] = useState<EditorDocumentSnapshotState>({
        isEditable: true,
        path: '',
        blocks: [],
    })
    const baselineRef = useRef<BlockBaseline[]>([])
    const pathRef = useRef('')
    const versionRef = useRef(0)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    /** 上次补拉快照的时间戳：路径为空时按最小间隔重试，既不空转也不永久放弃 */
    const recoveryRef = useRef(0)
    /** 在途的回写任务：并发 flush 会带同一版本发出两个请求，必须让后到的那一次排队 */
    const inflightRef = useRef<Promise<boolean> | null>(null)
    /** 在途期间又收到新的 flush 请求：本轮结束后补跑一次，不能丢用户最后那段输入 */
    const pendingRef = useRef(false)

    /**
     * 采样基准：setContent 是同步事务，文档模型立即就绪，序列化不必等渲染帧。
     * 旧实现放在 requestAnimationFrame 里，webview 不可见时 rAF 不执行，baseline 会一直是空数组，
     * 之后第一次回写就把整篇当成新增内容全量替换。
     */
    const sampleBaseline = useCallback((blocks: readonly EditorBlock[]): void => {
        if (editor === null || editor.isDestroyed) {
            return
        }
        baselineRef.current = pairBaseline(collectBlocks(editor), blocks)
    }, [editor])

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
            recoveryRef.current = 0
            setState({
                isEditable: snapshot.editable,
                path: snapshot.path,
                blocks: snapshot.blocks,
            })
            sampleBaseline(snapshot.blocks)
        },
        [editor, sampleBaseline],
    )

    /** 拉取最新快照：首次进入与 stale / 回滚后共用；force 用于同版本内容回滚 */
    const loadSnapshot = useCallback(
        async (force: boolean): Promise<void> => {
            try {
                const snapshot = await request<EditorSnapshotMessage>('editor/snapshot')
                applySnapshot(snapshot, force)
            } catch (error) {
                toast.error(MESSAGE_FAILED, { id: TOAST_ID_FAILED, description: describeError(error) })
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

    /** 一轮回写：无变化不发请求，宿主没落盘必须说出来 */
    const flushOnce = useCallback(async (): Promise<boolean> => {
        if (editor === null || editor.isDestroyed) {
            return false
        }
        if (!editor.isEditable) {
            // 只读时静默 return 会让用户以为「改了没保存」，实际是编辑命令全被拦下
            toast.warning('当前文档为只读，改动不会写回', { id: TOAST_ID_READONLY })
            return false
        }
        if (pathRef.current.length === 0) {
            // 快照没拿到时前端根本不知道该写哪个文件，表现就是「怎么改都不保存」且一声不响。
            // 这里按最小间隔反复补拉（旧版只放行一次，第一次失败后整场会话都不再重试）。
            const now = Date.now()
            if (now - recoveryRef.current >= RECOVERY_INTERVAL_MS) {
                recoveryRef.current = now
                await loadSnapshot(true)
            }
            if (pathRef.current.length === 0) {
                toast.warning(MESSAGE_NO_SNAPSHOT, { id: TOAST_ID_NO_SNAPSHOT })
                return false
            }
        }
        const blocks = collectBlocks(editor)
        const edits = buildBlockChanges(blocks, baselineRef.current)
        if (edits.length === 0) {
            return false
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
                toast.warning(MESSAGE_STALE, { id: TOAST_ID_STALE })
                return false
            }
            if (result.failed === true) {
                // applyEdit 被拒绝或落盘失败：编辑器里已经改好，磁盘上却没有——必须说
                toast.error('改动未能保存：请确认文件未被占用或设为只读', { id: TOAST_ID_FAILED })
                return false
            }
            if (result.appliedBlocks === 0) {
                // 区间被转换环节整体放弃（越界、重叠、合并单元格等）：磁盘上什么都没变。
                // 此时绝不能刷新 baseline——一旦按旧内容对齐，之后每次输入都会算成同一批无效区间，
                // 表现就是「怎么改都不保存」且没有任何提示。
                toast.error(MESSAGE_DISCARDED, { id: TOAST_ID_DISCARDED })
                return false
            }
            // 偏移基准必须跟着宿主刷新：写入会改变正文长度，旧区间再也对不上新内容
            if (result.blocks !== undefined) {
                baselineRef.current = pairBaseline(blocks, result.blocks)
            }
            versionRef.current = result.version
            // 回写成功即收起上一次的失败提示，避免旧错误一直挂在屏幕上
            toast.dismiss(TOAST_ID_FAILED)
            toast.dismiss(TOAST_ID_DISCARDED)
            toast.dismiss(TOAST_ID_STALE)
            toast.dismiss(TOAST_ID_NO_SNAPSHOT)
            return true
        } catch (error) {
            toast.error(MESSAGE_FAILED, { id: TOAST_ID_FAILED, description: describeError(error) })
            return false
        }
    }, [editor, loadSnapshot])

    /**
     * 串行回写：同一时刻只允许一次在途请求，期间到达的 flush 在结束后补跑。
     * 不加这道闸时，防抖计时器、visibilitychange 与浮层提交会同时发起请求，
     * 两条请求带同一个 version，宿主对第二条必然回 stale，前端随即整篇重载，用户输入当场消失。
     */
    const flush = useCallback(async (): Promise<boolean> => {
        if (editor === null || editor.isDestroyed) {
            return false
        }
        if (inflightRef.current !== null) {
            pendingRef.current = true
            return inflightRef.current
        }
        const task = (async (): Promise<boolean> => {
            let hasWritten = await flushOnce()
            while (pendingRef.current) {
                pendingRef.current = false
                hasWritten = (await flushOnce()) || hasWritten
            }
            return hasWritten
        })()
        inflightRef.current = task
        try {
            return await task
        } finally {
            inflightRef.current = null
        }
    }, [editor, flushOnce])

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
