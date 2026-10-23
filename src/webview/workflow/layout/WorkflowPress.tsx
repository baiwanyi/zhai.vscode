/**
 * 写作管理工作流页：写作管理模块的专属落点，模块切换时由注册表直接渲染本文件。
 * 复用约定：作品数据来自宿主读取的 设定.md / 角色设定.md / 大纲.md，经 press/document 解析成 OutlineWorkspace；
 * 分区内容按 activeSection 切换——设定、人物、大纲分别渲染 ../press 的三个页面，AI 对话渲染 ../aichat 的 AiChat
 * 并下传当前作品目录作为会话作用域（每个作品各有一份对话记录），取名渲染 ../naming 的 NamingPage；
 * 右侧分区入口由同目录 WorkflowPressNav 承载，分区之间共享同一份草稿。
 * 关键约束：本页不自行发起路由请求，作品定位只认宿主下发的 projectDir；未打开作品时渲染初始页（作品清单入口），
 * 不在页面内伪造示例数据；页面内的编辑仍是内存草稿，换作品或换页即重新按文档解析结果重建，
 * 需要落到文档时由右栏「保存到作品」把草稿序列化成段落交给宿主合并，未保存的改动仍会随换页丢失。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Skeleton } from '@components/ui/skeleton'
import type {
    OpenPressProjectResult,
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
import { PressCharacterPage, PressOutlinePage, PressSettingPage, PressWorkspaceStart } from '../press'
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
    createCharacterFromDraft,
    createOutlineFromDraft,
    createVolume,
} from '../press/utils'

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
    const [isSaving, setIsSaving] = useState(false)
    /** 进行中标记：右栏动作项没有禁用态，靠 ref 拦住连点 */
    const isSavingRef = useRef(false)

    useEffect(() => {
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
                setLoadState({ status: 'empty', projectDir: null, workspace: null, projects: [] })
            }
        }
        void load()
        return (): void => {
            isCancelled = true
        }
    }, [projectDir])

    /**
     * 回写作品文档：把当前草稿序列化成段落，交给宿主合并进 README、设定、角色设定与大纲。
     * 关键约束：序列化只产出段落片段，用户手写的其它段落由宿主保留；编辑本身仍是内存草稿，不回写就会随换页丢失。
     */
    const handleSave = useCallback((current: OutlineWorkspace, currentDir: string): void => {
        const run = async (): Promise<void> => {
            if (currentDir.length === 0 || isSavingRef.current) {
                return
            }
            isSavingRef.current = true
            setIsSaving(true)
            try {
                const result = await request<PressApplyResult>('press/apply', {
                    dirPath: currentDir,
                    readme: serializeReadmeMeta(current.setting),
                    setting: serializeSettingSection(current.setting),
                    characters: serializeCharacterBlocks(current.characters),
                    outline: serializeOutlineSection(current.volumes, current.characters),
                })
                if (result.written.length === 0) {
                    toast.error('没有写入任何文档，请检查日志')
                    return
                }
                toast.success(`已回写 ${result.written.join('、')}`)
            } catch (cause) {
                toastError(cause)
            } finally {
                isSavingRef.current = false
                setIsSaving(false)
            }
        }
        void run()
    }, [])

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

    /** 草稿更新：只在已载入作品时生效，未载入时忽略，避免出现无归属的编辑 */
    const updateWorkspace = useCallback((recipe: (previous: OutlineWorkspace) => OutlineWorkspace): void => {
        setLoadState((previous) =>
            previous.workspace === null ? previous : { ...previous, workspace: recipe(previous.workspace) },
        )
    }, [])

    const handleSelectStep = useCallback((step: number): void => {
        setActiveSection(STEP_SECTIONS[step] ?? 'chapter')
    }, [])

    const handleUpdateSetting = useCallback(
        (patch: Partial<ProjectSetting>): void => {
            updateWorkspace((previous) => ({ ...previous, setting: { ...previous.setting, ...patch } }))
        },
        [updateWorkspace],
    )

    const handleUpdateCharacter = useCallback(
        (characterId: string, patch: Partial<CharacterCard>): void => {
            updateWorkspace((previous) => ({
                ...previous,
                characters: previous.characters.map((character) =>
                    character.id === characterId ? { ...character, ...patch } : character,
                ),
            }))
        },
        [updateWorkspace],
    )

    /** 建卡并返回新卡 id：人物页据此直接下钻到新人物详情 */
    const handleCreateCharacter = useCallback(
        (seed: CharacterSeed): string => {
            const character = createCharacterCard(seed)
            updateWorkspace((previous) => ({ ...previous, characters: [...previous.characters, character] }))
            return character.id
        },
        [updateWorkspace],
    )

    /** 合并提取出的人物卡：按姓名去重后追加，返回实际新增人数供人物页提示 */
    const handleExtractCharacters = useCallback(
        (existing: CharacterCard[], drafts: PressExtractedCharacter[]): number => {
            const names = new Set(existing.map((character) => character.name))
            const additions: CharacterCard[] = []
            for (const draft of drafts) {
                if (draft.name.length === 0 || names.has(draft.name)) {
                    continue
                }
                names.add(draft.name)
                additions.push(createCharacterFromDraft(draft))
            }
            if (additions.length === 0) {
                return 0
            }
            // 提取期间列表可能已被编辑，合并时按最新草稿再去重一次
            updateWorkspace((previous) => {
                const usedNames = new Set(previous.characters.map((character) => character.name))
                const fresh = additions.filter((character) => !usedNames.has(character.name))
                return fresh.length === 0 ? previous : { ...previous, characters: [...previous.characters, ...fresh] }
            })
            return additions.length
        },
        [updateWorkspace],
    )

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
        },
        [updateWorkspace],
    )

    const handleCreateVolume = useCallback((): void => {
        updateWorkspace((previous) => ({
            ...previous,
            volumes: [...previous.volumes, createVolume(previous.volumes.length + 1, DEFAULT_CHAPTER_WORD_GOAL)],
        }))
    }, [updateWorkspace])

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
        },
        [updateWorkspace],
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
        },
        [updateWorkspace],
    )

    /** 用素材重建大纲树：整体覆盖既有草稿，返回重建的章节数供页面提示 */
    const handleExtractOutline = useCallback(
        (characters: CharacterCard[], drafts: PressExtractedVolume[]): number => {
            // 出场人物靠名称匹配人物卡：先拿到当前草稿的人物，重建后的章纲才能直接带出 characterIds
            const volumes = createOutlineFromDraft(drafts, DEFAULT_CHAPTER_WORD_GOAL, characters)
            const chapterCount = volumes.reduce((total, volume) => total + volume.chapters.length, 0)
            updateWorkspace((previous) => ({ ...previous, volumes }))
            return chapterCount
        },
        [updateWorkspace],
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
            }
            return filled
        },
        [updateWorkspace],
    )

    const renderSection = (workspace: OutlineWorkspace, workspaceDir: string): JSX.Element => {
        if (activeSection === 'setting') {
            return (
                <PressSettingPage
                    setting={workspace.setting}
                    dirPath={workspaceDir}
                    onChange={handleUpdateSetting}
                    onSelectStep={handleSelectStep}
                    onNext={() => setActiveSection('character')}
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
            <WorkflowPressNav
                activeSection={activeSection}
                onSelect={setActiveSection}
                isSaving={isSaving}
                onSave={() => handleSave(workspace, workspaceDir)}
            />
        </div>
    )
}
