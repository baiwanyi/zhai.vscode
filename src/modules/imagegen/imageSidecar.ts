/**
 * 图片侧车工具：按图片路径推导同名 `{id}.json`，并提供随图片删除的尽力而为操作。
 * 复用约定：图片标识即去掉扩展名的文件名，侧车命名与 imageGenerateService 落盘时一致，
 * 调用方只传图片 Uri，不重复拼路径；存在性判断复用 common/storagePath 的 isPathExisting。
 * 关键约束：侧车是可选附属物——旧图没有侧车属正常情况，删除不得抛错；
 * 只有确认存在后才操作，避免把「本来就没有」写进日志当作失败。
 */
import * as vscode from 'vscode'
import { logger } from '@modules/common/logger'
import { isPathExisting } from '@modules/common/storagePath'

/** 从文件名剥出标识：只处理最后一段扩展名，目录部分不受影响 */
const EXTENSION_PATTERN = /\.[^./]+$/u

/** 侧车字段：生图页与角色卡两条出图通道共用同一份结构 */
export interface SidecarMeta {
    readonly prompt: string
    /** 出图规格：生图页记比例（3:4），角色卡记像素尺寸（768x1024） */
    readonly ratio: string
    readonly style: string
    readonly characterId: string | null
    readonly enhancedFrom: string | null
    readonly createdAt: string
}

/** 写侧车：失败只记 warn，图片本身已落盘，不能因元数据缺失回滚主流程 */
export async function writeSidecarOf(dirUri: vscode.Uri, id: string, meta: SidecarMeta): Promise<void> {
    try {
        const content = Buffer.from(JSON.stringify(meta), 'utf8')
        await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dirUri, `${id}.json`), content)
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        logger.warn(`侧车元数据写入失败：${id}（${reason}）`)
    }
}

/** 由图片 Uri 推导同名侧车 Uri：`.../photo-xxx.png` → `.../photo-xxx.json` */
export function toSidecarUri(imageUri: vscode.Uri): vscode.Uri {
    // 用 joinPath 而不是改 path：目录与文件名都交给 Uri 自己拼，跨平台分隔符与规范化由它保证
    const fileName = imageUri.path.slice(imageUri.path.lastIndexOf('/') + 1)
    return vscode.Uri.joinPath(imageUri, '..', `${fileName.replace(EXTENSION_PATTERN, '')}.json`)
}

/** 随图片删除侧车：图片删除成功后调用，侧车不存在时静默跳过 */
export async function deleteSidecarOf(imageUri: vscode.Uri): Promise<void> {
    const sidecar = toSidecarUri(imageUri)
    if (!(await isPathExisting(sidecar))) {
        return
    }
    try {
        // 元数据无恢复价值，不走回收站，避免删图时把回收站塞满
        await vscode.workspace.fs.delete(sidecar, { useTrash: false })
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        logger.warn(`侧车元数据删除失败：${sidecar.fsPath}（${reason}）`)
    }
}
