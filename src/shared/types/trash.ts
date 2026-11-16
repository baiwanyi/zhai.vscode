/**
 * 回收站契约：应用内回收站条目的结构与恢复/清除请求的出入参。
 * 使用方：Webview 仪表盘回收站页与宿主侧回收站仓储。
 * 约束：id 为 .trash 下的子目录名单段白名单，不含任何路径分隔符；
 * 笔记删除先进回收站，彻底清除才从磁盘移除，恢复落点由宿主按原笔记本决定。
 */

/** 回收站目录名：与 notes/、press/ 并列放在存储根下，索引与全量扫描都须排除 */
export const TRASH_DIR_NAME = '.trash'

/** 回收站条目：一条对应 .trash 下的一个子目录 */
export interface TrashItem {
    /** .trash 下的子目录名，仅含小写字母、数字与连字符 */
    id: string
    /** 删除前的笔记标题 */
    title: string
    /** 删除前所属笔记本 id，用于恢复落点与列表副标题 */
    notebookId: string
    /** 删除前所属笔记本展示名 */
    notebookName: string
    /** 删除时间，ISO 8601 */
    deletedAt: string
    /** 删除前的相对路径，仅用于展示与恢复校验 */
    originalPath: string
}

/** 单条回收站操作失败的原因 */
export interface TrashFailure {
    /** 出错的回收站条目 id */
    id: string
    /** 失败原因，可直接展示给用户 */
    message: string
}

/** trash/list 响应 */
export interface TrashListResult {
    items: TrashItem[]
}

/** 恢复结果：一条记录携带条目 id 与恢复后的相对路径 */
export interface RestoredNote {
    id: string
    path: string
}

/** trash/restore 请求 */
export interface TrashRestoreRequest {
    ids: string[]
}

/** trash/restore 响应 */
export interface TrashRestoreResult {
    restored: RestoredNote[]
    failures: TrashFailure[]
}

/** trash/purge 请求：彻底删除指定条目 */
export interface TrashPurgeRequest {
    ids: string[]
}

/** trash/purge 响应 */
export interface TrashPurgeResult {
    purgedIds: string[]
    failures: TrashFailure[]
}

/** trash/clear 响应：清空回收站 */
export interface TrashClearResult {
    purgedCount: number
    failures: TrashFailure[]
}

/** 回收站条目 id 的形态：时间戳加随机串，只允许小写字母、数字与连字符 */
export const TRASH_ITEM_ID_PATTERN = /^[0-9a-z-]+$/

/** 判断是否为合法的回收站条目 id（类型收窄辅助） */
export function isTrashItemId(value: unknown): value is string {
    return typeof value === 'string' && TRASH_ITEM_ID_PATTERN.test(value)
}

/** 判断 id 列表是否合法且非空（恢复与清除共用） */
function isNonEmptyTrashIdList(value: unknown): value is string[] {
    return Array.isArray(value) && value.length > 0 && value.every((item: unknown) => isTrashItemId(item))
}

/** 判断是否为合法的恢复请求 */
export function isTrashRestoreRequest(payload: unknown): payload is TrashRestoreRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    return isNonEmptyTrashIdList((payload as { ids?: unknown }).ids)
}

/** 判断是否为合法的彻底清除请求 */
export function isTrashPurgeRequest(payload: unknown): payload is TrashPurgeRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    return isNonEmptyTrashIdList((payload as { ids?: unknown }).ids)
}
