/**
 * 图片目录扫描：把作品目录下的一组图片目录（统一目录 Images 与旧 Cover / Portraits）展开为扁平文件清单。
 * 复用约定：目录名由调用方从 ./constants 取，路径一律经 common/storagePath 构造；
 * URL 转换、时间取值与命名过滤由调用方拿到条目后各自加工，本模块不关心业务含义。
 * 关键约束：目录不存在或读取失败视为空目录而不抛错——并发删除、权限问题只影响单张图，不能让整次列举失败；
 * 只返回普通文件且扩展名属于图片集合的条目，子目录、侧车 JSON 与缩略图缓存都进不了列表；
 * 图片扩展名在此统一口径，图库、角色卡与封面画廊不再各自维护一份正则。
 */
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { buildStorageUri } from '@modules/common/storagePath'

/** 图片扩展名：图库、角色卡与封面画廊共用的唯一口径 */
const IMAGE_EXTENSION_PATTERN = /\.(png|jpe?g|webp|gif)$/i

/** 扫描结果：文件名、相对存储根的路径片段与完整 Uri */
export interface ImageDirFile {
    readonly name: string
    readonly segments: string[]
    readonly uri: vscode.Uri
}

/**
 * 列举图片文件：dirNames 按传入顺序依次展开，结果保持磁盘枚举顺序、不做排序。
 * 关键约束：调用方各自决定排序与命名过滤口径，这里只保证「目录存在则列出其图片文件」。
 */
export async function listImageFiles(projectSegments: string[], dirNames: readonly string[]): Promise<ImageDirFile[]> {
    const root = resolveStorageRoot()
    const files: ImageDirFile[] = []
    for (const dirName of dirNames) {
        const dirSegments = [...projectSegments, dirName]
        let entries: [string, vscode.FileType][]
        try {
            entries = await vscode.workspace.fs.readDirectory(buildStorageUri(root, dirSegments))
        } catch {
            // 该目录尚未创建：旧目录只读兼容，缺失属正常情况
            continue
        }
        for (const [name, type] of entries) {
            if (type !== vscode.FileType.File || !IMAGE_EXTENSION_PATTERN.test(name)) {
                continue
            }
            const segments = [...dirSegments, name]
            files.push({ name, segments, uri: buildStorageUri(root, segments) })
        }
    }
    return files
}
