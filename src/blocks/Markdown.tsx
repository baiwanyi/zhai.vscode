/**
 * Markdown 渲染入口：把主题类名映射、GFM 插件与图片路径解析收在一处，调用方只给正文。
 * 复用约定：映射逐标签复用 shadcn 语义令牌，不引 typography 插件，避免与气泡样式互相覆盖；
 * 语言无关的展示层共用——标注解释、AI 对话正文、解释弹窗都走这一个组件。
 * 关键约束：插件表与映射都是模块级常量，内联新建会让 ReactMarkdown 每次重建解析器；
 * 不接 rehype-raw，原始 HTML 一律不渲染；图片地址经 @shared/utils/zhaiPath 解析，
 * `@zhai/` 开头的引用拼到宿主注入的存储根基址，其余原样输出。
 */
'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Separator } from '@components/ui/separator'
import { STORAGE_BASE_META, resolveZhaiSrc } from '@shared/utils/zhaiPath'
import type { JSX } from 'react'
import type { Components } from 'react-markdown'

/** GFM 插件表：模块级常量，避免每次渲染新建数组导致 ReactMarkdown 重初始化解析器 */
const REMARK_PLUGINS = [remarkGfm]

/** 存储根基址：宿主以 meta 写入 HTML（CSP 禁止内联脚本），缺失时 @zhai/ 引用保持原样 */
const STORAGE_BASE = readStorageBase()

/** 读取宿主写入的存储根基址：非浏览器环境或未注入时返回空串 */
function readStorageBase(): string {
    if (typeof document === 'undefined') {
        return ''
    }
    const meta = document.querySelector(`meta[name="${STORAGE_BASE_META}"]`)
    return meta?.getAttribute('content') ?? ''
}

/** Markdown 元素到主题类名的映射：逐标签复用 shadcn 令牌，避免与气泡样式互相覆盖 */
const MARKDOWN_COMPONENTS: Components = {
    p: ({ children }) => <p className="mb-2 leading-relaxed last:mb-0">{children}</p>,
    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    ul: ({ children }) => <ul className="mb-2 list-disc pl-4 last:mb-0">{children}</ul>,
    ol: ({ children }) => <ol className="mb-2 list-decimal pl-4 last:mb-0">{children}</ol>,
    li: ({ children }) => <li className="mb-0.5">{children}</li>,
    h1: ({ children }) => <h3 className="mb-2 font-heading font-medium">{children}</h3>,
    h2: ({ children }) => <h4 className="mb-2 font-heading font-medium">{children}</h4>,
    h3: ({ children }) => <h5 className="mb-1.5 font-heading font-medium">{children}</h5>,
    blockquote: ({ children }) => (
        <blockquote className="mb-2 border-l-2 border-quote-border bg-quote-background pl-2 text-muted-foreground italic last:mb-0">
            {children}
        </blockquote>
    ),
    a: ({ children, href }) => (
        <a className="text-link underline underline-offset-2" href={href}>
            {children}
        </a>
    ),
    img: ({ src, alt }) => (
        <img
            className="mb-2 max-w-full rounded-md last:mb-0"
            src={typeof src === 'string' ? resolveZhaiSrc(src, STORAGE_BASE) : undefined}
            alt={alt ?? ''}
        />
    ),
    code: ({ children, className }) =>
        typeof className === 'string' && className.includes('language-') ? (
            <code className={className}>{children}</code>
        ) : (
            <code className="rounded bg-code-background px-1 py-0.5 font-mono">{children}</code>
        ),
    pre: ({ children }) => (
        <pre className="mb-2 overflow-x-auto rounded-md bg-code-background p-2 last:mb-0">{children}</pre>
    ),
    hr: () => <Separator className="my-2" />,
    table: ({ children }) => <table className="mb-2 w-full border-collapse last:mb-0">{children}</table>,
    th: ({ children }) => <th className="border border-border px-1.5 py-1 text-left font-medium">{children}</th>,
    td: ({ children }) => <td className="border border-border px-1.5 py-1">{children}</td>,
}

export interface MarkdownProps {
    /** Markdown 正文：不渲染空串，由调用方决定空态文案 */
    content: string
}

export function Markdown({ content }: MarkdownProps): JSX.Element {
    return (
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
            {content}
        </ReactMarkdown>
    )
}
