/**
 * 公众号协议路由：把 wechat/accounts 与 wechat/account/* 分发到账号服务，是仪表盘侧唯一入口。
 * 复用约定：由 DashboardViewProvider 按前缀委托，入参收窄统一在 shared/types/wechat 完成，
 * 本层只做方法名到服务方法的映射，不解析业务字段、不拼装提示文案。
 * 关键约束：方法名与 shared/types/messages 的 HostMethodName 一一对应，新增方法须两侧同时维护；
 * 未登记的方法一律抛错，避免拼错方法名时静默返回空结果。
 */
import {
    isCreateWechatAccountRequest,
    isRemoveWechatAccountRequest,
    isSelectWechatAccountRequest,
    isTestWechatAccountRequest,
    isUpdateWechatAccountRequest,
} from '@shared/types/wechat'
import type { WechatAccountService } from './accountService'

export class WechatRoutes {
    public constructor(private readonly accounts: WechatAccountService) {}

    /** 处理公众号协议方法 */
    public async handle(method: string, payload: unknown): Promise<unknown> {
        switch (method) {
            case 'wechat/accounts':
                return this.accounts.list()
            case 'wechat/account/create': {
                if (!isCreateWechatAccountRequest(payload)) {
                    throw new Error('wechat/account/create 参数非法：名称、AppID 与 AppSecret 均须合法')
                }
                return this.accounts.create(payload)
            }
            case 'wechat/account/update': {
                if (!isUpdateWechatAccountRequest(payload)) {
                    throw new Error('wechat/account/update 参数非法：id、名称与 AppID 均须合法')
                }
                return this.accounts.update(payload)
            }
            case 'wechat/account/remove': {
                if (!isRemoveWechatAccountRequest(payload)) {
                    throw new Error('wechat/account/remove 参数非法：id 须为合法账号标识')
                }
                return this.accounts.remove(payload.id)
            }
            case 'wechat/account/test': {
                if (!isTestWechatAccountRequest(payload)) {
                    throw new Error('wechat/account/test 参数非法：id 须为合法账号标识')
                }
                return this.accounts.test(payload.id)
            }
            case 'wechat/account/select': {
                if (!isSelectWechatAccountRequest(payload)) {
                    throw new Error('wechat/account/select 参数非法：id 须为合法账号标识或 null')
                }
                return this.accounts.select(payload.id)
            }
            default:
                throw new Error(`未知的公众号协议方法：${method}`)
        }
    }
}
