/**
 * 微博固定文案：按界面区域分组收拢按钮、加载态、空态、失败条与操作提示。
 * 复用约定：只收固定短文案；带插值的句子（已上传 N 张、共 N 条评论、展开 N 条回复）留在调用处，
 * 视图说明走 utils/weiboViewDescription，单文件长说明仍就地维护。
 * 关键约束：分组顺序固定为「动作 → 加载 → 空态 → 失败 → 提示」，组内按界面出现顺序排列；
 * 同一句只定义一次（刷新、重试、时间线没有内容等），新增文案先查重再落表；
 * 改措辞只改这里，组件里不再出现重复字面量。
 */
export const WEIBO_UI_TEXT = {
    /** 按钮与可点动作：顶栏、列表、对话框共用 */
    action: {
        refresh: '刷新',
        loadMore: '加载更多',
        retry: '重试',
        openSettings: '去设置',
        reloadGroups: '重新读取分组',
    },
    /** 加载态：整块占位与续载提示 */
    loading: {
        feed: '正在读取微博...',
        moreFeed: '正在加载更多...',
        groups: '正在读取分组...',
        defaultGroup: '正在读取默认分组...',
        credential: '正在读取登录状态...',
    },
    /** 空态标题：整块空态与「已经到底了」共用 */
    empty: {
        feed: '没有内容',
        timeline: '时间线没有内容',
        hot: '热门没有内容',
        likes: '还没有点赞',
        comments: '还没有评论',
        reposts: '还没有转发',
        end: '已经到底了',
        credential: '还没有配置微博 Cookie',
    },
    /** 失败提示：整块失败条的标题，细节由 @shared/utils/error 给出 */
    error: {
        feed: '读取失败',
        group: '没有读到默认分组',
        credential: '登录状态读取失败',
        credentialInvalid: '微博 Cookie 已失效',
        comments: '评论读取失败',
        moreComments: '更多评论加载失败',
        reposts: '转发读取失败',
        moreReposts: '更多转发加载失败',
        imageRead: '图片读取失败，请重试',
    },
    /** 操作结果提示：写操作、凭证与 AI 对话的回执 */
    toast: {
        credentialSaved: '微博 Cookie 已保存',
        credentialCleared: '已清除微博 Cookie',
        noNewPosts: '暂无新微博',
        reposted: '已转发',
        repostedWithComment: '已转发并评论',
        repostDeleted: '转发已删除',
        commentPosted: '评论已发布',
        commentedWithRepost: '已评论并转发',
        commentDeleted: '评论已删除',
        published: '已发布到微博',
        addedToChat: '已添加到 AI 对话',
        chatRejected: '未能添加到 AI 对话',
    },
} as const
