/**
 * 写作管理工作流页：写作管理模块的专属落点，模块切换时由注册表直接渲染本文件。
 * 复用约定：作品数据来自宿主读取的 设定.md / 角色设定.md / 大纲.md，经 press/document 解析成 OutlineWorkspace；
 * 分区内容按 activeSection 切换——设定、人物、大纲分别渲染 ../press 的三个页面，快照渲染 ../press 的
 * PressSnapshotPage（按作品隔离）、AI 对话渲染 ../aichat 的 AiChat 并下传当前作品目录作为会话作用域
 * （每个作品各有一份对话记录），取名渲染 ../naming 的 NamingPage，
 * AI 使用量渲染 ../usage 的 AiUsagePage（全局统计，不按作品隔离）；
 * 右侧分区入口由同目录 WorkflowPressNav 承载，分区之间共享同一份草稿。
 * 关键约束：本页不自行发起路由请求，作品定位只认宿主下发的 projectDir；未打开作品时渲染初始页（作品清单入口），
 * 不在页面内伪造示例数据；编辑即时落盘——字段输入在防抖窗口后写盘，新增、删除、弹窗保存等结构性操作立即写，
 * 每次只把本次变更的那一份文档交给宿主合并，未涉及的文档保持原样。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Skeleton } from '@components/ui/skeleton'
import type {
    OpenPressProjectResult,
    PressApplyRequest,
    PressApplyResult,
    PressExtractedCharacter,
    PressExtractedSetting,
    PressExtractedVolume,
    PressProjectSummary,
    PressWorkspaceRequest,
    PressWorkspaceResult,
} from '@shared/types/press'
import { WorkflowPressNav } from './WorkflowPressNav'
import type { WorkflowPressSection } from './WorkflowPressNav'
import type { WorkflowRenderProps } from '../core/registry'
import type {
    CharacterCard,
    CharacterSeed,
    OutlineChapter,
    OutlineVolume,
    OutlineWorkspace,
    ProjectSetting,
} from '../press/types'
import type { JSX } from 'react'
import { request } from '../../bridge'
import { toastError } from '../../utils'
import { AiChat } from '../aichat'
import { NamingPage } from '../naming'
import {
    PressCharacterPage,
    PressOutlinePage,
    PressSettingPage,
    PressSnapshotPage,
    PressWorkspaceStart,
} from '../press'
import { parseProjectWorkspace } from '../press/document'
import {
    serializeCharacterBlocks,
    serializeOutlineSection,
    serializeReadmeMeta,
    serializeSettingSection,
} from '../press/serialize'
import {
    createChapter,
    createCharacterCard,
    createOutlineFromDraft,
    createVolume,
    mergeCharacterDrafts,
} from '../press/utils'
import { AiUsagePage } from '../usage'

/** 默认分区：页面主体即 AI 对话，默认高亮与当前可见内容一致 */
const DEFAULT_SECTION: WorkflowPressSection = 'chat'

/** 新建卷、新建章时的默认单章目标字数，与网文常规更新量一致 */
const DEFAULT_CHAPTER_WORD_GOAL = 2500

/** 流程步骤到分区的映射：第 1 步与第 5 步都落到章节写作，正文由 AI 对话承接 */
const STEP_SECTIONS: Readonly<Record<number, WorkflowPressSection>> = {
    1: 'chapter',
    2: 'setting',
    3: 'character',
    4: 'outline',
    5: 'chapter',
}

/** 卷名归一：追加生成结果时去掉原有的「第N卷」前缀，避免与既有卷序号冲突 */
const VOLUME_PREFIX_PATTERN = /^第\d+卷\s*/

/** 即时保存的防抖时长：字段输入停止后写盘，结构性操作不走防抖 */
const SAVE_DEBOUNCE_MS = 600

/** 可独立写盘的文档范围：设定连带 README 元信息，角色与大纲各自成一份 */
type PersistScope = 'setting' | 'characters' | 'outline'

/** 加载状态：作品文档读取中、未打开作品（展示初始页）、已就绪（渲染工作区） */
type WorkspaceStatus = 'loading' | 'empty' | 'ready'

interface WorkspaceLoadState {
    status: WorkspaceStatus
    /** 已载入作品的目录：角色卡读写按它定位，未载入为 null */
    projectDir: string | null
    workspace: OutlineWorkspace | null
    /** 索引库聚合出的作品清单：初始页据此给出可选入口 */
    projects: PressProjectSummary[]
}

/** 初始状态按读取中处理，避免先闪一帧空态再跳内容 */
const INITIAL_LOAD_STATE: WorkspaceLoadState = {
    status: 'loading',
    projectDir: null,
    workspace: null,
    projects: [],
}

export function WorkflowPress({ context }: WorkflowRenderProps): JSX.Element {
    const projectDir = context.projectDir
    const [activeSection, setActiveSection] = useState<WorkflowPressSection>(DEFAULT_SECTION)
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
    const flush = useCallback(
        (
            scopes: Set<PersistScope>,
            options: { deleted?: { name: string; id: string }; successMessage?: string } = {},
        ): void => {
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
        },
        [],
    )

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

    /** 打开作品：宿主打开 README 并广播新的 projectDir，本页随之重新解析文档 */
    const handleOpenProject = useCallback((dirPath: string): void => {
        const open = async (): Promise<void> => {
            try {
                await request<OpenPressProjectResult>('press/open', { dirPath })
            } catch (cause) {
                toastError(cause)
            }
        }
        void open()
    }, [])

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

    const handleSelectStep = useCallback((step: number): void => {
        setActiveSection(STEP_SECTIONS[step] ?? 'chapter')
    }, [])

    /** 设定字段改动：输入频繁，走防抖写盘，停顿后统一落一次 */
    const handleUpdateSetting = useCallback(
        (patch: Partial<ProjectSetting>): void => {
            updateWorkspace((previous) => ({ ...previous, setting: { ...previous.setting, ...patch } }))
            scheduleFlush('setting')
        },
        [scheduleFlush, updateWorkspace],
    )

    /** 人物卡保存：编辑弹窗点保存即写盘，不再依赖手动回写 */
    const handleUpdateCharacter = useCallback(
        (characterId: string, patch: Partial<CharacterCard>): void => {
            updateWorkspace((previous) => ({
                ...previous,
                characters: previous.characters.map((character) =>
                    character.id === characterId ? { ...character, ...patch } : character,
                ),
            }))
            const name = workspaceRef.current?.characters.find((character) => character.id === characterId)?.name
            flush(new Set<PersistScope>(['characters']), {
                successMessage: name === undefined ? '已保存人物卡' : `已保存「${name}」`,
            })
        },
        [flush, updateWorkspace],
    )

    /** 删除人物：同步清理章纲里的出场引用，并立即写盘——角色块从其文档移除、设定图一并清理 */
    const handleDeleteCharacter = useCallback(
        (characterId: string): void => {
            const target = workspaceRef.current?.characters.find((character) => character.id === characterId) ?? null
            updateWorkspace((previous) => ({
                ...previous,
                characters: previous.characters.filter((character) => character.id !== characterId),
                volumes: previous.volumes.map((volume) => ({
                    ...volume,
                    chapters: volume.chapters.map((chapter) =>
                        chapter.characterIds.includes(characterId)
                            ? {
                                  ...chapter,
                                  characterIds: chapter.characterIds.filter((id) => id !== characterId),
                              }
                            : chapter,
                    ),
                })),
            }))
            flush(new Set<PersistScope>(['characters', 'outline']), {
                deleted: target === null ? undefined : { name: target.name, id: target.id },
                successMessage: target === null ? '已删除人物' : `已删除「${target.name}」`,
            })
        },
        [flush, updateWorkspace],
    )

    /** 建卡并返回新卡 id：人物页据此直接下钻到新人物详情，新卡立即写盘 */
    const handleCreateCharacter = useCallback(
        (seed: CharacterSeed): string => {
            const character = createCharacterCard(seed)
            updateWorkspace((previous) => ({ ...previous, characters: [...previous.characters, character] }))
            flush(new Set<PersistScope>(['characters']), { successMessage: '已新建人物，后续改动自动保存' })
            return character.id
        },
        [flush, updateWorkspace],
    )

    /**
     * 合并提取出的人物卡：同名人物按空字段补全（不覆盖作者已写内容），未匹配的按草案新建。
     * 关键约束：提取期间列表可能已被编辑，故按写入前的最新草稿再合并一次；
     * 没有任何实际变化时不写盘，避免一次「提取」把没动过的角色设定重写一遍。
     */
    const handleExtractCharacters = useCallback(
        (existing: CharacterCard[], drafts: PressExtractedCharacter[]): { created: number; updated: number } => {
            const planned = mergeCharacterDrafts(existing, drafts)
            if (planned.created === 0 && planned.updated === 0) {
                return { created: 0, updated: 0 }
            }
            let merged = planned
            updateWorkspace((previous) => {
                merged = mergeCharacterDrafts(previous.characters, drafts)
                return merged.created === 0 && merged.updated === 0
                    ? previous
                    : { ...previous, characters: merged.characters }
            })
            if (merged.created === 0 && merged.updated === 0) {
                return { created: 0, updated: 0 }
            }
            flush(new Set<PersistScope>(['characters']))
            return { created: merged.created, updated: merged.updated }
        },
        [flush, updateWorkspace],
    )

    /** 章纲字段改动：含标题输入，走防抖写盘 */
    const handleUpdateChapter = useCallback(
        (chapterId: string, patch: Partial<OutlineChapter>): void => {
            updateWorkspace((previous) => ({
                ...previous,
                volumes: previous.volumes.map((volume) => ({
                    ...volume,
                    chapters: volume.chapters.map((chapter) =>
                        chapter.id === chapterId ? { ...chapter, ...patch } : chapter,
                    ),
                })),
            }))
            scheduleFlush('outline')
        },
        [scheduleFlush, updateWorkspace],
    )

    const handleCreateVolume = useCallback((): void => {
        updateWorkspace((previous) => ({
            ...previous,
            volumes: [...previous.volumes, createVolume(previous.volumes.length + 1, DEFAULT_CHAPTER_WORD_GOAL)],
        }))
        flush(new Set<PersistScope>(['outline']))
    }, [flush, updateWorkspace])

    const handleCreateChapter = useCallback(
        (volumeId: string): void => {
            updateWorkspace((previous) => ({
                ...previous,
                volumes: previous.volumes.map((volume) => {
                    if (volume.id !== volumeId) {
                        return volume
                    }
                    const nextOrder = volume.chapters.reduce((max, chapter) => Math.max(max, chapter.order), 0) + 1
                    return {
                        ...volume,
                        chapters: [...volume.chapters, createChapter(nextOrder, DEFAULT_CHAPTER_WORD_GOAL)],
                    }
                }),
            }))
            flush(new Set<PersistScope>(['outline']))
        },
        [flush, updateWorkspace],
    )

    const handleApplyOutline = useCallback(
        (volumes: OutlineVolume[]): void => {
            updateWorkspace((previous) => {
                const offset = previous.volumes.length
                const appended = volumes.map((volume, index) => ({
                    ...volume,
                    name: `第${offset + index + 1}卷 ${volume.name.replace(VOLUME_PREFIX_PATTERN, '') || '新卷'}`,
                }))
                return { ...previous, volumes: [...previous.volumes, ...appended] }
            })
            flush(new Set<PersistScope>(['outline']))
        },
        [flush, updateWorkspace],
    )

    /** 用素材重建大纲树：整体覆盖既有草稿，返回重建的章节数供页面提示 */
    const handleExtractOutline = useCallback(
        (characters: CharacterCard[], drafts: PressExtractedVolume[]): number => {
            // 出场人物靠名称匹配人物卡：先拿到当前草稿的人物，重建后的章纲才能直接带出 characterIds
            const volumes = createOutlineFromDraft(drafts, DEFAULT_CHAPTER_WORD_GOAL, characters)
            const chapterCount = volumes.reduce((total, volume) => total + volume.chapters.length, 0)
            updateWorkspace((previous) => ({ ...previous, volumes }))
            flush(new Set<PersistScope>(['outline']))
            return chapterCount
        },
        [flush, updateWorkspace],
    )

    /** 合并设定草案：只填空字段，已有内容一律不动，返回实际填入的字段数 */
    const handleExtractSetting = useCallback(
        (current: ProjectSetting, draft: PressExtractedSetting): number => {
            const patch: Partial<ProjectSetting> = {}
            if (current.logline.length === 0 && draft.logline.length > 0) {
                patch.logline = draft.logline
            }
            if (current.conflict.length === 0 && draft.conflict.length > 0) {
                patch.conflict = draft.conflict
            }
            if (current.worldview.length === 0 && draft.worldview.length > 0) {
                patch.worldview = draft.worldview
            }
            if (current.geography.length === 0 && draft.geography.length > 0) {
                patch.geography = draft.geography
            }
            if (current.era.length === 0 && draft.era.length > 0) {
                patch.era = draft.era
            }
            if (current.factions.length === 0 && draft.factions.length > 0) {
                patch.factions = draft.factions
            }
            if (current.powerSystem.length === 0 && draft.powerSystem.length > 0) {
                patch.powerSystem = draft.powerSystem
            }
            if (current.concepts.length === 0 && draft.concepts.length > 0) {
                patch.concepts = draft.concepts
            }
            if (current.taboo.length === 0 && draft.taboo.length > 0) {
                patch.taboo = draft.taboo
            }
            if (current.goldenFingerType.length === 0 && draft.goldenFingerType.length > 0) {
                patch.goldenFingerType = draft.goldenFingerType
            }
            if (current.goldenFingerAbility.length === 0 && draft.goldenFingerAbility.length > 0) {
                patch.goldenFingerAbility = draft.goldenFingerAbility
            }
            if (current.goldenFingerCost.length === 0 && draft.goldenFingerCost.length > 0) {
                patch.goldenFingerCost = draft.goldenFingerCost
            }
            if (current.perspective.length === 0 && draft.perspective.length > 0) {
                patch.perspective = draft.perspective
            }
            if (current.tone.length === 0 && draft.tone.length > 0) {
                patch.tone = draft.tone
            }
            const genres = [...new Set([...current.genres, ...draft.genres])]
            if (genres.length > current.genres.length) {
                patch.genres = genres
            }
            const filled = Object.keys(patch).length
            if (filled > 0) {
                updateWorkspace((previous) => ({ ...previous, setting: { ...previous.setting, ...patch } }))
                scheduleFlush('setting')
            }
            return filled
        },
        [scheduleFlush, updateWorkspace],
    )

    const renderSection = (workspace: OutlineWorkspace, workspaceDir: string): JSX.Element => {
        if (activeSection === 'setting') {
            return (
                <PressSettingPage
                    setting={workspace.setting}
                    dirPath={workspaceDir}
                    onChange={handleUpdateSetting}
                    onExtractSetting={(draft) => handleExtractSetting(workspace.setting, draft)}
                />
            )
        }
        if (activeSection === 'character') {
            return (
                <PressCharacterPage
                    characters={workspace.characters}
                    setting={workspace.setting}
                    dirPath={workspaceDir}
                    onCreateCharacter={handleCreateCharacter}
                    onChangeCharacter={handleUpdateCharacter}
                    onDeleteCharacter={handleDeleteCharacter}
                    onExtractCharacters={(drafts) => handleExtractCharacters(workspace.characters, drafts)}
                />
            )
        }
        if (activeSection === 'outline') {
            return (
                <PressOutlinePage
                    workspace={workspace}
                    dirPath={workspaceDir}
                    defaultChapterWordGoal={DEFAULT_CHAPTER_WORD_GOAL}
                    onSelectStep={handleSelectStep}
                    onUpdateChapter={handleUpdateChapter}
                    onCreateVolume={handleCreateVolume}
                    onCreateChapter={handleCreateChapter}
                    onApplyOutline={handleApplyOutline}
                    onExtractOutline={(drafts) => handleExtractOutline(workspace.characters, drafts)}
                    onOpenChat={() => setActiveSection('chat')}
                />
            )
        }
        if (activeSection === 'naming') {
            return <NamingPage />
        }
        // 快照按作品隔离：与文档同目录，切作品即换用该作品自己的时间线
        if (activeSection === 'snapshot') {
            return <PressSnapshotPage dirPath={workspaceDir} />
        }
        // 用量是全局统计，不随作品目录隔离：跨作品的消耗在同一张表里汇总
        if (activeSection === 'usage') {
            return <AiUsagePage />
        }
        // 对话按作品隔离：当前作品目录即会话作用域，切作品即换用该作品自己的对话记录；
        // key 跟随作品目录，切作品时重建对话页，命令选择与未发送正文不会带进新作品
        return <AiChat key={workspaceDir} projectDir={workspaceDir} />
    }

    if (loadState.status === 'loading') {
        return (
            <div className="flex h-screen flex-col gap-2 p-4">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-28 w-full" />
            </div>
        )
    }

    const workspace = loadState.workspace
    if (workspace === null) {
        return <PressWorkspaceStart projects={loadState.projects} onOpenProject={handleOpenProject} />
    }
    const workspaceDir = loadState.projectDir ?? ''

    return (
        <div className="flex h-screen min-h-0">
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{renderSection(workspace, workspaceDir)}</div>
            <WorkflowPressNav activeSection={activeSection} onSelect={setActiveSection} />
        </div>
    )
}
