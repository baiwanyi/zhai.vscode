/**
 * 图片资源前缀：把正文里的 `@zhai/...` 引用转成 webview 可访问地址。
 * 复用约定：`@zhai/` 是项目既有的存储根别名（上传与媒体插入都按它写正文），此处只做前缀替换，
 * 不解析相对路径、不拼接文档目录。
 * 关键约束：只影响显示，不写回文档——nodeView 用转换后的地址，renderHTML 仍保留原始引用；
 * assetPrefix 由快照异步带来（首次渲染时可能为空），因此用模块级 store + 订阅让已渲染的图片重设 src。
 */
import { ZHAI_PATH_PREFIX } from '@shared/utils/zhaiPath'

let assetPrefix = ''
const listeners = new Set<() => void>()

/** 更新前缀：值未变时不通知，避免每次快照推送都让所有图片重渲染 */
export function setAssetPrefix(prefix: string): void {
    if (prefix === assetPrefix) {
        return
    }
    assetPrefix = prefix
    for (const listener of listeners) {
        listener()
    }
}

export function subscribeAssetPrefix(listener: () => void): () => void {
    listeners.add(listener)
    return (): void => {
        listeners.delete(listener)
    }
}

/** 引用转可访问地址：非 `@zhai/` 前缀（例如网络图）原样返回 */
export function resolveAssetUrl(src: string): string {
    if (!src.startsWith(ZHAI_PATH_PREFIX) || assetPrefix === '') {
        return src
    }
    return `${assetPrefix}/${src.slice(ZHAI_PATH_PREFIX.length)}`
}
