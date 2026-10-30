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
    isWechatFanListRequest,
    isWechatFanTagsRequest,
    isWechatIssueRemoveRequest,
    isWechatIssuesRequest,
    isWechatMaterialImportRequest,
    isWechatMaterialListRequest,
    isWechatMenuRequest,
    isWechatMenuSaveRequest,
    isWechatPublishDraftRequest,
    isWechatPublishQuotaRequest,
    isWechatPublishRequest,
    isWechatStatsRequest,
} from '@shared/types/wechat'
import type { WechatAccountService } from './accountService'
import type { WechatFanService } from './fanService'
import type { WechatIssueService } from './issueService'
import type { WechatMaterialService } from './materialService'
import type { WechatMenuService } from './menuService'
import type { WechatPublishService } from './publishService'
import type { WechatStatsService } from './statsService'

/** 路由依赖：按域注入，新增运营分区时只加字段，不改构造签名 */
export interface WechatRouteDeps {
    accounts: WechatAccountService
    issues: WechatIssueService
    publish: WechatPublishService
    materials: WechatMaterialService
    menu: WechatMenuService
    fans: WechatFanService
    stats: WechatStatsService
}

export class WechatRoutes {
    public constructor(private readonly deps: WechatRouteDeps) {}

    /** 处理公众号协议方法 */
    public async handle(method: string, payload: unknown): Promise<unknown> {
        switch (method) {
            case 'wechat/accounts':
                return this.deps.accounts.list()
            case 'wechat/account/create': {
                if (!isCreateWechatAccountRequest(payload)) {
                    throw new Error('wechat/account/create 参数非法：名称、AppID 与 AppSecret 均须合法')
                }
                return this.deps.accounts.create(payload)
            }
            case 'wechat/account/update': {
                if (!isUpdateWechatAccountRequest(payload)) {
                    throw new Error('wechat/account/update 参数非法：id、名称与 AppID 均须合法')
                }
                return this.deps.accounts.update(payload)
            }
            case 'wechat/account/remove': {
                if (!isRemoveWechatAccountRequest(payload)) {
                    throw new Error('wechat/account/remove 参数非法：id 须为合法账号标识')
                }
                return this.deps.accounts.remove(payload.id)
            }
            case 'wechat/account/test': {
                if (!isTestWechatAccountRequest(payload)) {
                    throw new Error('wechat/account/test 参数非法：id 须为合法账号标识')
                }
                return this.deps.accounts.test(payload.id)
            }
            case 'wechat/account/select': {
                if (!isSelectWechatAccountRequest(payload)) {
                    throw new Error('wechat/account/select 参数非法：id 须为合法账号标识或 null')
                }
                return this.deps.accounts.select(payload.id)
            }
            case 'wechat/issues': {
                if (!isWechatIssuesRequest(payload)) {
                    throw new Error('wechat/issues 参数非法：accountId 须为合法账号标识')
                }
                return this.deps.issues.list(payload.accountId)
            }
            case 'wechat/issue/create': {
                if (!isWechatIssueCreateRequest(payload)) {
                    throw new Error('wechat/issue/create 参数非法：accountId 须合法，title 为可选字符串')
                }
                return this.deps.issues.create(payload)
            }
            case 'wechat/issue/detail': {
                if (!isWechatIssueDetailRequest(payload)) {
                    throw new Error('wechat/issue/detail 参数非法：id 须为合法批次标识')
                }
                return this.deps.issues.detail(payload.id)
            }
            case 'wechat/issue/remove': {
                if (!isWechatIssueRemoveRequest(payload)) {
                    throw new Error('wechat/issue/remove 参数非法：id 须为合法批次标识')
                }
                return this.deps.issues.remove(payload.id)
            }
            case 'wechat/issue/publishDraft': {
                if (!isWechatPublishDraftRequest(payload)) {
                    throw new Error('wechat/issue/publishDraft 参数非法：issueId 须为合法批次标识')
                }
                return this.deps.publish.publishDraft(payload.issueId)
            }
            case 'wechat/issue/publish': {
                if (!isWechatPublishRequest(payload)) {
                    throw new Error('wechat/issue/publish 参数非法：issueId 须为合法批次标识')
                }
                return this.deps.publish.publish(payload.issueId)
            }
            case 'wechat/publishQuota': {
                if (!isWechatPublishQuotaRequest(payload)) {
                    throw new Error('wechat/publishQuota 参数非法：accountId 须为合法账号标识')
                }
                return this.deps.publish.quota(payload.accountId)
            }
            case 'wechat/article/create': {
                if (!isWechatArticleCreateRequest(payload)) {
                    throw new Error('wechat/article/create 参数非法：issueId 与标题必填，正文不得超长')
                }
                return this.deps.issues.createArticle(payload)
            }
            case 'wechat/article/update': {
                if (!isWechatArticleUpdateRequest(payload)) {
                    throw new Error('wechat/article/update 参数非法：id 与标题必填，正文不得超长')
                }
                return this.deps.issues.updateArticle(payload)
            }
            case 'wechat/article/remove': {
                if (!isWechatArticleRemoveRequest(payload)) {
                    throw new Error('wechat/article/remove 参数非法：id 须为合法文章标识')
                }
                return this.deps.issues.removeArticle(payload.id)
            }
            case 'wechat/article/import': {
                if (!isWechatArticleImportRequest(payload)) {
                    throw new Error('wechat/article/import 参数非法：issueId 须合法，sourceKind 须为 note 或 press')
                }
                return this.deps.issues.importArticle(payload)
            }
            case 'wechat/cover/pick':
                return this.deps.issues.pickCover()
            case 'wechat/material/list': {
                if (!isWechatMaterialListRequest(payload)) {
                    throw new Error('wechat/material/list 参数非法：accountId 须为合法账号标识')
                }
                return this.deps.materials.list(payload.accountId)
            }
            case 'wechat/material/import': {
                if (!isWechatMaterialImportRequest(payload)) {
                    throw new Error('wechat/material/import 参数非法：accountId 须为合法账号标识')
                }
                return this.deps.materials.importImage(payload.accountId)
            }
            case 'wechat/menu/get': {
                if (!isWechatMenuRequest(payload)) {
                    throw new Error('wechat/menu/get 参数非法：accountId 须为合法账号标识')
                }
                return this.deps.menu.get(payload.accountId)
            }
            case 'wechat/menu/save': {
                if (!isWechatMenuSaveRequest(payload)) {
                    throw new Error('wechat/menu/save 参数非法：accountId 须合法，buttons 须为数组')
                }
                return this.deps.menu.save(payload)
            }
            case 'wechat/fans/list': {
                if (!isWechatFanListRequest(payload)) {
                    throw new Error('wechat/fans/list 参数非法：accountId 须合法，nextOpenid 为可选字符串')
                }
                return this.deps.fans.list(payload)
            }
            case 'wechat/fans/tags': {
                if (!isWechatFanTagsRequest(payload)) {
                    throw new Error('wechat/fans/tags 参数非法：accountId 须为合法账号标识')
                }
                return this.deps.fans.tags(payload.accountId)
            }
            case 'wechat/stats/overview': {
                if (!isWechatStatsRequest(payload)) {
                    throw new Error('wechat/stats/overview 参数非法：accountId 须合法，days 只接受 7 / 15 / 30')
                }
                return this.deps.stats.overview(payload)
            }
            default:
                throw new Error(`未知的公众号协议方法：${method}`)
        }
    }
}
