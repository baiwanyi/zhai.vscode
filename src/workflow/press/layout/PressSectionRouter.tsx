/**
 * 写作页分区路由：按导航选中项渲染对应页面，所有分区共享同一份草稿与作品目录。
 * 复用约定：设定 / 人物 / 大纲 / 取名复用本模块页面组件，媒体与快照分别复用 media、snapshot 的页面组件；
 * 对话、校对、用量、在线图库与上传等常驻分区已由 WorkflowPress 在外层直接交给 WorkflowResidentSection，
 * 本文件保留这些分支只作兜底，避免新增调用方绕过外层时渲染错页；
 * 本文件只做「分区 → 页面 + 回调」的映射，不持有任何状态。
 * 关键约束：快照按作品目录隔离（dirPath 是作用域）；媒体在作品内要带角色与设定上下文；
 * 用量是跨作品的全局统计不隔离；回调统一来自 usePressMutations，路由层不自行读写草稿。
 */
import { WorkflowAiChat } from '@webview/workflow/aichat/WorkflowAiChat'
import type { WorkflowSection } from '@webview/workflow/layout/workflowSections'
import { WorkflowMedia } from '@webview/workflow/media/WorkflowMedia'
import { WorkflowStock } from '@webview/workflow/media/WorkflowStock'
import { WorkflowUpload } from '@webview/workflow/media/WorkflowUpload'
import { WorkflowProofread } from '@webview/workflow/proofread/WorkflowProofread'
import { WorkflowUsage } from '@webview/workflow/usage/WorkflowUsage'
import type { PressMutations } from '../hooks/usePressMutations'
import type { OutlineWorkspace } from '../types'
import type { JSX } from 'react'
import { PressCharacterPage } from '../character/PressCharacterPage'
import { PressNamingPage } from '../naming/PressNamingPage'
import { PressOutlinePage } from '../outline/PressOutlinePage'
import { PressSettingPage } from '../setting/PressSettingPage'
import { PressSnapshotPage } from '../snapshot/PressSnapshotPage'

interface PressSectionRouterProps {
    section: WorkflowSection
    workspace: OutlineWorkspace
    /** 当前作品目录：快照与人物设定图的作用域 */
    dirPath: string
    /** 对话作用域：作品目录（整个作品一份会话），为空时回落到 dirPath */
    chatScope: string | null
    mutations: PressMutations
}

export function PressSectionRouter({
    section,
    workspace,
    dirPath,
    chatScope,
    mutations,
}: PressSectionRouterProps): JSX.Element {
    if (section === 'setting') {
        return (
            <PressSettingPage
                setting={workspace.setting}
                characters={workspace.characters}
                lore={workspace.lore}
                dirPath={dirPath}
                onChange={mutations.updateSetting}
                onExtractSetting={mutations.extractSetting}
                onSaveSection={mutations.saveSettingSection}
                onFlushSettingSections={mutations.flushSettingSections}
                onCreateLore={mutations.createLore}
                onUpdateLore={mutations.updateLore}
                onDeleteLore={mutations.deleteLore}
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
                onUpdateChapter={mutations.updateChapter}
                onUpdateVolume={mutations.updateVolume}
                onApplyVolumeChapters={mutations.applyVolumeChapters}
                onUpdatePlan={mutations.updateOutlinePlan}
                onApplyOutlineChange={mutations.applyOutlineChange}
                onCreateVolume={mutations.createOutlineVolume}
                onCreateChapter={mutations.createOutlineChapter}
                onApplyVolumeOutlines={mutations.applyVolumeOutlines}
                onExtractOutline={mutations.extractOutline}
            />
        )
    }
    if (section === 'naming') {
        return <PressNamingPage />
    }
    // 媒体分区是全库共享的页面，作品上下文只影响出图归属与「设为作品封面」，切作品即重建组件
    if (section === 'media') {
        return (
            <WorkflowMedia
                key={dirPath}
                context={{
                    dirPath,
                    characters: workspace.characters,
                    lore: workspace.lore,
                    setting: workspace.setting,
                    // 认领封面与删除回退都是系统侧写回：静默落盘，避免出图成功时弹「已保存人物卡」
                    onChangeCharacter: (characterId, patch) => {
                        mutations.updateCharacter(characterId, patch, { silent: true })
                    },
                }}
            />
        )
    }
    // 在线图库是常驻分区：与作品无关，插入同样作用于当前编辑器的光标处
    if (section === 'stock') {
        return <WorkflowStock />
    }
    // 上传同样是常驻分区：文件落存储根的 uploads 目录，与当前作品无关
    if (section === 'upload') {
        return <WorkflowUpload />
    }
    // 校对以编辑器中的当前文档为目标，切作品即重建，避免上一个作品的问题列表残留
    if (section === 'proofread') {
        return <WorkflowProofread key={dirPath} />
    }
    // 快照按作品隔离：与文档同目录，切作品即换用该作品自己的时间线
    if (section === 'snapshot') {
        return <PressSnapshotPage dirPath={dirPath} title={workspace.setting.title} />
    }
    // 用量是全局统计，不随作品目录隔离：跨作品的消耗在同一张表里汇总
    if (section === 'usage') {
        return <WorkflowUsage />
    }
    // 对话由 WorkflowPress 在外层先处理（作品文档未读完也能直接进对话页），这里只作兜底：
    // key 跟随作用域（作品目录），作品内换章不重建对话页
    const scope = chatScope ?? dirPath
    return <WorkflowAiChat key={scope} projectDir={scope} projectTitle={workspace.setting.title} />
}
