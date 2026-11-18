/**
 * 编辑器形态切换期间的活跃文档事实：验证关闭旧 tab 造成的相邻文档中间态不会外泄。
 * 复用约定：标签、活跃编辑器与命令由 vscode 测试桩承接，用例只断言活跃文档事件的序列。
 * 关键约束：切换事务只在结束时广播一次最终形态；最终事实与切换前一致时完全不广播。
 */
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    commands,
    createTextDocument,
    createTextEditor,
    createUri,
    fireActiveTextEditor,
    registerTab,
    registerTextDocument,
    resetWorkspaceState,
    setActiveTab,
    setConfigValue,
    TabInputCustom,
    TabInputText,
    window,
} from './stubs/vscode'
import type * as vscode from 'vscode'
import {
    getActiveDocument,
    onDidChangeActiveDocument,
    reportRichDocument,
    reportTextDocument,
    trackActiveDocument,
    withActiveDocumentHold,
} from '../src/modules/editor/activeDocument'
import { RICH_EDITOR_VIEW_TYPE, openDocumentWith } from '../src/modules/editor/openDocument'

const STORAGE_ROOT = 'd:/vault'
const NOTE_A = path.join(STORAGE_ROOT, 'notes/a.md')
const NOTE_B = path.join(STORAGE_ROOT, 'notes/b.md')

/** 活跃文档事件：只保留断言需要的形态与路径 */
interface DocumentEvent {
    kind: 'text' | 'rich'
    path: string
}

let subscriptions: vscode.Disposable[] = []
let events: (DocumentEvent | null)[] = []

/** 订阅活跃文档事实：先注册文本编辑器监听，再记录每一次广播 */
function watchActiveDocument(): void {
    trackActiveDocument(subscriptions)
    subscriptions.push(
        onDidChangeActiveDocument((document) => {
            events.push(document === null ? null : { kind: document.kind, path: document.uri.fsPath })
        }),
    )
}

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
    registerTextDocument(NOTE_A, ['# a'])
    registerTextDocument(NOTE_B, ['# b'])
    subscriptions = []
    events = []
    watchActiveDocument()
})

afterEach(() => {
    for (const subscription of subscriptions) {
        subscription.dispose()
    }
})

describe('withActiveDocumentHold', () => {
    it('事务期间只暂存事实，结束后只广播最终形态', async () => {
        reportTextDocument(createUri(NOTE_A))
        events.length = 0

        await withActiveDocumentHold(() => {
            // 关闭旧 tab：VSCode 把相邻文档变成活跃文档
            reportTextDocument(createUri(NOTE_B))
            // 目标形态打开完成
            reportRichDocument(createUri(NOTE_A))
            return Promise.resolve()
        })

        expect(events).toEqual([{ kind: 'rich', path: NOTE_A }])
    })

    it('事务结束时事实与切换前一致则完全不广播', async () => {
        reportTextDocument(createUri(NOTE_A))
        events.length = 0

        await withActiveDocumentHold(() => {
            reportTextDocument(createUri(NOTE_B))
            reportTextDocument(createUri(NOTE_A))
            return Promise.resolve()
        })

        expect(events).toHaveLength(0)
    })
})

describe('openDocumentWith 活跃文档收尾', () => {
    it('切到宅写作编辑器时相邻文档的活跃事实不外泄，收尾为富文本', async () => {
        registerTab(createTab(new TabInputText(createUri(NOTE_A))))
        reportTextDocument(createUri(NOTE_A))
        events.length = 0

        // 关闭旧 tab 会让相邻文档成为活跃文档：不屏蔽的话工作流面板会被带过去再切回来
        vi.spyOn(window.tabGroups, 'close').mockImplementation(() => {
            fireActiveTextEditor(createTextEditor(createTextDocument(['# b'], NOTE_B)))
            return Promise.resolve(true)
        })
        const executeCommand = commands.executeCommand.bind(commands)
        vi.spyOn(commands, 'executeCommand').mockImplementation((command, ...args) => {
            if (command === 'vscode.openWith') {
                // 新开的自定义编辑器成为活跃 tab，宿主以它收尾
                setActiveTab(createTab(new TabInputCustom(createUri(NOTE_A), RICH_EDITOR_VIEW_TYPE)))
            }
            return executeCommand(command, ...args)
        })

        await openDocumentWith(createUri(NOTE_A), 'rich')

        expect(events).toEqual([{ kind: 'rich', path: NOTE_A }])
        expect(getActiveDocument()).toMatchObject({ kind: 'rich' })
    })

    it('切回文本编辑器时收尾为文本，且不残留富文本事实', async () => {
        registerTab(createTab(new TabInputCustom(createUri(NOTE_A), RICH_EDITOR_VIEW_TYPE)))
        reportRichDocument(createUri(NOTE_A))
        events.length = 0

        vi.spyOn(window.tabGroups, 'close').mockImplementation(() => {
            fireActiveTextEditor(createTextEditor(createTextDocument(['# b'], NOTE_B)))
            return Promise.resolve(true)
        })
        const executeCommand = commands.executeCommand.bind(commands)
        vi.spyOn(commands, 'executeCommand').mockImplementation((command, ...args) => {
            if (command === 'vscode.openWith') {
                setActiveTab(createTab(new TabInputText(createUri(NOTE_A))))
            }
            return executeCommand(command, ...args)
        })

        await openDocumentWith(createUri(NOTE_A), 'text')

        expect(events).toEqual([{ kind: 'text', path: NOTE_A }])
        expect(getActiveDocument()).toMatchObject({ kind: 'text' })
    })
})
