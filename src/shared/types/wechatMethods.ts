/**
 * 公众号协议方法名：Webview 与宿主共用的字面量表，与 HostMethodName 的 wechat/* 分支一一对应。
 * 复用约定：前端 request 只引用这里的键，组件与取数层不再散写字面量方法名；
 * 宿主 wechatRoutes 的 switch 与 messages 的联合类型同样引用本表，方法名只在文件里出现一次。
 * 关键约束：新增方法须同时在 HostMethodName（经 WechatMethodName 自动纳入）与 wechatRoutes 的 switch 登记，
 * 并在此表补键；漏登记会在运行时抛「未登记的公众号协议方法」。
 */

/** 公众号协议方法名表：键为语义名，值为协议字面量 */
export const WECHAT_METHODS = {
    /** 账号列表 */
    accounts: 'wechat/accounts',
    /** 账号：凭证保存 */
    accountCredentials: 'wechat/account/credentials',
    /** 账号：新建 */
    accountCreate: 'wechat/account/create',
    /** 账号：二维码 */
    accountQrcode: 'wechat/account/qrcode',
    /** 账号：删除 */
    accountRemove: 'wechat/account/remove',
    /** 账号：选中 */
    accountSelect: 'wechat/account/select',
    /** 账号：连通性测试 */
    accountTest: 'wechat/account/test',
    /** 账号：更新 */
    accountUpdate: 'wechat/account/update',
    /** 文章：封面 */
    articleCover: 'wechat/article/cover',
    /** 文章：新建 */
    articleCreate: 'wechat/article/create',
    /** 文章：导入 */
    articleImport: 'wechat/article/import',
    /** 文章：元数据 */
    articleMeta: 'wechat/article/meta',
    /** 文章：移动 */
    articleMove: 'wechat/article/move',
    /** 文章：打开正文 */
    articleOpen: 'wechat/article/open',
    /** 文章：快捷新建 */
    articleQuickCreate: 'wechat/article/quickCreate',
    /** 文章：删除 */
    articleRemove: 'wechat/article/remove',
    /** 文章：更新 */
    articleUpdate: 'wechat/article/update',
    /** 留言：列表 */
    commentList: 'wechat/comment/list',
    /** 留言：精选 */
    commentMark: 'wechat/comment/mark',
    /** 留言：删除 */
    commentRemove: 'wechat/comment/remove',
    /** 留言：回复 */
    commentReply: 'wechat/comment/reply',
    /** 封面：选图 */
    coverPick: 'wechat/cover/pick',
    /** 封面：预览 */
    coverPreview: 'wechat/cover/preview',
    /** 封面：来源 */
    coverSource: 'wechat/cover/source',
    /** 批次：新建 */
    issueCreate: 'wechat/issue/create',
    /** 批次：详情 */
    issueDetail: 'wechat/issue/detail',
    /** 批次：发布 */
    issuePublish: 'wechat/issue/publish',
    /** 批次：发布草稿 */
    issuePublishDraft: 'wechat/issue/publishDraft',
    /** 批次：删除 */
    issueRemove: 'wechat/issue/remove',
    /** 用户：拉黑与解除 */
    fansBlacklist: 'wechat/fans/blacklist',
    /** 用户：详情 */
    fansDetail: 'wechat/fans/detail',
    /** 用户：列表 */
    fansList: 'wechat/fans/list',
    /** 用户：备注 */
    fansRemark: 'wechat/fans/remark',
    /** 用户：检索 */
    fansSearch: 'wechat/fans/search',
    /** 用户：同步 */
    fansSync: 'wechat/fans/sync',
    /** 用户：同步状态 */
    fansSyncStatus: 'wechat/fans/sync/status',
    /** 标签：新建 */
    tagCreate: 'wechat/fans/tag/create',
    /** 标签：打标与取消 */
    tagMembers: 'wechat/fans/tag/members',
    /** 标签：删除 */
    tagRemove: 'wechat/fans/tag/remove',
    /** 标签：重命名 */
    tagRename: 'wechat/fans/tag/rename',
    /** 标签：列表 */
    tags: 'wechat/fans/tags',
    /** 批次列表 */
    issues: 'wechat/issues',
    /** 批次合并 */
    issuesMerge: 'wechat/issues/merge',
    /** 批次批量删除 */
    issuesRemoveBatch: 'wechat/issues/removeBatch',
    /** 素材：导入 */
    materialImport: 'wechat/material/import',
    /** 素材：列表 */
    materialList: 'wechat/material/list',
    /** 素材：删除 */
    materialRemove: 'wechat/material/remove',
    /** 菜单：读取 */
    menuGet: 'wechat/menu/get',
    /** 菜单：保存 */
    menuSave: 'wechat/menu/save',
    /** 发布配额 */
    publishQuota: 'wechat/publishQuota',
    /** 统计概览 */
    statsOverview: 'wechat/stats/overview',
    /** 任务状态 */
    tasks: 'wechat/tasks',
} as const

/** 公众号协议方法名联合：由 WECHAT_METHODS 的值推导 */
export type WechatMethodName = (typeof WECHAT_METHODS)[keyof typeof WECHAT_METHODS]
