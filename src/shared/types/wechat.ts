/**
 * 公众号契约：账号摘要、创建/更新/删除/测试连接与当前账号选定的请求结构，以及账号类型与状态的唯一口径。
 * 使用方：仪表盘 Webview 的公众号列表页与宿主侧 DashboardViewProvider、modules/wechat 服务。
 * 复用约定：id 取本地生成的短 id（小写字母数字与连字符），与页内路由 #/wechat/{accountId} 同源；
 * 账号名称、类型与 AppID 落 wechat.db，AppSecret 只回传「是否已配置 + 尾号」，明文仅存 SecretStorage。
 * 关键约束：前端传入的字段一律不可信，宿主须经本文件的收窄函数校验后才可写库或发起网络请求；
 * 账号状态由宿主按接口错误码归一（40164 等），前端只负责展示，不自行推断。
 */

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

/** wechat/account/create 请求 */
export interface CreateWechatAccountRequest {
    /** 账号名称，写入前由宿主折叠空白并截断 */
    name: string
    /** 平台 AppID */
    appId: string
    /** 平台 AppSecret：仅经协议传入一次，落 SecretStorage 后不再回传 */
    appSecret: string
    /** 账号类型，非法值回落订阅号 */
    accountType?: string
}

/** wechat/account/create 响应：返回落库后的摘要，前端据此跳到该账号 */
export interface CreateWechatAccountResult {
    account: WechatAccountSummary
}

/** wechat/account/update 请求 */
export interface UpdateWechatAccountRequest {
    /** 目标账号 id，须已在库中存在 */
    id: string
    /** 账号名称 */
    name: string
    /** 平台 AppID */
    appId: string
    /** 新密钥：留空或缺省表示沿用已存密钥 */
    appSecret?: string
    /** 账号类型，非法值回落订阅号 */
    accountType?: string
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

/** 判断是否为创建账号请求：名称、AppID 与密钥三项必填 */
export function isCreateWechatAccountRequest(payload: unknown): payload is CreateWechatAccountRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { name?: unknown; appId?: unknown; appSecret?: unknown }
    return (
        typeof candidate.name === 'string' &&
        readWechatAccountName(candidate.name).length > 0 &&
        isWechatAppId(candidate.appId) &&
        isWechatAppSecret(candidate.appSecret)
    )
}

/** 判断是否为更新账号请求：密钥可缺省表示沿用旧值 */
export function isUpdateWechatAccountRequest(payload: unknown): payload is UpdateWechatAccountRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { id?: unknown; name?: unknown; appId?: unknown; appSecret?: unknown }
    if (!isWechatAccountId(candidate.id)) {
        return false
    }
    if (typeof candidate.name !== 'string' || readWechatAccountName(candidate.name).length === 0) {
        return false
    }
    if (!isWechatAppId(candidate.appId)) {
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
    /** 源文档相对路径：manual 时缺省 */
    sourcePath?: string
    /** 指定的封面图路径：缺省时推送阶段取正文首图 */
    coverPath?: string
    /** 正文字数，供列表判断是否为空稿 */
    wordCount: number
}

/** 文章详情：编辑弹窗需要正文原文 */
export interface WechatArticleDetail extends WechatArticleSummary {
    /** Markdown 正文：推送前统一渲染为内联样式 HTML，此处只存源文 */
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
}

/** wechat/cover/pick 响应：用户取消时 path 为 null，路径为存储根相对形式 */
export interface WechatCoverPickResult {
    path: string | null
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
}

/** wechat/article/update 响应 */
export interface WechatArticleUpdateResult {
    article: WechatArticleDetail
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
    const candidate = payload as { issueId?: unknown; title?: unknown; body?: unknown; coverPath?: unknown }
    if (!isWechatIssueId(candidate.issueId)) {
        return false
    }
    if (readWechatArticleTitle(candidate.title).length === 0) {
        return false
    }
    if (candidate.coverPath !== undefined && typeof candidate.coverPath !== 'string') {
        return false
    }
    return candidate.body === undefined || isWechatArticleBody(candidate.body)
}

/** 判断是否为更新文章请求：正文必填 */
export function isWechatArticleUpdateRequest(payload: unknown): payload is WechatArticleUpdateRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { id?: unknown; title?: unknown; body?: unknown; coverPath?: unknown }
    if (!isWechatIssueId(candidate.id) || readWechatArticleTitle(candidate.title).length === 0) {
        return false
    }
    if (candidate.coverPath !== undefined && typeof candidate.coverPath !== 'string') {
        return false
    }
    return isWechatArticleBody(candidate.body)
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

/** wechat/issue/publish 响应：articleUrl 需等平台异步发布完成才有值，可能缺省 */
export interface WechatPublishResult {
    issue: WechatIssueSummary
    articleUrl?: string
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
 * 菜单按钮的三种动作：发送消息、跳转网页、跳转小程序。
 * 关键约束：其它平台动作（扫码、拍照、地理位置等）依赖特定权限与客户端版本，本期不开放，
 * 保存时统一按这三种校验，避免用户配出一个保存成功但点不动的菜单。
 */
export const WECHAT_MENU_TYPES = ['click', 'view', 'miniprogram'] as const

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

/** 菜单按钮：type 决定使用哪个内容字段；有 subButton 时自身不参与点击 */
export interface WechatMenuButton {
    name: string
    type?: WechatMenuType
    /** click 动作的开发者自定义键 */
    key?: string
    /** view / miniprogram 的跳转地址 */
    url?: string
    /** miniprogram 的小程序 AppID */
    appid?: string
    /** miniprogram 的页面路径 */
    pagepath?: string
    /** 二级菜单：存在即视为目录节点 */
    subButton?: WechatMenuButton[]
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
    nickname: string
    avatar?: string
    /** 0 未关注、1 已关注（平台口径） */
    subscribeStatus: number
    /** 关注时间：ISO 8601，未关注时缺省 */
    subscribedAt?: string
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

/** UTF-8 字节数：菜单名按字节限制，不能用字符数近似（一个汉字占 3 字节） */
function readByteLength(value: string): number {
    return new TextEncoder().encode(value).length
}

/**
 * 校验并规整菜单结构：返回 null 表示结构非法，调用方据此给出可执行提示。
 * 关键约束：一级 ≤3、二级 ≤5、名称按字节上限校验；目录节点（有 subButton）忽略自身动作字段；
 * 叶子节点必须有 name 与 type，且 click 需要 key、view 需要 url、miniprogram 需要 appid + pagepath。
 * 结构化字段只保留用得到的键，避免把前端多余字段带到平台侧。
 */
export function readWechatMenuButtons(value: unknown): WechatMenuButton[] | null {
    if (!Array.isArray(value) || value.length === 0 || value.length > WECHAT_MENU_TOP_LIMIT) {
        return null
    }
    const readLeaf = (item: unknown, isTop: boolean): WechatMenuButton | null => {
        if (typeof item !== 'object' || item === null) {
            return null
        }
        const candidate = item as {
            name?: unknown
            type?: unknown
            key?: unknown
            url?: unknown
            appid?: unknown
            pagepath?: unknown
            subButton?: unknown
        }
        const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
        if (name.length === 0) {
            return null
        }
        const nameLimit = isTop ? WECHAT_MENU_TOP_NAME_BYTES : WECHAT_MENU_SUB_NAME_BYTES
        if (readByteLength(name) > nameLimit) {
            return null
        }
        if (candidate.subButton !== undefined) {
            if (!Array.isArray(candidate.subButton) || candidate.subButton.length === 0) {
                return null
            }
            if (candidate.subButton.length > WECHAT_MENU_SUB_LIMIT) {
                return null
            }
            const children = candidate.subButton.map((child) => readLeaf(child, false))
            if (children.some((child) => child === null)) {
                return null
            }
            return { name, subButton: children as WechatMenuButton[] }
        }
        const type = candidate.type
        if (type !== 'click' && type !== 'view' && type !== 'miniprogram') {
            return null
        }
        if (type === 'click') {
            const key = typeof candidate.key === 'string' ? candidate.key.trim() : ''
            return key.length > 0 ? { name, type, key } : null
        }
        if (type === 'view') {
            const url = typeof candidate.url === 'string' ? candidate.url.trim() : ''
            return url.length > 0 ? { name, type, url } : null
        }
        const appid = typeof candidate.appid === 'string' ? candidate.appid.trim() : ''
        const pagepath = typeof candidate.pagepath === 'string' ? candidate.pagepath.trim() : ''
        return appid.length > 0 && pagepath.length > 0 ? { name, type, appid, pagepath } : null
    }
    const buttons = value.map((item) => readLeaf(item, true))
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
