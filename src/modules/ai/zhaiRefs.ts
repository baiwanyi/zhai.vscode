/**
 * 对话框里的 `@zhai\...` 路径引用：把用户手写的存储根相对路径展开成可直接读取的绝对路径。
 * 复用约定：令牌识别与段校验取 @shared/utils/zhaiPath（与前端粘贴识别同一份口径），
 * 存储根取 common/config 的 resolveStorageRoot，存在性判断走 vscode.workspace.fs.stat。
 * 关键约束：只展开落在存储根内且真实存在的目标，越界、含盘符、含 `..` 或不存在时原样保留，
 * 不在提示层猜测意图；展开只发生在发送瞬间，落库正文与气泡回显仍是用户原文；
 * 行号后缀（`:42` / `:42-50`）按单行或区间原样回写，交由模型按「路径:行」约定读取。
 */
import * as path from 'node:path'
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { readZhaiTargets } from '@shared/utils/zhaiPath'
import type { ZhaiTarget } from '@shared/utils/zhaiPath'

/** 目标是否落在存储根内：根自身不算，跨盘时 relative 返回绝对路径即判定越界 */
function isInsideRoot(root: string, target: string): boolean {
    const offset = path.relative(root, target)
    return offset.length > 0 && !offset.startsWith('..') && !path.isAbsolute(offset)
}

/** 目标是否存在：目录同样算命中，模型可据此继续浏览 */
async function isReachable(target: string): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(vscode.Uri.file(target))
        return true
    } catch {
        return false
    }
}

/** 行号回写：单行写作 `:42`，区间写作 `:42-50`，整篇不带后缀 */
function toLineSuffix(target: ZhaiTarget): string {
    if (target.startLine === null) {
        return ''
    }
    return target.endLine === null || target.endLine === target.startLine
        ? `:${String(target.startLine)}`
        : `:${String(target.startLine)}-${String(target.endLine)}`
}

/**
 * 展开正文里的 `@zhai\...` 路径：命中且可读的替换成绝对路径，其余保持原样。
 * 关键约束：无令牌时原样返回且不触达文件系统，纯问答不因本能力多一次 IO。
 */
export async function expandZhaiRefs(content: string): Promise<string> {
    if (!content.includes('@zhai')) {
        return content
    }
    const matches = readZhaiTargets(content)
    if (matches.length === 0) {
        return content
    }
    const root = resolveStorageRoot().fsPath
    let output = ''
    let cursor = 0
    for (const match of matches) {
        output += content.slice(cursor, match.index)
        cursor = match.index + match.token.length
        const target = path.join(root, ...match.target.relative.split('/'))
        if (!isInsideRoot(root, target) || !(await isReachable(target))) {
            output += match.token
            continue
        }
        output += `${target}${toLineSuffix(match.target)}`
    }
    return output + content.slice(cursor)
}
