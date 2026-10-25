/**
 * 角色设定图服务：先用文本模型写画面描述，再经图像通道路由出图，按人物建目录落盘并返回 webview 可用 URL。
 * 复用约定：文本描述经 ./ai/portraitSceneGenerator（通道由注入的 AiProvider 提供），出图经 ./ai/imageProvider 的入口
 * （唯一实现为 CodeBuddy 的 ImageGen），提示词复用 ./ai/portraitPrompt，目录名与配额键取自 ./constants，
 * 配额读写经 ../common/db/quotaRepository，路径一律经 common/storagePath 做白名单校验；URL 转换由调用方注入。
 * 关键约束：每次出图都重新挑一组画面变化（动作/地点/光线/姿态），文本通道失败时用同一组变化拼模板，
 * 保证同一角色反复出图也不撞画面；描述不计配额，限额只针对图片张数；
 * 图片平铺在 press/{作品名}/Portraits/ 下，文件名为 portrait-{8位角色标识}-{年月日时分秒}.扩展名，
 * 角色归属由文件名里的角色段解析（不再按角色分子目录），跟随作品目录（删除作品即一并清理）；
 * 目录是图片的唯一事实来源：生成完成即落盘，关闭弹窗不丢结果，列举以磁盘为准；
 * 删除、复制与插入只接受 press/{作品名}/{Images|Cover|Portraits} 下的四段白名单路径，删除优先走回收站，
 * 并顺带清掉同名侧车；
 * 复制经平台命令写入系统剪贴板（webview 内写图片受 CSP 与权限限制）；同一时刻只允许一个生成请求。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as vscode from 'vscode'
import { buildPortraitPrompt } from './ai/portraitPrompt'
import { generateSceneWithAi } from './ai/portraitSceneGenerator'
import { buildSceneMessages, sanitizeScene } from './ai/portraitScenePrompt'
import { formatVariation, pickVariation } from './ai/portraitVariation'
import { IMAGE_DIR_NAMES, IMAGE_QUOTA_KEYS, PORTRAIT_DIR } from './constants'
import { listImageFiles } from './imageDirScan'
import { deleteSidecarOf } from './imageSidecar'
import type { ImageProviderRouter } from './ai/imageProvider'
import type { PortraitVariation } from './ai/portraitVariation'
import type {
    CharacterPortrait,
    PortraitCopyResult,
    PortraitGalleryItem,
    PortraitGalleryResult,
    PortraitGenerateRequest,
    PortraitGenerateResult,
    PortraitInsertResult,
    PortraitListResult,
    PortraitStyle,
} from '../../shared/types/press'
import type { AiProvider } from '../ai/provider'
import type { UsageRecorder } from '../ai/usageRecorder'
import type Database from 'better-sqlite3'
import { parseImageCharacterId } from '../../shared/types/imagegen'
import { DEFAULT_PORTRAIT_STYLE, PORTRAIT_STYLES, isPressCharacterId } from '../../shared/types/press'
import { getSelectedCodebuddyModel } from '../ai/providers/codebuddyModels'
import { summarizeMessages } from '../ai/usageRecorder'
import { getZhaiConfig, resolveStorageRoot } from '../common/config'
import { consumeToday, readUsedToday } from '../common/db/quotaRepository'
import { logger } from '../common/logger'
import { PRESS_MODULE_DIR, readProjectSegments } from '../common/projectPath'
import { readText, readTextList } from '../common/readInput'
import { buildStorageUri, deleteResource, toSafeSegments } from '../common/storagePath'

/** 角色卡相对路径的段数：press/{作品名}/Portraits/{文件名} */
const PORTRAIT_SEGMENT_COUNT = 4
/** 设定图文件名前缀：后接角色标识与时间戳，扁平目录靠它识别归属 */
const PORTRAIT_FILE_PREFIX = 'portrait'
/** 短字段长度上限 */
const MAX_SHORT_TEXT = 64
/** 长字段长度上限 */
const MAX_LONG_TEXT = 400
/** 相对路径长度上限：作品名与人物标识相叠加高，留出余量 */
const MAX_PATH_LENGTH = 320
/** 剪贴板命令超时：外部进程卡住时不阻塞界面 */
const CLIPBOARD_TIMEOUT_MS = 8_000
/** Windows 剪贴板脚本：路径经环境变量传入，避免拼进命令串；SetImage 要求 STA 线程 */
const WINDOWS_CLIPBOARD_SCRIPT = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$image = [System.Drawing.Image]::FromFile($env:ZHAI_CLIPBOARD_IMAGE)',
    'try { [System.Windows.Forms.Clipboard]::SetImage($image) } finally { $image.Dispose() }',
].join('; ')
/** macOS 剪贴板类型码：不在表内的扩展名直接视为不支持 */
const MACOS_CLIPBOARD_CLASS: Readonly<Record<string, string>> = { png: 'PNGf', jpg: 'JPEG', jpeg: 'JPEG' }
/** Linux 剪贴板 MIME：xclip 按类型写入，未装 xclip 时回落不支持 */
const LINUX_CLIPBOARD_MIME: Readonly<Record<string, string>> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
}
/** 剪贴板命令随包注入的 promise 化执行器 */
const execFileAsync = promisify(execFile)

export class PortraitService {
    /** 进行中的生成请求：用于 pressAi/aiPortrait/abort 取消 */
    private activeRequest: AbortController | null = null
    /** 上一张用过的画面变化：只在本进程内记忆，用来保证连续两次不撞在同一个动作上 */
    private lastVariation: PortraitVariation | null = null

    public constructor(
        private readonly db: Database.Database,
        private readonly provider: AiProvider,
        private readonly router: ImageProviderRouter,
        private readonly usageRecorder: UsageRecorder,
    ) {}

    /**
     * 生成一张角色设定图并落盘。
     * @param toWebviewUri 把磁盘 Uri 转成 webview 可访问 URL 的转换器
     */
    public async generate(
        payload: unknown,
        toWebviewUri: (uri: vscode.Uri) => string,
    ): Promise<PortraitGenerateResult> {
        if (this.activeRequest) {
            throw new Error('已有生成中的角色卡请求，请等待完成或先取消')
        }
        const request = normalizePortraitRequest(payload)
        const config = getZhaiConfig()
        this.assertQuota()
        const controller = new AbortController()
        this.activeRequest = controller
        const startedAt = Date.now()
        logger.info(`角色卡生成开始：${request.name}（${config.imageSize}）`)
        try {
            // 每次生成都重新挑一组画面变化：人物卡不变时，这是让画面与动作不重复的唯一差异
            const variation = pickVariation(this.lastVariation)
            this.lastVariation = variation
            // 两段式：先让文本模型按这组变化写画面，再出图；文本通道不可用时用同一组变化拼模板
            const scene = await this.describeScene(request, variation, controller.signal)
            const prompt = buildPortraitPrompt(request, scene.text)
            const artifact = await this.router.generate({
                prompt,
                size: config.imageSize,
                signal: controller.signal,
            })
            // 出图按张计费：图像消耗单独成行，积分与其他入口一样按请求 id 从 CLI 会话记录回填
            this.usageRecorder.record({
                module: 'image',
                model: getSelectedCodebuddyModel(),
                usage: artifact.usage ?? null,
                meta: artifact.meta ?? null,
                prompt,
                startedAt: artifact.startedAt ?? startedAt,
            })
            logger.info(`角色卡通道：codebuddy（${scene.fromAi ? 'AI 画面描述' : '模板变化描述'}）：${scene.text}`)
            const id = `${PORTRAIT_FILE_PREFIX}-${request.characterId}-${formatPortraitStamp(new Date())}`
            const extension = artifact.extension
            // 平铺落到当前作品目录的 Portraits 下，作品删除时随目录一并清理
            const segments = [...readProjectSegments(request.dirPath), PORTRAIT_DIR, `${id}.${extension}`]
            const root = resolveStorageRoot()
            await vscode.workspace.fs.createDirectory(buildStorageUri(root, segments.slice(0, -1)))
            const target = buildStorageUri(root, segments)
            await vscode.workspace.fs.writeFile(target, artifact.bytes)
            consumeToday(this.db, IMAGE_QUOTA_KEYS)
            logger.info(`角色卡生成完成：耗时 ${Date.now() - startedAt}ms，${artifact.bytes.byteLength} 字节`)
            return {
                portrait: {
                    id,
                    path: segments.join('/'),
                    url: toWebviewUri(target),
                    createdAt: new Date().toISOString(),
                },
            }
        } catch (error) {
            // 取消与超时的文案由执行器给出，此处只补日志便于排查服务商耗时
            logger.error(`角色卡生成失败：耗时 ${Date.now() - startedAt}ms`, error)
            throw error
        } finally {
            this.activeRequest = null
        }
    }

    /**
     * 列举某个角色目录下的全部设定图：目录不存在视为空，按文件修改时间降序返回（最新在前）。
     * 磁盘是唯一事实来源，因此关闭弹窗期间完成的生成同样能被读回。
     * @param toWebviewUri 把磁盘 Uri 转成 webview 可访问 URL 的转换器
     */
    public async list(payload: unknown, toWebviewUri: (uri: vscode.Uri) => string): Promise<PortraitListResult> {
        const { dirPath, characterId } = normalizePortraitListRequest(payload)
        const portraits = await this.readPortraits(readProjectSegments(dirPath), toWebviewUri)
        return { portraits: portraits.filter((portrait) => parseImageCharacterId(portrait.id) === characterId) }
    }

    /**
     * 一次性列举作品下全部角色的设定图，供人物列表批量显示封面。
     * 关键约束：图片平铺在 Portraits 下，角色归属由文件名里的角色段解析；
     * 不符合命名规则的其它图片不参与分组，顺序与编辑弹窗里的图库完全一致。
     */
    public async listGallery(
        payload: unknown,
        toWebviewUri: (uri: vscode.Uri) => string,
    ): Promise<PortraitGalleryResult> {
        const dirPath = readProjectDirPath(payload, 'pressAi/listPortraitGallery')
        const galleries: Record<string, PortraitGalleryItem[]> = {}
        for (const portrait of await this.readPortraits(readProjectSegments(dirPath), toWebviewUri)) {
            const characterId = parseImageCharacterId(portrait.id)
            if (characterId === null) {
                continue
            }
            const list = galleries[characterId] ?? []
            list.push({ id: portrait.id, url: portrait.url })
            galleries[characterId] = list
        }
        return { galleries }
    }

    /**
     * 扫描设定图目录：目录不存在返回空数组，读取失败的文件跳过。
     * 关键约束：不抛错——并发删除或权限问题只影响单张图，不能让整次列举失败；
     * 图片 id 取文件名去掉扩展名，角色归属由调用方按其中的角色段解析。
     */
    private async readPortraits(
        projectSegments: string[],
        toWebviewUri: (uri: vscode.Uri) => string,
    ): Promise<CharacterPortrait[]> {
        const portraits: CharacterPortrait[] = []
        // 统一目录 Images 与两个旧目录一并扫描，新图与历史图出现在同一个列表里
        for (const file of await listImageFiles(projectSegments, IMAGE_DIR_NAMES)) {
            const id = file.name.replace(/\.[^.]+$/u, '')
            // 只收角色图：普通图片与手工图不属于任何角色
            if (parseImageCharacterId(id) === null) {
                continue
            }
            try {
                const stat = await vscode.workspace.fs.stat(file.uri)
                portraits.push({
                    id,
                    path: file.segments.join('/'),
                    url: toWebviewUri(file.uri),
                    createdAt: new Date(stat.mtime).toISOString(),
                })
            } catch {
                // 并发删除时文件可能已消失，跳过而不是让整次扫描失败
            }
        }
        // 最新在前：新生成的图出现在网格首位，与生成时占位框的位置一致
        portraits.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        return portraits
    }

    /**
     * 把图片插入当前编辑器光标处：先复制到文档同级的 assets 目录，再写入 Markdown 图片语法。
     * 没有活动编辑器时返回 no-editor，由前端静默忽略；只支持已保存的 Markdown 文档，其余情况返回原因；
     * 插入成功后再把焦点交回文档并选中刚写入的语法，避免编辑器在后台时看不到结果。
     */
    public async insertIntoEditor(payload: unknown): Promise<PortraitInsertResult> {
        const path = readPortraitPath(payload)
        const segments = toSafeSegments(path, '角色卡')
        const [moduleDir, projectName, portraitDir, fileName] = segments
        if (
            segments.length !== PORTRAIT_SEGMENT_COUNT ||
            moduleDir !== PRESS_MODULE_DIR ||
            portraitDir === undefined ||
            !IMAGE_DIR_NAMES.includes(portraitDir) ||
            !projectName ||
            !fileName
        ) {
            throw new Error(`角色卡路径非法：${path}`)
        }
        const editor = resolveInsertTarget()
        if (!editor) {
            return { inserted: false, reason: 'no-editor' }
        }
        const document = editor.document
        if (document.uri.scheme !== 'file') {
            return { inserted: false, reason: 'unsaved' }
        }
        if (document.languageId !== 'markdown') {
            return { inserted: false, reason: 'not-markdown' }
        }
        const source = buildStorageUri(resolveStorageRoot(), segments)
        const assetDirectory = vscode.Uri.joinPath(document.uri, '..', 'assets')
        try {
            await vscode.workspace.fs.createDirectory(assetDirectory)
            const bytes = await vscode.workspace.fs.readFile(source)
            await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(assetDirectory, fileName), bytes)
        } catch (error) {
            logger.error(`角色卡插入失败：复制到文章目录出错（${path}）`, error)
            return { inserted: false, reason: 'failed' }
        }
        const snippet = `![角色设定图](assets/${fileName})`
        const insertAt = editor.selection.active
        const didInsert = await editor.edit((builder) => {
            builder.insert(insertAt, snippet)
        })
        if (!didInsert) {
            return { inserted: false, reason: 'failed' }
        }
        const range = new vscode.Range(insertAt, insertAt.translate(0, snippet.length))
        await vscode.window.showTextDocument(document, { viewColumn: editor.viewColumn, selection: range })
        return { inserted: true }
    }

    /**
     * 把设定图写入系统剪贴板：webview 内写图片受 CSP 与剪贴板权限限制，改由宿主按平台调用原生能力。
     * 只接受 press/{作品名}/Portraits 下的四段相对路径；平台不支持或依赖缺失时返回原因，由前端提示。
     */
    public async copyToClipboard(payload: unknown): Promise<PortraitCopyResult> {
        const path = readPortraitPath(payload)
        const segments = toSafeSegments(path, '角色卡')
        const [moduleDir, projectName, portraitDir, fileName] = segments
        if (
            segments.length !== PORTRAIT_SEGMENT_COUNT ||
            moduleDir !== PRESS_MODULE_DIR ||
            portraitDir === undefined ||
            !IMAGE_DIR_NAMES.includes(portraitDir) ||
            !projectName ||
            !fileName
        ) {
            throw new Error(`角色卡路径非法：${path}`)
        }
        const target = buildStorageUri(resolveStorageRoot(), segments)
        const extension = fileName.split('.').pop()?.toLowerCase() ?? ''
        const outcome = await writeImageToClipboard(target.fsPath, extension)
        if (outcome === 'failed') {
            logger.error(`角色卡复制失败：写入系统剪贴板出错（${path}）`)
        }
        return outcome === 'copied' ? { copied: true } : { copied: false, reason: outcome }
    }

    /** 取消进行中的生成 */
    public abort(): { aborted: boolean } {
        if (!this.activeRequest) {
            return { aborted: false }
        }
        this.activeRequest.abort()
        return { aborted: true }
    }

    /** 删除一张已落盘的角色设定图：优先回收站，不支持时退化为直接删除 */
    public async remove(payload: unknown): Promise<{ removed: boolean }> {
        const path = readPortraitPath(payload)
        const segments = toSafeSegments(path, '角色卡')
        const fileName = segments[3] ?? ''
        if (
            segments.length !== PORTRAIT_SEGMENT_COUNT ||
            segments[0] !== PRESS_MODULE_DIR ||
            segments[2] === undefined ||
            !IMAGE_DIR_NAMES.includes(segments[2]) ||
            !segments[1] ||
            parseImageCharacterId(fileName.replace(/\.[^.]+$/u, '')) === null
        ) {
            throw new Error(`角色卡路径非法：${path}`)
        }
        const target = buildStorageUri(resolveStorageRoot(), segments)
        try {
            await deleteResource(target, false)
        } catch {
            return { removed: false }
        }
        // 图片删掉后侧车已无处可依，一并清理；失败只记日志，不影响删除结果
        await deleteSidecarOf(target)
        return { removed: true }
    }

    /**
     * 清理某个角色的全部设定图：删除角色时随角色块一并清理，避免留下无人引用的图片。
     * 关键约束：只删文件名角色段匹配且符合命名规范的文件，手工放入的其它图片不受影响。
     */
    public async removeByCharacterId(dirPath: string, characterId: string): Promise<{ removed: number }> {
        const projectSegments = readProjectSegments(dirPath)
        const root = resolveStorageRoot()
        let removed = 0
        // 三个图片目录都要清理：新图落在 Images，历史图还在 Cover / Portraits
        // 这里刻意不过滤扩展名：同名的出图参数侧车（.json）也要随图片一并清掉，故不走图片列举入口
        for (const dirName of IMAGE_DIR_NAMES) {
            const dirSegments = [...projectSegments, dirName]
            let entries: [string, vscode.FileType][]
            try {
                entries = await vscode.workspace.fs.readDirectory(buildStorageUri(root, dirSegments))
            } catch {
                continue
            }
            for (const [name, type] of entries) {
                if (type !== vscode.FileType.File) {
                    continue
                }
                if (parseImageCharacterId(name.replace(/\.[^.]+$/u, '')) !== characterId) {
                    continue
                }
                try {
                    await deleteResource(buildStorageUri(root, [...dirSegments, name]), false)
                    removed += 1
                } catch (error) {
                    logger.error(`角色图清理失败：${name}`, error)
                }
            }
        }
        return { removed }
    }

    /**
     * 先让文本模型按本次变化写画面描述：未就绪、超时、输出为空或调用失败都回退到模板变化描述，
     * 保证出图不被拖垮；两条路径共用同一组变化，因此「文本通道失败后每张图都一样」不会再发生。
     * 这一步不计配额——成本最终落在出图上，限额仍以图片张数为准。
     */
    private async describeScene(
        request: PortraitGenerateRequest,
        variation: PortraitVariation,
        signal: AbortSignal,
    ): Promise<{ text: string; fromAi: boolean }> {
        const fallback = formatVariation(variation)
        try {
            const status = await this.provider.checkReady()
            if (!status.ready) {
                logger.info(`角色卡画面描述跳过：${status.reason ?? 'AI 通道未就绪'}；改用模板变化：${fallback}`)
                return { text: fallback, fromAi: false }
            }
            const startedAt = Date.now()
            const result = await generateSceneWithAi({
                provider: this.provider,
                model: getSelectedCodebuddyModel(),
                request,
                variation,
                signal,
            })
            const scene = sanitizeScene(result.content)
            if (scene.length === 0) {
                logger.info(`角色卡画面描述为空，回退模板变化：${fallback}`)
                return { text: fallback, fromAi: false }
            }
            this.usageRecorder.record({
                module: 'scene',
                model: getSelectedCodebuddyModel(),
                usage: result.usage,
                meta: result.meta,
                prompt: summarizeMessages(buildSceneMessages(request, variation)),
                startedAt,
            })
            logger.info(`角色卡画面描述（${Date.now() - startedAt}ms）：${scene}`)
            return { text: scene, fromAi: true }
        } catch (error) {
            logger.error('角色卡画面描述失败，回退模板变化', error)
            return { text: fallback, fromAi: false }
        }
    }

    /** 校验今日次数：限额为 0 或负数时视为不限制 */
    private assertQuota(): void {
        const limit = getZhaiConfig().imageDailyLimit
        if (limit <= 0) {
            return
        }
        const used = readUsedToday(this.db, IMAGE_QUOTA_KEYS)
        if (used >= limit) {
            throw new Error(`今日角色卡生成次数已用完（${used} / ${limit}），可明日再试或调高 zhai.image.dailyLimit`)
        }
    }
}

/** 入参收窄：作品目录与人物标识走各自白名单，其余字段逐个截断，姓名为空直接拒绝 */
function normalizePortraitRequest(payload: unknown): PortraitGenerateRequest {
    const characterId = normalizeCharacterId(payload, 'pressAi/generatePortrait')
    const dirPath = readProjectDirPath(payload, 'pressAi/generatePortrait')
    const value = payload as {
        characterId?: unknown
        name?: unknown
        role?: unknown
        gender?: unknown
        age?: unknown
        height?: unknown
        bodyType?: unknown
        identity?: unknown
        appearance?: unknown
        traits?: unknown
        desire?: unknown
        weakness?: unknown
        ability?: unknown
        background?: unknown
        relation?: unknown
        era?: unknown
        genres?: unknown
        tone?: unknown
        style?: unknown
    }
    const request: PortraitGenerateRequest = {
        dirPath,
        characterId,
        name: readText(value.name, MAX_SHORT_TEXT),
        role: readText(value.role, MAX_SHORT_TEXT),
        gender: readText(value.gender, MAX_SHORT_TEXT),
        age: readText(value.age, MAX_SHORT_TEXT),
        height: readText(value.height, MAX_SHORT_TEXT),
        bodyType: readText(value.bodyType, MAX_SHORT_TEXT),
        identity: readText(value.identity, MAX_SHORT_TEXT),
        appearance: readText(value.appearance, MAX_LONG_TEXT),
        traits: readTextList(value.traits, 8, 16),
        desire: readText(value.desire, MAX_LONG_TEXT),
        weakness: readText(value.weakness, MAX_LONG_TEXT),
        ability: readText(value.ability, MAX_LONG_TEXT),
        background: readText(value.background, MAX_LONG_TEXT),
        relation: readText(value.relation, MAX_LONG_TEXT),
        era: readText(value.era, MAX_SHORT_TEXT),
        genres: readTextList(value.genres, 6, 16),
        tone: readText(value.tone, MAX_SHORT_TEXT),
        style: readStyle(value.style),
    }
    if (request.name.length === 0) {
        throw new Error('缺少人物姓名，无法生成角色卡')
    }
    return request
}

/** 文件名时间戳：本地时间 YYYYMMDDHHmmss，与图片命名规范一致，按文件名即可排序 */
function formatPortraitStamp(date: Date): string {
    const pad = (value: number): string => String(value).padStart(2, '0')
    return [
        String(date.getFullYear()),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds()),
    ].join('')
}

/** 读取画风：只接受白名单内的值，其余一律回落默认风格 */
function readStyle(value: unknown): PortraitStyle {
    if (typeof value !== 'string') {
        return DEFAULT_PORTRAIT_STYLE
    }
    return PORTRAIT_STYLES.find((item) => item === value) ?? DEFAULT_PORTRAIT_STYLE
}

/** 读取人物标识：只接受安全字符集，避免拼出越界目录；缺失或非法一律拒绝 */
function normalizeCharacterId(payload: unknown, method: string): string {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error(`${method} 缺少参数`)
    }
    const characterId = readText((payload as { characterId?: unknown }).characterId, MAX_SHORT_TEXT)
    if (!isPressCharacterId(characterId)) {
        throw new Error('人物标识非法，无法定位角色卡目录')
    }
    return characterId
}

/**
 * 读取作品目录：要求 press/{作品名} 两段，返回归一化后的相对路径。
 * 安全约束：越出 press 模块、含上跳或段数不符的路径一律拒绝，角色卡与封面目录只能落在作品目录下。
 * 供封面服务共用同一套校验，避免两处各写一份路径白名单。
 */
export function readProjectDirPath(payload: unknown, method: string): string {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error(`${method} 缺少参数`)
    }
    const dirPath = readText((payload as { dirPath?: unknown }).dirPath, MAX_PATH_LENGTH)
    if (dirPath.length === 0) {
        throw new Error(`${method} 缺少作品目录`)
    }
    return readProjectSegments(dirPath).join('/')
}

/** 列举入参：作品目录与人物标识共同定位角色卡目录，缺失任一项都直接拒绝 */
function normalizePortraitListRequest(payload: unknown): { dirPath: string; characterId: string } {
    return {
        dirPath: readProjectDirPath(payload, 'pressAi/listPortraits'),
        characterId: normalizeCharacterId(payload, 'pressAi/listPortraits'),
    }
}

/** 剪贴板写入结果：copied 成功、unsupported 平台或依赖缺失、failed 命令执行失败 */
type ClipboardOutcome = 'copied' | 'unsupported' | 'failed'

/**
 * 按平台把图片文件写入系统剪贴板。
 * 路径只经环境变量或参数数组传递，不拼进命令串，避免路径中的引号造成注入。
 */
async function writeImageToClipboard(filePath: string, extension: string): Promise<ClipboardOutcome> {
    const env = { ...process.env, ZHAI_CLIPBOARD_IMAGE: filePath }
    if (process.platform === 'win32') {
        const args = ['-NoProfile', '-NonInteractive', '-STA', '-Command', WINDOWS_CLIPBOARD_SCRIPT]
        return runClipboardCommand('powershell.exe', args, env, 'failed')
    }
    if (process.platform === 'darwin') {
        const typeClass = MACOS_CLIPBOARD_CLASS[extension]
        if (!typeClass) {
            return 'unsupported'
        }
        const script = `set the clipboard to (read (POSIX file (system attribute "ZHAI_CLIPBOARD_IMAGE")) as «class ${typeClass}»)`
        return runClipboardCommand('osascript', ['-e', script], env, 'failed')
    }
    if (process.platform === 'linux') {
        const mime = LINUX_CLIPBOARD_MIME[extension]
        if (!mime) {
            return 'unsupported'
        }
        const args = ['-selection', 'clipboard', '-t', mime, '-i', filePath]
        return runClipboardCommand('xclip', args, env, 'unsupported')
    }
    return 'unsupported'
}

/** 执行剪贴板命令：命令缺失按 missing 返回，其余执行失败一律 failed */
async function runClipboardCommand(
    command: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    missing: ClipboardOutcome,
): Promise<ClipboardOutcome> {
    try {
        await execFileAsync(command, args, { env, timeout: CLIPBOARD_TIMEOUT_MS, windowsHide: true })
        return 'copied'
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'ENOENT' ? missing : 'failed'
    }
}

/**
 * 取插入目标：优先活动编辑器；侧边栏 Webview 聚焦或焦点落在面板时 activeTextEditor 为空，
 * 退回到最近可见的 Markdown 编辑器，避免插入无反应。
 */
function resolveInsertTarget(): vscode.TextEditor | undefined {
    const active = vscode.window.activeTextEditor
    if (active) {
        return active
    }
    return [...vscode.window.visibleTextEditors]
        .reverse()
        .find((item) => item.document.languageId === 'markdown' && item.document.uri.scheme === 'file')
}

/** 读取删除请求里的相对路径 */
function readPortraitPath(payload: unknown): string {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('pressAi/deletePortrait 缺少参数')
    }
    const path = readText((payload as { path?: unknown }).path, MAX_PATH_LENGTH)
    if (path.length === 0) {
        throw new Error('缺少角色卡路径')
    }
    return path
}
