/**
 * 待办协议路由：把 todo/* 消息分发到 TodoService，是待办页唯一的宿主入口。
 * 复用约定：由 AiChatViewProvider 统一接收 Webview 消息后按前缀委托，入参收窄在 shared/types/todo 完成，
 * 本层只做方法名到服务方法的映射，不自行解析业务字段。
 * 关键约束：方法名与 shared/types/messages 的 HostMethodName 一一对应，新增方法须两侧同时维护；
 * 未登记的方法一律抛错，避免拼错方法名时静默返回空结果。
 */
import type { TodoService } from './todoService'
import type { Event } from 'vscode'

export class TodoRoutes {
    public constructor(private readonly service: TodoService) {}

    /** 外部文件变更事件：Provider 据此向面板广播刷新 */
    public get onDidChange(): Event<void> {
        return this.service.onDidChange
    }

    /** 处理待办协议方法 */
    public async handle(method: string, payload: unknown): Promise<unknown> {
        switch (method) {
            case 'todo/lists':
                return this.service.lists()
            case 'todo/items':
                return this.service.detail(payload)
            case 'todo/list/create':
                return this.service.createList()
            case 'todo/list/delete':
                return this.service.deleteList(payload)
            case 'todo/list/rename':
                return this.service.renameList(payload)
            case 'todo/item/add':
                return this.service.addItems(payload)
            case 'todo/item/toggle':
                return this.service.toggleItem(payload)
            case 'todo/item/delete':
                return this.service.deleteItem(payload)
            default:
                throw new Error(`未知的待办协议方法：${method}`)
        }
    }
}
