/**
 * 批次文档：把群发批次落到存储根 wechat/{appid}/post/{YYYYMMDDHHmm}/，每篇文章一个 Markdown 文件，
 * 封面与正文图片副本统一收在批次目录的 images/ 下。
 * 复用约定：标题提取走 common/db/fileMeta 的 parseTitle（首个一级标题），
 * 文件命名合法化复用 note/noteFactory，路径拼装与删除走 common/storagePath。
 * 关键约束：文件格式与笔记一致——不写也不认 frontmatter，标题就是正文首个 `# 标题`，文件名跟随标题；
 * 目录名取批次创建时分，同分钟重名追加 -2；文件是发布标题与正文的唯一来源，读不到或正文为空直接抛错；
 * 图片写入按调用方给定的文件名直接覆盖，重名分配由上层完成，本层不做去重。
 */
import * as path from 'node:path'
import * as vscode from 'vscode'
import { parseTitle } from '@modules/common/db/fileMeta'
import { logger } from '@modules/common/logger'
import { buildStorageUri, deleteResource, isPathExisting, toSafeSegments } from '@modules/common/storagePath'
import { toNoteFileName } from '@modules/note/noteFactory'
import { WECHAT_MODULE_DIR } from '@shared/types/wechat'

/** 批次目录下的二级目录名：与账号目录、素材目录平级 */
const WECHAT_POST_DIR = 'post'

/** 批次目录下的图片目录名：封面与正文图片副本都落在这里，正文按 `images/{文件名}` 相对引用 */
export const WECHAT_ISSUE_IMAGES_DIR = 'images'

/** 同名文件/目录的追加序号上限：超过说明目录已被塞满，交由用户整理 */
const NAME_SUFFIX_LIMIT = 100

/** 文章文件的内容：标题取自首个一级标题，正文不含标题行 */
export interface WechatArticleDoc {
    title: string
    body: string
}

/** 时间戳：年-月-日-时-分，定宽便于按名称排序 */
export function buildWechatIssueStamp(now: Date): string {
    const pad = (value: number): string => String(value).padStart(2, '0')
    return [
        String(now.getFullYear()),
        pad(now.getMonth() + 1),
        pad(now.getDate()),
        pad(now.getHours()),
        pad(now.getMinutes()),
    ].join('')
}

/** 标题转文件名：非法字符、保留名与超长由 toNoteFileName 兜底，同名按笔记口径顺延「标题 2」 */
export function buildWechatDocFileName(title: string, taken: ReadonlySet<string>): string {
    const preferred = toNoteFileName(title)
    if (!taken.has(preferred.toLowerCase())) {
        return preferred
    }
    const stem = preferred.slice(0, -'.md'.length)
    for (let index = 2; index < NAME_SUFFIX_LIMIT; index += 1) {
        const candidate = `${stem} ${String(index)}.md`
        if (!taken.has(candidate.toLowerCase())) {
            return candidate
        }
    }
    throw new Error(`批次目录内同名文章过多（${preferred}），请先整理目录后再保存`)
}

/** 目录名去重：时间戳相同即追加 -2，保证一个批次独占一个目录 */
function pickFreeDirectoryName(stamp: string, taken: ReadonlySet<string>): string {
    if (!taken.has(stamp.toLowerCase())) {
        return stamp
    }
    for (let index = 2; index < NAME_SUFFIX_LIMIT; index += 1) {
        const candidate = `${stamp}-${String(index)}`
        if (!taken.has(candidate.toLowerCase())) {
            return candidate
        }
    }
    throw new Error(`同一分钟内批次过多（${stamp}），请稍后重试`)
}

/** 列出目录内的名称（小写）：目录不存在时返回空集合，调用方据此判断重名 */
export async function readWechatDirectoryNames(root: vscode.Uri, relativePath: string): Promise<Set<string>> {
    const uri = buildStorageUri(root, toSafeSegments(relativePath, '批次目录'))
    try {
        const entries = await vscode.workspace.fs.readDirectory(uri)
        return new Set(entries.map(([name]) => name.toLowerCase()))
    } catch {
        return new Set()
    }
}

/** 创建批次目录并返回相对存储根的路径，形如 wechat/wx123/post/202611021530 */
export async function createWechatIssueDirectory(root: vscode.Uri, appId: string, now: Date): Promise<string> {
    const parentSegments = [WECHAT_MODULE_DIR, appId, WECHAT_POST_DIR]
    const taken = await readWechatDirectoryNames(root, parentSegments.join('/'))
    const name = pickFreeDirectoryName(buildWechatIssueStamp(now), taken)
    const segments = [...parentSegments, name]
    await vscode.workspace.fs.createDirectory(buildStorageUri(root, segments))
    return segments.join('/')
}

/**
 * 剥掉正文最前的一级标题：标题单独由文件名与库内 title 承载，正文再出现一次会重复。
 * 关键约束：只剥第一处且必须位于正文最前（允许前置空行），正文中间的标题保持原样。
 */
export function stripLeadingHeading(body: string): string {
    return body.replace(/^\s*#\s+.+(\r?\n)+/, '')
}

/** 拼装文章文件：与笔记一致，只有一级标题与正文，不写 frontmatter */
export function buildWechatArticleContent(title: string, body: string): string {
    const trimmed = body.trim()
    return trimmed.length === 0 ? `# ${title}\n` : `# ${title}\n\n${trimmed}\n`
}

/**
 * 拆解文章文件：标题取首个一级标题，正文剥掉标题行。
 * 关键约束：文件里没有元数据块，也不做 frontmatter 兼容——标题的唯一来源就是正文的 `# 标题`。
 */
export function parseWechatArticleContent(content: string): WechatArticleDoc {
    return {
        title: parseTitle(content, '').trim(),
        body: stripLeadingHeading(content).trim(),
    }
}

/** 写文章文件：目录不存在时先建，调用方随后把返回路径落库 */
export async function writeWechatArticleDoc(root: vscode.Uri, relativePath: string, content: string): Promise<void> {
    const uri = buildStorageUri(root, toSafeSegments(relativePath, '文章'))
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(uri.fsPath)))
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content))
}

/**
 * 写批次图片：落到 {批次目录}/images/ 下，返回存储根相对路径。
 * 关键约束：文件名由调用方分配（调用方已避开同名占用），同名直接覆盖；
 * 字节内容不做格式校验，格式由调用方在写入前决定。
 */
export async function writeWechatIssueImage(
    root: vscode.Uri,
    dirPath: string,
    fileName: string,
    bytes: Uint8Array,
): Promise<string> {
    const relativePath = `${dirPath}/${WECHAT_ISSUE_IMAGES_DIR}/${fileName}`
    const uri = buildStorageUri(root, toSafeSegments(relativePath, '批次图片'))
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(uri.fsPath)))
    await vscode.workspace.fs.writeFile(uri, bytes)
    return relativePath
}

/** 读取文件原文：文件缺失返回 null，由调用方决定提示文案 */
export async function readWechatArticleContent(root: vscode.Uri, relativePath: string): Promise<string | null> {
    const uri = buildStorageUri(root, toSafeSegments(relativePath, '文章'))
    try {
        return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8')
    } catch {
        return null
    }
}

/** 读取并拆解文章文件：文件缺失返回 null */
export async function readWechatArticleDoc(root: vscode.Uri, relativePath: string): Promise<WechatArticleDoc | null> {
    const raw = await readWechatArticleContent(root, relativePath)
    return raw === null ? null : parseWechatArticleContent(raw)
}

/**
 * 读取发布用内容：文件是唯一来源，缺失或正文为空一律抛错。
 * 关键约束：标题缺一级标题行时回落到库内标题，避免手改丢了标题后无法发布。
 */
export async function readWechatArticleForPublish(
    root: vscode.Uri,
    relativePath: string,
    fallbackTitle: string,
): Promise<WechatArticleDoc> {
    const doc = await readWechatArticleDoc(root, relativePath)
    if (doc === null) {
        throw new Error(`《${fallbackTitle}》的正文文件已丢失：${relativePath}，请打开文章保存一次以重建`)
    }
    if (doc.body.length === 0) {
        throw new Error(`《${doc.title || fallbackTitle}》的正文文件内容为空：${relativePath}，请补充内容后再发布`)
    }
    return { title: doc.title.length > 0 ? doc.title : fallbackTitle, body: doc.body }
}

/** 删除单个文章文件：文件本就不存在时视为成功 */
export async function removeWechatArticleDoc(root: vscode.Uri, relativePath: string): Promise<void> {
    const uri = buildStorageUri(root, toSafeSegments(relativePath, '文章'))
    if (!(await isPathExisting(uri))) {
        return
    }
    await deleteResource(uri, false)
}

/** 删除整个批次目录：批次已从库里移除，目录删不掉只记日志，不阻断删除 */
export async function removeWechatIssueDirectory(root: vscode.Uri, relativePath: string): Promise<void> {
    const uri = buildStorageUri(root, toSafeSegments(relativePath, '批次目录'))
    if (!(await isPathExisting(uri))) {
        return
    }
    try {
        await deleteResource(uri, true)
    } catch (cause) {
        logger.warn(`批次目录删除失败：${relativePath}（${cause instanceof Error ? cause.message : String(cause)}）`)
    }
}

/** 重命名文章文件：目标名由调用方选好，绝不覆盖既有文件 */
export async function renameWechatArticleDoc(root: vscode.Uri, fromPath: string, toPath: string): Promise<void> {
    const fromUri = buildStorageUri(root, toSafeSegments(fromPath, '文章'))
    const toUri = buildStorageUri(root, toSafeSegments(toPath, '文章'))
    await vscode.workspace.fs.rename(fromUri, toUri, { overwrite: false })
}

/**
 * 改名后把编辑器切到新文件：旧路径已不存在，继续编辑会写到一个被移走的位置。
 * 关键约束：只处理当前活动文档；先打开新文件再关掉旧标签，避免中间态丢失上下文。
 */
export async function focusWechatArticleIfActive(
    root: vscode.Uri,
    previousPath: string,
    nextPath: string,
): Promise<void> {
    const editor = vscode.window.activeTextEditor
    if (editor === undefined) {
        return
    }
    const previousUri = buildStorageUri(root, toSafeSegments(previousPath, '文章'))
    if (editor.document.uri.toString() !== previousUri.toString()) {
        return
    }
    const oldTab = vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .find((tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === previousUri.toString())
    const nextUri = buildStorageUri(root, toSafeSegments(nextPath, '文章'))
    await vscode.window.showTextDocument(nextUri, { preview: false })
    if (oldTab !== undefined) {
        await vscode.window.tabGroups.close(oldTab)
    }
}
