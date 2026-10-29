/**
 * @zhai/ 前缀路径：把文档里「相对存储根」的引用还原成可加载地址，并把绝对路径折算成 `@zhai\` 展示形式。
 * 复用约定：webview 侧（react-markdown）拼 asWebviewUri 基址，扩展宿主侧（Markdown 预览插件）转成相对当前文档的路径，
 * 两侧共用同一份前缀判定与路径清理，不再各写一套正则；展示折算同样集中于此，徽章与芯片共用一个口径。
 * 关键约束：只识别 `@zhai/` 前缀，其余写法（相对路径、http(s)、data:）原样返回；
 * 前缀后的 `..`、空段、反斜杠与盘符一律拒绝，避免越出存储根读到任意文件；
 * 基址末尾斜杠可有可无，拼接结果只保留单个分隔符；`?query` / `#hash` 原样保留；
 * 资源引用恒用正斜杠，展示路径恒用反斜杠，两套写法只在各自的出口出现，不可互相喂入。
 */

/** 存储根引用前缀：文档里写作 `@zhai/{存储根相对路径}` */
export const ZHAI_PATH_PREFIX = '@zhai/'

/** 存储根基址的 meta 名：宿主写进 HTML，webview 侧按此读取 */
export const STORAGE_BASE_META = 'zhai-storage-base'

/** 存储根文件系统路径的 meta 名：展示层据此把绝对路径裁回相对路径 */
export const STORAGE_ROOT_META = 'zhai-storage-root'

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

/** 展示前缀：悬浮提示里的完整路径写作 `@zhai\{存储根相对路径}` */
const ZHAI_DISPLAY_PREFIX = '@zhai\\'

/** 分隔符归一：比较与裁切都走正斜杠，避免同一路径出现两种写法 */
function toForwardSlashes(value: string): string {
    return value.replace(/[\\/]+/gu, '/')
}

/**
 * 展示路径折算：把存储根下的绝对路径裁成相对路径，再统一成 `@zhai\` 反斜杠形式。
 * 关键约束：只服务展示 —— 资源引用仍是 `@zhai/` 正斜杠，两者不可互相替代；
 * 绝对路径不在存储根下时原样返回，不在展示层猜测文件归属。
 */
export function formatZhaiDisplayPath(displayPath: string, storageRoot: string): string {
    const trimmed = displayPath.trim()
    if (trimmed.length === 0) {
        return trimmed
    }
    const target = toForwardSlashes(trimmed)
    const root = toForwardSlashes(storageRoot.trim()).replace(/\/+$/u, '')
    if (root.length > 0 && target.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
        return `${ZHAI_DISPLAY_PREFIX}${target.slice(root.length + 1).replace(/\//gu, '\\')}`
    }
    if (/^(?:[a-zA-Z]:\/|\/)/u.test(target)) {
        return trimmed
    }
    return `${ZHAI_DISPLAY_PREFIX}${target.replace(/\//gu, '\\')}`
}

/** 读取宿主注入的存储根文件系统路径：非 webview 环境或未注入时返回空串 */
export function readStorageRootPath(): string {
    if (typeof document === 'undefined') {
        return ''
    }
    const meta = document.querySelector(`meta[name="${STORAGE_ROOT_META}"]`)
    return meta?.getAttribute('content') ?? ''
}

/** 展示路径：取宿主注入的存储根后折算，供引用徽章与输入区芯片直接调用 */
export function toZhaiDisplayPath(displayPath: string): string {
    return formatZhaiDisplayPath(displayPath, readStorageRootPath())
}

/**
 * 正文令牌：`@zhai` + 一个分隔符起头，遇到空白、引号、尖括号与常见中英文标点即止。
 * 关键约束：正反斜杠都认，但令牌本身不参与资源解析，只用于识别用户手写的引用。
 */
export const ZHAI_TOKEN_PATTERN = /@zhai[\\/][^\s<>"'`，。；、！？（）【】「」『』]+/gu

/** 令牌解析结果：存储根相对路径与行范围（单行时首尾相同） */
export interface ZhaiTarget {
    relative: string
    startLine: number | null
    endLine: number | null
}

/**
 * 解析单个令牌：拆出行号并逐段校验。
 * 关键约束：空段、`.`、`..` 与含冒号的段一律拒绝 —— 后者的典型来源是盘符，拼进来就能跳出存储根；
 * 行范围倒序（`50-42`）同样拒绝，避免下游按 slice 取不到内容。
 */
export function parseZhaiTarget(token: string): ZhaiTarget | null {
    if (!/^@zhai[\\/]/u.test(token)) {
        return null
    }
    const matched = /^(.*?)(?::(\d+)(?:-(\d+))?)?$/u.exec(token.slice('@zhai'.length + 1))
    if (matched === null) {
        return null
    }
    const segments = (matched[1] ?? '').split(/[\\/]+/u)
    for (const segment of segments) {
        if (segment === '' || segment === '.' || segment === '..' || segment.includes(':')) {
            return null
        }
    }
    const start = matched[2] === undefined ? null : Number(matched[2])
    const end = start === null ? null : matched[3] === undefined ? start : Number(matched[3])
    if (start !== null && (start < 1 || (end !== null && end < start))) {
        return null
    }
    return { relative: segments.join('/'), startLine: start, endLine: end }
}

/** 令牌命中：保留原始位置，便于调用方按需替换或剥离 */
export interface ZhaiTokenMatch {
    token: string
    index: number
    target: ZhaiTarget
}

/** 扫描文本里的全部合法令牌：解析失败的整条跳过，其余按出现顺序返回 */
export function readZhaiTargets(text: string): ZhaiTokenMatch[] {
    const matches: ZhaiTokenMatch[] = []
    for (const match of text.matchAll(ZHAI_TOKEN_PATTERN)) {
        const target = parseZhaiTarget(match[0])
        if (target !== null) {
            matches.push({ token: match[0], index: match.index, target })
        }
    }
    return matches
}

/**
 * 把正文里位于存储根下的绝对路径改写成 `@zhai\` 形式，其余文本原样保留。
 * 用途是复制消息时统一路径口径，让剪贴板内容可以直接粘回输入框被识别。
 */
export function replaceStorageRootPaths(text: string, storageRoot: string): string {
    if (storageRoot.trim().length === 0) {
        return text
    }
    return text.replace(/[a-zA-Z]:[\\/][^\s<>"'`，。；、！？（）【】「」『』]+/gu, (token) =>
        formatZhaiDisplayPath(token, storageRoot),
    )
}
