/**
 * 笔记本打包：把整本笔记压成一段可直接注入的文本，按预算自动在全文 / 节选 / 目录三档之间切换。
 * 复用约定：结果为纯函数，输入已读好的正文，便于单测；调用方负责读盘与缓存，本模块不做 IO。
 * 关键约束：任何档位的输出都不得超过预算，避免下游按行截断把一段笔记切成两半；
 * 节选按「摘要 + 标题清单」组织，保留结构信息而丢掉细节，比截断尾部更有用。
 */
import type { AiNotebookPackMode } from '@shared/types/aiChat'

/** 单本笔记本的注入预算：约为单条引用上限的三成，给其它引用留出空间 */
export const NOTEBOOK_BUDGET = 6_000
/** 节选模式下单篇上限与下限：上限防止一篇吃掉整本预算，下限保证每篇都有可用信息 */
const PER_NOTE_MAX = 1_200
const PER_NOTE_MIN = 200
/** 篇数阈值：超过只出目录，避免节选片段碎到无法使用 */
const OUTLINE_THRESHOLD = 40
/** 单篇摘要长度上限 */
const SUMMARY_MAX = 200
/** 单篇标题清单条数上限 */
const HEADING_LIMIT = 12

/** 打包输入：一篇笔记的标题与正文 */
export interface NotebookSourceNote {
    title: string
    content: string
}

/** 打包结果：text 即注入文本，charCount 与芯片展示同源 */
export interface NotebookPackResult {
    text: string
    charCount: number
    packMode: AiNotebookPackMode
    memberCount: number
}

/** 提取摘要：首个非标题、非引用的自然段，超出上限按字符截断 */
function extractSummary(content: string): string {
    const paragraphs = content
        .split(/\r?\n\s*\r?\n/u)
        .map((part) => part.trim())
        .filter((part) => part.length > 0 && !part.startsWith('#') && !part.startsWith('>'))
    return (paragraphs[0] ?? '').slice(0, SUMMARY_MAX)
}

/** 提取标题清单：二三级标题即笔记的小节结构，足以让模型知道这篇讲了什么 */
function extractHeadings(content: string): string[] {
    return content
        .split(/\r?\n/u)
        .map((line) => /^#{2,3}\s+(.+?)\s*#*\s*$/u.exec(line))
        .filter((matched): matched is RegExpExecArray => matched !== null)
        .map((matched) => (matched[1] ?? '').trim())
        .filter((title) => title.length > 0)
        .slice(0, HEADING_LIMIT)
}

/** 全文档：每篇都完整注入 */
function renderFull(name: string, notes: readonly NotebookSourceNote[]): string {
    const body = notes
        .map((note, index) => `### ${String(index + 1)}. ${note.title}\n${note.content.trim()}`)
        .join('\n\n')
    return `## 笔记本：${name}（共 ${String(notes.length)} 篇）\n\n${body}`
}

/** 节选档：每篇按配额取摘要与标题清单 */
function renderExcerpt(name: string, notes: readonly NotebookSourceNote[], quota: number, totalChars: number): string {
    const body = notes
        .map((note, index) => {
            const detail = [extractSummary(note.content), ...extractHeadings(note.content).map((item) => `- ${item}`)]
                .filter((part) => part.length > 0)
                .join('\n')
                .slice(0, quota)
            return `### ${String(index + 1)}. ${note.title}\n${detail}`
        })
        .join('\n\n')
    return `## 笔记本：${name}（共 ${String(notes.length)} 篇，约 ${String(totalChars)} 字，已节选）\n\n${body}`
}

/** 目录档：只列标题与字数，引导用户改选具体笔记 */
function renderOutline(name: string, notes: readonly NotebookSourceNote[], totalChars: number): string {
    const body = notes
        .map((note, index) => `- ${String(index + 1)}. ${note.title}（约 ${String(note.content.length)} 字）`)
        .join('\n')
    return `## 笔记本：${name}（共 ${String(notes.length)} 篇，约 ${String(totalChars)} 字，仅列目录）\n请根据需要单独引用其中的笔记。\n\n${body}`
}

/**
 * 打包整本笔记本：总量不超预算走全文，篇数过多走目录，其余走节选。
 * 零篇时返回空文本，由调用方按「该笔记本暂无笔记」提示，不生成只有标题的空块。
 */
export function packNotebook(
    name: string,
    notes: readonly NotebookSourceNote[],
    budget = NOTEBOOK_BUDGET,
): NotebookPackResult {
    const memberCount = notes.length
    if (memberCount === 0) {
        return { text: '', charCount: 0, packMode: 'outline', memberCount }
    }
    const totalChars = notes.reduce((sum, note) => sum + note.content.length, 0)
    if (totalChars <= budget) {
        const text = renderFull(name, notes)
        return { text, charCount: text.length, packMode: 'full', memberCount }
    }
    if (memberCount > OUTLINE_THRESHOLD) {
        const text = renderOutline(name, notes, totalChars)
        return { text, charCount: text.length, packMode: 'outline', memberCount }
    }
    const quota = Math.min(Math.max(Math.floor(budget / memberCount), PER_NOTE_MIN), PER_NOTE_MAX)
    const excerpt = renderExcerpt(name, notes, quota, totalChars)
    if (excerpt.length <= budget) {
        return { text: excerpt, charCount: excerpt.length, packMode: 'excerpt', memberCount }
    }
    const outline = renderOutline(name, notes, totalChars)
    return { text: outline, charCount: outline.length, packMode: 'outline', memberCount }
}
