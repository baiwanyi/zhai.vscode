/**
 * 出图规则服务：列举、新建与出图取文，规则文件落在存储根下 prompt/rules。
 * 复用约定：存储根取 common/config，路径拼装走 common/storagePath，目录与 prompt/images 同级；
 * 「打开目录」沿用 promptImageService 的 revealFileInOS 口径，不另起一套打开方式。
 * 关键约束：规则是用户手写资料——保存只新建、不覆盖同名文件，标识即文件名主干；
 * 出图时按标识回查正文，规则被删除或读取失败一律跳过并记日志，不阻断出图；
 * 单次请求最多并入 5 条、合计 3000 字，超出部分丢弃，避免规则挤占画面描述。
 */
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { logger } from '@modules/common/logger'
import { buildStorageUri, isPathExisting } from '@modules/common/storagePath'
import type { PromptRule, PromptRuleListResult } from '@shared/types/imagegen'

/** 提示词模块的一级目录：与预览图库共用同一段，规则与图片各居其下 */
const PROMPT_DIR = 'prompt'

/** 规则子目录 */
const RULE_DIR = 'rules'

/** 规则文件扩展名：只认 md，目录里的其它文件不参与列举 */
const RULE_EXTENSION = '.md'

/** 规则名长度上限：文件名主干，过长在菜单里也放不下 */
const MAX_RULE_NAME = 40

/** 单条规则正文长度上限 */
const MAX_RULE_CONTENT = 4000

/** 单次出图并入的规则条数上限 */
const MAX_RULE_COUNT = 5

/** 单次出图并入的规则正文总长上限 */
const MAX_RULE_TOTAL_LENGTH = 3000

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
export function promptRuleDirUri(): vscode.Uri {
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
            throw new Error(`规则名称非法：不能为空、含路径分隔符或超过 ${String(MAX_RULE_NAME)} 个字符`)
        }
        const content = typeof record?.content === 'string' ? record.content.trim() : ''
        if (content.length === 0) {
            throw new Error('规则内容不能为空')
        }
        if (content.length > MAX_RULE_CONTENT) {
            throw new Error(`规则内容过长：上限 ${String(MAX_RULE_CONTENT)} 字`)
        }
        const fileUri = ruleFileUri(name)
        if (await isPathExisting(fileUri)) {
            throw new Error(`同名规则已存在：${name}`)
        }
        await vscode.workspace.fs.createDirectory(promptRuleDirUri())
        await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(`${content}\n`))
        logger.info(`规则已保存：${fileUri.fsPath}`)
        return { id: name, name }
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
        for (const id of ids.slice(0, MAX_RULE_COUNT)) {
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
