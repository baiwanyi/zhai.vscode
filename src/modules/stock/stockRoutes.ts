/**
 * 在线图库协议路由：把 stock/* 消息分发到 StockService，与 media/* 并列的独立前缀。
 * 复用约定：入参收窄全部在服务层完成，本类只做方法名到服务的映射；URL 转换由 Provider 注入，
 * 与媒体路由保持同一种装配方式，避免图库页再挂一条独立通道。
 * 关键约束：方法名必须在 @shared/types/messages 的 HostMethodName 中登记，拼错在编译期失败；
 * 前端只传 photoId 与受控枚举，不传 URL、路径与文件名。
 */
import type { StockService } from './stockService'
import type * as vscode from 'vscode'

export class StockRoutes {
    public constructor(private readonly service: StockService) {}

    /**
     * 处理在线图库协议方法。
     * @param toWebviewUri 把磁盘 Uri 转成 webview 可访问 URL 的转换器
     */
    public async handle(method: string, payload: unknown, toWebviewUri: (uri: vscode.Uri) => string): Promise<unknown> {
        switch (method) {
            case 'stock/status':
                return this.service.status()
            case 'stock/key/save':
                return this.service.keySave(payload)
            case 'stock/key/clear':
                return this.service.keyClear()
            case 'stock/search':
                return this.service.search(payload, toWebviewUri)
            case 'stock/insert':
                return this.service.insert(payload, toWebviewUri)
            case 'stock/copy':
                return this.service.copy(payload)
            case 'stock/thumb':
                return this.service.thumb(payload, toWebviewUri)
            case 'stock/downloaded':
                return this.service.downloaded(payload, toWebviewUri)
            case 'stock/remove':
                return this.service.remove(payload)
            default:
                throw new Error(`未知的在线图库协议方法：${method}`)
        }
    }
}
