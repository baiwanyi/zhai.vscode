/**
 * @zhai/ 前缀路径：把文档里「相对存储根」的引用还原成可加载地址。
 * 复用约定：webview 侧（react-markdown）拼 asWebviewUri 基址，扩展宿主侧（Markdown 预览插件）转成相对当前文档的路径，
 * 两侧共用同一份前缀判定与路径清理，不再各写一套正则。
 * 关键约束：只识别 `@zhai/` 前缀，其余写法（相对路径、http(s)、data:）原样返回；
 * 前缀后的 `..`、空段、反斜杠与盘符一律拒绝，避免越出存储根读到任意文件；
 * 基址末尾斜杠可有可无，拼接结果只保留单个分隔符；`?query` / `#hash` 原样保留。
 */

/** 存储根引用前缀：文档里写作 `@zhai/{存储根相对路径}` */
export const ZHAI_PATH_PREFIX = '@zhai/'

/** 存储根基址的 meta 名：宿主写进 HTML，webview 侧按此读取 */
export const STORAGE_BASE_META = 'zhai-storage-base'

/** 是否存储根引用：大小写敏感，避免把普通依赖路径误判成资源引用 */
export function isZhaiPath(value: string): boolean {
    return value.startsWith(ZHAI_PATH_PREFIX)
}

/**
 * 取前缀后的存储根相对路径（不含查询串与锚点）。
 * 非存储根引用、空路径与含越界段的路径都返回 null，由调用方保持原样。
 */
export function readZhaiRelativePath(value: string): string | null {
    if (!isZhaiPath(value)) {
        return null
    }
    const cut = value.search(/[?#]/u)
    const pathPart = cut === -1 ? value.slice(ZHAI_PATH_PREFIX.length) : value.slice(ZHAI_PATH_PREFIX.length, cut)
    const segments = pathPart.split('/')
    for (const segment of segments) {
        if (segment === '' || segment === '.' || segment === '..') {
            return null
        }
        if (segment.includes('\\') || segment.includes(':')) {
            return null
        }
    }
    return segments.join('/')
}

/** 拼接基址与相对路径：基址末尾多写或少写斜杠都收敛成一个分隔符 */
export function joinStorageBase(base: string, relative: string): string {
    const head = base.replace(/\/+$/u, '')
    const tail = relative.replace(/^\/+/u, '')
    if (head === '') {
        return tail
    }
    if (tail === '') {
        return head
    }
    return `${head}/${tail}`
}

/**
 * 解析图片地址：命中 `@zhai/` 前缀时拼到基址，其余原样返回。
 * 基址为空（宿主未注入）时同样原样返回，避免产出一个只有相对段的坏链接。
 */
export function resolveZhaiSrc(src: string, base: string): string {
    if (base === '') {
        return src
    }
    const relative = readZhaiRelativePath(src)
    if (relative === null) {
        return src
    }
    const cut = src.search(/[?#]/u)
    const suffix = cut === -1 ? '' : src.slice(cut)
    return `${joinStorageBase(base, relative)}${suffix}`
}
