/**
 * 待办仓库：todo/ 目录的枚举、读写与删除，是待办数据唯一的文件访问层。
 * 复用约定：目录挂在存储根下（common/config 的 resolveStorageRoot），路径经 common/storagePath 的
 * buildStorageUri + toSafeSegments 构造与校验，删除走 deleteResource（回收站优先）。
 * 关键约束：清单 id 只接受单段文件名主干，含上跳、分隔符或非法字符一律拒绝，从源头排除越出 todo 目录；
 * 文件不存在时读操作抛错而不是返回空内容——空内容会被误当成「空清单」并覆盖掉真实文件。
 */
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { logger } from '@modules/common/logger'
import { buildStorageUri, deleteResource, toSafeSegments } from '@modules/common/storagePath'
import type { DeleteOutcome } from '@modules/common/storagePath'

/** 待办模块在存储根下的一级目录名 */
export const TODO_MODULE_DIR = 'todo'

/** 清单文件扩展名：只认 md，目录里的其它文件不参与列举 */
const LIST_EXTENSION = '.md'

/** 文件名非法字符：Windows 保留字符与路径分隔符一律禁止 */
const INVALID_ID_PATTERN = /[\\/:*?"<>|]/u

/** 是否含控制字符：换行、制表等不可见字符写进文件名会让后续定位不可预期 */
function hasControlChar(value: string): boolean {
    return [...value].some((char) => {
        const code = char.charCodeAt(0)
        return code < 0x20 || code === 0x7f
    })
}

/**
 * 收窄清单 id：它既是文件名主干又是协议标识，须同时满足长度、字符集与首字符约束。
 * 关键约束：首字符为点会生成隐藏文件（用户在资源管理器里看不见），故一并拒绝。
 */
export function normalizeListId(value: unknown): string {
    const text = typeof value === 'string' ? value.trim() : ''
    if (text.length === 0 || text.length > 60) {
        throw new Error('清单标识非法：不能为空且不超过 60 个字符')
    }
    if (
        text === '.' ||
        text === '..' ||
        text.startsWith('.') ||
        INVALID_ID_PATTERN.test(text) ||
        hasControlChar(text)
    ) {
        throw new Error('清单标识非法：不能以点开头，也不能含路径分隔符或保留字符')
    }
    return text
}

export class TodoRepository {
    /** 待办目录 Uri：列举、读写与监听共用同一口径 */
    public dirUri(): vscode.Uri {
        return buildStorageUri(resolveStorageRoot(), [TODO_MODULE_DIR])
    }

    /** 待办目录的绝对路径，供空态提示与文件监听构造 */
    public dirPath(): string {
        return this.dirUri().fsPath
    }

    /** 清单文件 Uri：id 先经片段校验，拒绝会越出 todo 目录的拼装结果 */
    public fileUri(listId: string): vscode.Uri {
        const id = normalizeListId(listId)
        return buildStorageUri(resolveStorageRoot(), [
            TODO_MODULE_DIR,
            ...toSafeSegments(`${id}${LIST_EXTENSION}`, '待办'),
        ])
    }

    /** 列举清单 id：只取 md 文件，按中文名排序，目录缺失视为空 */
    public async listIds(): Promise<string[]> {
        let entries: [string, vscode.FileType][]
        try {
            entries = await vscode.workspace.fs.readDirectory(this.dirUri())
        } catch {
            return []
        }
        return entries
            .filter(([name, type]) => type === vscode.FileType.File && name.toLowerCase().endsWith(LIST_EXTENSION))
            .map(([name]) => name.slice(0, name.length - LIST_EXTENSION.length))
            .filter((name) => name.length > 0 && !name.startsWith('.'))
            .sort((left, right) => left.localeCompare(right, 'zh'))
    }

    /** 读取清单原文：文件不存在或读取失败直接抛错，由调用方转换成用户可读的提示 */
    public async readContent(listId: string): Promise<string> {
        try {
            const bytes = await vscode.workspace.fs.readFile(this.fileUri(listId))
            return Buffer.from(bytes).toString('utf8')
        } catch (cause) {
            logger.warn(`待办清单读取失败：${listId}（${cause instanceof Error ? cause.message : String(cause)}）`)
            throw new Error(`清单不存在或无法读取：${listId}`, { cause })
        }
    }

    /** 写入清单原文：目录缺失时先建出来，内容由调用方保证已是完整文档 */
    public async writeContent(listId: string, content: string): Promise<void> {
        await vscode.workspace.fs.createDirectory(this.dirUri())
        await vscode.workspace.fs.writeFile(this.fileUri(listId), new TextEncoder().encode(content))
    }

    /** 创建清单文件：同名的已有文件一律拒绝，不静默覆盖 */
    public async createFile(listId: string, content: string): Promise<void> {
        if (await this.isExisting(listId)) {
            throw new Error(`同名清单已存在：${listId}`)
        }
        await vscode.workspace.fs.createDirectory(this.dirUri())
        await vscode.workspace.fs.writeFile(this.fileUri(listId), new TextEncoder().encode(content))
        logger.info(`待办清单已创建：${listId}`)
    }

    /**
     * 重命名清单文件：文件名即清单名，走文件系统改名而不是「新建 + 删除」，保留原文件的修改时间。
     * 关键约束：目标名先经 fileUri 校验非法字符，且必须确认不存在同名文件，不覆盖任何既有清单。
     */
    public async renameFile(oldListId: string, newListId: string): Promise<void> {
        const target = this.fileUri(newListId)
        if (await this.isExisting(newListId)) {
            throw new Error(`同名清单已存在：${newListId}`)
        }
        await vscode.workspace.fs.rename(this.fileUri(oldListId), target, { overwrite: false })
        logger.info(`待办清单已重命名：${oldListId} → ${newListId}`)
    }

    /** 判定 todo 目录是否存在：用于区分「首次进入」与「用户已把清单删空」两种情况 */
    public async hasDirectory(): Promise<boolean> {
        try {
            const stat = await vscode.workspace.fs.stat(this.dirUri())
            return stat.type === vscode.FileType.Directory
        } catch {
            return false
        }
    }

    /** 删除清单文件：走统一删除入口，回收站不可用时由 storagePath 显式降级 */
    public async deleteFile(listId: string): Promise<DeleteOutcome> {
        const outcome = await deleteResource(this.fileUri(listId), false)
        logger.info(`待办清单已删除：${listId}（${outcome}）`)
        return outcome
    }

    /**
     * 判定清单是否仍在目录中：写操作前用它确认 id 来自真实文件，而不是前端捏造。
     * 关键约束：fileUri 的校验放在 try 之外——非法 id 应直接抛出「标识非法」，不能被当成「文件不存在」吞掉。
     */
    public async isExisting(listId: string): Promise<boolean> {
        const target = this.fileUri(listId)
        try {
            await vscode.workspace.fs.stat(target)
            return true
        } catch {
            return false
        }
    }
}
