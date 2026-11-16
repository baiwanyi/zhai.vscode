/**
 * 媒体路径契约：媒体基址目录、标识与路径的形态校验、从路径反查标识。
 * 复用约定：宿主扫描、引用重建与前端文档解析共用这一份口径，
 * 基址目录只在此定义，其它模块一律引用 MEDIA_DIR，不重复写字面量。
 * 关键约束：标识为 14 位本地时间戳 + 6 位字母数字随机段，迁移前的旧命名不通过；
 * 路径必须落在 images/{YYYYMM}/ 下且扩展名在图片集合内，手工命名的文件名不影响判定。
 */

/** 引用基址：媒体路径的相对根目录名，扫描、列举与校验都以这里为准 */
export const MEDIA_DIR = 'images'

/** 媒体 id：14 位时间戳 + 6 位字母数字随机段 */
const MEDIA_ID_PATTERN = /^\d{14}[A-Za-z0-9]{6}$/
/** 媒体相对路径：images/{YYYYMM}/{文件名}，文件名允许手工命名 */
const MEDIA_PATH_PATTERN = /^images\/(\d{6})\/([^/]+)$/
/** 图片扩展名白名单：与宿主扫描口径同源 */
const MEDIA_EXTENSION_PATTERN = /\.(png|jpe?g|webp|gif)$/i
/** 年月格式：YYYY-MM */
const MEDIA_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

/** 媒体标识是否合法：迁移前的旧命名（portrait-…）不通过 */
export function isMediaId(value: unknown): value is string {
    return typeof value === 'string' && MEDIA_ID_PATTERN.test(value)
}

/** 媒体相对路径是否合法：必须落在 images/{YYYYMM}/ 下且扩展名在图片集合内 */
export function isMediaPath(value: unknown): value is string {
    if (typeof value !== 'string') {
        return false
    }
    const matched = MEDIA_PATH_PATTERN.exec(value)
    return matched !== null && MEDIA_EXTENSION_PATTERN.test(matched[2] ?? '')
}

/** 从媒体路径取 id：文件名去掉扩展名；路径不合法时返回空串 */
export function readMediaIdFromPath(path: string): string {
    const fileName = path.split('/').pop() ?? ''
    return fileName.replace(/\.[^.]+$/u, '')
}

/** 年月是否合法：供协议入参收窄 */
export function isMediaMonth(value: unknown): value is string {
    return typeof value === 'string' && MEDIA_MONTH_PATTERN.test(value)
}
