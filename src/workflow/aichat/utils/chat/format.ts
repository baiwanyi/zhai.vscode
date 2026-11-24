/**
 * AI 对话展示层的文案格式化：引用体积与行范围的紧凑折算、路径末段提取、工具与步骤的动作文案、
 * 步骤耗时、问卷多选合并符，以及消息的复制文本。
 * 复用约定：引用与步骤类型取 @shared/types/aiChat，存储根路径口径取 @shared/utils/zhaiPath；
 * 页面主组件与各子组件共用本层，避免同一套展示口径各写一份。
 * 关键约束：复制文本带上 `@zhai\` 写法的引用，剪贴板内容与气泡里看到的一致且可直接粘回输入框；
 * 微博这类无文件来源的引用改用纯文本标注，不产出无法解析的假令牌；工具名表只做展示映射，
 * 未知工具原样透出，不得据此推断权限。
 */
import type { AiContextRef, AiMessage, AiNotebookPackMode, AiStep } from '@shared/types/aiChat'
import { readStorageRootPath, replaceStorageRootPaths, toZhaiDisplayPath } from '@shared/utils/zhaiPath'

/** 笔记本打包档位的中文标注：全文不额外标注，其余三档各自说明 */
const NOTEBOOK_PACK_LABELS: Readonly<Record<AiNotebookPackMode, string>> = {
    full: '',
    excerpt: '已节选',
    outline: '仅目录',
    compressed: '已压缩',
}

/** 引用体积描述：过千折算 k；笔记本补篇数与打包档位，普通引用在截断时追加标注 */
export function describeContext(ref: AiContextRef): string {
    const size = ref.charCount >= 1000 ? `${(ref.charCount / 1000).toFixed(1)}k 字` : `${ref.charCount} 字`
    if (ref.kind === 'notebook') {
        const members = ref.memberCount === undefined ? '' : `${String(ref.memberCount)} 篇`
        const packLabel = ref.packMode === undefined ? '' : NOTEBOOK_PACK_LABELS[ref.packMode]
        return [members, size, packLabel].filter((part) => part.length > 0).join(' · ')
    }
    return ref.isTruncated ? `${size} · 已截断` : size
}

/** 工具名展示表：模型返回英文工具名，界面给出中文动作 */
const TOOL_LABELS: Readonly<Record<string, string>> = {
    Read: '读取文件',
    Glob: '查找文件',
    Grep: '检索内容',
    LS: '浏览目录',
    Edit: '修改文件',
    Write: '写入文件',
    MultiEdit: '批量修改',
    NotebookEdit: '修改笔记',
    AskUserQuestion: '向你提问',
}

/** 工具动作文案：进度行与审批弹窗共用，未知工具原样透出便于排查 */
export function describeTool(name: string): string {
    return TOOL_LABELS[name] ?? name
}

/**
 * 多选答案的分隔符：SDK 的 answers 是「问题原文 → 字符串」的映射，多选只能合并成一个值。
 * 关键约束：弹窗与流内问卷共用同一常量，两处口径不一致会让模型收到两种格式的答案。
 */
export const ANSWER_SEPARATOR = '、'

/** 步骤行标题：动作 + 对象；未知工具原样透出，便于排查 CLI 新增的能力 */
export function describeStep(step: AiStep): string {
    const action = describeTool(step.name)
    return step.detail === null || step.detail.length === 0 ? action : `${action} ${step.detail}`
}

/** 步骤耗时：不足一秒按毫秒展示；未知或非正数返回 null，不显示没有信息量的「0 秒」 */
export function formatStepDuration(elapsedMs: number | null): string | null {
    if (elapsedMs === null || !Number.isFinite(elapsedMs) || elapsedMs <= 0) {
        return null
    }
    return elapsedMs < 1000 ? `${Math.round(elapsedMs)}ms` : `${(elapsedMs / 1000).toFixed(1)}s`
}

/** 路径末段：兼容正反斜杠，空值原样返回；完整路径由调用方放进悬浮提示 */
export function toFileName(path: string): string {
    const segments = path.split(/[\\/]/).filter((segment) => segment.length > 0)
    return segments[segments.length - 1] ?? path
}

/** 引用文件名：复用路径末段规则，保证引用芯片与审批目标的口径一致 */
export function toContextFileName(ref: AiContextRef): string {
    return toFileName(ref.displayPath)
}

/**
 * 引用的行范围后缀：`:12` / `:12-33` 形态紧跟在文件名之后，单行给一个行号、跨行给区间。
 * 整篇引用（startLine 为 null）返回空串，调用方据此不渲染后缀。
 */
export function toContextLineRange(ref: AiContextRef): string {
    if (ref.startLine === null) {
        return ''
    }
    return ref.endLine === null || ref.endLine === ref.startLine
        ? `:${String(ref.startLine)}`
        : `:${String(ref.startLine)}-${String(ref.endLine)}`
}

/**
 * 剪贴板里的引用写法：`@zhai\...` 加行范围，与输入框可识别的令牌同构，粘回去即可还原成芯片。
 * 微博与卷纲引用没有存储根路径，改写成纯文本标注，避免生成粘回输入框后无法解析的假令牌。
 */
function toClipboardRef(ref: AiContextRef): string {
    if (ref.kind === 'weibo') {
        return `[微博] ${ref.label}`
    }
    if (ref.kind === 'volumeOutline') {
        return `[卷纲] ${ref.label}`
    }
    const display = toZhaiDisplayPath(ref.displayPath)
    if (ref.startLine === null || /:\d+(?:-\d+)?$/u.test(display)) {
        return display
    }
    return ref.endLine === null || ref.endLine === ref.startLine
        ? `${display}:${String(ref.startLine)}`
        : `${display}:${String(ref.startLine)}-${String(ref.endLine)}`
}

/**
 * 消息的复制文本：`@zhai\` 写法的引用 + 正文，正文里存储根下的绝对路径同样折算。
 * 关键约束：只复制用户可见的信息；没有引用时等同于正文；
 * 路径统一成 `@zhai` 形式，粘贴回输入框时由宿主还原为引用芯片。
 */
export function toMessageCopyText(message: AiMessage): string {
    const badges = message.refs.map(toClipboardRef)
    const text = replaceStorageRootPaths(message.content, readStorageRootPath())
    return [badges.join(' '), text].filter((part) => part.length > 0).join('\n')
}
