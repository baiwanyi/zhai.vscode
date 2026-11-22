/**
 * 微博配图入库：把图床远程图搬进 uploads/{YYYYMM}/，以及图片的内联回退通道。
 * 复用约定：取图交给图片代理（补 Referer、401/403 带 Cookie 重试、302 跟随），
 * 落盘复用 upload/saveUploadFile 的命名规则，与上传页插入保持同构。
 * 关键约束：优先按 pid 走官方下载端点取最大尺寸原图，pid 缺失或失败才回退图床直链；
 * 逐张处理，单张失败只回退远程直链，不影响整篇笔记；超过上传单件上限的图同样跳过；
 * 返回值是存储根相对路径（不带 @zhai 前缀），引用写法由 note 组装层决定。
 */
import * as path from 'node:path'
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { logger } from '@modules/common/logger'
import { MAX_UPLOAD_BYTES } from '@modules/upload/uploadPayload'
import { saveUploadFile } from '@modules/upload/uploadStorage'
import { readImageAsDataUrl } from './imageData'
import type { WeiboImageSaver } from '../app/postActions'
import type { WeiboMediaProxy } from './imageProxy'
import { buildMiddleImageUrl } from '../timeline/media'

/**
 * 图片传输方式：
 * - data-url：内联 base64（默认）。不依赖任何路径授权，是唯一验证过的稳定通道；
 * - webview-uri：宿主签发 asWebviewUri，浏览器按需取图（零 IPC 传输、不占双份内存）。
 *   依赖 localResourceRoots 且要求该目录在面板创建时已存在，否则签发地址会被拒（表现为全部图片不显示）。
 * 关键约束：切换后需重开面板；两条通道都只回传本地缓存文件，不暴露远程地址。
 */
export const IMAGE_TRANSPORT: 'webview-uri' | 'data-url' = 'data-url'

/** 日志用的图片标识：只留主机与路径前段，查询串里可能带签名 */
function describeImageUrl(url: string): string {
    try {
        const parsed = new URL(url)
        return `${parsed.host}${parsed.pathname.slice(0, 60)}`
    } catch {
        return '非法地址'
    }
}

/**
 * 回退通道：把缓存文件读成 data URI；超过内联上限时改取 bmiddle 缩略图。
 * 关键约束：缩略图地址与原始地址相同时不再请求，直接返回 null 由前端显示占位。
 */
export async function readInlineImage(
    proxy: WeiboMediaProxy,
    imageUrl: string,
    filePath: string,
): Promise<string | null> {
    const dataUrl = await readImageAsDataUrl(filePath)
    if (dataUrl !== null) {
        return dataUrl
    }
    const middleUrl = buildMiddleImageUrl(imageUrl)
    if (middleUrl === imageUrl) {
        return null
    }
    const middlePath = await proxy.resolve(middleUrl)
    return middlePath === null ? null : readImageAsDataUrl(middlePath)
}

/** 创建配图搬运器：把微博图床的远程图搬进 uploads/{YYYYMM}/，与上传页共用同一套命名与落盘规则 */
export function createWeiboImageSaver(proxy: WeiboMediaProxy): WeiboImageSaver {
    return async (images) => {
        const root = resolveStorageRoot()
        const saved: Array<string | null> = []
        for (const image of images) {
            try {
                const original = image.pid.length > 0 ? await proxy.resolveOriginal(image.pid) : null
                const localPath = original ?? (await proxy.resolve(image.url))
                if (localPath === null) {
                    saved.push(null)
                    continue
                }
                const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(localPath))
                if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) {
                    logger.warn(
                        `微博配图跳过上传目录：体积 ${String(bytes.byteLength)} 字节（${describeImageUrl(image.url)}）`,
                    )
                    saved.push(null)
                    continue
                }
                const file = await saveUploadFile(root, { name: path.basename(localPath), bytes })
                saved.push(file.path)
            } catch (error) {
                logger.warn(
                    `微博配图保存失败：${describeImageUrl(image.url)}（${error instanceof Error ? error.message : String(error)}）`,
                )
                saved.push(null)
            }
        }
        return saved
    }
}
