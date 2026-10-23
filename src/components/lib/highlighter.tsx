/**
 * 语法高亮器：按需加载 shiki 语言包与主题，为代码块产出 token。
 * 复用约定：语言模块经动态 import 懒加载，别名表把常见后缀归一化到已注册语言。
 * 关键约束：高亮器实例单例缓存，首次调用才初始化；未注册语言直接回退纯文本，
 * 本文件只做高亮能力，不引入业务逻辑与组件样式。
 */
import * as React from 'react'
import {
    createHighlighterCore,
    type DynamicImportLanguageRegistration,
    type GrammarState,
    type HighlighterCore,
    type ThemedToken,
} from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

/** 语言模块的加载结果类型，等价于 shiki 的动态语言注册函数返回值 */
type LanguageModule = ReturnType<DynamicImportLanguageRegistration>

/** 单次高亮结果：逐行 token 与续接用的语法状态 */
type HighlightResult = {
    lines: React.ReactNode[][]
    state: GrammarState | undefined
}

/** 绑定语言后的高亮器 */
type LoadedHighlighter = {
    highlight: (code: string, state?: GrammarState) => HighlightResult
}

// Add the languages you need. Each one loads the first time it is used.
const languages = {
    bash: (): LanguageModule => import('shiki/langs/shellscript.mjs'),
    css: (): LanguageModule => import('shiki/langs/css.mjs'),
    diff: (): LanguageModule => import('shiki/langs/diff.mjs'),
    html: (): LanguageModule => import('shiki/langs/html.mjs'),
    javascript: (): LanguageModule => import('shiki/langs/javascript.mjs'),
    json: (): LanguageModule => import('shiki/langs/json.mjs'),
    jsx: (): LanguageModule => import('shiki/langs/jsx.mjs'),
    markdown: (): LanguageModule => import('shiki/langs/markdown.mjs'),
    python: (): LanguageModule => import('shiki/langs/python.mjs'),
    sql: (): LanguageModule => import('shiki/langs/sql.mjs'),
    tsx: (): LanguageModule => import('shiki/langs/tsx.mjs'),
    typescript: (): LanguageModule => import('shiki/langs/typescript.mjs'),
    yaml: (): LanguageModule => import('shiki/langs/yaml.mjs'),
}

const aliases: Record<string, keyof typeof languages> = {
    js: 'javascript',
    md: 'markdown',
    py: 'python',
    sh: 'bash',
    shell: 'bash',
    shellscript: 'bash',
    ts: 'typescript',
    yml: 'yaml',
    zsh: 'bash',
}

let highlighter: Promise<HighlighterCore> | undefined

function getHighlighter(): Promise<HighlighterCore> {
    highlighter ??= createHighlighterCore({
        themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
        langs: [],
        engine: createJavaScriptRegexEngine({ forgiving: true }),
    })

    return highlighter
}

function getLanguage(language: string): keyof typeof languages | 'ansi' | null {
    const name = language.toLowerCase()

    if (name === 'ansi') {
        return name
    }

    if (name in languages) {
        return name as keyof typeof languages
    }

    return aliases[name] ?? null
}

// Loads a language and returns a highlighter for it, or null for a language
// that is not listed.
export async function loadHighlighter(language: string): Promise<LoadedHighlighter | null> {
    const lang = getLanguage(language)

    if (!lang) {
        return null
    }

    const shiki = await getHighlighter()

    if (lang !== 'ansi' && !shiki.getLoadedLanguages().includes(lang)) {
        await shiki.loadLanguage(languages[lang])
    }

    return {
        // Returns one React node per line, and the grammar state after the last
        // line. Pass that state back to continue where the code left off.
        highlight(code: string, state?: GrammarState): HighlightResult {
            const tokenize = (text: string): ThemedToken[][] =>
                shiki.codeToTokens(text, {
                    lang,
                    themes: { light: 'github-light', dark: 'github-dark' },
                    defaultColor: false,
                    grammarState: state,
                }).tokens

            // ANSI has no grammar state, so each line is tokenized on its own and
            // gets the same colors whether it arrives in one piece or streams.
            const tokens = lang === 'ansi' ? code.split('\n').flatMap((line) => tokenize(line)) : tokenize(code)

            return {
                lines: tokens.map((line) =>
                    line.map((token) => (
                        <span
                            key={token.offset}
                            style={token.htmlStyle as React.CSSProperties}
                            className="text-(--shiki-light) dark:text-(--shiki-dark)"
                        >
                            {token.content}
                        </span>
                    )),
                ),
                state: shiki.getLastGrammarState(tokens),
            }
        },
    }
}

// Returns one React node per line, or null for a language that is not listed.
export async function highlightCode(code: string, language: string): Promise<React.ReactNode[][] | null> {
    const highlighter = await loadHighlighter(language)

    return highlighter ? highlighter.highlight(code).lines : null
}
