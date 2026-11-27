/**
 * 公众号契约：账号摘要、创建/更新/删除/测试连接与当前账号选定的请求结构，以及账号类型与状态的唯一口径。
 * 使用方：仪表盘 Webview 的公众号列表页与宿主侧 DashboardViewProvider、modules/wechat 服务。
 * 复用约定：id 取本地生成的短 id（小写字母数字与连字符），与页内路由 #/wechat/{accountId} 同源；
 * 账号名称、类型与 AppID 落 wechat.db，AppSecret 只回传「是否已配置 + 尾号」，明文仅存 SecretStorage。
 * 关键约束：前端传入的字段一律不可信，宿主须经本文件的收窄函数校验后才可写库或发起网络请求；
 * 账号状态由宿主按接口错误码归一（40164 等），前端只负责展示，不自行推断。
 */

/** 公众号在存储根下的一级目录名：其下存放账号的批次正文 */
export const WECHAT_MODULE_DIR = 'wechat'

/** 批次文档路径：wechat/{appid}/post/{时间戳}/{文件名}.md */
const WECHAT_BATCH_DOC_PATTERN = /^wechat\/[^/]+\/post\/[^/]+\/[^/]+\.md$/

/**
 * 判断是否为批次文档路径：只做形态判断，不校验账号与文件是否存在。
 * 关键约束：宿主与前端共用同一份正则，避免「索引未收录」时的兜底判定各写一套。
 */
export function isWechatBatchDocPath(relativePath: string): boolean {
    return WECHAT_BATCH_DOC_PATTERN.test(relativePath)
}

/** 账号目录段数：wechat/{appid} 两段，第三段起是批次目录（post/...）或账号级文件 */
const WECHAT_ACCOUNT_DIR_DEPTH = 2

/**
 * 读取账号目录：公众号文档路径的前两段（wechat/{appid}），不在账号目录下返回 null。
 * 关键约束：对话作用域按账号聚合——同一账号下的所有批次与文章共用一份会话，故不取文档或批次路径；
 * appid 复用 APP_ID_PATTERN 的形态判定，避免把 wechat/其它临时目录误当成账号目录。
 */
export function readWechatAccountDir(relativePath: string | null): string | null {
    if (relativePath === null) {
        return null
    }
    const segments = relativePath.split('/')
    if (segments.length <= WECHAT_ACCOUNT_DIR_DEPTH) {
        return null
    }
    const [module, appId] = segments
    if (module !== WECHAT_MODULE_DIR || appId === undefined || !APP_ID_PATTERN.test(appId)) {
        return null
    }
    return `${module}/${appId}`
}

/** 账号类型：订阅号与服务号的能力差异见 wechat.md 第 8 节 */
export const WECHAT_ACCOUNT_TYPES = ['subscription', 'service'] as const

/** 账号类型取值 */
export type WechatAccountType = (typeof WECHAT_ACCOUNT_TYPES)[number]

/** 未指定时的默认账号类型 */
export const DEFAULT_WECHAT_ACCOUNT_TYPE: WechatAccountType = 'subscription'

/** 账号类型展示名：列表徽标与表单选项共用一处口径 */
export const WECHAT_ACCOUNT_TYPE_LABELS: Readonly<Record<WechatAccountType, string>> = {
    subscription: '订阅号',
    service: '服务号',
}

/** 账号连接状态：由宿主按鉴权结果归一，前端据此决定色点与错误摘要 */
export const WECHAT_ACCOUNT_STATUSES = ['connected', 'unauthenticated', 'error', 'limited'] as const

/** 账号连接状态取值 */
export type WechatAccountStatus = (typeof WECHAT_ACCOUNT_STATUSES)[number]

/** 账号名称长度上限：与公众号后台的账号名长度无关，仅为列表展示与输入约束 */
export const WECHAT_ACCOUNT_NAME_MAX = 40

/** AppID 形态：微博与公众号均由平台签发，公众号为 wx 开头的字母数字串；此处只做形态收窄，不做前缀强校验 */
const APP_ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/

/** AppSecret 形态：平台签发为字母数字串，长度随账号类型略有差异，按区间收窄 */
const APP_SECRET_PATTERN = /^[A-Za-z0-9]{16,64}$/

/** 本地账号 id 形态：与页内路由的 hash 段同源，禁止出现路径分隔符 */
const ACCOUNT_ID_PATTERN = /^[a-z0-9-]{1,64}$/

/** 账号摘要：宿主按 wechat.db 聚合，列表页直接渲染 */
export interface WechatAccountSummary {
    /** 本地账号 id，同时用作页内路由段 */
    id: string
    /** 账号名称：微信无公开接口可拉取，由用户填写 */
    name: string
    /** 头像地址：缺省时前端用名称首字占位 */
    avatar?: string
    /** 平台 AppID（非敏感，可在列表中展示） */
    appId: string
    /** 账号类型 */
    accountType: WechatAccountType
    /** 默认作者：文章设置弹窗里作者字段的初始值，未设置时缺省 */
    defaultAuthor?: string
    /** 是否已认证：决定发布、数据统计等能力是否可用 */
    verified: boolean
    /** 最近一次鉴权结果归一后的状态 */
    status: WechatAccountStatus
    /** 最近一次鉴权失败的微信错误码（如 40164 IP 不在白名单） */
    lastErrorCode?: number
    /** 与错误码配套的可执行提示，直接取自宿主归一结果 */
    statusHint?: string
    /** 粉丝数：由数据统计接口回填，未取到时为 0 */
    fanCount: number
    /** 推送批次数：来自 wechat_issues 的聚合 */
    issueCount: number
    /** 最近一次推送时间（ISO 8601），未推送过为 null */
    lastPublishAt: string | null
    /** 是否已配置 AppSecret：明文不出宿主，前端据此判断能否发起鉴权 */
    hasSecret: boolean
    /** 密钥尾号提示，形如 ****3f2a；未配置时缺省 */
    secretHint?: string
    /** 最近更新时间（ISO 8601） */
    updatedAt: string
}

/** wechat/accounts 响应：账号快照与当前账号一次取回，列表的「当前」徽标据此渲染 */
export interface WechatAccountsResult {
    accounts: WechatAccountSummary[]
    /** 当前账号 id：未选择或所选账号已被删除时为 null */
    selectedId: string | null
}

/**
 * 账号设置：名称、类型与默认作者，创建与更新共用。
 * 关键约束：凭据（AppID / AppSecret）不在这组字段里——新建账号时只填设置，
 * 密钥经 wechat/account/credentials 单独保存并触发鉴权。
 */
export interface WechatAccountProfileInput {
    /** 账号名称，写入前由宿主折叠空白并截断 */
    name: string
    /** 账号类型，非法值回落订阅号 */
    accountType?: string
    /** 默认作者：文章作者字段的初始值，空表示不预填 */
    defaultAuthor?: string
}

/** wechat/account/create 请求：只含账号设置，创建后状态为「未配置密钥」 */
export type CreateWechatAccountRequest = WechatAccountProfileInput

/** wechat/account/credentials 请求：单独保存凭据，成功后立即鉴权 */
export interface SaveWechatAccountCredentialsRequest {
    /** 目标账号 id */
    id: string
    /** 平台 AppID：未配置时必填，改它会让旧 Token 失效并重新鉴权 */
    appId: string
    /** 平台 AppSecret：留空或缺省表示沿用已存密钥 */
    appSecret?: string
}

/** wechat/account/credentials 响应 */
export interface SaveWechatAccountCredentialsResult {
    account: WechatAccountSummary
}

/** wechat/account/create 响应：返回落库后的摘要，前端据此跳到该账号 */
export interface CreateWechatAccountResult {
    account: WechatAccountSummary
}

/** wechat/account/update 请求：只改账号设置，凭据走 wechat/account/credentials */
export interface UpdateWechatAccountRequest extends WechatAccountProfileInput {
    /** 目标账号 id，须已在库中存在 */
    id: string
}

/** wechat/account/update 响应 */
export interface UpdateWechatAccountResult {
    account: WechatAccountSummary
}

/** wechat/account/remove 请求 */
export interface RemoveWechatAccountRequest {
    /** 目标账号 id */
    id: string
}

/** wechat/account/remove 响应 */
export interface RemoveWechatAccountResult {
    removed: boolean
    /** 由该账号归入通用对话的历史会话条数：前端在删除提示里追加一句，0 表示没有可归入的会话 */
    adoptedConversations: number
}

/** wechat/account/test 请求：重新鉴权并回写状态 */
export interface TestWechatAccountRequest {
    /** 目标账号 id */
    id: string
}

/** wechat/account/test 响应：status 只可能是 connected 与 error（未配置密钥时为 unauthenticated） */
export interface WechatAccountTestResult {
    /** 归一后的连接状态 */
    status: WechatAccountStatus
    /** 微信错误码，成功时缺省 */
    errorCode?: number
    /** 可执行提示，成功时缺省 */
    hint?: string
}

/**
 * wechat/account/qrcode 请求：按账号取关注二维码。
 * 入参只收账号 id，场景值与图片格式由宿主固定，前端不参与拼装平台参数。
 */
export interface WechatAccountQrcodeRequest {
    /** 目标账号 id */
    id: string
}

/** wechat/account/qrcode 响应：二维码已内联为 data URI，Webview 可直接放进 img */
export interface WechatAccountQrcodeResult {
    dataUrl: string
}

/** wechat/account/select 请求：写入当前账号，供工作流面板按账号取数 */
export interface SelectWechatAccountRequest {
    /** 目标账号 id，null 表示清除选择 */
    id: string | null
}

/** wechat/account/select 响应 */
export interface SelectWechatAccountResult {
    selectedId: string | null
}

/** 收窄账号类型：非法值回落默认类型，避免前端传入任意字符串落库 */
export function readWechatAccountType(value: unknown): WechatAccountType {
    return value === 'service' ? 'service' : DEFAULT_WECHAT_ACCOUNT_TYPE
}

/**
 * 规整账号名称：折叠连续空白并截断到上限。
 * 关键约束：空名称返回空串，由调用方判定为非法，不在此处兜底成默认名。
 */
export function readWechatAccountName(value: unknown): string {
    if (typeof value !== 'string') {
        return ''
    }
    return value.replace(/\s+/g, ' ').trim().slice(0, WECHAT_ACCOUNT_NAME_MAX)
}

/** 收窄本地账号 id：形态不符直接拒绝，避免任意字符串流入库查询与路由 */
export function isWechatAccountId(value: unknown): value is string {
    return typeof value === 'string' && ACCOUNT_ID_PATTERN.test(value)
}

/** 收窄 AppID：形态不符即拒绝，不在前端做前缀判断 */
export function isWechatAppId(value: unknown): value is string {
    return typeof value === 'string' && APP_ID_PATTERN.test(value.trim())
}

/** 收窄 AppSecret：形态不符即拒绝；密码本身不做 trim 之外的改造 */
export function isWechatAppSecret(value: unknown): value is string {
    return typeof value === 'string' && APP_SECRET_PATTERN.test(value.trim())
}

/** 收窄账号设置里的可选字段：类型与默认作者都只接受字符串 */
function isWechatAccountProfileInput(payload: object): boolean {
    const candidate = payload as { name?: unknown; accountType?: unknown; defaultAuthor?: unknown }
    if (typeof candidate.name !== 'string' || readWechatAccountName(candidate.name).length === 0) {
        return false
    }
    if (candidate.accountType !== undefined && typeof candidate.accountType !== 'string') {
        return false
    }
    return candidate.defaultAuthor === undefined || typeof candidate.defaultAuthor === 'string'
}

/** 判断是否为创建账号请求：只校验账号设置，凭据之后单独保存 */
export function isCreateWechatAccountRequest(payload: unknown): payload is CreateWechatAccountRequest {
    return typeof payload === 'object' && payload !== null && isWechatAccountProfileInput(payload)
}

/** 判断是否为更新账号设置请求：id 合法 + 名称非空 */
export function isUpdateWechatAccountRequest(payload: unknown): payload is UpdateWechatAccountRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    if (!isWechatAccountId((payload as { id?: unknown }).id)) {
        return false
    }
    return isWechatAccountProfileInput(payload)
}

/** 判断是否为保存凭据请求：AppID 必填，AppSecret 缺省表示沿用旧值 */
export function isSaveWechatAccountCredentialsRequest(
    payload: unknown,
): payload is SaveWechatAccountCredentialsRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { id?: unknown; appId?: unknown; appSecret?: unknown }
    if (!isWechatAccountId(candidate.id) || !isWechatAppId(candidate.appId)) {
        return false
    }
    return candidate.appSecret === undefined || isWechatAppSecret(candidate.appSecret)
}

/** 判断是否为删除账号请求 */
export function isRemoveWechatAccountRequest(payload: unknown): payload is RemoveWechatAccountRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    return isWechatAccountId((payload as { id?: unknown }).id)
}

/** 判断是否为测试连接请求 */
export function isTestWechatAccountRequest(payload: unknown): payload is TestWechatAccountRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    return isWechatAccountId((payload as { id?: unknown }).id)
}

/** 判断是否为关注二维码请求 */
export function isWechatAccountQrcodeRequest(payload: unknown): payload is WechatAccountQrcodeRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    return isWechatAccountId((payload as { id?: unknown }).id)
}

/** 判断是否为选择当前账号请求：id 为 null 表示清除 */
export function isSelectWechatAccountRequest(payload: unknown): payload is SelectWechatAccountRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const { id } = payload as { id?: unknown }
    return id === null || isWechatAccountId(id)
}

/** 推送批次状态：与 wechat_issues.status 同值，界面据此决定徽标与可用操作 */
export const WECHAT_ISSUE_STATUSES = ['draft', 'ready', 'scheduled', 'pushing', 'published', 'failed'] as const

/** 推送批次状态取值 */
export type WechatIssueStatus = (typeof WECHAT_ISSUE_STATUSES)[number]

/** 文章正文来源：manual 为手写，note / press 为从对应模块的文档导入 */
export const WECHAT_ARTICLE_SOURCES = ['manual', 'note', 'press'] as const

/** 文章正文来源取值 */
export type WechatArticleSourceKind = (typeof WECHAT_ARTICLE_SOURCES)[number]

/** 一次群发的篇数上限：平台限制为 8 篇，超出会被拒 */
export const WECHAT_ISSUE_ARTICLE_LIMIT = 8

/** 标题字数上限：平台限制 64 字 */
export const WECHAT_ARTICLE_TITLE_MAX = 64

/** 作者字数上限：平台限制 8 字 */
export const WECHAT_ARTICLE_AUTHOR_MAX = 8

/** 摘要字数上限：平台限制 120 字 */
export const WECHAT_ARTICLE_DIGEST_MAX = 120

/** 正文字数上限：公众号编辑器限制 2 万字，超出无法保存到草稿 */
export const WECHAT_ARTICLE_BODY_MAX = 20_000

/** 批次标题长度上限：取标题位的同一口径，仅用于列表展示与输入约束 */
export const WECHAT_ISSUE_TITLE_MAX = WECHAT_ARTICLE_TITLE_MAX

/** 文章列表项：不含正文，供批次卡片渲染 */
export interface WechatArticleSummary {
    id: string
    /** 批次内顺序，从 1 开始 */
    sortIndex: number
    title: string
    author?: string
    digest?: string
    /** 正文来源 */
    sourceKind: WechatArticleSourceKind
    /** 源文档相对路径：manual 时缺省，只作追溯，不参与发布 */
    sourcePath?: string
    /** 批次内正文文件（存储根相对路径）：发布内容以它为准，旧文章首次保存后才有 */
    filePath?: string
    /** 指定的封面图路径：缺省时推送阶段取正文首图 */
    coverPath?: string
    /**
     * 是否允许读者留言：写入草稿的 need_open_comment。
     * 关键约束：账号未开通留言时平台侧不会生效，这里只表达「本次希望开启」，不保证结果。
     */
    allowComment: boolean
    /** 正文字数，供列表判断是否为空稿 */
    wordCount: number
}

/** 文章详情：编辑弹窗需要正文原文 */
export interface WechatArticleDetail extends WechatArticleSummary {
    /** Markdown 正文：批次文件内容的镜像，推送时以文件为准，此处只供编辑回填 */
    body: string
}

/** 推送批次摘要：一次群发对应一个批次，含 1~8 篇文章 */
export interface WechatIssueSummary {
    id: string
    accountId: string
    title: string
    status: WechatIssueStatus
    /** 批次内文章数：与 articles.length 一致，列表按此判断是否可推送 */
    articleCount: number
    /** 批次内文章摘要，按 sortIndex 升序；列表只渲染前若干条 */
    articles: WechatArticleSummary[]
    /** 最近更新时间（ISO 8601） */
    updatedAt: string
    /** 计划推送时间（ISO 8601），未定时缺省 */
    scheduledAt?: string
    /** 实际推送时间（ISO 8601），未推送缺省 */
    publishedAt?: string
    /** 平台发布后获得的图文 id：article_id 类型菜单与旧批次可能缺省 */
    articleId?: string
    /** 失败原因摘要：status 为 failed 时给出可执行提示 */
    errorHint?: string
}

/** wechat/issues 请求 */
export interface WechatIssuesRequest {
    /** 目标账号 id */
    accountId: string
}

/**
 * wechat/issues/removeBatch 请求：批量删除批次。
 * 关键约束：只允许草稿与推送失败的批次——已推送的必须去平台后台删除，
 * 推送中的也可能已在平台侧生成内容，若前端绕过勾选限制，宿主会整体拒绝并说明原因。
 */
export interface WechatIssuesRemoveBatchRequest {
    ids: string[]
}

/** wechat/issues/removeBatch 响应 */
export interface WechatIssuesRemoveBatchResult {
    removed: number
}

/** 单次批量删除的条数上限：一次勾选不可能超过列表可见范围 */
export const WECHAT_ISSUE_REMOVE_BATCH_LIMIT = 50

/**
 * wechat/issues/merge 请求：把多个草稿批次的文章并入目标批次，源批次随后被删除。
 * 关键约束：目标批次必须在 ids 之外且同为草稿——已生成草稿的批次内容已进平台草稿箱，
 * 再往里加文章会让本地与平台不一致；合计篇数受一次群发的 8 篇上限约束。
 */
export interface WechatIssuesMergeRequest {
    /** 源批次 id：合并后这些批次会被删除 */
    ids: string[]
    /** 目标批次 id：文章追加到它末尾 */
    targetId: string
}

/** wechat/issues/merge 响应：返回合并后的目标批次与迁移的文章数 */
export interface WechatIssuesMergeResult {
    issue: WechatIssueSummary
    movedCount: number
}

/** 单次合并的源批次上限：与批量删除同口径 */
export const WECHAT_ISSUE_MERGE_LIMIT = 20

/** 判断是否为批次合并请求 */
export function isWechatIssuesMergeRequest(payload: unknown): payload is WechatIssuesMergeRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { ids?: unknown; targetId?: unknown }
    if (!isWechatIssueId(candidate.targetId) || !Array.isArray(candidate.ids)) {
        return false
    }
    if (candidate.ids.length === 0 || candidate.ids.length > WECHAT_ISSUE_MERGE_LIMIT) {
        return false
    }
    if (!candidate.ids.every((item) => isWechatIssueId(item))) {
        return false
    }
    // 目标批次同时出现在源列表里没有意义，直接在契约层拒绝
    return !candidate.ids.includes(candidate.targetId)
}

/** 判断是否为批量删除请求 */
export function isWechatIssuesRemoveBatchRequest(payload: unknown): payload is WechatIssuesRemoveBatchRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const ids = (payload as { ids?: unknown }).ids
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > WECHAT_ISSUE_REMOVE_BATCH_LIMIT) {
        return false
    }
    return ids.every((item) => isWechatIssueId(item))
}

/** wechat/issue/create 请求 */
export interface WechatIssueCreateRequest {
    accountId: string
    /** 批次标题，留空时由宿主取「未命名批次 · 日期」 */
    title?: string
}

/** wechat/issue/create 响应 */
export interface WechatIssueCreateResult {
    issue: WechatIssueSummary
}

/** wechat/issue/detail 请求 */
export interface WechatIssueDetailRequest {
    id: string
}

/** wechat/issue/detail 响应 */
export interface WechatIssueDetailResult {
    issue: WechatIssueSummary
    articles: WechatArticleDetail[]
}

/** wechat/issue/remove 请求 */
export interface WechatIssueRemoveRequest {
    id: string
}

/** wechat/issue/remove 响应 */
export interface WechatIssueRemoveResult {
    removed: boolean
}

/** wechat/article/create 请求：手写一篇新文章 */
export interface WechatArticleCreateRequest {
    issueId: string
    title: string
    author?: string
    digest?: string
    body?: string
    /** 指定的封面图路径：留空则推送时取正文首图 */
    coverPath?: string
    /** 是否允许读者留言：缺省为关闭 */
    allowComment?: boolean
}

/** wechat/cover/pick 响应：用户取消时 path 为 null，路径为存储根相对形式 */
export interface WechatCoverPickResult {
    path: string | null
}

/**
 * wechat/cover/source 请求：把选中的封面原图读成 data URI，供前端在 canvas 里裁剪。
 * 关键约束：Webview 里的 asWebviewUri 地址与页面不同源，直接画进 canvas 会污染画布、
 * 导出时报 SecurityError；先内联成 data URI 再裁剪，是唯一稳的路径。
 */
export interface WechatCoverSourceRequest {
    /** 存储根相对路径或存储根内的绝对路径 */
    path: string
}

/** wechat/cover/source 响应 */
export interface WechatCoverSourceResult {
    /** data:image/…;base64,… 形式，可直接作为 img 源与 drawImage 输入 */
    dataUrl: string
}

/** 封面原图体积上限：裁剪在 Webview 内存里完成，超大图会让面板卡住 */
export const WECHAT_COVER_IMAGE_MAX_BYTES = 12 * 1024 * 1024

/** 裁剪结果 data URI 的长度上限：1175×500 的 jpeg 通常远小于此，超出说明不是裁剪产物 */
export const WECHAT_COVER_DATA_URL_MAX = 4 * 1024 * 1024

/**
 * wechat/article/cover 请求：保存前端裁剪好的封面图。
 * 关键约束：dataUrl 只接受 jpeg / png 的 base64 内联图——宿主不做像素处理，
 * 原图由前端 canvas 按封面比例裁好；落盘位置固定为批次目录 images/ 下。
 */
export interface WechatArticleCoverRequest {
    id: string
    dataUrl: string
}

/** wechat/article/create 响应 */
export interface WechatArticleCreateResult {
    article: WechatArticleDetail
}

/** wechat/article/update 请求 */
export interface WechatArticleUpdateRequest {
    id: string
    title: string
    author?: string
    digest?: string
    body: string
    /** 指定的封面图路径：传空串表示清除 */
    coverPath?: string
    /** 是否允许读者留言：缺省表示不改动 */
    allowComment?: boolean
}

/** wechat/article/update 响应 */
export interface WechatArticleUpdateResult {
    article: WechatArticleDetail
}

/**
 * wechat/article/quickCreate 请求：只给批次，其余交给宿主。
 * 关键约束：标题由宿主按「未命名文章 N」生成，前端不弹表单，新建后直接打开正文文件。
 */
export interface WechatArticleQuickCreateRequest {
    issueId: string
}

/** wechat/article/open 请求：在编辑器里打开该文章的正文文件 */
export interface WechatArticleOpenRequest {
    id: string
}

/** wechat/article/open 响应：opened 为 false 表示文件不可用（已由宿主提示原因） */
export interface WechatArticleOpenResult {
    opened: boolean
}

/**
 * wechat/article/meta 请求：只改元信息，正文由用户在编辑器里维护。
 * 关键约束：coverPath 传空串表示清除、缺省表示不改动；宿主改标题时保留文件里的正文；
 * title 缺省表示「不改标题」——只改作者/摘要/留言的入口不得回传列表快照里的旧标题，
 * 否则并行编辑（编辑器或推送面板改过标题）后会把新标题与文件名改回旧值。
 */
export interface WechatArticleMetaRequest {
    id: string
    /** 新标题，缺省表示不修改；给出时须非空 */
    title?: string
    author?: string
    digest?: string
    coverPath?: string
    allowComment?: boolean
}

/**
 * wechat/article/move 请求：在同一批次内上移或下移一篇。
 * 关键约束：批次内顺序号即公众号的推送顺序，移动只交换相邻两篇；
 * 首项上移与末项下移由宿主拒绝，前端同时置灰，避免无效请求。
 */
export interface WechatArticleMoveRequest {
    id: string
    direction: 'up' | 'down'
}

/** wechat/article/move 响应 */
export interface WechatArticleMoveResult {
    moved: boolean
}

/** wechat/article/remove 请求 */
export interface WechatArticleRemoveRequest {
    id: string
}

/** wechat/article/remove 响应 */
export interface WechatArticleRemoveResult {
    removed: boolean
}

/**
 * wechat/article/import 请求：从笔记或作品文档导入一篇。
 * 关键约束：不接收路径——源文件由宿主弹出选择器并回查索引库，前端无法指定任意文件。
 */
export interface WechatArticleImportRequest {
    issueId: string
    /** 源模块：note 只列 notes/ 下的文档，press 只列 press/ 下的文档 */
    sourceKind: 'note' | 'press'
}

/**
 * wechat/article/import 响应：用户取消选择时 imported 为 false 且不含 article。
 * 关键约束：取消不是错误，前端据此静默结束，不弹提示。
 */
export interface WechatArticleImportResult {
    imported: boolean
    article?: WechatArticleDetail
}

/** 规整标题：折叠空白并截断到平台上限 */
export function readWechatArticleTitle(value: unknown): string {
    if (typeof value !== 'string') {
        return ''
    }
    return value.replace(/\s+/g, ' ').trim().slice(0, WECHAT_ARTICLE_TITLE_MAX)
}

/** 规整作者：平台上限 8 字，空串表示不填 */
export function readWechatArticleAuthor(value: unknown): string {
    if (typeof value !== 'string') {
        return ''
    }
    return value.replace(/\s+/g, ' ').trim().slice(0, WECHAT_ARTICLE_AUTHOR_MAX)
}

/** 规整摘要：平台上限 120 字，保留换行折叠为空格 */
export function readWechatArticleDigest(value: unknown): string {
    if (typeof value !== 'string') {
        return ''
    }
    return value.replace(/\s+/g, ' ').trim().slice(0, WECHAT_ARTICLE_DIGEST_MAX)
}

/** 收窄正文：超长直接拒绝，由调用方给出「超出公众号 2 万字上限」的提示 */
export function isWechatArticleBody(value: unknown): value is string {
    return typeof value === 'string' && value.length <= WECHAT_ARTICLE_BODY_MAX
}

/** 判断是否为批次列表请求 */
export function isWechatIssuesRequest(payload: unknown): payload is WechatIssuesRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    return isWechatAccountId((payload as { accountId?: unknown }).accountId)
}

/** 判断是否为新建批次请求：标题可缺省 */
export function isWechatIssueCreateRequest(payload: unknown): payload is WechatIssueCreateRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { accountId?: unknown; title?: unknown }
    if (!isWechatAccountId(candidate.accountId)) {
        return false
    }
    return candidate.title === undefined || typeof candidate.title === 'string'
}

/** 判断是否为批次详情请求 */
export function isWechatIssueDetailRequest(payload: unknown): payload is WechatIssueDetailRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    return isWechatIssueId((payload as { id?: unknown }).id)
}

/** 判断是否为删除批次请求 */
export function isWechatIssueRemoveRequest(payload: unknown): payload is WechatIssueRemoveRequest {
    return isWechatIssueDetailRequest(payload)
}

/** 收窄批次 / 文章 id：与账号 id 同一形态（宿主生成的短 id） */
export function isWechatIssueId(value: unknown): value is string {
    return isWechatAccountId(value)
}

/** 判断是否为新建文章请求 */
export function isWechatArticleCreateRequest(payload: unknown): payload is WechatArticleCreateRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as {
        issueId?: unknown
        title?: unknown
        body?: unknown
        coverPath?: unknown
        allowComment?: unknown
    }
    if (!isWechatIssueId(candidate.issueId)) {
        return false
    }
    if (readWechatArticleTitle(candidate.title).length === 0) {
        return false
    }
    if (candidate.coverPath !== undefined && typeof candidate.coverPath !== 'string') {
        return false
    }
    if (candidate.allowComment !== undefined && typeof candidate.allowComment !== 'boolean') {
        return false
    }
    return candidate.body === undefined || isWechatArticleBody(candidate.body)
}

/** 判断是否为更新文章请求：正文必填 */
export function isWechatArticleUpdateRequest(payload: unknown): payload is WechatArticleUpdateRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as {
        id?: unknown
        title?: unknown
        body?: unknown
        coverPath?: unknown
        allowComment?: unknown
    }
    if (!isWechatIssueId(candidate.id) || readWechatArticleTitle(candidate.title).length === 0) {
        return false
    }
    if (candidate.coverPath !== undefined && typeof candidate.coverPath !== 'string') {
        return false
    }
    if (candidate.allowComment !== undefined && typeof candidate.allowComment !== 'boolean') {
        return false
    }
    return isWechatArticleBody(candidate.body)
}

/** 判断是否为快速新建文章请求：只需要批次标识 */
export function isWechatArticleQuickCreateRequest(payload: unknown): payload is WechatArticleQuickCreateRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    return isWechatIssueId((payload as { issueId?: unknown }).issueId)
}

/** 判断是否为打开正文文件请求 */
export function isWechatArticleOpenRequest(payload: unknown): payload is WechatArticleOpenRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    return isWechatIssueId((payload as { id?: unknown }).id)
}

/** 判断是否为文章元信息请求：id 必填；标题缺省表示不改标题，给出时须非空；封面与留言为可选 */
export function isWechatArticleMetaRequest(payload: unknown): payload is WechatArticleMetaRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as {
        id?: unknown
        title?: unknown
        coverPath?: unknown
        allowComment?: unknown
    }
    if (!isWechatIssueId(candidate.id)) {
        return false
    }
    if (candidate.title !== undefined && readWechatArticleTitle(candidate.title).length === 0) {
        return false
    }
    if (candidate.coverPath !== undefined && typeof candidate.coverPath !== 'string') {
        return false
    }
    if (candidate.allowComment !== undefined && typeof candidate.allowComment !== 'boolean') {
        return false
    }
    return true
}

/** 判断是否为调整文章顺序请求：id 合法且方向只接受 up / down */
export function isWechatArticleMoveRequest(payload: unknown): payload is WechatArticleMoveRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { id?: unknown; direction?: unknown }
    if (!isWechatIssueId(candidate.id)) {
        return false
    }
    return candidate.direction === 'up' || candidate.direction === 'down'
}

/** 判断是否为删除文章请求 */
export function isWechatArticleRemoveRequest(payload: unknown): payload is WechatArticleRemoveRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    return isWechatIssueId((payload as { id?: unknown }).id)
}

/**
 * wechat/issue/publishDraft 请求：把批次渲染并提交到草稿箱。
 * 关键约束：只生成草稿，不触发群发——群发受主体权限与一天一次频率限制，属独立动作。
 */
export interface WechatPublishDraftRequest {
    issueId: string
}

/**
 * wechat/issue/publishDraft 响应。
 * warnings 为非阻断提示（如外链图片未上传、封面取自正文首图），前端用 warning 级提示展示。
 */
export interface WechatPublishDraftResult {
    issue: WechatIssueSummary
    warnings: string[]
}

/**
 * 推送阶段：草稿与群发共用同一套阶段名，界面据此显示「正在做什么」。
 * 关键约束：阶段只是进度提示，不参与状态机——批次状态仍以 wechat_issues.status 为准。
 */
export const WECHAT_PUBLISH_STAGES = ['render', 'material', 'draft', 'submit', 'poll'] as const

/** 推送阶段取值 */
export type WechatPublishStage = (typeof WECHAT_PUBLISH_STAGES)[number]

/** 阶段文案：广播载荷只带阶段与一句话，界面直接显示 message */
export const WECHAT_PUBLISH_STAGE_LABELS: Readonly<Record<WechatPublishStage, string>> = {
    render: '渲染正文',
    material: '上传图片素材',
    draft: '提交草稿',
    submit: '提交群发',
    poll: '等待发布结果',
}

/** 推送进度广播载荷：经 state 通道的 wechat 频道下发 */
export interface WechatPublishProgress {
    kind: 'progress'
    issueId: string
    stage: WechatPublishStage
    /** 面向用户的一句话，如「渲染第 2/3 篇」 */
    message: string
}

/** 收窄进度载荷：Webview 收到的数据不可信，逐字段校验后才显示 */
export function isWechatPublishProgress(payload: unknown): payload is WechatPublishProgress {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { kind?: unknown; issueId?: unknown; stage?: unknown; message?: unknown }
    if (candidate.kind !== 'progress' || !isWechatIssueId(candidate.issueId)) {
        return false
    }
    if (typeof candidate.message !== 'string' || candidate.message.length === 0) {
        return false
    }
    return (WECHAT_PUBLISH_STAGES as readonly string[]).includes(String(candidate.stage))
}

/** 判断是否为生成草稿请求 */
export function isWechatPublishDraftRequest(payload: unknown): payload is WechatPublishDraftRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    return isWechatIssueId((payload as { issueId?: unknown }).issueId)
}

/**
 * wechat/issue/publish 请求：把已生成草稿的批次正式群发。
 * 关键约束：必须先有 media_id（草稿已就绪），且不满足频率额度时直接拒绝——群发不可撤销。
 */
export interface WechatPublishRequest {
    issueId: string
}

/** wechat/issue/publish 响应：articleUrl 与 articleId 需等平台异步发布完成才有值，可能缺省 */
export interface WechatPublishResult {
    issue: WechatIssueSummary
    articleUrl?: string
    articleId?: string
}

/** wechat/publishQuota 请求：查询某账号当前的群发额度 */
export interface WechatPublishQuotaRequest {
    accountId: string
}

/**
 * 群发额度：订阅号每个自然日 1 次，服务号每个自然月 4 次。
 * reason 在不可群发时给出可执行说明（如「今日额度已用完，明天 0 点后恢复」）。
 */
export interface WechatPublishQuotaResult {
    /** 周期内允许的次数 */
    limit: number
    /** 周期内已用次数 */
    used: number
    /** 剩余次数 */
    remaining: number
    /** 额度说明：正常时描述周期规则，用尽时给出恢复时间 */
    reason: string
}

/** 判断是否为群发请求 */
export function isWechatPublishRequest(payload: unknown): payload is WechatPublishRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    return isWechatIssueId((payload as { issueId?: unknown }).issueId)
}

/** 判断是否为额度查询请求 */
export function isWechatPublishQuotaRequest(payload: unknown): payload is WechatPublishQuotaRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    return isWechatAccountId((payload as { accountId?: unknown }).accountId)
}

/**
 * 已上传素材摘要：只反映本地映射表，不逐条回查平台详情。
 * 关键约束：url 是平台可访问地址，可直接粘进正文；mediaId 用于封面与删除。
 */
export interface WechatMaterialSummary {
    id: string
    mediaId: string
    url: string
    name: string
    sizeBytes: number
    createdAt: string
}

/** wechat/material/list 请求 */
export interface WechatMaterialListRequest {
    accountId: string
}

/** wechat/material/import 请求：宿主弹选择器，前端不传路径 */
export interface WechatMaterialImportRequest {
    accountId: string
}

/** wechat/material/import 响应：取消时 imported 为 false */
export interface WechatMaterialImportResult {
    imported: boolean
    material?: WechatMaterialSummary
}

/** 判断是否为素材列表请求 */
export function isWechatMaterialListRequest(payload: unknown): payload is WechatMaterialListRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    return isWechatAccountId((payload as { accountId?: unknown }).accountId)
}

/** 判断是否为素材导入请求 */
export function isWechatMaterialImportRequest(payload: unknown): payload is WechatMaterialImportRequest {
    return isWechatMaterialListRequest(payload)
}

/**
 * wechat/material/remove 请求：删除平台永久素材并清理本地映射。
 * 关键约束：删除后已发布文章里对这张图的引用会失效，界面必须二次确认。
 */
export interface WechatMaterialRemoveRequest {
    accountId: string
    /** 本地素材 id（mat- 前缀），宿主据此回查 media_id */
    id: string
}

/**
 * 账号鉴权失败广播：state 通道的 wechat 频道下发。
 * 关键约束：只在拿到平台错误码时下发（网络失败不算鉴权失效），
 * 界面据此提示并刷新账号状态色点，避免用户在其他页面操作时状态长期停留在旧值。
 */
export interface WechatAccountAuthFailureEvent {
    kind: 'authFailure'
    accountId: string
    /** 账号名：提示直接说「哪个账号」，不让用户对着 id 猜 */
    accountName: string
    /** 平台错误码，如 40164 白名单、40001 密钥失效 */
    errorCode: number
    /** 面向用户的可执行提示 */
    message: string
}

/** 收窄鉴权失败广播：逐字段校验后再展示 */
export function isWechatAccountAuthFailureEvent(payload: unknown): payload is WechatAccountAuthFailureEvent {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as {
        kind?: unknown
        accountId?: unknown
        accountName?: unknown
        errorCode?: unknown
        message?: unknown
    }
    if (candidate.kind !== 'authFailure' || !isWechatAccountId(candidate.accountId)) {
        return false
    }
    if (typeof candidate.accountName !== 'string' || candidate.accountName.length === 0) {
        return false
    }
    if (typeof candidate.errorCode !== 'number' || typeof candidate.message !== 'string') {
        return false
    }
    return candidate.message.length > 0
}

/** 判断是否为素材删除请求：素材 id 与账号 id 同形态（宿主生成的短 id） */
export function isWechatMaterialRemoveRequest(payload: unknown): payload is WechatMaterialRemoveRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { accountId?: unknown; id?: unknown }
    return isWechatAccountId(candidate.accountId) && isWechatAccountId(candidate.id)
}

/**
 * wechat/cover/preview 请求：把本地封面路径换成 Webview 可加载的 URI。
 * 关键约束：Webview 受 CSP 限制无法直接加载 file://，必须由宿主用 asWebviewUri 转换；
 * 只接受存储根内的 jpg/png，一次最多 20 条（够覆盖首屏批次卡片）。
 */
export interface WechatCoverPreviewRequest {
    paths: string[]
}

/** wechat/cover/preview 响应：键为请求路径，缺失表示该路径不可用 */
export interface WechatCoverPreviewResult {
    uris: Record<string, string>
}

/** 单次预览的路径数上限 */
export const WECHAT_COVER_PREVIEW_LIMIT = 20

/** 判断是否为封面预览请求 */
export function isWechatCoverPreviewRequest(payload: unknown): payload is WechatCoverPreviewRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const paths = (payload as { paths?: unknown }).paths
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > WECHAT_COVER_PREVIEW_LIMIT) {
        return false
    }
    return paths.every((item) => typeof item === 'string' && item.length > 0)
}

/** 判断是否为封面原图读取请求：只校验非空与长度，路径归属由宿主再校验一次 */
export function isWechatCoverSourceRequest(payload: unknown): payload is WechatCoverSourceRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const { path: target } = payload as { path?: unknown }
    return typeof target === 'string' && target.trim().length > 0 && target.length <= 512
}

/**
 * 判断是否为保存裁剪封面请求：只接受 jpeg / png 的 base64 内联图。
 * 关键约束：长度上限先于解码判断，避免把超大字符串带进内存。
 */
export function isWechatArticleCoverRequest(payload: unknown): payload is WechatArticleCoverRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const { id, dataUrl } = payload as { id?: unknown; dataUrl?: unknown }
    if (!isWechatIssueId(id) || typeof dataUrl !== 'string') {
        return false
    }
    if (dataUrl.length > WECHAT_COVER_DATA_URL_MAX) {
        return false
    }
    return /^data:image\/(?:jpeg|jpg|png);base64,/u.test(dataUrl)
}

/**
 * 留言：平台按「群发消息 msg_data_id + 文章序号 index」定位，两者缺一不可。
 * 关键约束：elected 表示作者设为精选；replyContent 为作者回复，未回复时缺省而不是空串。
 */
export interface WechatCommentSummary {
    /** 平台侧的留言 id（user_comment_id），回复、加精、删除都用它 */
    id: number
    openid: string
    /** 留言时间：ISO 8601 */
    createdAt: string
    content: string
    isElected: boolean
    replyContent?: string
}

/** wechat/comment/list 请求：sortIndex 从 1 开始，宿主转成平台的 0 基 index */
export interface WechatCommentListRequest {
    accountId: string
    issueId: string
    sortIndex: number
    /** 已加载条数：翻页时作为 begin 传入，首次传 0 或缺省 */
    offset?: number
}

/** wechat/comment/list 响应 */
export interface WechatCommentListResult {
    comments: WechatCommentSummary[]
    total: number
}

/** wechat/comment/reply 请求 */
export interface WechatCommentReplyRequest {
    accountId: string
    issueId: string
    sortIndex: number
    commentId: number
    content: string
}

/** wechat/comment/mark 请求：elected 为 true 设为精选，false 取消精选 */
export interface WechatCommentMarkRequest {
    accountId: string
    issueId: string
    sortIndex: number
    commentId: number
    elected: boolean
}

/** wechat/comment/remove 请求 */
export interface WechatCommentRemoveRequest {
    accountId: string
    issueId: string
    sortIndex: number
    commentId: number
}

/** 每页留言条数：平台允许更大，但侧栏一屏放不下更多 */
export const WECHAT_COMMENT_PAGE_SIZE = 20

/** 单条留言的最大长度：回复内容与留言本体同一上限 */
export const WECHAT_COMMENT_CONTENT_MAX = 300

/** 收窄 sortIndex：批次内文章序号从 1 开始，上限按批次容量 */
function isWechatCommentSortIndex(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= WECHAT_ISSUE_ARTICLE_LIMIT
}

/** 收窄留言 id：平台为自增正整数 */
function isWechatCommentId(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0
}

/**
 * 公共校验：四个留言动作都要求「账号 + 批次 + 文章序号」齐全。
 * 关键约束：返回收窄后的三元组而不是布尔值，避免各处再写一次断言；非对象直接判 null。
 */
function readCommentTarget(payload: unknown): { accountId: string; issueId: string; sortIndex: number } | null {
    if (typeof payload !== 'object' || payload === null) {
        return null
    }
    const candidate = payload as { accountId?: unknown; issueId?: unknown; sortIndex?: unknown }
    if (!isWechatAccountId(candidate.accountId) || !isWechatIssueId(candidate.issueId)) {
        return null
    }
    if (!isWechatCommentSortIndex(candidate.sortIndex)) {
        return null
    }
    return { accountId: candidate.accountId, issueId: candidate.issueId, sortIndex: candidate.sortIndex }
}

/** 判断是否为留言列表请求 */
export function isWechatCommentListRequest(payload: unknown): payload is WechatCommentListRequest {
    if (readCommentTarget(payload) === null) {
        return false
    }
    const offset = (payload as { offset?: unknown }).offset
    return offset === undefined || (typeof offset === 'number' && offset >= 0)
}

/** 判断是否为留言回复请求 */
export function isWechatCommentReplyRequest(payload: unknown): payload is WechatCommentReplyRequest {
    if (readCommentTarget(payload) === null) {
        return false
    }
    const candidate = payload as { commentId?: unknown; content?: unknown }
    if (!isWechatCommentId(candidate.commentId) || typeof candidate.content !== 'string') {
        return false
    }
    const content = candidate.content.trim()
    return content.length > 0 && content.length <= WECHAT_COMMENT_CONTENT_MAX
}

/** 判断是否为留言加精请求 */
export function isWechatCommentMarkRequest(payload: unknown): payload is WechatCommentMarkRequest {
    if (readCommentTarget(payload) === null) {
        return false
    }
    const candidate = payload as { commentId?: unknown; elected?: unknown }
    return isWechatCommentId(candidate.commentId) && typeof candidate.elected === 'boolean'
}

/** 判断是否为留言删除请求 */
export function isWechatCommentRemoveRequest(payload: unknown): payload is WechatCommentRemoveRequest {
    if (readCommentTarget(payload) === null) {
        return false
    }
    return isWechatCommentId((payload as { commentId?: unknown }).commentId)
}

/**
 * 菜单按钮的四种动作：下发图片、下发图文、跳转网页、跳转小程序。
 * 关键约束：四种动作都由微信客户端直接响应，无需开发者服务器回调；click 等事件型动作不开放，
 * 扫码、拍照、地理位置等依赖客户端版本与回调服务，本期同样不开放。
 */
export const WECHAT_MENU_TYPES = ['media_id', 'article_id', 'view', 'miniprogram'] as const

/** 菜单动作类型 */
export type WechatMenuType = (typeof WECHAT_MENU_TYPES)[number]

/** 一级菜单数量上限（平台限制） */
export const WECHAT_MENU_TOP_LIMIT = 3

/** 单个一级菜单下的二级数量上限（平台限制） */
export const WECHAT_MENU_SUB_LIMIT = 5

/** 一级菜单名称的字节上限：平台按 UTF-8 字节计，16 字节约 5 个汉字 */
export const WECHAT_MENU_TOP_NAME_BYTES = 16

/** 二级菜单名称的字节上限 */
export const WECHAT_MENU_SUB_NAME_BYTES = 60

/** 菜单跳转地址的字节上限（平台限制） */
export const WECHAT_MENU_URL_BYTES = 1024

/**
 * 菜单内容类型：图片与图文从素材列表选择，链接填写网页地址，小程序填写 appid 与页面路径。
 * 关键约束：图片对应 media_id、图文对应 article_id、链接对应 view、小程序对应 miniprogram；
 * 内容随菜单结构落本地库，回读时按位置合并，本地保留 kind 便于重新打开编辑态。
 */
export const WECHAT_MENU_CONTENT_KINDS = ['image', 'news', 'link', 'miniprogram'] as const

/** 菜单内容类型取值 */
export type WechatMenuContentKind = (typeof WECHAT_MENU_CONTENT_KINDS)[number]

/** 菜单内容：按 kind 只读取对应字段，不允许一种类型带着另一种类型的残留 */
export interface WechatMenuContent {
    kind: WechatMenuContentKind
    /** 跳转链接地址（link 类型）：仅放行 http/https，与图片素材地址 url 区分 */
    linkUrl?: string
    /** 图片素材：本地 id、平台 mediaId 与可访问地址 */
    materialId?: string
    mediaId?: string
    url?: string
    materialName?: string
    /** 图文素材：推送批次 id、平台发布后获得的 articleId、标题与篇数 */
    issueId?: string
    articleId?: string
    title?: string
    articleCount?: number
    coverUrl?: string
    /** 小程序：appid 仅认证账号可配置且须小写，pagepath 为页面路径，url 为旧版本兜底网页 */
    appid?: string
    pagepath?: string
    miniUrl?: string
}

/**
 * 菜单按钮：type 决定使用哪个内容字段；有 subButton 时自身不参与点击。
 * 关键约束：id 是前端与本地结构里的稳定身份，平台接口不接收也不返回；
 * 平台下发字段与内容字段同源（mediaId / articleId / url / appid / pagepath），校验与构造必须一一对应。
 */
export interface WechatMenuButton {
    /** 稳定身份：平台无此字段，由前端新建或服务端回读时生成 */
    id: string
    name: string
    type?: WechatMenuType
    /** view 动作的跳转地址，也是 miniprogram 在旧版本客户端的兜底网页 */
    url?: string
    /** media_id 动作的永久素材 id */
    mediaId?: string
    /** article_id 动作的发布后图文 id */
    articleId?: string
    /** miniprogram 动作的小程序 AppID（小写） */
    appid?: string
    /** miniprogram 动作的小程序页面路径 */
    pagepath?: string
    /** 二级菜单：存在即视为目录节点 */
    subButton?: WechatMenuButton[]
    /** 本地内容：图片 / 图文 / 链接 / 小程序，平台只接收对应的跳转字段 */
    content?: WechatMenuContent
}

/** wechat/menu/get 请求 */
export interface WechatMenuRequest {
    accountId: string
}

/** wechat/menu/get 响应：hasMenu 为 false 表示平台侧尚未配置 */
export interface WechatMenuResult {
    hasMenu: boolean
    buttons: WechatMenuButton[]
    /** 本地最近一次保存时间（ISO 8601），从未保存时缺省 */
    updatedAt?: string
}

/** wechat/menu/save 请求：整棵菜单覆盖式保存 */
export interface WechatMenuSaveRequest {
    accountId: string
    buttons: WechatMenuButton[]
}

/** wechat/menu/save 响应：published 表示平台侧已生效 */
export interface WechatMenuSaveResult {
    published: boolean
    buttons: WechatMenuButton[]
}

/** 粉丝摘要：昵称与头像来自批量资料接口，未关注用户只保留 openid */
export interface WechatFanSummary {
    openid: string
    /** 开放平台身份：仅公众号绑定开放平台且平台返回时有值 */
    unionid?: string
    nickname: string
    avatar?: string
    /** 0 未关注、1 已关注（平台口径） */
    subscribeStatus: number
    /** 关注时间：ISO 8601，未关注时缺省 */
    subscribedAt?: string
    /** 平台备注：可编辑 */
    remark?: string
    /** 平台给出的关注来源场景值 */
    subscribeScene?: string
    /** 已打标签的平台 id，升序去重 */
    tagIds: number[]
    /** 是否在公众号黑名单中：由 getBlacklist 回读写入，实时回落时为 false */
    isBlocked: boolean
    /** 最近一次同步时间：实时回落时缺省 */
    lastSyncedAt?: string
}

/** wechat/fans/list 请求：nextOpenid 为空表示从头拉取 */
export interface WechatFanListRequest {
    accountId: string
    nextOpenid?: string
}

/** wechat/fans/list 响应 */
export interface WechatFanListResult {
    fans: WechatFanSummary[]
    /** 下一页游标：缺省表示已到末页 */
    nextOpenid?: string
    /** 平台给出的关注者总数，用于界面提示还有多少未加载 */
    total: number
    /** 最近一次同步时间：未同步过时缺省 */
    syncedAt?: string
}

/** 粉丝标签 */
export interface WechatFanTag {
    id: number
    name: string
    /** 该标签下的粉丝数 */
    count: number
}

/** wechat/fans/tags 请求 */
export interface WechatFanTagsRequest {
    accountId: string
}

/** wechat/fans/tags 响应 */
export interface WechatFanTagsResult {
    tags: WechatFanTag[]
}

/** 平台批量接口的硬上限：user/info/batchget 与打标接口一次都是 100 */
export const WECHAT_FAN_BATCH_LIMIT = 100

/** 拉黑/解除拉黑的单次上限：平台限制为 20，与打标接口的 100 不同 */
export const WECHAT_FAN_BLACKLIST_BATCH_LIMIT = 20

/** 备注上限：平台 user/info/updateremark 限制 */
export const WECHAT_FAN_REMARK_MAX = 30

/** 标签名长度上限：平台 tags/create 限制 */
export const WECHAT_FAN_TAG_NAME_MAX = 30

/** 检索关键词长度上限：与宿主守卫一致，前端输入与守卫共用同一口径 */
export const WECHAT_FAN_KEYWORD_MAX = 64

/** 用户状态筛选：blocked 走 isBlocked，其余走 subscribeStatus，两者互斥 */
export type WechatFanStatusFilter = 'all' | 'subscribed' | 'unsubscribed' | 'blocked'

/** 用户检索：空字段表示不限，limit / offset 用于本地快照分页 */
export interface WechatFanSearchRequest {
    accountId: string
    keyword?: string
    tagId?: number
    subscribeStatus?: 0 | 1
    /** true 只看黑名单用户；与 subscribeStatus 互斥 */
    isBlocked?: boolean
    limit?: number
    offset?: number
}

/** 用户检索响应：snapshotTotal 用于「平台 N / 已同步 M」提示 */
export interface WechatFanSearchResult {
    fans: WechatFanSummary[]
    /** 本次筛选命中数 */
    total: number
    /** 本地快照总条数 */
    snapshotTotal: number
    /** 最近一次成功同步时间，未同步过时缺省 */
    syncedAt?: string
}

/** 用户详情请求 */
export interface WechatFanDetailRequest {
    accountId: string
    openid: string
}

/** 同一 UnionID 在本项目其他公众号下的关注记录 */
export interface WechatFanRelatedAccount {
    accountName: string
    openid: string
    subscribedAt?: string
}

/** 用户详情响应：资料字段仅在快照里有值时给出 */
export interface WechatFanDetailResult {
    fan: WechatFanSummary
    country?: string
    province?: string
    city?: string
    language?: string
    subscribeScene?: string
    qrScene?: string
    related: WechatFanRelatedAccount[]
}

/** 同步任务：状态与计数用于进度条与结果提示 */
export interface WechatFanSyncTask {
    id: string
    status: 'running' | 'success' | 'partial' | 'failed'
    cursor: string
    pageCount: number
    fetched: number
    total: number
    createdCount: number
    updatedCount: number
    unfollowed: number
    failedCount: number
    errorCode?: number
    errorHint?: string
    startedAt: string
    finishedAt?: string
}

/** 触发或续跑同步：taskId 缺省表示新建任务 */
export interface WechatFanSyncRequest {
    accountId: string
    taskId?: string
}

export interface WechatFanSyncResult {
    task: WechatFanSyncTask
}

export interface WechatFanSyncStatusRequest {
    accountId: string
    taskId?: string
}

export interface WechatFanSyncStatusResult {
    task: WechatFanSyncTask | null
}

/** 标签新建 */
export interface WechatFanTagCreateRequest {
    accountId: string
    name: string
}

/** 标签重命名 */
export interface WechatFanTagRenameRequest {
    accountId: string
    id: number
    name: string
}

/** 标签删除 */
export interface WechatFanTagRemoveRequest {
    accountId: string
    id: number
}

export interface WechatFanTagMutationResult {
    tag: WechatFanTag
}

export interface WechatFanTagRemoveResult {
    removed: boolean
}

/** 批量打标与取消：action 决定走平台哪个写接口 */
export interface WechatFanTagMembersRequest {
    accountId: string
    openids: string[]
    tagId: number
    action: 'add' | 'remove'
}

export interface WechatFanTagMembersResult {
    succeeded: number
    failed: number
}

/** 备注：空串表示清除备注 */
export interface WechatFanRemarkRequest {
    accountId: string
    openid: string
    remark: string
}

export interface WechatFanRemarkResult {
    updated: boolean
}

/** 拉黑与解除：破坏性操作，前端必须二次确认 */
export interface WechatFanBlacklistRequest {
    accountId: string
    openids: string[]
    action: 'block' | 'unblock'
}

export interface WechatFanBlacklistResult {
    succeeded: number
    failed: number
}

/** 用户增长的单日数据点：日期为 YYYY-MM-DD（用户所在时区） */
export interface WechatStatsPoint {
    date: string
    newUsers: number
    cancelUsers: number
    netUsers: number
    cumulateUsers: number
}

/** wechat/stats/overview 请求：只开放三档固定区间，避免任意区间打满接口额度 */
export interface WechatStatsRequest {
    accountId: string
    days: 7 | 15 | 30
}

/** wechat/stats/overview 响应 */
export interface WechatStatsResult {
    points: WechatStatsPoint[]
    totalNew: number
    totalCancel: number
    totalNet: number
    /** 期末累计关注人数：取最后一天的 cumulateUsers */
    cumulateUsers: number
}

/** 统计维度：与官方文档四类数据分组一一对应 */
export const WECHAT_STATS_DIMENSIONS = ['users', 'news', 'message', 'api'] as const

/** 统计维度取值 */
export type WechatStatsDimension = (typeof WECHAT_STATS_DIMENSIONS)[number]

/** 维度展示名：页头切换与结果标题共用一处口径 */
export const WECHAT_STATS_DIMENSION_LABELS: Readonly<Record<WechatStatsDimension, string>> = {
    users: '用户增长',
    news: '图文内容',
    message: '消息互动',
    api: '接口调用',
}

/**
 * 统计视图：与官方文档四类数据统计接口一一对应（含已停止维护但仍在服务的历史接口）。
 * 关键约束：各视图的单次跨度、时间粒度与数据起始日期差异很大，元数据集中在 WECHAT_STATS_VIEW_META，
 * 宿主按它分段取数，前端按它生成切换项与提示，避免两处各写一套口径。
 */
export const WECHAT_STATS_VIEWS = [
    'userDaily',
    'userCumulate',
    'newsSummary',
    'newsReadHour',
    'newsShareHour',
    'newsRead',
    'newsShare',
    'newsTotal',
    'newsBiz',
    'newsArticleRead',
    'newsArticleShare',
    'newsArticleDetail',
    'msgDaily',
    'msgHour',
    'msgWeek',
    'msgMonth',
    'msgDist',
    'msgDistWeek',
    'msgDistMonth',
    'apiDaily',
    'apiHour',
] as const

/** 统计视图取值 */
export type WechatStatsView = (typeof WECHAT_STATS_VIEWS)[number]

/** 统计时间范围：预设档位与自定义日期二选一，自定义跨度不超过 30 天 */
export type WechatStatsRange =
    { kind: 'days'; days: 7 | 15 | 30 } | { kind: 'custom'; beginDate: string; endDate: string }

/** 统计数据的横轴粒度 */
export type WechatStatsGranularity = 'day' | 'hour' | 'week' | 'month'

/** 统计视图元数据：展示名、所属维度、粒度、单次跨度上限与数据起始日期 */
export interface WechatStatsViewMeta {
    label: string
    dimension: WechatStatsDimension
    granularity: WechatStatsGranularity
    /** 平台单次查询的最大天数（含首尾） */
    maxDays: number
    /** 平台数据存储起始日期，早于此日期的查询无意义 */
    since: string
    /** 官方标注停止维护时的替代说明，前端原样展示 */
    deprecated?: string
}

/** 各视图元数据：跨度与起始日均按官方文档填写，前端与宿主共用 */
export const WECHAT_STATS_VIEW_META: Readonly<Record<WechatStatsView, WechatStatsViewMeta>> = {
    userDaily: { label: '增减与来源', dimension: 'users', granularity: 'day', maxDays: 7, since: '2014-12-01' },
    userCumulate: { label: '累计用户', dimension: 'users', granularity: 'day', maxDays: 7, since: '2014-12-01' },
    newsSummary: {
        label: '群发每日',
        dimension: 'news',
        granularity: 'day',
        maxDays: 7,
        since: '2014-12-01',
        deprecated: '官方已停止维护，建议改用「内容阅读 / 内容分享 / 内容概况」',
    },
    newsReadHour: {
        label: '阅读分时',
        dimension: 'news',
        granularity: 'hour',
        maxDays: 1,
        since: '2014-12-01',
        deprecated: '官方已停止维护，新接口不提供分时数据',
    },
    newsShareHour: {
        label: '转发分时',
        dimension: 'news',
        granularity: 'hour',
        maxDays: 1,
        since: '2014-12-01',
        deprecated: '官方已停止维护，新接口不提供分时数据',
    },
    newsRead: {
        label: '阅读概况',
        dimension: 'news',
        granularity: 'day',
        maxDays: 7,
        since: '2014-12-01',
        deprecated: '官方已停止维护，建议改用「内容阅读」',
    },
    newsShare: {
        label: '转发概况',
        dimension: 'news',
        granularity: 'day',
        maxDays: 7,
        since: '2014-12-01',
        deprecated: '官方已停止维护，建议改用「内容分享」',
    },
    newsTotal: {
        label: '群发总数据',
        dimension: 'news',
        granularity: 'day',
        maxDays: 7,
        since: '2014-12-01',
        deprecated: '官方已停止维护，建议改用「发表明细」',
    },
    newsBiz: { label: '内容概况', dimension: 'news', granularity: 'day', maxDays: 30, since: '2025-11-01' },
    newsArticleRead: {
        label: '内容阅读',
        dimension: 'news',
        granularity: 'day',
        maxDays: 1,
        since: '2025-11-01',
    },
    newsArticleShare: {
        label: '内容分享',
        dimension: 'news',
        granularity: 'day',
        maxDays: 1,
        since: '2025-11-01',
    },
    newsArticleDetail: {
        label: '发表明细',
        dimension: 'news',
        granularity: 'day',
        maxDays: 1,
        since: '2025-11-01',
    },
    msgDaily: { label: '发送概况', dimension: 'message', granularity: 'day', maxDays: 6, since: '2014-12-01' },
    msgHour: { label: '发送分时', dimension: 'message', granularity: 'hour', maxDays: 1, since: '2014-12-01' },
    msgWeek: { label: '发送周数据', dimension: 'message', granularity: 'week', maxDays: 30, since: '2014-12-01' },
    msgMonth: { label: '发送月数据', dimension: 'message', granularity: 'month', maxDays: 30, since: '2014-12-01' },
    msgDist: {
        label: '发送量分布',
        dimension: 'message',
        granularity: 'day',
        maxDays: 15,
        since: '2014-12-01',
    },
    msgDistWeek: {
        label: '分布周数据',
        dimension: 'message',
        granularity: 'week',
        maxDays: 15,
        since: '2014-12-01',
    },
    msgDistMonth: {
        label: '分布月数据',
        dimension: 'message',
        granularity: 'month',
        maxDays: 15,
        since: '2014-12-01',
    },
    apiDaily: { label: '被动回复', dimension: 'api', granularity: 'day', maxDays: 30, since: '2014-12-01' },
    apiHour: { label: '回复分时', dimension: 'api', granularity: 'hour', maxDays: 1, since: '2014-12-01' },
}

/** wechat/stats/query 请求 */
export interface WechatStatsQueryRequest {
    accountId: string
    dimension: WechatStatsDimension
    view: WechatStatsView
    range: WechatStatsRange
}

/** 统计指标：key 在 points[].values 中取值，label 由宿主按平台字段命名 */
export interface WechatStatsMetric {
    key: string
    label: string
    total: number
    /** duration 表示毫秒耗时，展示时折算为毫秒/次 */
    format: 'number' | 'duration'
}

/** 统计数据点：date 为 YYYY-MM-DD（分时视图形如 YYYY-MM-DD HH），values 以指标 key 为索引 */
export interface WechatStatsDataPoint {
    date: string
    values: Record<string, number>
}

/** 分类分布项：用于来源、消息类型、发送量区间等维度拆分 */
export interface WechatStatsBreakdown {
    label: string
    value: number
}

/** 逐篇明细：发表内容与群发总数据视图用它展示单篇表现 */
export interface WechatStatsItem {
    id: string
    title: string
    date: string
    values: Record<string, number>
    /** 平台返回的文章地址，可能缺省 */
    url?: string
}

/** wechat/stats/query 响应 */
export interface WechatStatsQueryResult {
    dimension: WechatStatsDimension
    view: WechatStatsView
    beginDate: string
    endDate: string
    granularity: WechatStatsGranularity
    metrics: WechatStatsMetric[]
    points: WechatStatsDataPoint[]
    /** 分类分布：按来源 / 消息类型 / 发送量区间拆分 */
    breakdowns: WechatStatsBreakdown[]
    /** 逐篇明细：仅内容类视图返回 */
    items: WechatStatsItem[]
    /** 平台返回的统计延迟标记：为 true 时提示数据可能后续修正 */
    isDelayed: boolean
}

/** 判断是否为菜单读取请求 */
export function isWechatMenuRequest(payload: unknown): payload is WechatMenuRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    return isWechatAccountId((payload as { accountId?: unknown }).accountId)
}

/** 判断是否为菜单保存请求：结构校验交给 readWechatMenuButtons，这里只挡明显非法载荷 */
export function isWechatMenuSaveRequest(payload: unknown): payload is WechatMenuSaveRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { accountId?: unknown; buttons?: unknown }
    return isWechatAccountId(candidate.accountId) && Array.isArray(candidate.buttons)
}

/** 判断是否为粉丝列表请求 */
export function isWechatFanListRequest(payload: unknown): payload is WechatFanListRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { accountId?: unknown; nextOpenid?: unknown }
    if (!isWechatAccountId(candidate.accountId)) {
        return false
    }
    return candidate.nextOpenid === undefined || typeof candidate.nextOpenid === 'string'
}

/** 判断是否为标签请求 */
export function isWechatFanTagsRequest(payload: unknown): payload is WechatFanTagsRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    return isWechatAccountId((payload as { accountId?: unknown }).accountId)
}

/** 收窄 openid：非空且长度在平台范围内 */
function isWechatOpenid(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 128
}

/** 收窄 openid 数组：指定上限，默认与平台批量资料上限一致 */
function isWechatOpenidList(value: unknown, limit = WECHAT_FAN_BATCH_LIMIT): value is string[] {
    return (
        Array.isArray(value) && value.length > 0 && value.length <= limit && value.every((item) => isWechatOpenid(item))
    )
}

/** 收窄标签名：去空白后 1~30 字符 */
function isWechatFanTagName(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= WECHAT_FAN_TAG_NAME_MAX
}

/** 收窄备注：空串表示清除，其余须非纯空白且不超过 30 字符 */
function isWechatFanRemark(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        value.length <= WECHAT_FAN_REMARK_MAX &&
        (value.length === 0 || value.trim().length > 0)
    )
}

/** 判断是否为粉丝检索请求 */
export function isWechatFanSearchRequest(payload: unknown): payload is WechatFanSearchRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as {
        accountId?: unknown
        keyword?: unknown
        tagId?: unknown
        subscribeStatus?: unknown
        isBlocked?: unknown
        limit?: unknown
        offset?: unknown
    }
    if (!isWechatAccountId(candidate.accountId)) {
        return false
    }
    if (
        candidate.keyword !== undefined &&
        (typeof candidate.keyword !== 'string' || candidate.keyword.length > WECHAT_FAN_KEYWORD_MAX)
    ) {
        return false
    }
    if (
        candidate.tagId !== undefined &&
        (typeof candidate.tagId !== 'number' || !Number.isInteger(candidate.tagId) || candidate.tagId <= 0)
    ) {
        return false
    }
    if (candidate.subscribeStatus !== undefined && candidate.subscribeStatus !== 0 && candidate.subscribeStatus !== 1) {
        return false
    }
    if (candidate.isBlocked !== undefined && typeof candidate.isBlocked !== 'boolean') {
        return false
    }
    if (
        candidate.limit !== undefined &&
        (typeof candidate.limit !== 'number' ||
            !Number.isInteger(candidate.limit) ||
            candidate.limit < 1 ||
            candidate.limit > 200)
    ) {
        return false
    }
    if (
        candidate.offset !== undefined &&
        (typeof candidate.offset !== 'number' || !Number.isInteger(candidate.offset) || candidate.offset < 0)
    ) {
        return false
    }
    return true
}

/** 判断是否为粉丝详情请求 */
export function isWechatFanDetailRequest(payload: unknown): payload is WechatFanDetailRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { accountId?: unknown; openid?: unknown }
    return isWechatAccountId(candidate.accountId) && isWechatOpenid(candidate.openid)
}

/** 判断是否为同步触发请求：taskId 为空表示新建 */
export function isWechatFanSyncRequest(payload: unknown): payload is WechatFanSyncRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { accountId?: unknown; taskId?: unknown }
    return (
        isWechatAccountId(candidate.accountId) &&
        (candidate.taskId === undefined || typeof candidate.taskId === 'string')
    )
}

/** 判断是否为同步状态请求 */
export function isWechatFanSyncStatusRequest(payload: unknown): payload is WechatFanSyncStatusRequest {
    return isWechatFanSyncRequest(payload)
}

/** 判断是否为标签新建请求 */
export function isWechatFanTagCreateRequest(payload: unknown): payload is WechatFanTagCreateRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { accountId?: unknown; name?: unknown }
    return isWechatAccountId(candidate.accountId) && isWechatFanTagName(candidate.name)
}

/** 判断是否为标签重命名请求 */
export function isWechatFanTagRenameRequest(payload: unknown): payload is WechatFanTagRenameRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { accountId?: unknown; id?: unknown; name?: unknown }
    return (
        isWechatAccountId(candidate.accountId) &&
        typeof candidate.id === 'number' &&
        Number.isInteger(candidate.id) &&
        candidate.id > 0 &&
        isWechatFanTagName(candidate.name)
    )
}

/** 判断是否为标签删除请求 */
export function isWechatFanTagRemoveRequest(payload: unknown): payload is WechatFanTagRemoveRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { accountId?: unknown; id?: unknown }
    return (
        isWechatAccountId(candidate.accountId) &&
        typeof candidate.id === 'number' &&
        Number.isInteger(candidate.id) &&
        candidate.id > 0
    )
}

/** 判断是否为打标与取消请求：openids 一次最多 100 个 */
export function isWechatFanTagMembersRequest(payload: unknown): payload is WechatFanTagMembersRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { accountId?: unknown; openids?: unknown; tagId?: unknown; action?: unknown }
    return (
        isWechatAccountId(candidate.accountId) &&
        isWechatOpenidList(candidate.openids) &&
        typeof candidate.tagId === 'number' &&
        Number.isInteger(candidate.tagId) &&
        candidate.tagId > 0 &&
        (candidate.action === 'add' || candidate.action === 'remove')
    )
}

/** 判断是否为备注请求：空串表示清除备注 */
export function isWechatFanRemarkRequest(payload: unknown): payload is WechatFanRemarkRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { accountId?: unknown; openid?: unknown; remark?: unknown }
    return (
        isWechatAccountId(candidate.accountId) &&
        isWechatOpenid(candidate.openid) &&
        isWechatFanRemark(candidate.remark)
    )
}

/** 判断是否为黑名单请求：openids 一次最多 20 个，action 只接受 block 或 unblock */
export function isWechatFanBlacklistRequest(payload: unknown): payload is WechatFanBlacklistRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { accountId?: unknown; openids?: unknown; action?: unknown }
    return (
        isWechatAccountId(candidate.accountId) &&
        isWechatOpenidList(candidate.openids, WECHAT_FAN_BLACKLIST_BATCH_LIMIT) &&
        (candidate.action === 'block' || candidate.action === 'unblock')
    )
}

/** 判断是否为数据统计请求：days 只接受 7 / 15 / 30 */
export function isWechatStatsRequest(payload: unknown): payload is WechatStatsRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { accountId?: unknown; days?: unknown }
    if (!isWechatAccountId(candidate.accountId)) {
        return false
    }
    return candidate.days === 7 || candidate.days === 15 || candidate.days === 30
}

/** 日期形态：只接受 YYYY-MM-DD，且必须是真实存在的日期 */
const STATS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** 收窄统计日期：格式与真实日期都合法时返回原串，否则返回 null */
function readStatsDate(value: unknown): string | null {
    if (typeof value !== 'string' || !STATS_DATE_PATTERN.test(value)) {
        return null
    }
    const time = Date.parse(`${value}T00:00:00Z`)
    if (Number.isNaN(time)) {
        return null
    }
    return new Date(time).toISOString().slice(0, 10) === value ? value : null
}

/** 判断是否为分维度统计请求：日期合法、起止有序且跨度不超过 30 天 */
export function isWechatStatsQueryRequest(payload: unknown): payload is WechatStatsQueryRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { accountId?: unknown; dimension?: unknown; view?: unknown; range?: unknown }
    if (!isWechatAccountId(candidate.accountId)) {
        return false
    }
    if (!(WECHAT_STATS_DIMENSIONS as readonly unknown[]).includes(candidate.dimension)) {
        return false
    }
    if (!(WECHAT_STATS_VIEWS as readonly unknown[]).includes(candidate.view)) {
        return false
    }
    const meta = WECHAT_STATS_VIEW_META[candidate.view as WechatStatsView]
    if (meta.dimension !== candidate.dimension) {
        return false
    }
    if (typeof candidate.range !== 'object' || candidate.range === null) {
        return false
    }
    const range = candidate.range as { kind?: unknown; days?: unknown; beginDate?: unknown; endDate?: unknown }
    if (range.kind === 'days') {
        return range.days === 7 || range.days === 15 || range.days === 30
    }
    if (range.kind !== 'custom') {
        return false
    }
    const beginDate = readStatsDate(range.beginDate)
    const endDate = readStatsDate(range.endDate)
    if (beginDate === null || endDate === null || beginDate > endDate) {
        return false
    }
    const spanDays = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${beginDate}T00:00:00Z`)) / 86_400_000
    return spanDays <= 30
}

/** UTF-8 字节数：菜单名按字节限制，不能用字符数近似（一个汉字占 3 字节） */
export function readByteLength(value: string): number {
    return new TextEncoder().encode(value).length
}

/** 读取可选非空字符串：只收窄本类型真正用到的字段 */
function readMenuText(value: unknown): string | undefined {
    const text = typeof value === 'string' ? value.trim() : ''
    return text.length > 0 ? text : undefined
}

/** 读取跳转地址：只放行 http/https，避免把 javascript: 等危险协议提交给平台 */
function readMenuLinkUrl(value: unknown): string | undefined {
    const text = readMenuText(value)
    if (text === undefined || readByteLength(text) > WECHAT_MENU_URL_BYTES) {
        return undefined
    }
    try {
        const parsed = new URL(text)
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? text : undefined
    } catch {
        return undefined
    }
}

/**
 * 收窄菜单内容：按 kind 校验必填字段，非法内容返回 null 让整棵菜单被拒绝，
 * 避免用户选好的内容在保存后静默丢失；可选字段非法时只丢弃该字段，不影响主要内容。
 */
export function readWechatMenuContent(value: unknown): WechatMenuContent | null {
    if (typeof value !== 'object' || value === null) {
        return null
    }
    const candidate = value as {
        kind?: unknown
        materialId?: unknown
        mediaId?: unknown
        url?: unknown
        materialName?: unknown
        issueId?: unknown
        articleId?: unknown
        title?: unknown
        articleCount?: unknown
        coverUrl?: unknown
        linkUrl?: unknown
        appid?: unknown
        pagepath?: unknown
        miniUrl?: unknown
    }
    if (candidate.kind === 'link') {
        const linkUrl = readMenuLinkUrl(candidate.linkUrl)
        return linkUrl === undefined ? null : { kind: 'link', linkUrl }
    }
    if (candidate.kind === 'image') {
        const materialId = readMenuText(candidate.materialId)
        const mediaId = readMenuText(candidate.mediaId)
        const url = readMenuText(candidate.url)
        if (materialId === undefined || mediaId === undefined || url === undefined) {
            return null
        }
        const materialName = readMenuText(candidate.materialName)
        return materialName === undefined
            ? { kind: 'image', materialId, mediaId, url }
            : { kind: 'image', materialId, mediaId, url, materialName }
    }
    if (candidate.kind === 'news') {
        const issueId = readMenuText(candidate.issueId)
        const articleId = readMenuText(candidate.articleId)
        const title = readMenuText(candidate.title)
        if (issueId === undefined || articleId === undefined || title === undefined) {
            return null
        }
        const content: WechatMenuContent = { kind: 'news', issueId, articleId, title }
        const coverUrl = readMenuText(candidate.coverUrl)
        if (coverUrl !== undefined) {
            content.coverUrl = coverUrl
        }
        if (typeof candidate.articleCount === 'number' && Number.isInteger(candidate.articleCount)) {
            content.articleCount = Math.max(0, candidate.articleCount)
        }
        return content
    }
    if (candidate.kind === 'miniprogram') {
        const appid = readMenuText(candidate.appid)
        const pagepath = readMenuText(candidate.pagepath)
        const miniUrl = readMenuLinkUrl(candidate.miniUrl)
        // 平台要求小程序 appid 必须小写
        if (appid === undefined || appid !== appid.toLowerCase() || pagepath === undefined || miniUrl === undefined) {
            return null
        }
        return { kind: 'miniprogram', appid, pagepath, miniUrl }
    }
    return null
}

/** 动作类型与本地内容类型的对应关系，校验时据此拒绝内容与动作不匹配的菜单 */
const CONTENT_KIND_BY_TYPE: Readonly<Record<WechatMenuType, WechatMenuContentKind>> = {
    media_id: 'image',
    article_id: 'news',
    view: 'link',
    miniprogram: 'miniprogram',
}

/**
 * 校验并规整菜单结构：返回 null 表示结构非法，调用方据此给出可执行提示。
 * 关键约束：一级 ≤3、二级 ≤5、名称按字节上限校验；目录节点（有 subButton）忽略自身动作字段；
 * 叶子必须有 name 与 type：media_id 需要 mediaId、article_id 需要 articleId、view 需要 url、
 * miniprogram 需要 appid + pagepath + url（旧版本兜底网页）；
 * content 存在时必须合法且与动作类型匹配，避免选好的内容在保存后丢失；
 * 目录节点的 content 若存在也校验并保留：平台同步忽略，但二级删空后据此恢复原叶子内容；
 * id 必填且原样保留（平台无此字段，由读取链路生成），缺失直接拒绝以保证编辑坐标稳定。
 * 结构化字段只保留用得到的键，避免把前端多余字段带到平台侧。
 */
export function readWechatMenuButtons(value: unknown): WechatMenuButton[] | null {
    if (!Array.isArray(value) || value.length === 0 || value.length > WECHAT_MENU_TOP_LIMIT) {
        return null
    }
    const readLeaf = (item: unknown, isTop: boolean, allowSubButton: boolean): WechatMenuButton | null => {
        if (typeof item !== 'object' || item === null) {
            return null
        }
        const candidate = item as {
            id?: unknown
            name?: unknown
            type?: unknown
            url?: unknown
            mediaId?: unknown
            articleId?: unknown
            appid?: unknown
            pagepath?: unknown
            subButton?: unknown
            content?: unknown
        }
        const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
        if (name.length === 0) {
            return null
        }
        const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
        if (id.length === 0) {
            return null
        }
        const identity = { id }
        const nameLimit = isTop ? WECHAT_MENU_TOP_NAME_BYTES : WECHAT_MENU_SUB_NAME_BYTES
        if (readByteLength(name) > nameLimit) {
            return null
        }
        if (candidate.subButton !== undefined) {
            // 平台仅支持两级：二级菜单不允许再携带 subButton
            if (!allowSubButton) {
                return null
            }
            if (!Array.isArray(candidate.subButton) || candidate.subButton.length === 0) {
                return null
            }
            if (candidate.subButton.length > WECHAT_MENU_SUB_LIMIT) {
                return null
            }
            const children = candidate.subButton.map((child) => readLeaf(child, false, false))
            if (children.some((child) => child === null)) {
                return null
            }
            const group: WechatMenuButton = { ...identity, name, subButton: children as WechatMenuButton[] }
            if (candidate.content !== undefined) {
                const content = readWechatMenuContent(candidate.content)
                if (content !== null) {
                    group.content = content
                }
            }
            return group
        }
        const type = candidate.type
        if (type !== 'media_id' && type !== 'article_id' && type !== 'view' && type !== 'miniprogram') {
            return null
        }
        const content =
            candidate.content === undefined ? undefined : readWechatMenuContent(candidate.content)
        if (content === null || (content !== undefined && content.kind !== CONTENT_KIND_BY_TYPE[type])) {
            return null
        }
        if (type === 'view') {
            const url = readMenuLinkUrl(candidate.url)
            if (url === undefined || (content !== undefined && content.linkUrl !== url)) {
                return null
            }
            return { ...identity, name, type, url, ...(content === undefined ? {} : { content }) }
        }
        if (type === 'media_id') {
            const mediaId = readMenuText(candidate.mediaId)
            if (mediaId === undefined || (content !== undefined && content.mediaId !== mediaId)) {
                return null
            }
            return { ...identity, name, type, mediaId, ...(content === undefined ? {} : { content }) }
        }
        if (type === 'article_id') {
            const articleId = readMenuText(candidate.articleId)
            if (articleId === undefined || (content !== undefined && content.articleId !== articleId)) {
                return null
            }
            return { ...identity, name, type, articleId, ...(content === undefined ? {} : { content }) }
        }
        const appid = readMenuText(candidate.appid)
        const pagepath = readMenuText(candidate.pagepath)
        const url = readMenuLinkUrl(candidate.url)
        // 平台要求小程序 appid 必须小写
        if (appid === undefined || appid !== appid.toLowerCase() || pagepath === undefined || url === undefined) {
            return null
        }
        if (
            content !== undefined &&
            (content.appid !== appid || content.pagepath !== pagepath || content.miniUrl !== url)
        ) {
            return null
        }
        return {
            ...identity,
            name,
            type,
            url,
            appid,
            pagepath,
            ...(content === undefined ? {} : { content }),
        }
    }
    const buttons = value.map((item) => readLeaf(item, true, true))
    if (buttons.some((item) => item === null)) {
        return null
    }
    return buttons as WechatMenuButton[]
}

/** 判断是否为从文档导入请求 */
export function isWechatArticleImportRequest(payload: unknown): payload is WechatArticleImportRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { issueId?: unknown; sourceKind?: unknown }
    if (!isWechatIssueId(candidate.issueId)) {
        return false
    }
    return candidate.sourceKind === 'note' || candidate.sourceKind === 'press'
}
