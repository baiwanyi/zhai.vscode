/**
 * 公众号 HTML 渲染：Markdown → 可直接提交到草稿箱的正文 HTML。
 * 复用约定：解析走 unified + remark-parse + remark-gfm + remark-rehype，样式内联走 juice，
 * 代码高亮走 shiki（语言缺失或高亮失败时回退为普通代码块），主题默认值见 ./theme。
 * 关键约束：公众号不支持 <style> 与外链 CSS，输出必须是内联样式，juice 处理后不得残留 style 标签；
 * 图片只收集地址、不上传——上传素材与改写 URL 属于推送链路，渲染保持纯函数、可重复执行；
 * 输出为正文片段（外层一个 section），不含 html/body，微信编辑器按片段接收；
 * 不开放内联 HTML 解析（不挂 rehype-raw），避免把不可信标签带进平台过滤器。
 */
import juice from 'juice'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { codeToHast } from 'shiki'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import { DEFAULT_WECHAT_THEME_CSS } from './theme'
import type { Element, Root as HastRoot } from 'hast'
import type { Image, Root as MdastRoot } from 'mdast'
import type { Plugin } from 'unified'
import type { Parent } from 'unist'

/** 高亮主题：公众号正文以浅色底为主，深色主题在多数阅读场景里显得突兀 */
const SHIKI_THEME = 'github-light'

/** 语言标识前缀：remark-rehype 把 ```ts 写成 class="language-ts" */
const CODE_LANG_PREFIX = 'language-'

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

/** 收集正文中的图片地址：只认 Markdown 图片语法，内联 HTML 不参与 */
function collectImageUrls(markdown: string): string[] {
    const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown)
    const urls: string[] = []
    for (const node of collectImageNodes(tree)) {
        if (node.url.length > 0 && !urls.includes(node.url)) {
            urls.push(node.url)
        }
    }
    return urls
}

/** 用 shiki 高亮一个代码块：语言未知或加载失败时返回 null，由调用方保留原节点 */
async function highlightCodeBlock(code: string, lang: string): Promise<Element | null> {
    try {
        const hast = await codeToHast(code, { lang: lang.length > 0 ? lang : 'text', theme: SHIKI_THEME })
        const [first] = hast.children
        return first?.type === 'element' ? first : null
    } catch {
        return null
    }
}

/**
 * rehype 插件：把 pre > code 替换为 shiki 高亮后的节点。
 * 关键约束：unified 的 visitor 不支持异步，先收集目标再逐个替换，避免在遍历中 await；
 * 替换失败时保留原节点，宁可没有配色也不能丢掉代码内容。
 */
const rehypeShiki: Plugin<[], HastRoot, HastRoot> = () => {
    return async (tree: HastRoot): Promise<void> => {
        const targets: { parent: Parent; index: number; code: string; lang: string }[] = []
        visit(tree, 'element', (node, index, parent) => {
            if (node.tagName !== 'pre' || index === undefined || parent === undefined) {
                return
            }
            const codeElement = node.children.find(
                (child): child is Element => child.type === 'element' && child.tagName === 'code',
            )
            if (codeElement === undefined) {
                return
            }
            const className = codeElement.properties?.className
            const langClass = Array.isArray(className)
                ? className.find((item) => typeof item === 'string' && item.startsWith(CODE_LANG_PREFIX))
                : undefined
            targets.push({
                parent,
                index,
                code: codeElement.children.map((child) => (child.type === 'text' ? child.value : '')).join(''),
                lang: typeof langClass === 'string' ? langClass.slice(CODE_LANG_PREFIX.length) : '',
            })
        })
        for (const target of targets) {
            const highlighted = await highlightCodeBlock(target.code, target.lang)
            if (highlighted !== null) {
                target.parent.children[target.index] = highlighted
            }
        }
    }
}

/** 收集 mdast 中的图片节点：改写 url 需要在语法树上做，字符串替换会漏掉属性转义差异 */
function collectImageNodes(tree: MdastRoot): Image[] {
    const nodes: Image[] = []
    visit(tree, 'image', (node: Image) => {
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
    const imageUrls = collectImageUrls(markdown)
    const mdast = unified().use(remarkParse).use(remarkGfm).parse(markdown)
    if (options.resolveImageUrl !== undefined) {
        const resolve = options.resolveImageUrl
        for (const node of collectImageNodes(mdast)) {
            const next = await resolve(node.url)
            if (next !== null && next.length > 0) {
                node.url = next
            }
        }
    }
    const hast = await unified().use(remarkRehype).use(rehypeShiki).run(mdast)
    const rawHtml = unified().use(rehypeStringify).stringify(hast)
    const fragment = `<section>${rawHtml}</section>`
    const html = juice.inlineContent(fragment, options.themeCss ?? DEFAULT_WECHAT_THEME_CSS, {
        applyStyleTags: false,
        removeStyleTags: true,
        preserveMediaQueries: false,
        inlinePseudoElements: false,
    })
    return { html, imageUrls }
}
