/**
 * 素材服务：把正文里的本地图片上传为公众号永久素材，并按内容 hash 复用已上传结果。
 * 复用约定：上传走 client 的 uploadWechatImageMaterial，映射读写走 db/materialRepository，
 * Token 由 tokenService 统一取用（含并发合并），本地路径以存储根为基准解析。
 * 关键约束：只处理 jpg/png 且 ≤10MB 的本地文件，其余一律降级为提示而不是中断整篇；
 * 外链图片不上传（平台会屏蔽或存在防盗链），保留原地址并由调用方提示用户；
 * 解析后的路径必须落在存储根内，越界直接判为不可用，避免把任意本地文件传上公网。
 */
import { createHash, randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import * as path from 'node:path'
import { uploadWechatImageMaterial } from './client'
import { findWechatMaterial, insertWechatMaterial } from './db/materialRepository'
import type { WechatSecretStore } from './credentials'
import type { WechatTokenService } from './tokenService'
import type Database from 'better-sqlite3'

/** 微信永久图片素材上限 */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/** 支持的扩展名 → MIME：平台只接受 jpg/png，gif 与 webp 会被拒绝 */
const SUPPORTED_IMAGE_MIME: Readonly<Record<string, string>> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
}

/** 外链判定：带协议的绝对地址与协议相对地址都不上传 */
const EXTERNAL_PATTERN = /^(?:https?:)?\/\//i

/** data URI：内联图无法作为素材上传 */
const DATA_URI_PATTERN = /^data:/i

/** 图片定位结果：外链保留、本地可上传、无法使用（调用方据此给提示） */
export type WechatImageLocation =
    { kind: 'external' } | { kind: 'local'; filePath: string } | { kind: 'invalid'; reason: string }

/** 单张图片的处理结果 */
export type WechatImageEnsureResult =
    | { kind: 'uploaded'; url: string; mediaId: string; reused: boolean }
    | { kind: 'external' }
    | { kind: 'missing'; reason: string }

/** 服务依赖：库、密钥、Token 缓存与存储根解析（存储根可随配置变更，故用函数而非快照） */
export interface WechatMaterialServiceDeps {
    db: Database.Database
    secrets: WechatSecretStore
    tokens: WechatTokenService
    resolveRoot: () => string
}

/** 解码百分号转义：非法编码时保留原样，由后续的存在性检查兜底 */
function decodePath(value: string): string {
    try {
        return decodeURIComponent(value)
    } catch {
        return value
    }
}

/**
 * 定位 Markdown 中的图片地址：区分外链、本地文件与非法路径。
 * 规则：`/` 开头按存储根相对路径解析（Markdown 作者的常见写法），盘符或正斜杠绝对路径按原样使用，
 * 其余相对路径相对于源文档所在目录（手写稿没有源文档，落在存储根）。
 * 安全约束：解析结果必须仍在存储根内，越界直接判为非法。
 */
export function locateWechatImage(imageUrl: string, sourcePath: string | null, rootPath: string): WechatImageLocation {
    const trimmed = imageUrl.trim()
    if (trimmed.length === 0) {
        return { kind: 'invalid', reason: '图片地址为空' }
    }
    if (EXTERNAL_PATTERN.test(trimmed)) {
        return { kind: 'external' }
    }
    if (DATA_URI_PATTERN.test(trimmed)) {
        return { kind: 'invalid', reason: '内联 base64 图片无法上传，请改为本地文件' }
    }

    const root = path.resolve(rootPath)
    // 去掉查询串与锚点（?raw=1、#preview），再解码 %20 之类的转义
    const withoutQuery = trimmed.split(/[?#]/)[0] ?? ''
    const decoded = decodePath(withoutQuery)
    if (decoded.length === 0) {
        return { kind: 'invalid', reason: '图片地址无法解析' }
    }

    const baseDir = sourcePath === null ? root : path.dirname(path.join(root, ...sourcePath.split('/')))
    const candidate = decoded.startsWith('/')
        ? path.join(root, decoded)
        : path.isAbsolute(decoded)
          ? path.normalize(decoded)
          : path.resolve(baseDir, decoded)

    const relative = path.relative(root, candidate)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        return { kind: 'invalid', reason: '图片不在文档保存目录内，未上传' }
    }
    return { kind: 'local', filePath: candidate }
}

/** 图片字节的内容 hash：同一张图在同账号下只上传一次 */
function hashBytes(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex').slice(0, 16)
}

export class WechatMaterialService {
    public constructor(private readonly deps: WechatMaterialServiceDeps) {}

    /**
     * 确保一张图片可用：本地上传或复用，外链原样保留，不可用时给出原因。
     * 关键约束：不抛错——单张图失败不应让整篇推送失败，由调用方汇总为提示。
     */
    public async ensureImage(input: {
        accountId: string
        appId: string
        sourcePath: string | null
        imageUrl: string
    }): Promise<WechatImageEnsureResult> {
        const location = locateWechatImage(input.imageUrl, input.sourcePath, this.deps.resolveRoot())
        if (location.kind === 'external') {
            return { kind: 'external' }
        }
        if (location.kind === 'invalid') {
            return { kind: 'missing', reason: location.reason }
        }
        return this.uploadLocalImage(input, location.filePath)
    }

    /** 上传或复用本地图片：先按 hash 查表，未命中才走一次网络 */
    private async uploadLocalImage(
        input: { accountId: string; appId: string },
        filePath: string,
    ): Promise<WechatImageEnsureResult> {
        const extension = path.extname(filePath).toLowerCase()
        const mimeType = SUPPORTED_IMAGE_MIME[extension]
        if (mimeType === undefined) {
            return { kind: 'missing', reason: `仅支持 jpg/png，${path.basename(filePath)} 未上传` }
        }

        let bytes: Buffer
        try {
            const info = await stat(filePath)
            if (!info.isFile()) {
                return { kind: 'missing', reason: `${path.basename(filePath)} 不是文件，未上传` }
            }
            if (info.size > MAX_IMAGE_BYTES) {
                return { kind: 'missing', reason: `${path.basename(filePath)} 超过 10MB，未上传` }
            }
            bytes = await readFile(filePath)
        } catch {
            return { kind: 'missing', reason: `${path.basename(filePath)} 已不存在，未上传` }
        }

        const localHash = hashBytes(bytes)
        const cached = findWechatMaterial(this.deps.db, input.accountId, localHash, 'image')
        if (cached !== null) {
            return { kind: 'uploaded', url: cached.url, mediaId: cached.media_id, reused: true }
        }

        const appSecret = await this.deps.secrets.read(input.accountId)
        if (appSecret === undefined || appSecret.length === 0) {
            throw new Error('公众号密钥缺失，无法上传素材')
        }
        const tokenOutcome = await this.deps.tokens.getToken({
            accountId: input.accountId,
            appId: input.appId,
            appSecret,
        })
        if (!tokenOutcome.ok) {
            throw new Error(tokenOutcome.message)
        }

        const outcome = await uploadWechatImageMaterial(tokenOutcome.token.accessToken, {
            bytes,
            fileName: path.basename(filePath),
            mimeType,
        })
        if (!outcome.ok) {
            return { kind: 'missing', reason: `${path.basename(filePath)} 上传失败：${outcome.message}` }
        }

        insertWechatMaterial(this.deps.db, {
            id: `mat-${randomUUID().replace(/-/g, '').slice(0, 10)}`,
            accountId: input.accountId,
            localHash,
            mediaId: outcome.mediaId,
            url: outcome.url,
            type: 'image',
            name: path.basename(filePath),
            sizeBytes: bytes.byteLength,
            createdAt: new Date().toISOString(),
        })
        return { kind: 'uploaded', url: outcome.url, mediaId: outcome.mediaId, reused: false }
    }
}
