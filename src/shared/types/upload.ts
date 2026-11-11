/**
 * 上传契约：存储根 uploads 目录的条目模型与各协议方法的出入参。
 * 复用约定：路径一律为相对存储根的 uploads/{YYYYMM}/{文件名}，文件名主体由宿主生成，
 * 前端只持有相对路径与展示字段，不接受任意路径；图片条目额外带 url 供缩略图直接渲染。
 * 关键约束：文件名形态为 14 位本地时间戳 + 6 位 [A-Z0-9] 随机段 + 原扩展名，
 * 原始文件名不参与路径拼接（只在跳过回执里回报），条目 name 即磁盘上的生成名；
 * 删除只接受 uploads/{YYYYMM}/ 下的单层文件路径，越界与多段路径一律拒绝；
 * 插入把文件引用写进当前 Markdown 光标处，图片用图片语法、其余用链接语法；
 * 非图片文件 url 为 null，由前端改用图标表示。
 */

/** 上传基址：存储根下的通用上传目录，与媒体库的 images 互不影响 */
export const UPLOAD_DIR = 'uploads'

/** 上传路径形态：uploads/{YYYYMM}/{单层文件名}，删除与校验共用 */
const UPLOAD_PATH_PATTERN = /^uploads\/\d{6}\/[^/\\:]+$/u

/** 上传路径是否合法：只接受 uploads/{YYYYMM}/ 下的单层文件名，越界与多段路径一律拒绝 */
export function isUploadPath(value: unknown): value is string {
    return typeof value === 'string' && UPLOAD_PATH_PATTERN.test(value)
}

/** 上传文件条目：一次列举或一次上传回执的最小集合 */
export interface UploadFileItem {
    /** 相对存储根的路径：uploads/202611/20261103153045K3M9QZ.png */
    path: string
    /** 磁盘文件名（生成名，不含目录）：20261103153045K3M9QZ.png */
    name: string
    /** 落盘扩展名：不带点，取不到合法扩展名时为 bin */
    ext: string
    byteSize: number
    /** 年月：YYYY-MM，本地时区 */
    month: string
    createdAt: string
    /** webview 可访问的完整 URL：非图片文件为 null */
    url: string | null
}

/** 上传结果：成功落盘的文件与逐条跳过原因，失败的项不影响同批其余文件 */
export interface UploadResult {
    uploaded: UploadFileItem[]
    skipped: { name: string; reason: string }[]
}

/** 列举结果：按年月目录倒序、目录内按文件名倒序（文件名含时间戳） */
export interface UploadListResult {
    items: UploadFileItem[]
}

/** 打开上传目录的结果：宿主无法唤起系统文件管理器时为 false */
export interface UploadRevealResult {
    opened: boolean
}

/** 删除结果：文件移入回收站（回收站不可用时永久删除）即视为成功 */
export interface UploadRemoveResult {
    removed: boolean
}

/** 插入失败原因：与媒体库同一套四态口径 */
export type UploadInsertReason = 'no-editor' | 'unsaved' | 'not-markdown' | 'failed'

/** 插入结果：refPath 为写进正文的引用，duplicated 表示该文档此前已引用过同一文件 */
export interface UploadInsertResult {
    inserted: boolean
    reason?: UploadInsertReason
    refPath?: string
    duplicated?: boolean
}
