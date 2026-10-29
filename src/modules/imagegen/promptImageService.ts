/**
 * 提示词预览图库：定位提示词的 images 目录，判空后把它转成 webview 可访问的基址。
 * 复用约定：目录取 common/promptRoot（父目录来自 zhai.prompt.rootPath，留空为存储根下的 prompt），
 * URL 转换由调用方注入 toWebviewUri，本模块不接触具体 Webview 实例。
 * 关键约束：图库全局共享、与作品无关，因此不接受前端传入的任何路径；
 * 图片按「分类/分组/名称」镜像嵌套存放，判空必须下探两层（顶层放哈希图同样算有图），
 * 只看顶层会把整个图库误判为空，前端随之永不渲染预览浮层；
 * 目录为空时 baseUrl 必须为 null，前端据此整体隐藏缩略图，而不是逐张请求失败后再降级。
 */
import * as vscode from 'vscode'
import { promptDirUri } from '@modules/common/promptRoot'
import type { PromptImageBase } from '@shared/types/imagegen'

/** 图片扩展名白名单：与媒体扫描的列举口径保持一致 */
const IMAGE_EXTENSION_PATTERN = /\.(png|jpe?g|webp|gif)$/i

/** 判空的下探深度：images → 分类 → 分组 → 文件，再深的层级不参与登记 */
const IMAGE_DEPTH = 2

/** 图库目录 Uri：查询基址与「打开目录」命令共用同一口径，避免两处拼路径 */
export function promptImageDirUri(): vscode.Uri {
    return promptDirUri('images')
}

/** 打开图库目录：目录不存在时先建出来，再交给系统文件管理器定位 */
export async function openPromptImageDir(): Promise<void> {
    const dirUri = promptImageDirUri()
    await vscode.workspace.fs.createDirectory(dirUri)
    await vscode.commands.executeCommand('revealFileInOS', dirUri)
}

/**
 * 探测目录下是否至少有一张图：按「分类/分组」两级下探，命中任意图片即提前返回。
 * 关键约束：读取失败按没有图处理，与列举口径一致；不枚举全部文件，图库再大也只扫到第一张。
 */
async function hasAnyImage(dirUri: vscode.Uri, depth: number): Promise<boolean> {
    let entries: [string, vscode.FileType][]
    try {
        entries = await vscode.workspace.fs.readDirectory(dirUri)
    } catch {
        return false
    }
    const subdirs: vscode.Uri[] = []
    for (const [name, type] of entries) {
        if (type === vscode.FileType.File) {
            if (IMAGE_EXTENSION_PATTERN.test(name)) {
                return true
            }
            continue
        }
        if (type === vscode.FileType.Directory && depth > 0) {
            subdirs.push(vscode.Uri.joinPath(dirUri, name))
        }
    }
    for (const subdir of subdirs) {
        if (await hasAnyImage(subdir, depth - 1)) {
            return true
        }
    }
    return false
}

/**
 * 取预览图基址：整个图库（含嵌套的分类/分组）没有任何图片时 baseUrl 为 null。
 * dirPath 始终回传——空态要把它显示给用户，说明图片该放到哪里。
 */
export async function readPromptImageBase(toWebviewUri: (uri: vscode.Uri) => string): Promise<PromptImageBase> {
    const dirUri = promptImageDirUri()
    const hasImage = await hasAnyImage(dirUri, IMAGE_DEPTH)
    return {
        baseUrl: hasImage ? toWebviewUri(dirUri).replace(/\/$/u, '') : null,
        dirPath: dirUri.fsPath,
    }
}
