/**
 * 上传服务：选择文件、接收字节流、列举已上传文件与打开上传目录，是上传页唯一的宿主入口。
 * 复用约定：入参收窄与体积校验在 uploadPayload，命名与目录在 media/mediaNaming，读写与列举在 uploadStorage；
 * 回执与列举同构，图片按会话签发 webview URL 供缩略图渲染，非图片文件 url 为 null。
 * 关键约束：上传只落 {root}/uploads/{YYYYMM}/，不写媒体库索引，与 images 下的媒体条目互不影响；
 * 单条失败只跳过该条并回报原因，整批超量直接拒绝，避免半批写盘后才发现超限；
 * 前端只提交字节与展示用文件名，任何路径都由宿主自行拼装。
 */
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { logger } from '@modules/common/logger'
import { buildStorageUri } from '@modules/common/storagePath'
import { UPLOAD_DIR } from '@shared/types/upload'
import type { UploadFileItem, UploadListResult, UploadResult, UploadRevealResult } from '@shared/types/upload'
import { MAX_UPLOAD_COUNT, MAX_UPLOAD_TOTAL_BYTES, parseUploadItem, readCandidateFile } from './uploadPayload'
import { listUploadFiles, saveUploadFile } from './uploadStorage'
import type { UploadCandidate } from './uploadPayload'
import type { StoredUploadFile } from './uploadStorage'

/** 可预览的图片扩展名：只有这些签发 webview URL，其余交给前端用图标表示 */
const PREVIEW_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif'])

/** 把落盘结果转成协议条目：图片带 URL，非图片为 null */
function toUploadItem(
    root: vscode.Uri,
    file: StoredUploadFile,
    toWebviewUri: (uri: vscode.Uri) => string,
): UploadFileItem {
    return {
        path: file.path,
        name: file.name,
        ext: file.ext,
        byteSize: file.byteSize,
        month: file.month,
        createdAt: file.createdAt,
        url: PREVIEW_EXTENSIONS.has(file.ext) ? toWebviewUri(buildStorageUri(root, file.path.split('/'))) : null,
    }
}

/** 入参收窄：非对象一律拒绝 */
function readPayload(payload: unknown, method: string): Record<string, unknown> {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error(`${method} 缺少参数`)
    }
    return payload as Record<string, unknown>
}

export class UploadService {
    /** 上传本地文件：宿主弹选择器，前端不传任何路径 */
    public async pickUpload(toWebviewUri: (uri: vscode.Uri) => string): Promise<UploadResult> {
        const root = resolveStorageRoot()
        const picked = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: true,
            openLabel: '上传',
            defaultUri: root,
        })
        if (picked === undefined || picked.length === 0) {
            return { uploaded: [], skipped: [] }
        }
        const candidates: UploadCandidate[] = []
        const skipped: { name: string; reason: string }[] = []
        for (const uri of picked.slice(0, MAX_UPLOAD_COUNT)) {
            const parsed = await readCandidateFile(uri)
            if (parsed.ok) {
                candidates.push(parsed.candidate)
            } else {
                skipped.push({ name: parsed.name, reason: parsed.reason })
            }
        }
        if (picked.length > MAX_UPLOAD_COUNT) {
            skipped.push({
                name: `${String(picked.length - MAX_UPLOAD_COUNT)} 个文件`,
                reason: `一次最多上传 ${String(MAX_UPLOAD_COUNT)} 个，其余已跳过`,
            })
        }
        const accepted: UploadCandidate[] = []
        let total = 0
        for (const candidate of candidates) {
            if (total + candidate.bytes.byteLength > MAX_UPLOAD_TOTAL_BYTES) {
                skipped.push({ name: candidate.name, reason: '本批总量超过上限，已跳过' })
                continue
            }
            total += candidate.bytes.byteLength
            accepted.push(candidate)
        }
        return this.commit(accepted, skipped, toWebviewUri)
    }

    /**
     * 上传字节流（拖拽与粘贴）：逐条解析后交给统一落盘流程。
     * 关键约束：单条非法只跳过该条并回报原因；整批超量直接拒绝，避免半批写盘后才发现超限。
     */
    public async uploadBytes(payload: unknown, toWebviewUri: (uri: vscode.Uri) => string): Promise<UploadResult> {
        const raw = readPayload(payload, 'upload/bytes').items
        const list = Array.isArray(raw) ? raw : []
        if (list.length === 0) {
            throw new Error('缺少待上传的文件')
        }
        if (list.length > MAX_UPLOAD_COUNT) {
            throw new Error(`一次最多上传 ${String(MAX_UPLOAD_COUNT)} 个文件`)
        }
        const candidates: UploadCandidate[] = []
        const skipped: { name: string; reason: string }[] = []
        for (const item of list) {
            const parsed = parseUploadItem(item)
            if (parsed.ok) {
                candidates.push(parsed.candidate)
            } else {
                skipped.push({ name: parsed.name, reason: parsed.reason })
            }
        }
        const total = candidates.reduce((sum, candidate) => sum + candidate.bytes.byteLength, 0)
        if (total > MAX_UPLOAD_TOTAL_BYTES) {
            throw new Error(`本次上传总量超过 ${String(MAX_UPLOAD_TOTAL_BYTES / 1024 / 1024)} MB`)
        }
        return this.commit(candidates, skipped, toWebviewUri)
    }

    /** 列举已上传文件：目录缺失返回空清单，页面据此展示空态 */
    public async list(toWebviewUri: (uri: vscode.Uri) => string): Promise<UploadListResult> {
        const root = resolveStorageRoot()
        const files = await listUploadFiles(root)
        return { items: files.map((file) => toUploadItem(root, file, toWebviewUri)) }
    }

    /** 打开上传目录：目录不存在时先建出来，命令不可用只回报 false */
    public async reveal(): Promise<UploadRevealResult> {
        const dir = buildStorageUri(resolveStorageRoot(), [UPLOAD_DIR])
        await vscode.workspace.fs.createDirectory(dir)
        try {
            await vscode.commands.executeCommand('revealFileInOS', dir)
            return { opened: true }
        } catch (error) {
            logger.warn(`打开上传目录失败：${dir.fsPath}（${error instanceof Error ? error.message : String(error)}）`)
            return { opened: false }
        }
    }

    /**
     * 上传编排：逐条落盘，单条失败只记回执。
     * 关键约束：不写任何索引——uploads 与媒体库无关，磁盘即清单。
     */
    private async commit(
        candidates: readonly UploadCandidate[],
        skipped: readonly { name: string; reason: string }[],
        toWebviewUri: (uri: vscode.Uri) => string,
    ): Promise<UploadResult> {
        const root = resolveStorageRoot()
        const uploaded: UploadFileItem[] = []
        const failures = [...skipped]
        for (const candidate of candidates) {
            try {
                const file = await saveUploadFile(root, candidate)
                uploaded.push(toUploadItem(root, file, toWebviewUri))
            } catch (error) {
                failures.push({
                    name: candidate.name,
                    reason: error instanceof Error ? error.message : '上传失败',
                })
                logger.error(`文件上传失败：${candidate.name}`, error)
            }
        }
        if (uploaded.length > 0) {
            logger.info(`文件上传完成：${String(uploaded.length)} 个`)
        }
        return { uploaded, skipped: failures }
    }
}
