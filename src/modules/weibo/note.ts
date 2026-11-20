/**
 * 微博剪藏：把卡片上的一条微博转成笔记 Markdown 与 AI 对话文本。
 * 复用约定：不写 Frontmatter，元信息（作者 / 原文 / 发表时间 / 采集方式）落在正文引用块，
 * 正文版式为「正文首行作一级标题 / 元信息 / 正文余下内容 / 转发内容 / 微博配图」；
 * 落盘交给 note/createNoteFromContent，配图引用走 @zhai/ 存储根口径（与上传页插入同构），
 * 对话注入由调用方按内联引用承载；时间戳折算与截断说明都在本文件内完成。
 * 关键约束：正文来自 Webview，属不可信文本，只做长度截断与空值回退，不做 HTML 解析；
 * 元信息里的作者名要折掉换行，否则会把引用块截断成普通正文；
 * 视频不进笔记（直链带签名且会失效），需要时由用户回到原文观看。
 */
import type { WeiboPagePostPayload } from '@shared/types/weibo'
import { ZHAI_PATH_PREFIX } from '@shared/utils/zhaiPath'
import { WEIBO_WEB_ORIGIN } from './weiboEndpoints'

/** 采集方式说明：与 docs/modules/weibo.md 的剪藏模板一致 */
const COLLECT_MODE = '微博浏览器 · 保存为笔记'

/** 未知作者的回退文案：上游隐藏昵称时仍要保证元信息可读 */
const UNKNOWN_AUTHOR = '未知作者'

/** 正文为空时的兜底标题片段：纯图片微博没有可作标题的文本 */
const FALLBACK_HEADING = '微博内容'

/** 正文摘要长度：H1 标题与文件名都取前 18 个字符 */
const EXCERPT_LENGTH = 18

/** 补零：发表时间按两位固定宽度拼接 */
function pad2(value: number): string {
    return String(value).padStart(2, '0')
}

/** 正文里的发表时间：年-月-日 时:分:秒；上游时间缺失或非法时给可读占位而不是当前时间 */
function toDisplayTime(iso: string): string {
    const parsed = new Date(iso)
    if (Number.isNaN(parsed.getTime())) {
        return '未知时间'
    }
    const day = `${String(parsed.getFullYear())}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`
    const clock = `${pad2(parsed.getHours())}:${pad2(parsed.getMinutes())}:${pad2(parsed.getSeconds())}`
    return `${day} ${clock}`
}

/** 链接回退：卡片 url 缺失时用 detail 链接兜底，不编造 uid 路径 */
function resolvePermalink(post: WeiboPagePostPayload): string {
    if (post.url.length > 0) {
        return post.url
    }
    return `${WEIBO_WEB_ORIGIN}/detail/${post.id}`
}

/**
 * 正文摘要：折成单行后截取前 N 个字符，并给出是否被截断。
 * 关键约束：空正文回退占位文案；折行是为了让摘要能安全进标题与文件名，原文换行不外泄到名字里。
 */
function toExcerpt(text: string, maxLength: number): { text: string; isTruncated: boolean } {
    const oneLine = text.replace(/\s+/gu, ' ').trim()
    if (oneLine.length === 0) {
        return { text: FALLBACK_HEADING, isTruncated: false }
    }
    return { text: oneLine.slice(0, maxLength), isTruncated: oneLine.length > maxLength }
}

/** H1 标题摘要：只有真的被截断时才补省略号，完整放进标题的正文不额外加 `...` */
function toHeadingExcerpt(text: string): string {
    const excerpt = toExcerpt(text, EXCERPT_LENGTH)
    return excerpt.isTruncated ? `${excerpt.text}...` : excerpt.text
}

/** 作者名回退：空昵称给占位，换行折成空格（引用块内不允许出现换行） */
function resolveAuthorName(post: WeiboPagePostPayload): string {
    const name = post.author.name.replace(/[\r\n]+/gu, ' ').trim()
    return name.length > 0 ? name : UNKNOWN_AUTHOR
}

/**
 * 笔记标题（决定文件名）：微博-用户昵称-正文前 18 字。
 * 关键约束：文件名里的摘要不带省略号（避免出现 `....md`），超出部分直接截断；
 * 昵称与摘要里的非法文件名片段由笔记模块的 toNoteFileName 统一收窄；
 * 同名（同一微博重复保存）由落盘流程追加序号顺延。
 */
export function buildWeiboNoteTitle(post: WeiboPagePostPayload): string {
    return `微博-${resolveAuthorName(post)}-${toExcerpt(post.text, EXCERPT_LENGTH).text}`
}

/** 笔记组装选项：主贴与转发配图的本地化结果各自与对应 images 一一对应 */
export interface BuildWeiboNoteOptions {
    /** 主贴配图：已搬进 uploads/ 的存储根相对路径；缺省或对应项为 null 时回退远程直链 */
    localImages?: ReadonlyArray<string | null>
    /** 转发配图：同上，与 retweeted.images 一一对应 */
    retweetImages?: ReadonlyArray<string | null>
}

/** 单张配图的引用写法：本地化成功用 @zhai/ 存储根口径，否则保留图床直链 */
function toImageRef(remote: string, local: string | null | undefined): string {
    return local === null || local === undefined ? remote : `${ZHAI_PATH_PREFIX}${local}`
}

/**
 * 组装微博笔记正文（版式：微博-正文摘要作标题 / 元信息 / 微博正文 / 转发内容 / 微博配图），不写 Frontmatter。
 * 关键约束：标题取正文前 18 个字符（超出才补 ...），笔记模块按它生成大纲；
 * 完整正文放在「## 微博正文」段里，不再被拆进标题；正文为空时标题回退固定文案。
 */
export function buildWeiboNoteMarkdown(post: WeiboPagePostPayload, options: BuildWeiboNoteOptions = {}): string {
    const author = resolveAuthorName(post)
    const permalink = resolvePermalink(post)

    // 不写 Frontmatter：作者、原文与采集信息全部落在正文引用块里，笔记按普通 Markdown 处理
    const metaLines = [
        `> 作者：${author}`,
        `> 原文：[微博链接](${permalink})`,
        `> 发表时间：${toDisplayTime(post.createdAt)}`,
        `> 采集方式：${COLLECT_MODE}`,
    ]
    if (post.isTruncated) {
        // 长文未展开时正文只是摘要：在元信息块里写明来源限制，避免被当成全文存档
        metaLines.push('> 注：正文可能被上游截断，完整内容请看原文链接')
    }

    // 段落块按固定顺序拼接，块间空一行；转发段不另起分隔线，配图段前保留一条
    const sections: string[] = [
        `# 微博-${toHeadingExcerpt(post.text)}`,
        metaLines.join('\n'),
        '---',
        '## 微博正文',
        post.text.length > 0 ? post.text : '(无正文)',
    ]

    if (post.retweeted !== null) {
        const retweetAuthor = post.retweeted.authorName.length > 0 ? post.retweeted.authorName : '原作者'
        sections.push('## 转发内容')
        sections.push(post.retweeted.text.length > 0 ? post.retweeted.text : '（原微博不可见）')
        if (post.retweeted.images.length > 0) {
            // 转发配图同样保存：引用口径与主贴一致，单张失败时回退远程直链
            sections.push('### 转发配图')
            sections.push(
                post.retweeted.images
                    .map(
                        (remote, index) =>
                            `![${retweetAuthor} 的配图](${toImageRef(remote, options.retweetImages?.[index])})`,
                    )
                    .join('\n'),
            )
        }
    }

    if (post.images.length > 0) {
        sections.push('---')
        sections.push('## 微博配图')
        sections.push(
            post.images
                .map((remote, index) => `![${author} 的配图](${toImageRef(remote, options.localImages?.[index])})`)
                .join('\n'),
        )
    }

    // 视频不进笔记：直链带签名且会失效，需要时回到原文观看
    return `${sections.join('\n\n')}\n`
}

/** 组装 AI 对话用的微博上下文文本：作者、原文链接与正文，不含媒体直链 */
export function buildWeiboChatText(post: WeiboPagePostPayload): string {
    const author = resolveAuthorName(post)
    const lines: string[] = []
    lines.push(`微博 @${author}${post.createdAt.length > 0 ? `（${post.createdAt}）` : ''}`)
    lines.push(`原文：${resolvePermalink(post)}`)
    if (post.isTruncated) {
        lines.push('说明：正文可能被上游截断，完整内容见原文链接')
    }
    lines.push('')
    lines.push(post.text.length > 0 ? post.text : '(无正文)')
    if (post.retweeted !== null) {
        const retweetAuthor = post.retweeted.authorName.length > 0 ? post.retweeted.authorName : '原作者'
        lines.push('')
        lines.push(`转发 @${retweetAuthor}：`)
        lines.push(post.retweeted.text.length > 0 ? post.retweeted.text : '（原微博不可见）')
    }
    return lines.join('\n')
}
