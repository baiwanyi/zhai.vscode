/**
 * 写作页分区路由：按导航选中项渲染对应页面，所有分区共享同一份草稿与作品目录。
 * 复用约定：设定 / 人物 / 大纲 / 快照复用本模块页面组件，取名、校对、AI 用量、对话与生图分别复用
 * naming、proofread、usage、aichat、imagegen 的页面组件；
 * 本文件只做「分区 → 页面 + 回调」的映射，不持有任何状态。
 * 关键约束：对话与快照按作品目录隔离（dirPath 既是作用域也是对话页 key，切作品即重建），
 * 用量是跨作品的全局统计不隔离；回调统一来自 usePressMutations，路由层不自行读写草稿。
 */
import type { WorkflowPressSection } from '../../layout/WorkflowPressNav'
import type { PressMutations } from '../hooks/usePressMutations'
import type { OutlineWorkspace } from '../types'
import type { JSX } from 'react'
import { AiChat } from '../../aichat'
import { ImageGenPage } from '../../imagegen'
import { NamingPage } from '../../naming'
import { ProofreadPage } from '../../proofread'
import { AiUsagePage } from '../../usage'
import { PressCharacterPage } from '../character/PressCharacterPage'
import { DEFAULT_CHAPTER_WORD_GOAL } from '../constants'
import { PressOutlinePage } from '../outline/PressOutlinePage'
import { PressSettingPage } from '../setting/PressSettingPage'
import { PressSnapshotPage } from '../snapshot/PressSnapshotPage'

interface PressSectionRouterProps {
    section: WorkflowPressSection
    workspace: OutlineWorkspace
    /** 当前作品目录：快照、人物设定图与对话会话的作用域 */
    dirPath: string
    mutations: PressMutations
    /** 大纲页的步骤跳转：按步骤映射回分区 */
    onSelectStep: (step: number) => void
    /** 大纲页的「去写正文」：切到对话分区 */
    onOpenChat: () => void
}

export function PressSectionRouter({
    section,
    workspace,
    dirPath,
    mutations,
    onSelectStep,
    onOpenChat,
}: PressSectionRouterProps): JSX.Element {
    if (section === 'setting') {
        return (
            <PressSettingPage
                setting={workspace.setting}
                dirPath={dirPath}
                onChange={mutations.updateSetting}
                onExtractSetting={mutations.extractSetting}
            />
        )
    }
    if (section === 'character') {
        return (
            <PressCharacterPage
                characters={workspace.characters}
                setting={workspace.setting}
                dirPath={dirPath}
                onCreateCharacter={mutations.createCharacter}
                onChangeCharacter={mutations.updateCharacter}
                onDeleteCharacter={mutations.deleteCharacter}
                onExtractCharacters={mutations.extractCharacters}
            />
        )
    }
    if (section === 'outline') {
        return (
            <PressOutlinePage
                workspace={workspace}
                dirPath={dirPath}
                defaultChapterWordGoal={DEFAULT_CHAPTER_WORD_GOAL}
                onSelectStep={onSelectStep}
                onUpdateChapter={mutations.updateChapter}
                onCreateVolume={mutations.addVolume}
                onCreateChapter={mutations.addChapter}
                onApplyOutline={mutations.applyOutline}
                onExtractOutline={mutations.extractOutline}
                onOpenChat={onOpenChat}
            />
        )
    }
    if (section === 'naming') {
        return <NamingPage />
    }
    // 生图按作品隔离：图片目录与参数文件都在作品目录下，切作品即重建，筛选与搜索不串味
    if (section === 'image') {
        return (
            <ImageGenPage
                key={dirPath}
                dirPath={dirPath}
                characters={workspace.characters}
                setting={workspace.setting}
                onChangeCharacter={mutations.updateCharacter}
            />
        )
    }
    // 校对以编辑器中的当前文档为目标，切作品即重建，避免上一个作品的问题列表残留
    if (section === 'proofread') {
        return <ProofreadPage key={dirPath} />
    }
    // 快照按作品隔离：与文档同目录，切作品即换用该作品自己的时间线
    if (section === 'snapshot') {
        return <PressSnapshotPage dirPath={dirPath} />
    }
    // 用量是全局统计，不随作品目录隔离：跨作品的消耗在同一张表里汇总
    if (section === 'usage') {
        return <AiUsagePage />
    }
    // 对话按作品隔离：当前作品目录即会话作用域，切作品即换用该作品自己的对话记录；
    // key 跟随作品目录，切作品时重建对话页，命令选择与未发送正文不会带进新作品
    return <AiChat key={dirPath} projectDir={dirPath} />
}
