/**
 * 卷纲编辑草稿的纯数据层：编辑态条目 id 与文本互转、草稿归一为保存补丁。
 * 复用约定：数值收敛复用 press/utils 的 clampIntegerInput，条目 id 复用 press/utils 的 createId；
 * 本文件只处理数据，不碰 React 状态与 UI——生成期的并发保护与卸载保护由 useVolumeEditDraft 承担。
 * 关键约束：条目 id 只在弹窗会话内稳定，磁盘与 AI 上下文仍是纯文本；保存时过滤空条目，
 * 卷名只有真改动才进补丁，避免连带重写章节段的三级标题。
 */
import type { OutlineVolume } from '../../types'
import { clampIntegerInput, createId } from '../../utils'

/** 核心事件字数上限：与卷纲卡片的展示口径一致 */
export const CORE_EVENT_MAX_LENGTH = 200

/** 预计章节数上限：正常作品远低于该值，超出视为误输 */
export const EXPECTED_CHAPTERS_MAX = 500

/** 条目编辑态：id 只在同一弹窗会话内稳定，磁盘仍按纯文本保存 */
export interface EditablePlotItem {
    id: string
    text: string
}

/** 新建编辑态条目：新增按钮与文本初始化共用同一 id 来源 */
export function createEditableItem(text = ''): EditablePlotItem {
    return { id: createId('plot'), text }
}

/** 文本转编辑态：每条分配独立 id，增删时不会让相邻 Textarea 复用同一实例 */
export function toEditableItems(values: readonly string[]): EditablePlotItem[] {
    return values.map(createEditableItem)
}

/** 编辑态转回文本：保存与 AI 上下文只带正文，空条目照旧过滤 */
export function toTextList(items: readonly EditablePlotItem[]): string[] {
    return items.map((item) => item.text.trim()).filter((text) => text.length > 0)
}

/** 草稿字段集合：保持输入控件的字符串 / 编辑态形态，写盘前才归一 */
export interface VolumeEditDraft {
    name: string
    expectedChapters: string
    coreEvent: string
    mainPlot: EditablePlotItem[]
    turningPoints: EditablePlotItem[]
    result: string
}

/** 草稿归一为补丁：章节数夹取、列表过滤空项，卷名未真改时不带该字段 */
export function createVolumeEditPatch(volume: OutlineVolume, draft: VolumeEditDraft): Partial<OutlineVolume> {
    const patch: Partial<OutlineVolume> = {
        expectedChapters: clampIntegerInput(draft.expectedChapters, 0, 0, EXPECTED_CHAPTERS_MAX),
        coreEvent: draft.coreEvent.trim(),
        mainPlot: toTextList(draft.mainPlot),
        turningPoints: toTextList(draft.turningPoints),
        result: draft.result.trim(),
    }
    const nextName = draft.name.trim()
    if (nextName.length > 0 && nextName !== volume.name) {
        patch.name = nextName
    }
    return patch
}
