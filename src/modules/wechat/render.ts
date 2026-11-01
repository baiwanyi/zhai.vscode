/**
 * 公众号 HTML 渲染：Markdown → 可直接提交到草稿箱的正文 HTML。
 * 复用约定：解析走 unified + remark-parse + remark-gfm + remark-rehype，样式内联走 juice，
 * 代码块保持纯文本、不做语法高亮（底色与等宽字体由主题 CSS 提供），主题默认值见 ./theme。
 * 关键约束：公众号不支持 <style> 与外链 CSS，输出必须是内联样式，juice 处理后不得残留 style 标签；
 * 图片只收集地址、不上传——上传素材与改写 URL 属于推送链路，渲染保持纯函数、可重复执行；
 * 输出为正文片段（外层一个 section），不含 html/body，微信编辑器按片段接收；
 * 不开放内联 HTML 解析（不挂 rehype-raw），避免把不可信标签带进平台过滤器；
 * juice 与 unified 生态首次加载约 700ms，改为首次渲染时动态加载，激活期不再背这份开销。
 */
import { DEFAULT_WECHAT_THEME_CSS } from './theme'
import type juice from 'juice'
import type { Image, Root as MdastRoot } from 'mdast'
import type rehypeStringify from 'rehype-stringify'
import type remarkGfm from 'remark-gfm'
import type remarkParse from 'remark-parse'
import type remarkRehype from 'remark-rehype'
import type { unified } from 'unified'
import type { visit } from 'unist-util-visit'

/** 渲染结果 */
export interface WechatRenderResult {
    /** 内联样式后的正文片段 */
    html: string
    /** 正文引用的图片地址（按出现顺序去重），供推送前上传素材 */
    imageUrls: string[]
}

/** 渲染选项 */
export interface WechatRenderOptions {
    /** 自定义主题 CSS：整段替换默认主题，不做合并，避免两套规则互相覆盖 */
    themeCss?: string
    /**
     * 图片地址改写：返回 null 表示保持原样。
     * 关键约束：改写发生在 mdast 上、渲染之前，调用方在这里完成「本地上传素材 / 外链保留」的决策。
     */
    resolveImageUrl?: (url: string) => Promise<string | null>
}

/** 延迟加载的渲染依赖：类型直接取各包导出的类型，避免另写一份手写签名 */
interface RenderDeps {
    juice: typeof juice
    unified: typeof unified
    remarkParse: typeof remarkParse
    remarkGfm: typeof remarkGfm
    remarkRehype: typeof remarkRehype
    rehypeStringify: typeof rehypeStringify
    visit: typeof visit
}

let renderDeps: Promise<RenderDeps> | null = null

/** 加载渲染依赖：七个包并发加载，任一失败即整体失败（不吞错，交由调用方决定如何提示） */
async function loadRenderDeps(): Promise<RenderDeps> {
    const [
        juiceModule,
        unifiedModule,
        remarkParseModule,
        remarkGfmModule,
        remarkRehypeModule,
        rehypeStringifyModule,
        visitModule,
    ] = await Promise.all([
        import('juice'),
        import('unified'),
        import('remark-parse'),
        import('remark-gfm'),
        import('remark-rehype'),
        import('rehype-stringify'),
        import('unist-util-visit'),
    ])
    return {
        juice: juiceModule.default,
        unified: unifiedModule.unified,
        remarkParse: remarkParseModule.default,
        remarkGfm: remarkGfmModule.default,
        remarkRehype: remarkRehypeModule.default,
        rehypeStringify: rehypeStringifyModule.default,
        visit: visitModule.visit,
    }
}

/** 惰性加载渲染依赖：并发首调用共享同一份 Promise，失败时清空句柄，下次渲染可重试 */
function ensureRenderDeps(): Promise<RenderDeps> {
    if (renderDeps === null) {
        renderDeps = loadRenderDeps().catch((error: unknown) => {
            renderDeps = null
            throw error
        })
    }
    return renderDeps
}

/** 收集正文中的图片地址：只认 Markdown 图片语法，内联 HTML 不参与 */
function collectImageUrls(deps: RenderDeps, markdown: string): string[] {
    const tree = deps.unified().use(deps.remarkParse).use(deps.remarkGfm).parse(markdown)
    const urls: string[] = []
    for (const node of collectImageNodes(deps, tree)) {
        if (node.url.length > 0 && !urls.includes(node.url)) {
            urls.push(node.url)
        }
    }
    return urls
}

/** 收集 mdast 中的图片节点：改写 url 需要在语法树上做，字符串替换会漏掉属性转义差异 */
function collectImageNodes(deps: RenderDeps, tree: MdastRoot): Image[] {
    const nodes: Image[] = []
    deps.visit(tree, 'image', (node: Image) => {
        nodes.push(node)
    })
    return nodes
}

/**
 * 渲染公众号正文：Markdown → 内联样式 HTML。
 * 关键约束：juice 的 inlineContent 只处理传入的片段与 CSS，不读外部样式表；
 * 关闭 applyStyleTags 是因为输入里不应存在 style 标签，开启反而会把不可信的标签样式带进来；
 * 图片地址改写发生在 mdast 上（resolveImageUrl），渲染后不再动 HTML 字符串——
 * 属性值在序列化时会被转义，字符串比对会漏掉这类差异。
 */
export async function renderWechatHtml(
    markdown: string,
    options: WechatRenderOptions = {},
): Promise<WechatRenderResult> {
    const deps = await ensureRenderDeps()
    const imageUrls = collectImageUrls(deps, markdown)
    const mdast = deps.unified().use(deps.remarkParse).use(deps.remarkGfm).parse(markdown)
    if (options.resolveImageUrl !== undefined) {
        const resolve = options.resolveImageUrl
        for (const node of collectImageNodes(deps, mdast)) {
            const next = await resolve(node.url)
            if (next !== null && next.length > 0) {
                node.url = next
            }
        }
    }
    const hast = await deps.unified().use(deps.remarkRehype).run(mdast)
    const rawHtml = deps.unified().use(deps.rehypeStringify).stringify(hast)
    const fragment = `<section>${rawHtml}</section>`
    const html = deps.juice.inlineContent(fragment, options.themeCss ?? DEFAULT_WECHAT_THEME_CSS, {
        applyStyleTags: false,
        removeStyleTags: true,
        preserveMediaQueries: false,
        inlinePseudoElements: false,
    })
    return { html, imageUrls }
}
