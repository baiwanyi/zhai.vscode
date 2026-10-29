/**
 * AI 工具权限守卫：把会话模式与审批模式翻译成 SDK 侧工具白名单与逐次调用的审批回调。
 * 复用约定：策略由会话服务构造，交互往返由 ../permissionBroker 承担，本层只做规则判定与路径规范化；
 * 路径统一经 realpath 解析后按大小写无关比对，防止经软链或别名目录逃逸白名单。
 * 关键约束：SDK 仅在 permissionMode 为 default 时就每次工具调用回调本守卫，
 * 不得改用 acceptEdits —— 该模式下编辑类工具由 CLI 直接放行，路径校验会被整体绕过；
 * 未提供 canUseTool 时 SDK 一律拒绝工具调用，因此放行必须显式返回 allow；
 * 用户在审批中改写路径后必须重新校验，不能因为「已批准」而放过越界写入。
 */
import { realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import { logger } from '@modules/common/logger'
import type { AiApprovalMode, AiAskQuestion, AiPermissionRequest } from '@shared/types/aiChat'
import type { AiPermissionChannel, AiToolPolicy } from '../provider'
import type { CanUseTool, PermissionResult } from '@tencent-ai/agent-sdk'

/** 只读工具：读取、检索与目录列举，不改变磁盘内容 */
export const READ_ONLY_TOOLS: readonly string[] = ['Read', 'Glob', 'Grep', 'LS']

/** 写入工具：修改既有文件与新建文件 */
export const WRITE_TOOLS: readonly string[] = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']

/** 模型向用户提问的工具名：单独走问答往返，不走写入审批 */
export const ASK_USER_QUESTION = 'AskUserQuestion'

/** 交互类工具：与读写权限无关，两种模式都允许，缺了它问答链路永远无法触发 */
export const INTERACTIVE_TOOLS: readonly string[] = [ASK_USER_QUESTION]

/** 工具入参里的路径字段：各工具命名不完全统一，按优先级取值 */
const PATH_FIELDS: readonly string[] = ['file_path', 'path', 'filePath', 'notebook_path']

/** 提问条数与选项上限：SDK 约定 1-4 个问题、每题 2-4 个选项，超出的部分直接截断 */
const MAX_QUESTIONS = 4
const MAX_OPTIONS = 6

/** 守卫构造参数：策略决定边界，审批模式决定写入手感，桥决定交互往返 */
export interface ToolGuardOptions {
    policy: AiToolPolicy
    approval: AiApprovalMode
    /** 审批桥：ask 模式下逐次询问；null 表示没有可交互的通道，此时写入一律拒绝 */
    broker: AiPermissionChannel | null
}

/** 归一化为可比对的小写绝对路径：Windows 盘符与大小写差异会让前缀比对失真 */
function normalizePath(value: string): string {
    return resolve(value).toLowerCase()
}

/**
 * 解析真实路径：目标可能尚未创建（Write 新建文件），此时只解析父目录再拼回文件名。
 * 解析失败（父目录也不存在）时退回字面路径，保证校验不会因异常而放行。
 */
async function resolveRealPath(value: string): Promise<string> {
    try {
        return normalizePath(await realpath(value))
    } catch {
        try {
            const parent = await realpath(dirname(value))
            return normalizePath(resolve(parent, basename(value)))
        } catch {
            return normalizePath(value)
        }
    }
}

/** 判断目标是否落在任一根内：根自身也算命中，跨盘时 relative 返回绝对路径即判定越界 */
function insideRoots(target: string, roots: readonly string[]): boolean {
    return roots.some((root) => {
        const offset = relative(root, target)
        return offset.length === 0 || (!offset.startsWith('..') && !isAbsolute(offset))
    })
}

/** 读取工具入参中的路径：缺省表示该次调用不带具体文件（如无 path 的 Glob） */
function readToolPath(input: Record<string, unknown>): string | null {
    for (const field of PATH_FIELDS) {
        const value = input[field]
        if (typeof value === 'string' && value.trim().length > 0) {
            return value
        }
    }
    return null
}

/** 把用户改写后的路径写回同一个字段：字段名不同但语义一致，保留原结构 */
function replacePathField(input: Record<string, unknown>, nextPath: string): Record<string, unknown> {
    for (const field of PATH_FIELDS) {
        if (typeof input[field] === 'string') {
            return { ...input, [field]: nextPath }
        }
    }
    return { ...input, file_path: nextPath }
}

/** 收窄选项清单：Webview 只消费展示字段，脏数据整条丢弃 */
function readOptions(raw: unknown): { label: string; description: string }[] {
    if (!Array.isArray(raw)) {
        return []
    }
    const options: { label: string; description: string }[] = []
    for (const item of raw.slice(0, MAX_OPTIONS)) {
        if (typeof item !== 'object' || item === null) {
            continue
        }
        const record = item as Record<string, unknown>
        const label = typeof record.label === 'string' ? record.label.trim() : ''
        if (label.length === 0) {
            continue
        }
        options.push({
            label,
            description: typeof record.description === 'string' ? record.description : '',
        })
    }
    return options
}

/** 收窄问题清单：缺问题原文或没有选项的条目直接跳过 */
function readQuestions(input: Record<string, unknown>): AiAskQuestion[] {
    const raw = input.questions
    if (!Array.isArray(raw)) {
        return []
    }
    const questions: AiAskQuestion[] = []
    for (const item of raw.slice(0, MAX_QUESTIONS)) {
        if (typeof item !== 'object' || item === null) {
            continue
        }
        const record = item as Record<string, unknown>
        const question = typeof record.question === 'string' ? record.question.trim() : ''
        const options = readOptions(record.options)
        if (question.length === 0 || options.length === 0) {
            continue
        }
        questions.push({
            question,
            header: typeof record.header === 'string' ? record.header : '',
            options,
            multiSelect: record.multiSelect === true,
        })
    }
    return questions
}

function allow(input: Record<string, unknown>): PermissionResult {
    return { behavior: 'allow', updatedInput: input }
}

function deny(message: string, interrupt: boolean): PermissionResult {
    return { behavior: 'deny', message, interrupt }
}

/** 越界拒绝：读取越界不中断（换路径还能继续），写入越界直接中断，防止模型反复试错 */
function rejectPath(action: '读取' | '写入', toolName: string, rawPath: string): PermissionResult {
    logger.warn(`AI 工具被拒绝：${toolName} → ${rawPath}（超出${action}范围）`)
    return action === '读取' ? deny('该文件不在允许读取的范围内', false) : deny('该文件不在允许写入的范围内', true)
}

/** 处理模型提问：把问题交给前端收集答案，再把答案并回工具入参 */
async function askUser(
    input: Record<string, unknown>,
    toolUseID: string,
    broker: AiPermissionChannel | null,
): Promise<PermissionResult> {
    const questions = readQuestions(input)
    if (questions.length === 0) {
        return deny('模型提问缺少有效问题', false)
    }
    if (broker === null) {
        return deny('当前没有可用的提问通道', false)
    }
    const decision = await broker.request({
        id: toolUseID,
        kind: 'question',
        toolName: ASK_USER_QUESTION,
        detail: `待确认 ${String(questions.length)} 个问题`,
        editablePath: null,
        questions,
    })
    const answers = decision.answers ?? {}
    if (!decision.allowed || Object.keys(answers).length === 0) {
        return deny('用户没有回答问题', false)
    }
    return allow({ ...input, answers })
}

/** 处理写入确认：先问用户，用户改写目标后重新走一遍白名单校验 */
async function confirmWrite(params: {
    input: Record<string, unknown>
    toolName: string
    rawPath: string
    toolUseID: string
    policy: AiToolPolicy
    broker: AiPermissionChannel
}): Promise<PermissionResult> {
    const request: AiPermissionRequest = {
        id: params.toolUseID,
        kind: 'tool',
        toolName: params.toolName,
        detail: params.rawPath,
        editablePath: params.rawPath,
        questions: [],
    }
    const decision = await params.broker.request(request)
    if (!decision.allowed) {
        logger.info(`AI 写入被用户拒绝：${params.toolName} → ${params.rawPath}`)
        return deny('用户拒绝该写入操作', true)
    }
    const nextPath = decision.path?.trim()
    if (nextPath === undefined || nextPath.length === 0 || nextPath === params.rawPath) {
        return allow(params.input)
    }
    const next = await resolveRealPath(nextPath)
    if (!insideRoots(next, params.policy.writeRoots)) {
        logger.warn(`AI 改写路径越界，已拒绝：${nextPath}`)
        return deny('改写后的路径不在允许写入的范围内', true)
    }
    return allow(replacePathField(params.input, nextPath))
}

/**
 * 构造逐次调用的审批回调：只读按读取根放行，写入按审批模式决定是否询问，提问单独走问答往返。
 * 关键约束：白名单外的工具不设置 interrupt —— 工具集已由 CLI 侧白名单收窄，模型不会再看到它们，
 * 真被调用属于异常路径，拒绝并让模型继续即可，贸然中断会把可恢复的失败放大成整轮失败。
 */
export function createToolGuard(options: ToolGuardOptions): CanUseTool {
    const { policy, approval, broker } = options
    return async (toolName, input, callOptions) => {
        if (toolName === ASK_USER_QUESTION) {
            return askUser(input, callOptions.toolUseID, broker)
        }
        const isReadOnly = READ_ONLY_TOOLS.includes(toolName)
        const isWriter = WRITE_TOOLS.includes(toolName)
        if (!isReadOnly && !isWriter) {
            logger.warn(`AI 工具被拒绝（当前模式不允许）：${toolName}`)
            return deny(`当前模式不允许使用 ${toolName}`, false)
        }
        const rawPath = readToolPath(input)
        if (rawPath === null) {
            // 无路径的检索等价于在 cwd 内扫描，由通道下发的 cwd 兜住范围
            return isWriter ? deny('写入工具缺少目标路径', false) : allow(input)
        }
        const target = await resolveRealPath(rawPath)
        if (isReadOnly) {
            return insideRoots(target, policy.readRoots) ? allow(input) : rejectPath('读取', toolName, rawPath)
        }
        if (!insideRoots(target, policy.writeRoots)) {
            return rejectPath('写入', toolName, rawPath)
        }
        if (approval === 'readonly') {
            return deny('当前为只读模式，不能修改文件', false)
        }
        if (approval === 'auto') {
            return allow(input)
        }
        if (broker === null) {
            return deny('当前没有可用的审批通道，已拒绝写入', true)
        }
        return confirmWrite({ input, toolName, rawPath, toolUseID: callOptions.toolUseID, policy, broker })
    }
}
