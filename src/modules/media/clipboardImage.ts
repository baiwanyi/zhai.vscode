/**
 * 图片剪贴板：按平台把磁盘图片写入系统剪贴板，供媒体详情面板的「复制图片」使用。
 * 复用约定：webview 内写图片受 CSP 与权限限制，统一由宿主调原生能力；路径经环境变量或参数数组传递，
 * 不拼进命令串，避免路径中的引号造成注入。
 * 关键约束：只在扩展宿主进程内调用；命令缺失（xclip 未安装）与执行失败分别返回 unsupported / failed，
 * 由调用方转成界面提示，不抛错。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

/** 剪贴板命令超时：外部进程卡住时不阻塞界面 */
const CLIPBOARD_TIMEOUT_MS = 8_000
/** Windows 剪贴板脚本：路径经环境变量传入，SetImage 要求 STA 线程 */
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

/** 剪贴板结果：copied 成功、unsupported 平台或依赖缺失、failed 命令执行失败 */
type ClipboardOutcome = 'copied' | 'unsupported' | 'failed'

/** 命令随包注入的 promise 化执行器 */
const execFileAsync = promisify(execFile)

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
 * 按平台把图片文件写入系统剪贴板。
 * @param filePath 图片绝对路径
 * @param extension 不带点的扩展名，用于选择剪贴板类型
 */
export async function writeImageToClipboard(filePath: string, extension: string): Promise<ClipboardOutcome> {
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
        return runClipboardCommand('xclip', ['-selection', 'clipboard', '-t', mime, '-i', filePath], env, 'unsupported')
    }
    return 'unsupported'
}
