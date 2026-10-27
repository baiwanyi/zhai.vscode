/**
 * 词库 md 的解析与序列化：在「# 分类 / ## 分组 / ### 词条 + 原文」的文档与结构化条目之间互转。
 * 格式契约（改动本文件前先对照 docs/modules/imagegen.md 的「词库 md 格式规范」）：
 * 一个文件一个分类、文件名即分类名；三级标题缺一即整块跳过，不猜归属；
 * `###` 下一行起为原文，直到下一个 1-3 级标题，多行按空格合并、空行忽略（换行会破坏提示词分段）；
 * 四级及更深标题并入上一条正文而不是新词条；正文为空的块不加载，首个标题之前的内容丢弃。
 * 正文里以 `#` 开头的行必须写成 `\#`（序列化会自动加反斜杠），否则会被当成标题切断该条。
 * 复用约定：纯函数、零依赖；标识统一由 tagIdOf 生成，服务、导出脚本与测试共用同一口径。
 * 关键约束：序列化按分组首次出现顺序归拢输出，保证读改写幂等；
 * 分类、分组、名称三段都不允许自带 `::`，否则标识拆不回三段。
 */

/** 标识分隔符：分类、分组、名称三段拼成词条 id，三段都不允许自带该分隔符 */
const TAG_ID_SEPARATOR = '::'

/** 标题行：只认一到三级，四级及以下视为正文，避免把用户的强调行当成新层级 */
const HEADING_PATTERN = /^(#{1,3})\s+(.+)$/u

/** 词条 md 中的一条：分类来自文件名，分组与名称来自标题，prompt 为标题下的正文 */
export interface TagMarkdownEntry {
    object: string
    attribute: string
    name: string
    prompt: string
}

/** 词条标识：分类::分组::名称 */
export function tagIdOf(object: string, attribute: string, name: string): string {
    return [object, attribute, name].join(TAG_ID_SEPARATOR)
}

/**
 * 拆分词条标识：段数不为 3 或任一段为空时返回 null。
 * 关键约束：标识可能来自前端旧数据或被手工改过的请求，逐段校验后才能用于定位 md 中的块。
 */
export function parseTagId(id: string): { object: string; attribute: string; name: string } | null {
    const segments = id.split(TAG_ID_SEPARATOR)
    if (segments.length !== 3) {
        return null
    }
    const [object, attribute, name] = segments
    if (object === undefined || attribute === undefined || name === undefined) {
        return null
    }
    const trimmed = { object: object.trim(), attribute: attribute.trim(), name: name.trim() }
    if (trimmed.object.length === 0 || trimmed.attribute.length === 0 || trimmed.name.length === 0) {
        return null
    }
    return trimmed
}

/**
 * 解析词库 md：按三级标题归组，标题之间的非空行合并为词条原文。
 * 关键约束：`####` 之类更深的标题不会被当成词条名；缺分类、缺分组或正文为空的块直接丢弃，
 * 不落成半条数据。
 */
export function parseTagMarkdown(text: string): TagMarkdownEntry[] {
    const entries: TagMarkdownEntry[] = []
    let object = ''
    let attribute = ''
    let name = ''
    let buffer: string[] = []

    /** 收尾当前词条：三段齐全且正文非空才算一条 */
    const flush = (): void => {
        const prompt = buffer.join(' ').trim()
        if (object.length > 0 && attribute.length > 0 && name.length > 0 && prompt.length > 0) {
            entries.push({ object, attribute, name, prompt })
        }
        buffer = []
    }

    for (const raw of text.split(/\r?\n/u)) {
        const line = raw.trim()
        // 行首 `\#` 是正文里的字面量 #：用户在正文里写标题样式时由序列化补上反斜杠，这里还原
        if (line.startsWith('\\#')) {
            if (name.length > 0) {
                buffer.push(line.slice(1))
            }
            continue
        }
        const heading = HEADING_PATTERN.exec(line)
        if (heading !== null) {
            const level = heading[1] ?? ''
            const title = (heading[2] ?? '').trim()
            flush()
            if (level === '#') {
                object = title
                attribute = ''
                name = ''
            } else if (level === '##') {
                attribute = title
                name = ''
            } else {
                name = title
            }
            continue
        }
        if (line.length > 0 && name.length > 0) {
            buffer.push(line)
        }
    }
    flush()
    return entries
}

/** 正文里的行首 # 需要补一个反斜杠，否则读回时会被当成标题切断该条 */
function escapeBody(prompt: string): string {
    return prompt.startsWith('#') ? `\\${prompt}` : prompt
}

/**
 * 序列化词库 md：分类作一级标题，分组作二级标题，分组按首次出现顺序排列、同组条目归拢在一起。
 * 关键约束：标题与正文之间固定空一行，条目之间同样空一行；末尾只保留一个换行，
 * 让读改写格式幂等——同一份内容反复读写不会再产生行变更。
 */
export function serializeTagMarkdown(object: string, entries: readonly TagMarkdownEntry[]): string {
    const order: string[] = []
    const grouped = new Map<string, TagMarkdownEntry[]>()
    for (const entry of entries) {
        const list = grouped.get(entry.attribute)
        if (list === undefined) {
            order.push(entry.attribute)
            grouped.set(entry.attribute, [entry])
            continue
        }
        list.push(entry)
    }
    const sections: string[] = []
    for (const attribute of order) {
        const items = (grouped.get(attribute) ?? []).map((entry) => `### ${entry.name}\n${escapeBody(entry.prompt)}`)
        sections.push([`## ${attribute}`, ...items].join('\n\n'))
    }
    return `${[`# ${object}`, ...sections].join('\n\n')}\n`
}
