/**
 * 微博面板：编辑区独立页，主体是微博发布框（编辑器）与时间线占位。
 * 复用约定：页面骨架取 @webview/components/AppPage，发布框与卡片取 @components/ui/card，
 * 主按钮取 @webview/components/Button，操作反馈用 sonner（Toaster 主题取 useVscodeTheme）。
 * 关键约束：AI 对话不在此页另开一份，统一使用侧栏工作流面板的 AI 对话；
 * 发布框为受控输入并限制长度，当前不落盘、不发请求，内容只停留在页面状态里；
 * 时间线为本地示例，接入真实接口前不得让占位数据被误读为真实内容。
 */
import { Heart, MessageCircle, Repeat2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent } from '@components/ui/card'
import { Toaster } from '@components/ui/sonner'
import { AppContent, AppDescription, AppHeader, AppPage, AppTitle } from '@webview/components/AppPage'
import { Button } from '@webview/components/Button'
import { useVscodeTheme } from '@webview/hooks/useVscodeTheme'
import type { JSX } from 'react'

/** 发布框字数上限：按微博普通正文限制收口，接入接口前先在前端挡住超长输入 */
const POST_MAX_LENGTH = 2000

/** 占位微博：字段对应后续真实时间线卡片的信息层级，接入接口后按同一形状替换数据源 */
interface PlaceholderPost {
    author: string
    time: string
    text: string
    /** 有无媒体区：占位阶段只区分「带图」与「纯文字」两种形态 */
    hasMedia: boolean
    comments: number
    reposts: number
    likes: number
}

/** 示例内容：仅用于占位展示，不代表任何真实账号或时间线 */
const PLACEHOLDER_POSTS: readonly PlaceholderPost[] = [
    {
        author: '宅写作',
        time: '刚刚',
        text: '微博面板已经接到编辑区：上方是发布框，下方是时间线。当前为占位页面，展示的内容均为本地示例。',
        hasMedia: false,
        comments: 12,
        reposts: 3,
        likes: 28,
    },
    {
        author: '写作素材',
        time: '10 分钟前',
        text: '带图微博的卡片形态：正文在上，媒体区在下，互动数收在底部一行。',
        hasMedia: true,
        comments: 4,
        reposts: 1,
        likes: 9,
    },
    {
        author: '灵感收集',
        time: '1 小时前',
        text: '时间线与发布接口接入后，这里的示例会被真实数据替换；届时图片与视频按原始比例呈现，长文自动折行。',
        hasMedia: false,
        comments: 0,
        reposts: 0,
        likes: 2,
    },
]

export function WeiboPanel(): JSX.Element {
    const theme = useVscodeTheme()

    return (
        <AppPage>
            <AppHeader>
                <AppTitle>微博</AppTitle>
                <AppDescription>
                    发布框可先编辑草稿，发布与时间线接口尚未接入；需要 AI 帮忙润色时，请使用侧栏「工作流」的 AI 对话。
                </AppDescription>
            </AppHeader>

            <AppContent isScrollable className="gap-3 pb-4">
                <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
                    <ComposerCard />
                    {PLACEHOLDER_POSTS.map((post) => (
                        <PostCard key={`${post.author}-${post.time}`} post={post} />
                    ))}
                </div>
            </AppContent>

            <Toaster theme={theme} />
        </AppPage>
    )
}

/** 微博发布框：受控编辑器 + 字数与发布按钮，占位阶段不落盘、不请求宿主 */
function ComposerCard(): JSX.Element {
    const [draft, setDraft] = useState('')
    const canPublish = draft.trim().length > 0

    /** 发布占位：接口未接入，先给出明确反馈，避免点了没反应 */
    function handlePublish(): void {
        if (!canPublish) {
            return
        }
        toast.info('发布能力尚未接入：当前内容只停留在编辑框内')
    }

    return (
        <Card>
            <CardContent className="flex flex-col gap-2">
                <textarea
                    value={draft}
                    rows={4}
                    placeholder="分享你的新鲜事…"
                    aria-label="微博正文"
                    maxLength={POST_MAX_LENGTH}
                    onChange={(event) => {
                        setDraft(event.target.value)
                    }}
                    className="min-h-24 w-full resize-y bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
                />
                <div className="flex items-center justify-between gap-2 border-t pt-2">
                    <span className="text-muted-foreground text-xs tabular-nums">
                        {draft.length} / {POST_MAX_LENGTH}
                    </span>
                    <Button variant="primary" disabled={!canPublish} onClick={handlePublish}>
                        发布
                    </Button>
                </div>
            </CardContent>
        </Card>
    )
}

interface PostCardProps {
    post: PlaceholderPost
}

/** 单条微博卡片：作者与时间同行，正文折行，媒体与互动数依次在下 */
function PostCard({ post }: PostCardProps): JSX.Element {
    return (
        <Card>
            <CardContent className="flex flex-col gap-3">
                <div className="flex items-start gap-3">
                    <span
                        aria-hidden
                        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground text-sm"
                    >
                        {post.author.slice(0, 1)}
                    </span>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                            <span className="truncate font-medium">{post.author}</span>
                            <span className="shrink-0 text-muted-foreground text-xs">{post.time}</span>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap wrap-break-word text-sm leading-relaxed">{post.text}</p>
                    </div>
                </div>

                {post.hasMedia ? (
                    <div className="flex aspect-video items-center justify-center rounded-lg bg-muted text-muted-foreground text-xs ring-1 ring-foreground/5">
                        图片占位
                    </div>
                ) : null}

                <div className="flex items-center gap-4 text-muted-foreground text-xs">
                    <Metric icon={<Repeat2 className="size-3.5" />} label="转发" value={post.reposts} />
                    <Metric icon={<MessageCircle className="size-3.5" />} label="评论" value={post.comments} />
                    <Metric icon={<Heart className="size-3.5" />} label="赞" value={post.likes} />
                </div>
            </CardContent>
        </Card>
    )
}

interface MetricProps {
    icon: JSX.Element
    label: string
    value: number
}

/** 互动数：图标只作装饰，可读名由 aria-label 给出，避免读屏念出图标名 */
function Metric({ icon, label, value }: MetricProps): JSX.Element {
    return (
        <span className="flex items-center gap-1" aria-label={`${label} ${String(value)}`}>
            <span aria-hidden>{icon}</span>
            {value}
        </span>
    )
}
