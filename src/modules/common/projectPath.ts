/**
 * 作品路径规则：模块一级目录名与作品目录片段校验，供生图、快照、索引与工作台共用同一份白名单。
 * 复用约定：依赖同目录 storagePath 的归一化与片段校验，各模块只从这里取 PRESS_MODULE_DIR，
 * 不再各自定义，避免同一条路径规则出现多份口径。
 * 关键约束：只接受 press/{作品名} 恰好两段，越出模块、含上跳或段数不符一律拒绝；
 * 本文件只做字符串层面的路径判定，不读写文件系统，不感知任何业务字段。
 */
import { toSafeSegments, toStorageRelativePath } from './storagePath'

/** 作品所属模块的一级目录名，与存储根约定一致 */
export const PRESS_MODULE_DIR = 'press'

/**
 * 校验并切分作品目录：先归一化再校验片段，且必须恰好是 press/{作品名} 两段。
 * 安全约束：从源头排除越出 press 模块、上跳或指向其他模块目录的路径。
 * 复用约定：角色卡、封面、快照与工作台文档读取等按作品定位的模块共用本函数，不各自实现路径校验。
 */
export function readProjectSegments(dirPath: string): string[] {
    const segments = toSafeSegments(toStorageRelativePath(dirPath, '作品'), '作品')
    if (segments.length !== 2 || segments[0] !== PRESS_MODULE_DIR) {
        throw new Error(`作品路径非法：${dirPath}`)
    }
    return segments
}
