/**
 * 提示词预览图库：定位存储根下的 prompt/images，判空后把它转成 webview 可访问的基址。
 * 复用约定：判空复用 imageDirScan 的 listImageFiles（目录缺失与读取失败已按空目录处理），
 * URL 转换由调用方注入 toWebviewUri，本模块不接触具体 Webview 实例。
 * 关键约束：图库全局共享、与作品无关，因此不接受前端传入的任何路径；
 * 目录为空时 baseUrl 必须为 null，前端据此整体隐藏缩略图，而不是逐张请求失败后再降级。
 */
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { buildStorageUri } from '@modules/common/storagePath'
import type { PromptImageBase } from '@shared/types/imagegen'
import { listImageFiles } from './imageDirScan'

/** 提示词模块的一级目录 */
const PROMPT_DIR = 'prompt'

/** 预览图所在的子目录 */
const PROMPT_IMAGE_DIR = 'images'

/** 图库目录 Uri：查询基址与「打开目录」命令共用同一口径，避免两处拼路径 */
export function promptImageDirUri(): vscode.Uri {
    return buildStorageUri(resolveStorageRoot(), [PROMPT_DIR, PROMPT_IMAGE_DIR])
}

/** 打开图库目录：目录不存在时先建出来，再交给系统文件管理器定位 */
export async function openPromptImageDir(): Promise<void> {
    const dirUri = promptImageDirUri()
    await vscode.workspace.fs.createDirectory(dirUri)
    await vscode.commands.executeCommand('revealFileInOS', dirUri)
}

/**
 * 取预览图基址：目录里没有任何图片时 baseUrl 为 null。
 * dirPath 始终回传——空态要把它显示给用户，说明图片该放到哪里。
 */
export async function readPromptImageBase(toWebviewUri: (uri: vscode.Uri) => string): Promise<PromptImageBase> {
    const dirUri = promptImageDirUri()
    const files = await listImageFiles([PROMPT_DIR], [PROMPT_IMAGE_DIR])
    return {
        baseUrl: files.length === 0 ? null : toWebviewUri(dirUri).replace(/\/$/u, ''),
        dirPath: dirUri.fsPath,
    }
}
