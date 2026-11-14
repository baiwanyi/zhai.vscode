/**
 * 编辑器形态切换：验证文本编辑器与宅写作编辑器之间切换时不会留下两个标签。
 * 复用约定：标签分组与命令调用由 vscode 测试桩承接，用例只断言「关了哪个 tab、打开了哪个形态」。
 * 关键约束：切换必须收起另一种形态的 tab，否则同一文档两个标签并存；
 * 目标形态已打开时只激活它，不关闭任何 tab。
 */
import * as path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
    createUri,
    readClosedTabs,
    readExecutedCommands,
    registerTab,
    registerTextDocument,
    resetWorkspaceState,
    setConfigValue,
    TabInputCustom,
    TabInputText,
} from './stubs/vscode'
import type * as vscode from 'vscode'
import { RICH_EDITOR_VIEW_TYPE, openDocumentWith } from '../src/modules/editor/openDocument'

const STORAGE_ROOT = 'd:/vault'
const NOTE_PATH = path.join(STORAGE_ROOT, 'notes/202610/a.md')

/** 构造一个已打开的标签：标签挂在分组自己的 tabs 里，registerTab 只登记分组 */
function createTab(input: vscode.TabInputText | vscode.TabInputCustom): vscode.Tab {
    const tabs: vscode.Tab[] = []
    const group = { viewColumn: 1, isActive: true, tabs, activeTab: undefined } as vscode.TabGroup
    const tab = {
        label: input.uri.fsPath,
        input,
        isActive: true,
        isDirty: false,
        isPinned: false,
        isPreview: false,
        group,
    } as vscode.Tab
    tabs.push(tab)
    return tab
}

beforeEach(() => {
    resetWorkspaceState()
    setConfigValue('storage.rootPath', STORAGE_ROOT)
    // 打开类命令在桩里会校验文档是否可打开（未登记即 ENOENT），切换用例先登记这份笔记
    registerTextDocument(NOTE_PATH, ['# 笔记'])
})

describe('openDocumentWith', () => {
    it('从文本编辑器切到宅写作编辑器：收起文本 tab，只按富文本打开一次', async () => {
        registerTab(createTab(new TabInputText(createUri(NOTE_PATH))))

        await openDocumentWith(createUri(NOTE_PATH), 'rich')

        const closed = readClosedTabs()
        expect(closed).toHaveLength(1)
        expect(closed[0]?.input).toBeInstanceOf(TabInputText)
        expect(readExecutedCommands().filter((command) => command === 'vscode.openWith')).toHaveLength(1)
    })

    it('目标形态已打开时只激活，不关闭任何 tab', async () => {
        registerTab(createTab(new TabInputCustom(createUri(NOTE_PATH), RICH_EDITOR_VIEW_TYPE)))

        await openDocumentWith(createUri(NOTE_PATH), 'rich')

        expect(readClosedTabs()).toHaveLength(0)
        expect(readExecutedCommands()).toContain('vscode.openWith')
    })

    it('从宅写作编辑器切回文本编辑器：收起富文本 tab', async () => {
        registerTab(createTab(new TabInputCustom(createUri(NOTE_PATH), RICH_EDITOR_VIEW_TYPE)))

        await openDocumentWith(createUri(NOTE_PATH), 'text')

        const closed = readClosedTabs()
        expect(closed).toHaveLength(1)
        expect(closed[0]?.input).toBeInstanceOf(TabInputCustom)
    })

    it('文档尚未打开时直接按目标形态打开，不关闭任何 tab', async () => {
        await openDocumentWith(createUri(NOTE_PATH), 'rich')

        expect(readClosedTabs()).toHaveLength(0)
        expect(readExecutedCommands()).toContain('vscode.openWith')
    })
})
