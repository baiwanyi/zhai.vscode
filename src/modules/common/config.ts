/**
 * 配置中心：集中读取 zhai.* 配置项，避免各模块散落调用 getConfiguration。
 * 复用 VSCode contributes.configuration 全局/工作区两级机制，路径解析遵循 common.md 第 1.5 节存储根约定。
 */
import * as vscode from 'vscode'

/** 插件全部配置项的强类型视图 */
export interface ZhaiConfig {
    /** 文档保存目录（空 = 工作区根） */
    rootPath: string
    indexExclude: string[]
    indexDebounceMs: number
    rebuildOnActivate: boolean
    searchLimit: number
    aiModel: string
    aiTemperature: number
    aiMaxContextTokens: number
    aiDailyTokenBudget: number
    telemetryEnabled: boolean
}

const SECTION = 'zhai'

/** 读取当前生效的插件配置（每次调用即时求值，跟随用户修改） */
export function getZhaiConfig(): ZhaiConfig {
    const cfg = vscode.workspace.getConfiguration(SECTION)
    return {
        rootPath: cfg.get<string>('storage.rootPath', ''),
        indexExclude: cfg.get<string[]>('index.exclude', ['**/node_modules/**', '**/.git/**']),
        indexDebounceMs: cfg.get<number>('index.debounceMs', 500),
        rebuildOnActivate: cfg.get<boolean>('index.rebuildOnActivate', true),
        searchLimit: cfg.get<number>('search.limit', 50),
        aiModel: cfg.get<string>('ai.model', 'deepseek-chat'),
        aiTemperature: cfg.get<number>('ai.temperature', 0.7),
        aiMaxContextTokens: cfg.get<number>('ai.maxContextTokens', 4000),
        aiDailyTokenBudget: cfg.get<number>('ai.dailyTokenBudget', 500000),
        telemetryEnabled: cfg.get<boolean>('telemetry.enabled', false),
    }
}

/** 解析文档保存目录 URI：配置为空时回退到工作区第一个根目录 */
export function resolveStorageRoot(): vscode.Uri {
    const { rootPath } = getZhaiConfig()
    if (rootPath.trim().length > 0) {
        return vscode.Uri.file(rootPath)
    }
    const firstFolder = vscode.workspace.workspaceFolders?.[0]
    if (!firstFolder) {
        throw new Error('未打开任何工作区，且未配置 zhai.storage.rootPath，无法确定文档保存目录')
    }
    return firstFolder.uri
}
