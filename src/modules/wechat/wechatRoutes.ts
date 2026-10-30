/**
 * 公众号协议路由：把 wechat/accounts、wechat/account/* 与批次、文章相关方法分发到对应服务。
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
    isWechatArticleCreateRequest,
    isWechatArticleImportRequest,
    isWechatArticleRemoveRequest,
    isWechatArticleUpdateRequest,
    isWechatIssueCreateRequest,
    isWechatIssueDetailRequest,
    isWechatIssueRemoveRequest,
    isWechatIssuesRequest,
    isWechatPublishDraftRequest,
    isWechatPublishQuotaRequest,
    isWechatPublishRequest,
} from '@shared/types/wechat'
import type { WechatAccountService } from './accountService'
import type { WechatIssueService } from './issueService'
import type { WechatPublishService } from './publishService'

export class WechatRoutes {
    public constructor(
        private readonly accounts: WechatAccountService,
        private readonly issues: WechatIssueService,
        private readonly publish: WechatPublishService,
    ) {}

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
            case 'wechat/issues': {
                if (!isWechatIssuesRequest(payload)) {
                    throw new Error('wechat/issues 参数非法：accountId 须为合法账号标识')
                }
                return this.issues.list(payload.accountId)
            }
            case 'wechat/issue/create': {
                if (!isWechatIssueCreateRequest(payload)) {
                    throw new Error('wechat/issue/create 参数非法：accountId 须合法，title 为可选字符串')
                }
                return this.issues.create(payload)
            }
            case 'wechat/issue/detail': {
                if (!isWechatIssueDetailRequest(payload)) {
                    throw new Error('wechat/issue/detail 参数非法：id 须为合法批次标识')
                }
                return this.issues.detail(payload.id)
            }
            case 'wechat/issue/remove': {
                if (!isWechatIssueRemoveRequest(payload)) {
                    throw new Error('wechat/issue/remove 参数非法：id 须为合法批次标识')
                }
                return this.issues.remove(payload.id)
            }
            case 'wechat/issue/publishDraft': {
                if (!isWechatPublishDraftRequest(payload)) {
                    throw new Error('wechat/issue/publishDraft 参数非法：issueId 须为合法批次标识')
                }
                return this.publish.publishDraft(payload.issueId)
            }
            case 'wechat/issue/publish': {
                if (!isWechatPublishRequest(payload)) {
                    throw new Error('wechat/issue/publish 参数非法：issueId 须为合法批次标识')
                }
                return this.publish.publish(payload.issueId)
            }
            case 'wechat/publishQuota': {
                if (!isWechatPublishQuotaRequest(payload)) {
                    throw new Error('wechat/publishQuota 参数非法：accountId 须为合法账号标识')
                }
                return this.publish.quota(payload.accountId)
            }
            case 'wechat/article/create': {
                if (!isWechatArticleCreateRequest(payload)) {
                    throw new Error('wechat/article/create 参数非法：issueId 与标题必填，正文不得超长')
                }
                return this.issues.createArticle(payload)
            }
            case 'wechat/article/update': {
                if (!isWechatArticleUpdateRequest(payload)) {
                    throw new Error('wechat/article/update 参数非法：id 与标题必填，正文不得超长')
                }
                return this.issues.updateArticle(payload)
            }
            case 'wechat/article/remove': {
                if (!isWechatArticleRemoveRequest(payload)) {
                    throw new Error('wechat/article/remove 参数非法：id 须为合法文章标识')
                }
                return this.issues.removeArticle(payload.id)
            }
            case 'wechat/article/import': {
                if (!isWechatArticleImportRequest(payload)) {
                    throw new Error('wechat/article/import 参数非法：issueId 须合法，sourceKind 须为 note 或 press')
                }
                return this.issues.importArticle(payload)
            }
            case 'wechat/cover/pick':
                return this.issues.pickCover()
            default:
                throw new Error(`未知的公众号协议方法：${method}`)
        }
    }
}
