/**
 * 会话来源标签：把会话作用域键反向解析成「类型 + 展示名」，供历史浮层「全部」态标注来源。
 * 复用约定：作用域口径由 workflow/layout/contentScope 的 readScopeDir 决定，本文件只做反向解析，
 * 不新增第五种粒度；路径片段校验复用 common/storagePath 的 toSafeSegments，作品目录常量取 common/projectPath。
 * 关键约束：不查库、不依赖公众号 / 作品模块，标签只按路径段派生——作品取第二段（兼容旧版按章的文档路径），
 * 公众号取 appid（账号名映射留作后续增强）；存量脏数据解析失败一律按「通用对话」兜底，
 * 不能让一行脏值挡住整个历史列表。
 */
import { PRESS_MODULE_DIR } from '@modules/common/projectPath'
import { toSafeSegments } from '@modules/common/storagePath'
import type { AiConversationScopeKind } from '@shared/types/aiChat'
import { NOTES_MODULE_KEY, WEIBO_MODULE_KEY, WECHAT_MODULE_KEY } from '@shared/types/workflow'

/** 来源标签：kind 决定分组与图标，label 直接展示 */
export interface AiScopeLabel {
    kind: AiConversationScopeKind
    label: string
}

/** 通用对话的展示名：所有解析不了的来源都回落到它 */
const GENERAL_LABEL = '通用对话'

/** 笔记展示名去掉扩展名：只认 .md，与工作流区的 md 门槛同口径 */
function toNoteName(fileName: string): string {
    return fileName.toLowerCase().endsWith('.md') ? fileName.slice(0, -'.md'.length) : fileName
}

/** 宽松切分：历史库里的作用域可能不合法，解析失败返回 null 由调用方兜底，不抛错 */
function readSegments(scope: string): string[] | null {
    try {
        return toSafeSegments(scope, '对话作用域')
    } catch {
        return null
    }
}

export function readScopeLabel(scope: string | null): AiScopeLabel {
    if (scope === null) {
        return { kind: null, label: GENERAL_LABEL }
    }
    const segments = readSegments(scope)
    if (segments === null) {
        return { kind: null, label: GENERAL_LABEL }
    }
    const [moduleKey, name] = segments
    if (moduleKey === WEIBO_MODULE_KEY) {
        return { kind: 'weibo', label: '微博' }
    }
    if (moduleKey === NOTES_MODULE_KEY && name !== undefined) {
        return { kind: 'note', label: toNoteName(name) }
    }
    if (moduleKey === WECHAT_MODULE_KEY && name !== undefined) {
        return { kind: 'wechat', label: name }
    }
    if (moduleKey === PRESS_MODULE_DIR && name !== undefined) {
        return { kind: 'press', label: name }
    }
    return { kind: null, label: GENERAL_LABEL }
}
