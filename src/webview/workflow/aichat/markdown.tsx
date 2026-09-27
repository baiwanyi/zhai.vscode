/**
 * AI 对话助手回复的 Markdown 元素到主题类名映射：逐标签复用 shadcn 语义令牌渲染正文元素。
 * 与 layout/message-view 的气泡样式解耦，避免引入 typography 插件造成样式互相覆盖（见 markdown-one.md 第 5 节）。
 * 关键约束：仅供 react-markdown 的 components 属性消费，键集须覆盖助手回复可能产出的全部 GFM 元素。
 */
import type { Components } from 'react-markdown'

/** Markdown 元素到主题类名的映射：不引入 typography 插件，逐标签复用 shadcn 令牌，避免与气泡样式互相覆盖 */
export const MARKDOWN_COMPONENTS: Components = {
    p: ({ children }) => <p className="mb-2 leading-relaxed last:mb-0">{children}</p>,
    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    ul: ({ children }) => <ul className="mb-2 list-disc pl-4 last:mb-0">{children}</ul>,
    ol: ({ children }) => <ol className="mb-2 list-decimal pl-4 last:mb-0">{children}</ol>,
    li: ({ children }) => <li className="mb-0.5">{children}</li>,
    h1: ({ children }) => <h3 className="mb-2 font-heading text-base font-medium">{children}</h3>,
    h2: ({ children }) => <h4 className="mb-2 font-heading text-sm font-medium">{children}</h4>,
    h3: ({ children }) => <h5 className="mb-1.5 font-heading text-sm font-medium">{children}</h5>,
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
    code: ({ children, className }) =>
        typeof className === 'string' && className.includes('language-') ? (
            <code className={className}>{children}</code>
        ) : (
            <code className="rounded bg-code-background px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
        ),
    pre: ({ children }) => (
        <pre className="mb-2 overflow-x-auto rounded-md bg-code-background p-2 text-xs last:mb-0">{children}</pre>
    ),
    hr: () => <hr className="my-2 border-border" />,
    table: ({ children }) => <table className="mb-2 w-full border-collapse text-xs last:mb-0">{children}</table>,
    th: ({ children }) => <th className="border border-border px-1.5 py-1 text-left font-medium">{children}</th>,
    td: ({ children }) => <td className="border border-border px-1.5 py-1">{children}</td>,
}
