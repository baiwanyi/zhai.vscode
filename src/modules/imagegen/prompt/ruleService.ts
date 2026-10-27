/**
 * 出图规则服务：列举、读取、新建、改写、删除与出图取文，规则文件落在存储根下 prompt/rules。
 * 复用约定：存储根取 common/config，路径拼装与删除走 common/storagePath，目录与 prompt/images 同级；
 * 「打开目录」沿用 promptImageService 的 revealFileInOS 口径，不另起一套打开方式。
 * 关键约束：规则是用户手写资料——新建不覆盖同名文件，标识即文件名主干，改名等价于换标识；
 * 读取与改写都以文件名主干定位，非法名称、缺失文件与改名撞名一律拒绝，不静默落到同名文件上；
 * 删除走回收站优先的 deleteResource，出图时按标识回查正文，缺失或读取失败一律跳过并记日志，不阻断出图；
 * 条数与总长上限统一取同目录 ./limits，本文件不再自带数值，避免两处各写一份。
 */
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { logger } from '@modules/common/logger'
import { buildStorageUri, deleteResource, isPathExisting } from '@modules/common/storagePath'
import type { PromptRule, PromptRuleDetail, PromptRuleListResult } from '@shared/types/imagegen'
import { MAX_RULE_CONTENT, MAX_RULE_NAME, MAX_RULES, MAX_RULE_TOTAL_LENGTH } from './limits'

/** 提示词模块的一级目录：与预览图库共用同一段，规则与图片各居其下 */
const PROMPT_DIR = 'prompt'

/** 规则子目录 */
const RULE_DIR = 'rules'

/** 规则文件扩展名：只认 md，目录里的其它文件不参与列举 */
const RULE_EXTENSION = '.md'

/** 文件名非法字符：路径分隔符与 Windows 保留字符一律禁止 */
const INVALID_NAME_PATTERN = /[\\/:*?"<>|]/u

/** 是否含控制字符：换行、制表等不可见字符写进文件名会让后续读取与列举变得不可预期 */
function hasControlChar(value: string): boolean {
    return [...value].some((char) => {
        const code = char.charCodeAt(0)
        return code < 0x20 || code === 0x7f
    })
}

/** 规则目录 Uri：列举、保存与打开目录共用同一口径，避免两处拼路径 */
function promptRuleDirUri(): vscode.Uri {
    return buildStorageUri(resolveStorageRoot(), [PROMPT_DIR, RULE_DIR])
}

/**
 * 收窄规则名：剥掉可选的 .md 后缀后校验，非法返回 null。
 * 关键约束：名称既作文件名又作芯片标识，上跳片段与路径分隔符必须在此拦下。
 */
function normalizeRuleName(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null
    }
    const name = value.trim().replace(/\.md$/iu, '').trim()
    if (name.length === 0 || name.length > MAX_RULE_NAME) {
        return null
    }
    if (name === '.' || name === '..' || INVALID_NAME_PATTERN.test(name) || hasControlChar(name)) {
        return null
    }
    return name
}

/** 规则文件 Uri：名称必须已通过 normalizeRuleName */
function ruleFileUri(name: string): vscode.Uri {
    return buildStorageUri(resolveStorageRoot(), [PROMPT_DIR, RULE_DIR, `${name}${RULE_EXTENSION}`])
}

/** 名称非法的统一提示：列举之外的入口都按同一句回给前端 */
const INVALID_NAME_MESSAGE = `规则名称非法：不能为空、含路径分隔符或超过 ${String(MAX_RULE_NAME)} 个字符`

/** 收窄规则正文：去首尾空白后校验空值与上限，新建与改写共用同一口径 */
function normalizeRuleContent(value: unknown): string {
    const content = typeof value === 'string' ? value.trim() : ''
    if (content.length === 0) {
        throw new Error('规则内容不能为空')
    }
    if (content.length > MAX_RULE_CONTENT) {
        throw new Error(`规则内容过长：上限 ${String(MAX_RULE_CONTENT)} 字`)
    }
    return content
}

export class PromptRuleService {
    /** 列举规则：目录缺失视为空库；名称按中文排序，与角色选择器的展示口径一致 */
    public async list(): Promise<PromptRuleListResult> {
        const dirUri = promptRuleDirUri()
        let entries: [string, vscode.FileType][]
        try {
            entries = await vscode.workspace.fs.readDirectory(dirUri)
        } catch {
            // 目录尚未创建：首次使用属正常情况，空列表由前端引导新建
            return { rules: [], dirPath: dirUri.fsPath }
        }
        const rules: PromptRule[] = []
        for (const [fileName, type] of entries) {
            if (type !== vscode.FileType.File || !fileName.toLowerCase().endsWith(RULE_EXTENSION)) {
                continue
            }
            const name = normalizeRuleName(fileName)
            if (name === null) {
                continue
            }
            rules.push({ id: name, name })
        }
        rules.sort((left, right) => left.name.localeCompare(right.name, 'zh'))
        return { rules, dirPath: dirUri.fsPath }
    }

    /** 新建规则：同名文件已存在时拒绝，内容统一以换行结尾，返回可直接挂芯片的条目 */
    public async save(payload: unknown): Promise<PromptRule> {
        const record = payload as { name?: unknown; content?: unknown } | null
        const name = normalizeRuleName(record?.name)
        if (name === null) {
            throw new Error(INVALID_NAME_MESSAGE)
        }
        const content = normalizeRuleContent(record?.content)
        const fileUri = ruleFileUri(name)
        if (await isPathExisting(fileUri)) {
            throw new Error(`同名规则已存在：${name}`)
        }
        await vscode.workspace.fs.createDirectory(promptRuleDirUri())
        await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(`${content}\n`))
        logger.info(`规则已保存：${fileUri.fsPath}`)
        return { id: name, name }
    }

    /** 读取规则正文：编辑弹窗回填用，文件缺失直接报错，不返回空内容让表单悄悄清空原文 */
    public async read(payload: unknown): Promise<PromptRuleDetail> {
        const record = payload as { name?: unknown } | null
        const name = normalizeRuleName(record?.name)
        if (name === null) {
            throw new Error(INVALID_NAME_MESSAGE)
        }
        const fileUri = ruleFileUri(name)
        let bytes: Uint8Array
        try {
            bytes = await vscode.workspace.fs.readFile(fileUri)
        } catch {
            throw new Error(`规则不存在：${name}`)
        }
        return { name, content: Buffer.from(bytes).toString('utf8').trim() }
    }

    /**
     * 改写规则：整段替换正文；改名时先按新名改名再写内容，等价于换一个标识。
     * 关键约束：原名必须存在，新名不得撞上另一条规则——否则会把两条规则合成一条，且芯片标识凭空失效。
     */
    public async update(payload: unknown): Promise<PromptRule> {
        const record = payload as { previousName?: unknown; name?: unknown; content?: unknown } | null
        const previousName = normalizeRuleName(record?.previousName)
        if (previousName === null) {
            throw new Error(INVALID_NAME_MESSAGE)
        }
        const name = normalizeRuleName(record?.name)
        if (name === null) {
            throw new Error(INVALID_NAME_MESSAGE)
        }
        const content = normalizeRuleContent(record?.content)
        const sourceUri = ruleFileUri(previousName)
        if (!(await isPathExisting(sourceUri))) {
            throw new Error(`规则不存在：${previousName}`)
        }
        const targetUri = ruleFileUri(name)
        // 仅大小写不同时在 Windows 上视为同一文件，跳过撞名检查，交给 rename 改写显示名
        const isCaseOnlyRename = name !== previousName && name.toLowerCase() === previousName.toLowerCase()
        if (name !== previousName && !isCaseOnlyRename && (await isPathExisting(targetUri))) {
            throw new Error(`同名规则已存在：${name}`)
        }
        await vscode.workspace.fs.createDirectory(promptRuleDirUri())
        if (name !== previousName) {
            await vscode.workspace.fs.rename(sourceUri, targetUri, { overwrite: false })
        }
        await vscode.workspace.fs.writeFile(targetUri, new TextEncoder().encode(`${content}\n`))
        logger.info(`规则已改写：${targetUri.fsPath}`)
        return { id: name, name }
    }

    /** 删除规则：文件移入回收站优先，成功后回传最新列表，前端不必再补一次列举 */
    public async remove(payload: unknown): Promise<PromptRuleListResult> {
        const record = payload as { name?: unknown } | null
        const name = normalizeRuleName(record?.name)
        if (name === null) {
            throw new Error(INVALID_NAME_MESSAGE)
        }
        const fileUri = ruleFileUri(name)
        if (!(await isPathExisting(fileUri))) {
            throw new Error(`规则不存在：${name}`)
        }
        const outcome = await deleteResource(fileUri, false)
        logger.info(`规则已删除（${outcome}）：${fileUri.fsPath}`)
        return this.list()
    }

    /** 打开规则目录：不存在时先建出来，再交给系统文件管理器定位，并回传最新列表 */
    public async openDir(): Promise<PromptRuleListResult> {
        const dirUri = promptRuleDirUri()
        await vscode.workspace.fs.createDirectory(dirUri)
        await vscode.commands.executeCommand('revealFileInOS', dirUri)
        return this.list()
    }

    /**
     * 出图取文：按标识回查 md 正文，缺失或读取失败跳过；条数与总长在此收口。
     * 关键约束：非法标识直接丢弃而不报错——前端可能带着已删除规则的芯片发请求。
     */
    public async readForPrompt(ids: readonly string[]): Promise<string[]> {
        const sections: string[] = []
        let total = 0
        for (const id of ids.slice(0, MAX_RULES)) {
            const name = normalizeRuleName(id)
            if (name === null) {
                continue
            }
            let text: string
            try {
                const bytes = await vscode.workspace.fs.readFile(ruleFileUri(name))
                text = Buffer.from(bytes).toString('utf8').trim()
            } catch {
                logger.warn(`规则读取失败，已跳过：${name}`)
                continue
            }
            const budget = MAX_RULE_TOTAL_LENGTH - total
            if (text.length === 0 || budget <= 0) {
                continue
            }
            const section = text.slice(0, budget)
            sections.push(section)
            total += section.length
        }
        return sections
    }
}
