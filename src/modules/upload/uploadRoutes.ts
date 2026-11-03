/**
 * 上传协议路由：把 upload/* 消息分发到上传服务，与 media/*、stock/* 并列的独立前缀。
 * 复用约定：入参收窄全部在服务层完成，本类只做方法到服务的映射；URL 转换由 Provider 注入，
 * 与媒体路由保持同一种装配方式。
 * 关键约束：方法名必须在 @shared/types/messages 的 HostMethodName 中登记，拼错在编译期失败；
 * 前端不传任何路径，落盘位置只由宿主决定。
 */
import type { UploadService } from './uploadService'
import type * as vscode from 'vscode'

export class UploadRoutes {
    public constructor(private readonly upload: UploadService) {}

    /**
     * 处理上传协议方法。
     * @param toWebviewUri 把磁盘 Uri 转成 webview 可访问 URL 的转换器
     */
    public async handle(method: string, payload: unknown, toWebviewUri: (uri: vscode.Uri) => string): Promise<unknown> {
        switch (method) {
            case 'upload/pick':
                return this.upload.pickUpload(toWebviewUri)
            case 'upload/bytes':
                return this.upload.uploadBytes(payload, toWebviewUri)
            case 'upload/list':
                return this.upload.list(toWebviewUri)
            case 'upload/reveal':
                return this.upload.reveal()
            default:
                throw new Error(`未知的上传协议方法：${method}`)
        }
    }
}
