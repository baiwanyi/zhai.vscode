/**
 * 角色设定图服务：列举已落盘的设定图、复制到剪贴板、插入 Markdown，以及删除人物时清理其图片。
 * 复用约定：目录名取自 ./constants，路径一律经 common/storagePath 做白名单校验；URL 转换由调用方注入。
 * 关键约束：出图统一在生图页完成（pressAi/generateImage），本服务不再生成图片，也不再读写配额；
 * 角色归属由文件名里的角色段解析（不按角色分子目录），跟随作品目录（删除作品即一并清理）；
 * 目录是图片的唯一事实来源，列举以磁盘为准；
 * 删除、复制与插入只接受 press/{作品名}/Images 下的四段白名单路径，删除优先走回收站；
 * 复制经平台命令写入系统剪贴板（webview 内写图片受 CSP 与权限限制）。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { logger } from '@modules/common/logger'
import { PRESS_MODULE_DIR, readProjectSegments } from '@modules/common/projectPath'
import { readText } from '@modules/common/readInput'
import { buildStorageUri, deleteResource, toSafeSegments } from '@modules/common/storagePath'
import { parseImageCharacterId } from '@shared/types/imagegen'
import type {
    CharacterPortrait,
    PortraitCopyResult,
    PortraitGalleryItem,
    PortraitGalleryResult,
    PortraitInsertResult,
    PortraitListResult,
} from '@shared/types/press'
import { isPressCharacterId } from '@shared/types/press'
import { IMAGE_DIR_NAMES } from './constants'
import { listImageFiles } from './imageDirScan'

/** 角色卡相对路径的段数：press/{作品名}/Images/{文件名} */
const PORTRAIT_SEGMENT_COUNT = 4
/** 短字段长度上限 */
const MAX_SHORT_TEXT = 64
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
     * 关键约束：图片平铺在 Images 下，角色归属由文件名里的角色段解析；
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
        // 只扫统一目录 Images：历史 Cover / Portraits 不再读取
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
     * 只接受 press/{作品名}/Images 下的四段相对路径；平台不支持或依赖缺失时返回原因，由前端提示。
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

    /**
     * 清理某个角色的全部设定图：删除角色时随角色块一并清理，避免留下无人引用的图片。
     * 关键约束：只删文件名角色段匹配且符合命名规范的文件，手工放入的其它图片不受影响。
     */
    public async removeByCharacterId(dirPath: string, characterId: string): Promise<{ removed: number }> {
        const projectSegments = readProjectSegments(dirPath)
        const root = resolveStorageRoot()
        let removed = 0
        // 只清理统一目录 Images：历史 Cover / Portraits 不再纳入
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

/** 读取图片操作（复制 / 插入）里的相对路径 */
function readPortraitPath(payload: unknown): string {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('角色卡请求缺少参数')
    }
    const path = readText((payload as { path?: unknown }).path, MAX_PATH_LENGTH)
    if (path.length === 0) {
        throw new Error('缺少角色卡路径')
    }
    return path
}
