/**
 * 标注库的事件接线：文件删除置失效、文件改名迁移路径、文档保存后校正锚点。
 * 复用约定：写操作全走 annotationRepository，锚点算法走 annotationAnchors，本文件只做事件分发。
 * 关键约束：三个监听都必须能失败无感——标注库不可用（存储根未配置、库损坏）时直接跳过，
 * 不能让一个可选功能把保存流程或文件操作拖垮；相对路径口径与编辑区上报一致，否则匹配不上库里记录。
 */
import * as vscode from 'vscode'
import { logger } from '@modules/common/logger'
import { relocateDocumentAnnotations } from './annotationAnchors'
import { markDocOrphaned, renameAnnotationDoc } from './annotationRepository'
import { readEditorSnapshot } from './editorDocService'
import type { AnnotationDatabase } from './db/connection'

/** 相对路径：与编辑区写入标注时同一口径（asRelativePath 不带 workspace 前缀） */
function toDocPath(uri: vscode.Uri): string {
    return vscode.workspace.asRelativePath(uri, false)
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

export function registerAnnotationWatchers(
    context: vscode.ExtensionContext,
    dbProvider: () => AnnotationDatabase,
): void {
    context.subscriptions.push(
        vscode.workspace.onDidDeleteFiles((event) => {
            try {
                const db = dbProvider().db
                for (const uri of event.files) {
                    const marked = markDocOrphaned(db, toDocPath(uri))
                    if (marked > 0) {
                        logger.info(`标注已置失效：${toDocPath(uri)}（${String(marked)} 条）`)
                    }
                }
            } catch (error) {
                logger.warn(`标注失效标记失败：${describeError(error)}`)
            }
        }),
    )

    context.subscriptions.push(
        vscode.workspace.onDidRenameFiles((event) => {
            try {
                const db = dbProvider().db
                for (const file of event.files) {
                    const moved = renameAnnotationDoc(db, toDocPath(file.oldUri), toDocPath(file.newUri))
                    if (moved > 0) {
                        logger.info(
                            `标注已随文件迁移：${toDocPath(file.oldUri)} → ${toDocPath(file.newUri)}（${String(moved)} 条）`,
                        )
                    }
                }
            } catch (error) {
                logger.warn(`标注迁移失败：${describeError(error)}`)
            }
        }),
    )

    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((document) => {
            if (document.languageId !== 'markdown' || document.uri.scheme !== 'file') {
                return
            }
            void (async (): Promise<void> => {
                try {
                    const db = dbProvider().db
                    const docPath = toDocPath(document.uri)
                    const snapshot = await readEditorSnapshot(document.getText(), document.version, docPath)
                    const updated = relocateDocumentAnnotations(db, docPath, snapshot.blocks)
                    if (updated > 0) {
                        logger.info(`标注锚点已校正：${docPath}（${String(updated)} 条）`)
                    }
                } catch (error) {
                    logger.warn(`标注锚点校正失败：${describeError(error)}`)
                }
            })()
        }),
    )
}
