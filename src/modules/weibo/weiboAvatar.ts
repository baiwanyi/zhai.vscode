/**
 * 本人头像缓存：下载到 {存储根}/weibo_avatar.jpg，读回时转成 data URI 供 Webview 直接渲染。
 * 复用约定：下载交给宿主注入的 mediaProxy.resolve（同一套代理降级与 Referer/Cookie），
 * data URI 由 mediaProxy 的 buildImageDataUrl 拼装，格式按魔数嗅探而不是扩展名。
 * 关键约束：文件名固定（刷新即覆盖），先写 .part 再 rename 避免半截图；读取失败返回 null
 * 由前端回落占位；清除凭证时整份删除，避免换号后露出上一个账号的头像。
 */
import * as vscode from 'vscode'
import { buildStorageUri } from '@modules/common/storagePath'
import { buildImageDataUrl, sniffImageExtension } from './mediaProxy'

/** 头像文件名：固定名，便于「有则用它、无则重下」的判定 */
export const WEIBO_AVATAR_FILE = 'weibo_avatar.jpg'

/** 内联上限：头像通常几十 KB，超过基本说明取到了别的对象（例如封面大图） */
const AVATAR_MAX_BYTES = 2 * 1024 * 1024

/** 头像网关：路由层只依赖这三个动作，不接触文件系统 */
export interface WeiboAvatarGateway {
    /** 读本地头像的 data URI：文件缺失或不可用返回 null */
    read(): Promise<string | null>
    /** 下载并落盘远程头像，返回 data URI：失败返回 null 且保留既有文件 */
    download(imageUrl: string): Promise<string | null>
    /** 删除本地头像：清除凭证时调用 */
    clear(): Promise<void>
}

/** 头像文件 Uri：{存储根}/weibo_avatar.jpg */
function resolveAvatarUri(root: vscode.Uri): vscode.Uri {
    return buildStorageUri(root, [WEIBO_AVATAR_FILE])
}

/** 字节转 data URI：空文件与超限都返回 null，格式按魔数判定 */
function toDataUrl(bytes: Uint8Array): string | null {
    if (bytes.byteLength === 0 || bytes.byteLength > AVATAR_MAX_BYTES) {
        return null
    }
    const buffer = Buffer.from(bytes)
    return buildImageDataUrl(buffer, sniffImageExtension(buffer) ?? 'jpg')
}

/** 读取本地头像：文件缺失、不可读或超限一律返回 null，读取路径永不抛错 */
export async function readAvatarDataUrl(root: vscode.Uri): Promise<string | null> {
    try {
        return toDataUrl(await vscode.workspace.fs.readFile(resolveAvatarUri(root)))
    } catch {
        return null
    }
}

/** 头像网关构造参数 */
export interface WeiboAvatarGatewayOptions {
    /** 存储根：头像落 {存储根}/weibo_avatar.jpg */
    root: vscode.Uri
    /** 远程取图：生产注入 mediaProxy.resolve，返回本地缓存文件路径 */
    resolveImage: (imageUrl: string) => Promise<string | null>
}

/** 创建头像网关：读取、下载落盘与清除三个动作都集中在存储根下的同一个文件 */
export function createWeiboAvatarGateway(options: WeiboAvatarGatewayOptions): WeiboAvatarGateway {
    const { root, resolveImage } = options
    return {
        read: async (): Promise<string | null> => await readAvatarDataUrl(root),
        download: async (imageUrl: string): Promise<string | null> => {
            // 没有远程地址时保留既有文件：上游偶尔只回昵称不给头像
            if (imageUrl.length === 0) {
                return null
            }
            const localPath = await resolveImage(imageUrl)
            if (localPath === null) {
                return null
            }
            const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(localPath))
            const dataUrl = toDataUrl(bytes)
            if (dataUrl === null) {
                return null
            }
            const tempUri = buildStorageUri(root, [`${WEIBO_AVATAR_FILE}.part`])
            await vscode.workspace.fs.createDirectory(root)
            await vscode.workspace.fs.writeFile(tempUri, bytes)
            await vscode.workspace.fs.rename(tempUri, resolveAvatarUri(root), { overwrite: true })
            return dataUrl
        },
        clear: async (): Promise<void> => {
            try {
                await vscode.workspace.fs.delete(resolveAvatarUri(root), { useTrash: false })
            } catch {
                // 文件本就不存在：清除语义已经达成
            }
        },
    }
}
