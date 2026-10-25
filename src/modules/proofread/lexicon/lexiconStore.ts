/**
 * 自定义词库存储：读写存储根下 proofread/lexicon.json，供自定义纠错检查与忽略词使用。
 * 复用 common/config 的存储根与 common/storagePath 的 Uri 拼装，词库是用户可直接编辑的纯文本文件。
 * 关键约束：解析逐字段收窄并限长，格式损坏时降级为空库并记日志，不能因为词库写坏而让校对整体失败；
 * 文件不存在时由 ensureLexiconFile 落一份带说明的骨架，用户打开即可照格式补充，不需要额外文档。
 */
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { logger } from '@modules/common/logger'
import { buildStorageUri } from '@modules/common/storagePath'
import type { ProofreadLexicon, ProofreadLexiconEntry, ProofreadLexiconState } from '@shared/types/proofread'

/** 词库目录名：存储根下的一级目录，与 notes / press 平级 */
const LEXICON_DIR = 'proofread'

/** 词库文件名 */
const LEXICON_FILE = 'lexicon.json'

/** 词条上限：超出部分忽略，避免异常文件放大检查开销 */
const MAX_ENTRIES = 2000

/** 忽略词上限 */
const MAX_IGNORES = 500

/** 单个词条长度上限 */
const MAX_WORD_LENGTH = 32

/** 词条说明长度上限 */
const MAX_NOTE_LENGTH = 120

/** 词库相对存储根路径 */
export const LEXICON_RELATIVE_PATH = `${LEXICON_DIR}/${LEXICON_FILE}`

/** 空词库：文件缺失或解析失败时返回，调用方无需判空 */
const EMPTY_LEXICON: ProofreadLexicon = { version: 1, entries: [], ignores: [] }

/** 骨架文件与保存时共用的说明字段：用户打开 JSON 也能看懂格式 */
const LEXICON_COMMENT =
    'wrong 为错误写法，right 为建议写法；mode 取 replace 可一键替换，取 flag 仅提示；ignores 中的词不参与任何检查，适合放角色名与专有名词。'

/** 骨架文件内容：带一句说明字段，用户照着填即可 */
const LEXICON_TEMPLATE = `{
    "_comment": ${JSON.stringify(LEXICON_COMMENT)},
    "version": 1,
    "entries": [],
    "ignores": []
}
`

/** 词库文件 Uri */
function resolveLexiconUri(): vscode.Uri {
    return buildStorageUri(resolveStorageRoot(), [LEXICON_DIR, LEXICON_FILE])
}

/** 文本字段收窄：去控制字符、去首尾空白并限长 */
function readText(value: unknown, maxLength: number): string {
    if (typeof value !== 'string') {
        return ''
    }
    return value
        .replace(/[\p{Cc}]/gu, '')
        .trim()
        .slice(0, maxLength)
}

/** 单条词条收窄：错误写法与建议写法都必须非空 */
function normalizeEntry(value: unknown): ProofreadLexiconEntry | null {
    if (typeof value !== 'object' || value === null) {
        return null
    }
    const source = value as { wrong?: unknown; right?: unknown; mode?: unknown; note?: unknown }
    const wrong = readText(source.wrong, MAX_WORD_LENGTH)
    const right = readText(source.right, MAX_WORD_LENGTH)
    if (wrong.length === 0 || right.length === 0) {
        return null
    }
    const note = readText(source.note, MAX_NOTE_LENGTH)
    const entry: ProofreadLexiconEntry = {
        wrong,
        right,
        mode: source.mode === 'flag' ? 'flag' : 'replace',
    }
    if (note.length > 0) {
        entry.note = note
    }
    return entry
}

/** 解析词库：任何字段异常都按空值处理，不抛错 */
export function parseLexicon(payload: unknown): ProofreadLexicon {
    if (typeof payload !== 'object' || payload === null) {
        return EMPTY_LEXICON
    }
    const source = payload as { entries?: unknown; ignores?: unknown }
    const entries: ProofreadLexiconEntry[] = []
    if (Array.isArray(source.entries)) {
        for (const item of source.entries.slice(0, MAX_ENTRIES)) {
            const entry = normalizeEntry(item)
            if (entry !== null) {
                entries.push(entry)
            }
        }
    }
    const ignores: string[] = []
    if (Array.isArray(source.ignores)) {
        for (const item of source.ignores.slice(0, MAX_IGNORES)) {
            const word = readText(item, MAX_WORD_LENGTH)
            if (word.length > 0) {
                ignores.push(word)
            }
        }
    }
    return { version: 1, entries, ignores }
}

/** 读取词库：文件缺失或损坏时返回空库 */
export async function readLexicon(): Promise<ProofreadLexicon> {
    try {
        const content = await vscode.workspace.fs.readFile(resolveLexiconUri())
        const parsed: unknown = JSON.parse(new TextDecoder('utf-8').decode(content))
        return parseLexicon(parsed)
    } catch (error) {
        const isMissing = error instanceof vscode.FileSystemError && error.code === 'FileNotFound'
        if (isMissing) {
            return EMPTY_LEXICON
        }
        const reason = error instanceof Error ? error.message : String(error)
        logger.warn(`校对词库读取失败，按空词库继续：${LEXICON_RELATIVE_PATH}（${reason}）`)
        return EMPTY_LEXICON
    }
}

/** 读取词库状态：前端据此决定「设置词库」入口文案 */
export async function readLexiconState(): Promise<ProofreadLexiconState> {
    const uri = resolveLexiconUri()
    const hasFile = await isExisting(uri)
    if (!hasFile) {
        return { path: LEXICON_RELATIVE_PATH, exists: false, entries: 0, ignores: 0 }
    }
    const lexicon = await readLexicon()
    return {
        path: LEXICON_RELATIVE_PATH,
        exists: true,
        entries: lexicon.entries.length,
        ignores: lexicon.ignores.length,
    }
}

/** 确保词库文件存在并返回绝对 Uri：缺失时落一份骨架文件 */
export async function ensureLexiconFile(): Promise<vscode.Uri> {
    const uri = resolveLexiconUri()
    if (await isExisting(uri)) {
        return uri
    }
    const directory = buildStorageUri(resolveStorageRoot(), [LEXICON_DIR])
    await vscode.workspace.fs.createDirectory(directory)
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(LEXICON_TEMPLATE))
    return uri
}

/**
 * 写入词库：先按读取口径收窄，再原子替换文件。
 * 关键约束：写入前统一走 parseLexicon，保证落盘内容与读取侧完全同构；
 * 先写临时文件再 rename，避免写到一半中断把用户词库写坏。
 */
export async function writeLexicon(lexicon: ProofreadLexicon): Promise<void> {
    const normalized = parseLexicon({ entries: lexicon.entries, ignores: lexicon.ignores })
    const body = JSON.stringify(
        {
            _comment: LEXICON_COMMENT,
            version: 1,
            entries: normalized.entries,
            ignores: normalized.ignores,
        },
        null,
        4,
    )
    const uri = resolveLexiconUri()
    const directory = buildStorageUri(resolveStorageRoot(), [LEXICON_DIR])
    await vscode.workspace.fs.createDirectory(directory)
    const tempUri = uri.with({ path: `${uri.path}.tmp` })
    await vscode.workspace.fs.writeFile(tempUri, new TextEncoder().encode(`${body}\n`))
    await vscode.workspace.fs.rename(tempUri, uri, { overwrite: true })
}

/** 判定文件是否存在：stat 抛错即视为不存在 */
async function isExisting(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri)
        return true
    } catch {
        return false
    }
}
