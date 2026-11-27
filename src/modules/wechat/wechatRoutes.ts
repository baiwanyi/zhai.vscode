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
    isSaveWechatAccountCredentialsRequest,
    isSelectWechatAccountRequest,
    isTestWechatAccountRequest,
    isUpdateWechatAccountRequest,
    isWechatAccountQrcodeRequest,
    isWechatArticleCoverRequest,
    isWechatArticleCreateRequest,
    isWechatArticleImportRequest,
    isWechatArticleMetaRequest,
    isWechatArticleMoveRequest,
    isWechatArticleOpenRequest,
    isWechatArticleQuickCreateRequest,
    isWechatArticleRemoveRequest,
    isWechatArticleUpdateRequest,
    isWechatIssueCreateRequest,
    isWechatIssueDetailRequest,
    isWechatCommentListRequest,
    isWechatCommentMarkRequest,
    isWechatCommentRemoveRequest,
    isWechatCommentReplyRequest,
    isWechatCoverSourceRequest,
    isWechatFanBlacklistRequest,
    isWechatFanDetailRequest,
    isWechatFanListRequest,
    isWechatFanRemarkRequest,
    isWechatFanSearchRequest,
    isWechatFanSyncRequest,
    isWechatFanSyncStatusRequest,
    isWechatFanTagCreateRequest,
    isWechatFanTagMembersRequest,
    isWechatFanTagRemoveRequest,
    isWechatFanTagRenameRequest,
    isWechatFanTagsRequest,
    isWechatIssueRemoveRequest,
    isWechatIssuesMergeRequest,
    isWechatIssuesRemoveBatchRequest,
    isWechatIssuesRequest,
    isWechatMaterialImportRequest,
    isWechatMaterialListRequest,
    isWechatMaterialRemoveRequest,
    isWechatMenuRequest,
    isWechatMenuSaveRequest,
    isWechatPublishDraftRequest,
    isWechatPublishQuotaRequest,
    isWechatPublishRequest,
    isWechatStatsQueryRequest,
    isWechatStatsRequest,
} from '@shared/types/wechat'
import type { WechatPublishProgress } from '@shared/types/wechat'
import { WECHAT_METHODS } from '@shared/types/wechatMethods'
import type { WechatAccountService } from './accountService'
import type { WechatCommentService } from './commentService'
import type { WechatFanService } from './fanService'
import type { WechatFanSyncService } from './fanSyncService'
import type { WechatFanWriteService } from './fanWriteService'
import type { WechatIssueService } from './issueService'
import type { WechatMaterialService } from './materialService'
import type { WechatMenuService } from './menuService'
import type { WechatPublishService } from './publishService'
import type { WechatQrcodeService } from './qrcodeService'
import type { WechatStatsService } from './statsService'

/**
 * 会切换活跃编辑器的公众号协议：打开正文、新建即打开、导入即打开。
 * 使用方：两个 Provider 处理完请求后立即同步工作流路由事实，使侧栏菜单跟随当前文档。
 */
export const WECHAT_DOCUMENT_METHODS: ReadonlySet<string> = new Set([
    WECHAT_METHODS.articleImport,
    WECHAT_METHODS.articleOpen,
    WECHAT_METHODS.articleQuickCreate,
])

/** 路由依赖：按域注入，新增运营分区时只加字段，不改构造签名 */
export interface WechatRouteDeps {
    accounts: WechatAccountService
    qrcode: WechatQrcodeService
    issues: WechatIssueService
    publish: WechatPublishService
    materials: WechatMaterialService
    menu: WechatMenuService
    fans: WechatFanService
    fanSync: WechatFanSyncService
    fanWrite: WechatFanWriteService
    stats: WechatStatsService
    comments: WechatCommentService
}

export class WechatRoutes {
    public constructor(private readonly deps: WechatRouteDeps) {}

    /**
     * 处理公众号协议方法。
     * onProgress 由发起请求的面板提供：草稿与群发会分阶段播报，经该回调投递给自己的 Webview。
     */
    public async handle(
        method: string,
        payload: unknown,
        onProgress?: (progress: WechatPublishProgress) => void,
    ): Promise<unknown> {
        switch (method) {
            case WECHAT_METHODS.accounts:
                return this.deps.accounts.list()
            case WECHAT_METHODS.accountCreate: {
                if (!isCreateWechatAccountRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.accountCreate} 参数非法：名称必填，类型与默认作者须为字符串`)
                }
                return this.deps.accounts.create(payload)
            }
            case WECHAT_METHODS.accountUpdate: {
                if (!isUpdateWechatAccountRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.accountUpdate} 参数非法：id 与名称必填，类型与默认作者须为字符串`)
                }
                return this.deps.accounts.update(payload)
            }
            case WECHAT_METHODS.accountCredentials: {
                if (!isSaveWechatAccountCredentialsRequest(payload)) {
                    throw new Error(
                        `${WECHAT_METHODS.accountCredentials} 参数非法：id 与 AppID 必填，AppSecret 缺省表示沿用`,
                    )
                }
                return this.deps.accounts.saveCredentials(payload)
            }
            case WECHAT_METHODS.accountRemove: {
                if (!isRemoveWechatAccountRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.accountRemove} 参数非法：id 须为合法账号标识`)
                }
                return this.deps.accounts.remove(payload.id)
            }
            case WECHAT_METHODS.accountTest: {
                if (!isTestWechatAccountRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.accountTest} 参数非法：id 须为合法账号标识`)
                }
                return this.deps.accounts.test(payload.id)
            }
            case WECHAT_METHODS.accountQrcode: {
                if (!isWechatAccountQrcodeRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.accountQrcode} 参数非法：id 须为合法账号标识`)
                }
                return this.deps.qrcode.get(payload.id)
            }
            case WECHAT_METHODS.accountSelect: {
                if (!isSelectWechatAccountRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.accountSelect} 参数非法：id 须为合法账号标识或 null`)
                }
                return this.deps.accounts.select(payload.id)
            }
            case WECHAT_METHODS.issues: {
                if (!isWechatIssuesRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.issues} 参数非法：accountId 须为合法账号标识`)
                }
                return this.deps.issues.list(payload.accountId)
            }
            case WECHAT_METHODS.issuesMerge: {
                if (!isWechatIssuesMergeRequest(payload)) {
                    throw new Error(
                        `${WECHAT_METHODS.issuesMerge} 参数非法：ids 须为 1~20 个合法批次标识，targetId 须合法且不在 ids 内`,
                    )
                }
                return this.deps.issues.merge(payload)
            }
            case WECHAT_METHODS.issuesRemoveBatch: {
                if (!isWechatIssuesRemoveBatchRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.issuesRemoveBatch} 参数非法：ids 须为 1~50 个合法批次标识`)
                }
                return this.deps.issues.removeMany(payload.ids)
            }
            case WECHAT_METHODS.issueCreate: {
                if (!isWechatIssueCreateRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.issueCreate} 参数非法：accountId 须合法，title 为可选字符串`)
                }
                return this.deps.issues.create(payload)
            }
            case WECHAT_METHODS.issueDetail: {
                if (!isWechatIssueDetailRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.issueDetail} 参数非法：id 须为合法批次标识`)
                }
                return this.deps.issues.detail(payload.id)
            }
            case WECHAT_METHODS.issueRemove: {
                if (!isWechatIssueRemoveRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.issueRemove} 参数非法：id 须为合法批次标识`)
                }
                return this.deps.issues.remove(payload.id)
            }
            case WECHAT_METHODS.issuePublishDraft: {
                if (!isWechatPublishDraftRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.issuePublishDraft} 参数非法：issueId 须为合法批次标识`)
                }
                return this.deps.publish.publishDraft(payload.issueId, onProgress)
            }
            case WECHAT_METHODS.issuePublish: {
                if (!isWechatPublishRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.issuePublish} 参数非法：issueId 须为合法批次标识`)
                }
                return this.deps.publish.publish(payload.issueId, onProgress)
            }
            case WECHAT_METHODS.tasks:
                // 进行中任务只读且无参数：任意页面进入时查询一次，用于展示「现在在跑什么」
                return this.deps.publish.listTasks()
            case WECHAT_METHODS.publishQuota: {
                if (!isWechatPublishQuotaRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.publishQuota} 参数非法：accountId 须为合法账号标识`)
                }
                return this.deps.publish.quota(payload.accountId)
            }
            case WECHAT_METHODS.articleCreate: {
                if (!isWechatArticleCreateRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.articleCreate} 参数非法：issueId 与标题必填，正文不得超长`)
                }
                return this.deps.issues.createArticle(payload)
            }
            case WECHAT_METHODS.articleUpdate: {
                if (!isWechatArticleUpdateRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.articleUpdate} 参数非法：id 与标题必填，正文不得超长`)
                }
                return this.deps.issues.updateArticle(payload)
            }
            case WECHAT_METHODS.articleRemove: {
                if (!isWechatArticleRemoveRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.articleRemove} 参数非法：id 须为合法文章标识`)
                }
                return this.deps.issues.removeArticle(payload.id)
            }
            case WECHAT_METHODS.articleImport: {
                if (!isWechatArticleImportRequest(payload)) {
                    throw new Error(
                        `${WECHAT_METHODS.articleImport} 参数非法：issueId 须合法，sourceKind 须为 note 或 press`,
                    )
                }
                return this.deps.issues.importArticle(payload)
            }
            case WECHAT_METHODS.articleQuickCreate: {
                if (!isWechatArticleQuickCreateRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.articleQuickCreate} 参数非法：issueId 须为合法批次标识`)
                }
                return this.deps.issues.quickCreateArticle(payload.issueId)
            }
            case WECHAT_METHODS.articleOpen: {
                if (!isWechatArticleOpenRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.articleOpen} 参数非法：id 须为合法文章标识`)
                }
                return this.deps.issues.openArticle(payload.id)
            }
            case WECHAT_METHODS.articleMeta: {
                if (!isWechatArticleMetaRequest(payload)) {
                    throw new Error(
                        `${WECHAT_METHODS.articleMeta} 参数非法：id 必填，标题给出时须非空，封面与留言开关须为合法类型`,
                    )
                }
                return this.deps.issues.updateArticleMeta(payload)
            }
            case WECHAT_METHODS.articleMove: {
                if (!isWechatArticleMoveRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.articleMove} 参数非法：id 须合法，direction 只接受 up 或 down`)
                }
                return this.deps.issues.moveArticle(payload)
            }
            case WECHAT_METHODS.articleCover: {
                if (!isWechatArticleCoverRequest(payload)) {
                    throw new Error(
                        `${WECHAT_METHODS.articleCover} 参数非法：id 须合法，dataUrl 须为 jpeg/png 的 base64 内联图`,
                    )
                }
                return this.deps.issues.saveArticleCover(payload)
            }
            case WECHAT_METHODS.coverPick:
                return this.deps.issues.pickCover()
            case WECHAT_METHODS.coverSource: {
                if (!isWechatCoverSourceRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.coverSource} 参数非法：path 须为非空路径`)
                }
                return this.deps.issues.readCoverSource(payload)
            }
            case WECHAT_METHODS.materialList: {
                if (!isWechatMaterialListRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.materialList} 参数非法：accountId 须为合法账号标识`)
                }
                return this.deps.materials.list(payload.accountId)
            }
            case WECHAT_METHODS.materialImport: {
                if (!isWechatMaterialImportRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.materialImport} 参数非法：accountId 须为合法账号标识`)
                }
                return this.deps.materials.importImage(payload.accountId)
            }
            case WECHAT_METHODS.materialRemove: {
                if (!isWechatMaterialRemoveRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.materialRemove} 参数非法：accountId 与 id 须为合法标识`)
                }
                return this.deps.materials.remove(payload.accountId, payload.id)
            }
            case WECHAT_METHODS.menuGet: {
                if (!isWechatMenuRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.menuGet} 参数非法：accountId 须为合法账号标识`)
                }
                return this.deps.menu.get(payload.accountId)
            }
            case WECHAT_METHODS.menuSave: {
                if (!isWechatMenuSaveRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.menuSave} 参数非法：accountId 须合法，buttons 须为数组`)
                }
                return this.deps.menu.save(payload)
            }
            case WECHAT_METHODS.fansList: {
                if (!isWechatFanListRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.fansList} 参数非法：accountId 须合法，nextOpenid 为可选字符串`)
                }
                return this.deps.fans.list(payload)
            }
            case WECHAT_METHODS.tags: {
                if (!isWechatFanTagsRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.tags} 参数非法：accountId 须为合法账号标识`)
                }
                return this.deps.fans.tags(payload.accountId)
            }
            case WECHAT_METHODS.fansSearch: {
                if (!isWechatFanSearchRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.fansSearch} 参数非法：筛选字段与分页值须合法`)
                }
                return this.deps.fans.search(payload)
            }
            case WECHAT_METHODS.fansDetail: {
                if (!isWechatFanDetailRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.fansDetail} 参数非法：accountId 与 openid 须合法`)
                }
                return this.deps.fans.detail(payload)
            }
            case WECHAT_METHODS.fansSync: {
                if (!isWechatFanSyncRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.fansSync} 参数非法：accountId 须合法，taskId 为可选字符串`)
                }
                return this.deps.fanSync.sync(payload)
            }
            case WECHAT_METHODS.fansSyncStatus: {
                if (!isWechatFanSyncStatusRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.fansSyncStatus} 参数非法：accountId 须合法，taskId 为可选字符串`)
                }
                return this.deps.fans.syncStatus(payload)
            }
            case WECHAT_METHODS.tagCreate: {
                if (!isWechatFanTagCreateRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.tagCreate} 参数非法：accountId 须合法，标签名 1~30 字符`)
                }
                return this.deps.fanWrite.createTag(payload)
            }
            case WECHAT_METHODS.tagRename: {
                if (!isWechatFanTagRenameRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.tagRename} 参数非法：id 须正整数，标签名 1~30 字符`)
                }
                return this.deps.fanWrite.renameTag(payload)
            }
            case WECHAT_METHODS.tagRemove: {
                if (!isWechatFanTagRemoveRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.tagRemove} 参数非法：id 须为正整数`)
                }
                return this.deps.fanWrite.removeTag(payload)
            }
            case WECHAT_METHODS.tagMembers: {
                if (!isWechatFanTagMembersRequest(payload)) {
                    throw new Error(
                        `${WECHAT_METHODS.tagMembers} 参数非法：openids 须为 1~100 个，action 只接受 add / remove`,
                    )
                }
                return this.deps.fanWrite.tagMembers(payload)
            }
            case WECHAT_METHODS.fansRemark: {
                if (!isWechatFanRemarkRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.fansRemark} 参数非法：openid 须合法，备注不超过 30 字符`)
                }
                return this.deps.fanWrite.remark(payload)
            }
            case WECHAT_METHODS.fansBlacklist: {
                if (!isWechatFanBlacklistRequest(payload)) {
                    throw new Error(
                        `${WECHAT_METHODS.fansBlacklist} 参数非法：openids 须为 1~100 个，action 只接受 block / unblock`,
                    )
                }
                return this.deps.fanWrite.blacklist(payload)
            }
            case WECHAT_METHODS.statsOverview: {
                if (!isWechatStatsRequest(payload)) {
                    throw new Error(
                        `${WECHAT_METHODS.statsOverview} 参数非法：accountId 须合法，days 只接受 7 / 15 / 30`,
                    )
                }
                return this.deps.stats.overview(payload)
            }
            case WECHAT_METHODS.statsQuery: {
                if (!isWechatStatsQueryRequest(payload)) {
                    throw new Error(
                        `${WECHAT_METHODS.statsQuery} 参数非法：accountId、维度与视图须匹配，日期须有序且跨度不超过 30 天`,
                    )
                }
                return this.deps.stats.query(payload)
            }
            case WECHAT_METHODS.commentList: {
                if (!isWechatCommentListRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.commentList} 参数非法：accountId、issueId、sortIndex 均须合法`)
                }
                return this.deps.comments.list(payload)
            }
            case WECHAT_METHODS.commentReply: {
                if (!isWechatCommentReplyRequest(payload)) {
                    throw new Error(
                        `${WECHAT_METHODS.commentReply} 参数非法：留言 id 须合法，内容不能为空且不超过 300 字`,
                    )
                }
                return this.deps.comments.reply(payload)
            }
            case WECHAT_METHODS.commentMark: {
                if (!isWechatCommentMarkRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.commentMark} 参数非法：留言 id 须合法，elected 须为布尔值`)
                }
                return this.deps.comments.mark(payload)
            }
            case WECHAT_METHODS.commentRemove: {
                if (!isWechatCommentRemoveRequest(payload)) {
                    throw new Error(`${WECHAT_METHODS.commentRemove} 参数非法：留言 id 须合法`)
                }
                return this.deps.comments.remove(payload)
            }
            default:
                throw new Error(`未知的公众号协议方法：${method}`)
        }
    }
}
