/**
 * 作品契约：仪表盘 /press 页的作品摘要、创建与打开请求结构，以及作品分类枚举。
 * 使用方：仪表盘 Webview 的作品列表与宿主侧 DashboardViewProvider、modules/press 服务。
 * 复用约定：dirPath 取相对存储根口径（press/{作品名}），与索引库 files.path 同源；作品名即目录名。
 * 关键约束：前端传入的作品名与目录路径均不可信，宿主须先经名称白名单校验或索引库回查后才可触达文件系统；
 * 分类枚举只此一份，前端选项与落盘 Frontmatter 共用，避免两处口径分叉。
 */

/** 作品分类：写入 README Frontmatter 的 category，同时作为列表筛选项的取值来源 */
export const PRESS_CATEGORIES = ['玄幻', '都市', '历史', '科幻', '悬疑', '言情', '其他'] as const

/** 作品分类取值 */
export type PressCategory = (typeof PRESS_CATEGORIES)[number]

/** 未指定分类时的默认值 */
export const DEFAULT_PRESS_CATEGORY: PressCategory = '其他'

/** 作品摘要：宿主按索引库聚合，一部作品对应 press/ 下的一个目录 */
export interface PressProjectSummary {
    /** 目录名即作品名 */
    name: string
    /** 相对存储根的作品目录，形如 press/【小说名】 */
    dirPath: string
    /** 是否存在作品根 README.md（打开作品的落点） */
    hasReadme: boolean
    /** Chapter 下的章节文档数，兼容分卷层级 */
    chapterCount: number
    /** 作品目录下全部文档的字数合计 */
    wordCount: number
    /** 作品目录内最新的文档修改时间（ISO 8601） */
    mtime: string
}

/** press/create 请求：新建作品并生成骨架 */
export interface CreatePressProjectRequest {
    /** 作品名，同时作为目录名，须通过宿主名称白名单校验 */
    name: string
    /** 可选分类，缺省或非法值回落为「其他」 */
    category?: string
}

/** press/create 响应 */
export interface CreatePressProjectResult {
    /** 相对存储根的作品目录，用于前端定位新条目 */
    dirPath: string
    /** 作品标题，与目录名一致 */
    title: string
}

/** press/open 请求：打开指定作品的 README.md */
export interface OpenPressProjectRequest {
    /** 相对存储根的作品目录，须已在索引库中存在 */
    dirPath: string
}

/** press/open 响应 */
export interface OpenPressProjectResult {
    opened: boolean
}

/** 判断是否为合法的新建作品请求（类型收窄辅助） */
export function isCreatePressProjectRequest(payload: unknown): payload is CreatePressProjectRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { name?: unknown; category?: unknown }
    const isValidName = typeof candidate.name === 'string' && candidate.name.trim().length > 0
    const isValidCategory = candidate.category === undefined || typeof candidate.category === 'string'
    return isValidName && isValidCategory
}

/** 判断是否为合法的打开作品请求（类型收窄辅助） */
export function isOpenPressProjectRequest(payload: unknown): payload is OpenPressProjectRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { dirPath?: unknown }
    return typeof candidate.dirPath === 'string' && candidate.dirPath.length > 0
}

/** 读取分类取值：只接受枚举内的字符串，其余（含未传）回落为默认分类 */
export function readPressCategory(value: unknown): PressCategory {
    if (typeof value !== 'string') {
        return DEFAULT_PRESS_CATEGORY
    }
    return PRESS_CATEGORIES.find((item) => item === value) ?? DEFAULT_PRESS_CATEGORY
}
