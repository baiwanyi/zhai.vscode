/**
 * 写作工作区装配：按作品目录读取宿主文档、解析成草稿，并负责草稿的即时落盘。
 * 复用约定：文档解析交给 ../document 的 parseProjectWorkspace，序列化交给 ../serialize，
 * 请求统一走 @webview/bridge（方法名受 HostMethodName 约束），错误经 ../utils 的 toastError 提示。
 * 关键约束：草稿同时存在于 ref 与 state 两份——写盘与合并读 ref（最新值），渲染读 state；
 * 写盘串行排队，防抖窗口内同范围的多次输入合并成一次请求；切换作品与卸载都要清掉未到期的防抖任务，
 * 否则上一个作品的草稿会被写进新作品。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type {
    PressApplyRequest,
    PressApplyResult,
    PressProjectSummary,
    PressWorkspaceRequest,
    PressWorkspaceResult,
} from '@shared/types/press'
import { request } from '@webview/bridge'
import { toastError } from '@webview/utils'
import type { OutlineWorkspace } from '../types'
import { parseProjectWorkspace } from '../document'
import {
    serializeCharacterBlocks,
    serializeOutlineSection,
    serializeReadmeMeta,
    serializeSettingSection,
} from '../serialize'

/** 即时保存的防抖时长：字段输入停止后写盘，结构性操作不走防抖 */
const SAVE_DEBOUNCE_MS = 600

/** 可独立写盘的文档范围：设定连带 README 元信息，角色与大纲各自成一份 */
export type PersistScope = 'setting' | 'characters' | 'outline'

/** 加载状态：作品文档读取中、未打开作品（展示初始页）、已就绪（渲染工作区） */
export type WorkspaceStatus = 'loading' | 'empty' | 'ready'

/** 立即写盘的可选行为：删除角色时随请求带出待删块，成功后可附一句提示 */
export interface FlushOptions {
    deleted?: { name: string; id: string }
    successMessage?: string
}

export interface PressWorkspaceState {
    status: WorkspaceStatus
    /** 已载入作品的目录：角色卡读写按它定位，未载入为 null */
    projectDir: string | null
    workspace: OutlineWorkspace | null
    /** 索引库聚合出的作品清单：初始页据此给出可选入口 */
    projects: PressProjectSummary[]
    /** 读取最新草稿：写盘与合并时用，避免闭包拿到旧值 */
    getWorkspace: () => OutlineWorkspace | null
    updateWorkspace: (recipe: (previous: OutlineWorkspace) => OutlineWorkspace) => void
    flush: (scopes: Set<PersistScope>, options?: FlushOptions) => void
    scheduleFlush: (scope: PersistScope) => void
}

interface WorkspaceLoadState {
    status: WorkspaceStatus
    projectDir: string | null
    workspace: OutlineWorkspace | null
    projects: PressProjectSummary[]
}

/** 初始状态按读取中处理，避免先闪一帧空态再跳内容 */
const INITIAL_LOAD_STATE: WorkspaceLoadState = {
    status: 'loading',
    projectDir: null,
    workspace: null,
    projects: [],
}

export function usePressWorkspace(projectDir: string | null): PressWorkspaceState {
    const [loadState, setLoadState] = useState<WorkspaceLoadState>(INITIAL_LOAD_STATE)
    /** 草稿与作品目录快照：写盘时取最新值，避免闭包里拿到旧 state */
    const workspaceRef = useRef<OutlineWorkspace | null>(null)
    const dirRef = useRef('')
    /** 防抖窗口内累积的待写范围：同一窗口的多次输入合并成一次请求 */
    const pendingScopesRef = useRef<Set<PersistScope>>(new Set())
    const debounceRef = useRef<number | null>(null)
    /** 写盘串行队列：防抖写入与立即写入排队执行，避免并发覆盖同一份文档 */
    const queueRef = useRef<Promise<void>>(Promise.resolve())

    // 卸载时丢弃未到期的防抖任务：定时器属于已消失的页面，回调再跑只会写脏数据
    useEffect(
        () => (): void => {
            if (debounceRef.current !== null) {
                window.clearTimeout(debounceRef.current)
                debounceRef.current = null
            }
            pendingScopesRef.current = new Set()
        },
        [],
    )

    useEffect(() => {
        // 切作品先清掉未到期的防抖任务：它属于上一个作品的草稿，不能写进新作品
        if (debounceRef.current !== null) {
            window.clearTimeout(debounceRef.current)
            debounceRef.current = null
        }
        pendingScopesRef.current = new Set()
        let isCancelled = false
        const load = async (): Promise<void> => {
            setLoadState(INITIAL_LOAD_STATE)
            try {
                const payload: PressWorkspaceRequest = projectDir === null ? {} : { dirPath: projectDir }
                const result = await request<PressWorkspaceResult>('press/workspace', payload)
                if (isCancelled) {
                    return
                }
                if (result.project === null) {
                    setLoadState({ status: 'empty', projectDir: null, workspace: null, projects: result.projects })
                    return
                }
                const parsed = parseProjectWorkspace(result.project.files, result.project.name)
                workspaceRef.current = parsed
                dirRef.current = result.project.dirPath
                setLoadState({
                    status: 'ready',
                    projectDir: result.project.dirPath,
                    workspace: parsed,
                    projects: result.projects,
                })
            } catch (cause) {
                if (isCancelled) {
                    return
                }
                toastError(cause)
                workspaceRef.current = null
                dirRef.current = ''
                setLoadState({ status: 'empty', projectDir: null, workspace: null, projects: [] })
            }
        }
        void load()
        return (): void => {
            isCancelled = true
        }
    }, [projectDir])

    /**
     * 立即写盘：把指定范围的最新草稿序列化成段落交给宿主合并，未带上的文档保持原样。
     * 关键约束：写入排在队列尾部串行执行，避免防抖写入与结构性操作并发覆盖同一份文档；
     * 删除角色时随请求带上要移除的角色块与设定图，宿主据此删块并清理图片。
     */
    const flush = useCallback((scopes: Set<PersistScope>, options: FlushOptions = {}): void => {
        const current = workspaceRef.current
        const dirPath = dirRef.current
        if (current === null || dirPath.length === 0) {
            return
        }
        const deleted = options.deleted ?? null
        const payload: PressApplyRequest = { dirPath }
        if (scopes.has('setting')) {
            // README 的标题、读者、题材、字数目标与设定段落同源，一起写才不会出现两份口径
            payload.readme = serializeReadmeMeta(current.setting)
            payload.setting = serializeSettingSection(current.setting)
        }
        if (scopes.has('characters')) {
            payload.characters = serializeCharacterBlocks(current.characters)
        }
        if (scopes.has('outline')) {
            payload.outline = serializeOutlineSection(current.volumes, current.characters)
        }
        if (deleted !== null) {
            payload.deletedCharacterNames = [deleted.name]
            payload.deletedCharacterIds = [deleted.id]
        }
        queueRef.current = queueRef.current.then(async () => {
            try {
                await request<PressApplyResult>('press/apply', payload)
                if (options.successMessage !== undefined) {
                    toast.success(options.successMessage)
                }
            } catch (cause) {
                toastError(cause)
            }
        })
    }, [])

    /** 防抖写盘：字段级输入只在停顿后写一次，连续输入不会产生大量请求 */
    const scheduleFlush = useCallback(
        (scope: PersistScope): void => {
            pendingScopesRef.current.add(scope)
            if (debounceRef.current !== null) {
                window.clearTimeout(debounceRef.current)
            }
            debounceRef.current = window.setTimeout(() => {
                debounceRef.current = null
                const scopes = pendingScopesRef.current
                pendingScopesRef.current = new Set()
                flush(scopes)
            }, SAVE_DEBOUNCE_MS)
        },
        [flush],
    )

    /**
     * 草稿更新：只在已载入作品时生效，未载入时忽略，避免出现无归属的编辑。
     * 关键约束：先更新 ref 再 setState——紧随其后的写盘逻辑读 ref，才能拿到本次变更后的草稿。
     */
    const updateWorkspace = useCallback((recipe: (previous: OutlineWorkspace) => OutlineWorkspace): void => {
        const previous = workspaceRef.current
        if (previous === null) {
            return
        }
        const next = recipe(previous)
        workspaceRef.current = next
        setLoadState((state) => (state.workspace === null ? state : { ...state, workspace: next }))
    }, [])

    const getWorkspace = useCallback((): OutlineWorkspace | null => workspaceRef.current, [])

    return {
        status: loadState.status,
        projectDir: loadState.projectDir,
        workspace: loadState.workspace,
        projects: loadState.projects,
        getWorkspace,
        updateWorkspace,
        flush,
        scheduleFlush,
    }
}
