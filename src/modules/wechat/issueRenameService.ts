/**
 * 批次文章重命名：保存时让文件名与库内标题跟随正文的一级标题，与笔记维持同一条「文件名 = 标题」规则。
 * 复用约定：标题与正文拆解走 ./issueDocument（与发布同源），文件名合法化与同名顺延沿用笔记口径，
 * 记录定位走 db/issueRepository 的 file_path 反查，路径构造走 common/storagePath。
 * 关键约束：只处理 wechat/{appid}/post/ 下的 Markdown，其它文件原样放过；
 * 标题为空或文件名已一致（忽略大小写）即跳过；目标名被占用时顺延序号，绝不覆盖；
 * 同一文件的连续保存事件按路径去重，重命名后若正在编辑该文档，把编辑器切到新文件。
 */
import * as path from 'node:path'
import { resolveStorageRoot } from '@modules/common/config'
import { logger } from '@modules/common/logger'
import { WECHAT_MODULE_DIR } from '@shared/types/wechat'
import {
    findWechatArticleByFilePath,
    updateWechatArticleFilePath,
    updateWechatArticleTitle,
} from './db/issueRepository'
import {
    buildWechatDocFileName,
    focusWechatArticleIfActive,
    parseWechatArticleContent,
    readWechatDirectoryNames,
    renameWechatArticleDoc,
} from './issueDocument'
import type Database from 'better-sqlite3'
import type * as vscode from 'vscode'

/** 批次目录的层级下标：wechat/{appid}/post/{时间戳}/{文件} */
const POST_DIR_SEGMENT_INDEX = 2

/** 批次文章路径的最小段数：少于它就落不到具体文章 */
const ISSUE_ARTICLE_DEPTH = 5

/** 判定是否批次文章：只认 wechat/{appid}/post/ 下的 Markdown */
export function isWechatIssueArticlePath(relativePath: string): boolean {
    const segments = relativePath.split('/')
    return (
        relativePath.toLowerCase().endsWith('.md') &&
        segments.length >= ISSUE_ARTICLE_DEPTH &&
        segments[0] === WECHAT_MODULE_DIR &&
        segments[POST_DIR_SEGMENT_INDEX] === 'post'
    )
}

/** 取存储根口径的相对路径：不在存储根内返回 null */
function toStorageRelative(filePath: string): string | null {
    const root = resolveStorageRoot()
    const relativePath = path.relative(root.fsPath, filePath).split(path.sep).join('/')
    return relativePath.startsWith('..') || path.isAbsolute(relativePath) ? null : relativePath
}

export class WechatIssueRenameService {
    /** 处理中的文件：保存事件可能连续到达，重命名过程中再次触发一律丢弃 */
    private readonly pending = new Set<string>()

    public constructor(private readonly db: Database.Database) {}

    /** 保存钩子：标题变了就同步库与文件名，失败只记日志，不打断保存 */
    public async handleSave(document: vscode.TextDocument): Promise<void> {
        if (document.isUntitled || document.uri.scheme !== 'file') {
            return
        }
        const relativePath = toStorageRelative(document.uri.fsPath)
        if (relativePath === null || !isWechatIssueArticlePath(relativePath)) {
            return
        }
        if (this.pending.has(relativePath)) {
            return
        }
        const article = findWechatArticleByFilePath(this.db, relativePath)
        if (article === null) {
            return
        }
        const title = parseWechatArticleContent(document.getText()).title
        if (title.length === 0) {
            return
        }

        this.pending.add(relativePath)
        try {
            if (title !== article.title) {
                updateWechatArticleTitle(this.db, article.id, title)
            }
            const nextPath = await this.resolveRenamedPath(relativePath, title)
            if (nextPath === null) {
                return
            }
            updateWechatArticleFilePath(this.db, article.id, nextPath)
            logger.info(`公众号文章已按标题重命名：${relativePath} → ${nextPath}`)
            await focusWechatArticleIfActive(resolveStorageRoot(), relativePath, nextPath)
        } catch (cause) {
            logger.warn(
                `公众号文章重命名失败：${relativePath}（${cause instanceof Error ? cause.message : String(cause)}）`,
            )
        } finally {
            this.pending.delete(relativePath)
        }
    }

    /** 算出目标路径并改名：文件名已一致时返回 null，调用方无需更新库 */
    private async resolveRenamedPath(relativePath: string, title: string): Promise<string | null> {
        const separator = relativePath.lastIndexOf('/')
        if (separator <= 0) {
            return null
        }
        const root = resolveStorageRoot()
        const dirPath = relativePath.slice(0, separator)
        const currentName = relativePath.slice(separator + 1)
        const taken = await readWechatDirectoryNames(root, dirPath)
        taken.delete(currentName.toLowerCase())
        const fileName = buildWechatDocFileName(title, taken)
        if (fileName.toLowerCase() === currentName.toLowerCase()) {
            return null
        }
        const nextPath = `${dirPath}/${fileName}`
        await renameWechatArticleDoc(root, relativePath, nextPath)
        return nextPath
    }
}
