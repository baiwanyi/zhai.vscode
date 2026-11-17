/**
 * 提示词资源根：把 imagegen / press / images / rules 四个子目录统一挂到「词库目录」下。
 * 复用约定：父目录取 ./config 的 resolvePromptRoot（默认 {存储根}/prompt，可在设置项 `zhai.prompt.rootPath` 改），
 * 路径拼装走 ./storagePath 的 buildStorageUri；两套词库、预览图与规则共用本模块，读写都从这里取路径。
 * 关键约束：子目录名只接受本文件登记的值，避免调用方拼出未登记的路径；
 * imagegen 为生图提示词库、press 为 AI 对话的写作提示词库，两者互不覆盖；
 * tags 是生图词库的旧目录名，仅在一次性迁移时读取；
 * 配置每次调用即时求值，切换目录后无需重启，重开面板即可看到新库；
 * 目录缺失一律按空库处理，不在这里预先创建，创建由各服务的写入路径负责。
 */
import { resolvePromptRoot } from './config'
import { buildStorageUri } from './storagePath'
import type * as vscode from 'vscode'

/** 提示词子目录名：与「两套词库、预览图、规则」四个入口一一对应，新增子目录须在此登记 */
export type PromptSegment = 'imagegen' | 'press' | 'images' | 'rules' | 'tags'

/** 取提示词子目录 Uri：父目录由词库目录设置决定，未配置时为存储根下的 prompt */
export function promptDirUri(segment: PromptSegment): vscode.Uri {
    return buildStorageUri(resolvePromptRoot(), [segment])
}
