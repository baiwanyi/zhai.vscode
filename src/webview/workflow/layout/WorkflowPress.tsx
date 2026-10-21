/**
 * 写作管理工作流页：写作管理模块的专属落点，模块切换时由注册表直接渲染本文件。
 * 复用约定：分区内容按 activeSection 切换——设定、人物、大纲分别渲染 ../press 的三个页面，
 * AI 对话渲染 ../aichat 的 AiChat，取名渲染 ../naming 的 NamingPage；右侧分区入口由同目录
 * WorkflowPressNav 承载，页面之间共享同一份作品草稿（workspace），避免切分区丢编辑。
 * 关键约束：本页不自行发起路由请求，分区高亮仅为页内局部状态（不写入宿主路由）；
 * 作品草稿只在本页内存中存在，宿主协议接通后由 大纲.md / 角色设定.md 的解析结果替换；
 * 换页时本页卸载重建，草稿随之重置，对话数据与取名历史仍由宿主侧服务持有。
 */
import { useCallback, useState } from 'react'
import { WorkflowPressNav } from './WorkflowPressNav'
import type { WorkflowPressSection } from './WorkflowPressNav'
import type {
    CharacterCard,
    CharacterSeed,
    OutlineChapter,
    OutlineVolume,
    OutlineWorkspace,
    ProjectSetting,
} from '../press/types'
import type { JSX } from 'react'
import { AiChat } from '../aichat'
import { NamingPage } from '../naming'
import { PressCharacterPage, PressOutlinePage, PressSettingPage } from '../press'
import { SAMPLE_WORKSPACE } from '../press/sample'
import { createChapter, createCharacterCard, createVolume } from '../press/utils'

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

export function WorkflowPress(): JSX.Element {
    const [activeSection, setActiveSection] = useState<WorkflowPressSection>(DEFAULT_SECTION)
    const [workspace, setWorkspace] = useState<OutlineWorkspace>(SAMPLE_WORKSPACE)

    const handleSelectStep = useCallback((step: number): void => {
        setActiveSection(STEP_SECTIONS[step] ?? 'chapter')
    }, [])

    const handleUpdateSetting = useCallback((patch: Partial<ProjectSetting>): void => {
        setWorkspace((previous) => ({ ...previous, setting: { ...previous.setting, ...patch } }))
    }, [])

    const handleUpdateCharacter = useCallback((characterId: string, patch: Partial<CharacterCard>): void => {
        setWorkspace((previous) => ({
            ...previous,
            characters: previous.characters.map((character) =>
                character.id === characterId ? { ...character, ...patch } : character,
            ),
        }))
    }, [])

    /** 建卡并返回新卡 id：人物页据此直接下钻到新人物详情 */
    const handleCreateCharacter = useCallback((seed: CharacterSeed): string => {
        const character = createCharacterCard(seed)
        setWorkspace((previous) => ({ ...previous, characters: [...previous.characters, character] }))
        return character.id
    }, [])

    const handleUpdateChapter = useCallback((chapterId: string, patch: Partial<OutlineChapter>): void => {
        setWorkspace((previous) => ({
            ...previous,
            volumes: previous.volumes.map((volume) => ({
                ...volume,
                chapters: volume.chapters.map((chapter) =>
                    chapter.id === chapterId ? { ...chapter, ...patch } : chapter,
                ),
            })),
        }))
    }, [])

    const handleCreateVolume = useCallback((): void => {
        setWorkspace((previous) => ({
            ...previous,
            volumes: [...previous.volumes, createVolume(previous.volumes.length + 1, DEFAULT_CHAPTER_WORD_GOAL)],
        }))
    }, [])

    const handleCreateChapter = useCallback((volumeId: string): void => {
        setWorkspace((previous) => ({
            ...previous,
            volumes: previous.volumes.map((volume) => {
                if (volume.id !== volumeId) {
                    return volume
                }
                const nextOrder = volume.chapters.reduce((max, chapter) => Math.max(max, chapter.order), 0) + 1
                return { ...volume, chapters: [...volume.chapters, createChapter(nextOrder, DEFAULT_CHAPTER_WORD_GOAL)] }
            }),
        }))
    }, [])

    const handleApplyOutline = useCallback((volumes: OutlineVolume[]): void => {
        setWorkspace((previous) => {
            const offset = previous.volumes.length
            const appended = volumes.map((volume, index) => ({
                ...volume,
                name: `第${offset + index + 1}卷 ${volume.name.replace(VOLUME_PREFIX_PATTERN, '') || '新卷'}`,
            }))
            return { ...previous, volumes: [...previous.volumes, ...appended] }
        })
    }, [])

    const renderSection = (): JSX.Element => {
        if (activeSection === 'setting') {
            return (
                <PressSettingPage
                    setting={workspace.setting}
                    onChange={handleUpdateSetting}
                    onSelectStep={handleSelectStep}
                    onNext={() => setActiveSection('character')}
                />
            )
        }
        if (activeSection === 'character') {
            return (
                <PressCharacterPage
                    characters={workspace.characters}
                    setting={workspace.setting}
                    onCreateCharacter={handleCreateCharacter}
                    onChangeCharacter={handleUpdateCharacter}
                />
            )
        }
        if (activeSection === 'outline') {
            return (
                <PressOutlinePage
                    workspace={workspace}
                    defaultChapterWordGoal={DEFAULT_CHAPTER_WORD_GOAL}
                    onSelectStep={handleSelectStep}
                    onUpdateChapter={handleUpdateChapter}
                    onCreateVolume={handleCreateVolume}
                    onCreateChapter={handleCreateChapter}
                    onApplyOutline={handleApplyOutline}
                    onOpenChat={() => setActiveSection('chat')}
                />
            )
        }
        if (activeSection === 'naming') {
            return <NamingPage />
        }
        return <AiChat />
    }

    return (
        <div className="flex h-screen min-h-0">
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{renderSection()}</div>
            <WorkflowPressNav activeSection={activeSection} onSelect={setActiveSection} />
        </div>
    )
}
