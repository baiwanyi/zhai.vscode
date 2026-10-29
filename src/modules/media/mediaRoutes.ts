/**
 * 媒体协议路由：把 media/* 消息分发到媒体库服务，是与 pressAi/* 并列的独立前缀。
 * 复用约定：入参收窄全部在服务层完成，本类只做方法到服务的映射；URL 转换由 Provider 注入，
 * 与写作管理路由保持同一种装配方式，避免媒体页再挂一条独立通道。
 * 关键约束：方法名必须在 @shared/types/messages 的 HostMethodName 中登记，拼错在编译期失败；
 * 前端只传媒体 id 与受控枚举，不传任意路径。
 */
import type { MediaLibraryService } from './mediaLibraryService'
import type * as vscode from 'vscode'

export class MediaRoutes {
    public constructor(private readonly library: MediaLibraryService) {}

    /**
     * 处理媒体协议方法。
     * @param toWebviewUri 把磁盘 Uri 转成 webview 可访问 URL 的转换器
     */
    public async handle(
        method: string,
        payload: unknown,
        toWebviewUri: (uri: vscode.Uri) => string,
    ): Promise<unknown> {
        switch (method) {
            case 'media/list':
                return this.library.list(payload, toWebviewUri)
            case 'media/detail':
                return this.library.detail(payload, toWebviewUri)
            case 'media/delete':
                return this.library.remove(payload)
            case 'media/deleteBatch':
                return this.library.batchRemove(payload)
            case 'media/setCover':
                return this.library.setCover(payload)
            case 'media/insert':
                return this.library.insert(payload)
            case 'media/copy':
                return this.library.copy(payload)
            case 'media/rescan':
                return this.library.rescan()
            default:
                throw new Error(`未知的媒体协议方法：${method}`)
        }
    }
}
