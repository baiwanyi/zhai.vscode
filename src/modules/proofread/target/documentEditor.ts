/**
 * 校对文档编辑：按相对路径取到已打开或待打开的文档，执行批量替换与区间定位。
 * 复用 targetReader 的路径校验与 Uri 拼装，写回统一走 WorkspaceEdit，不依赖编辑器是否可见。
 * 关键约束：每条替换必须回查原文一致（quote 与文档内容逐字相符）且区间不重叠，对不上的整条跳过；
 * 写回前把全文交给调用方留底，确保 AI 或批量替换改坏时可以回到动手前的状态；
 * 前端传入的偏移不可信，一律按文档当前长度与单条区间长度上限重新校验。
 */
import * as vscode from 'vscode'
import { resolveProofreadUri } from './targetReader'
import type {
    ProofreadApplyRequest,
    ProofreadApplyResult,
    ProofreadRevealRequest,
    ProofreadRevealResult,
} from '../../../shared/types/proofread'

/** 单次写回的区间上限：防止异常载荷触发大面积改写 */
const MAX_EDITS = 500

/** 单条替换文本长度上限 */
const MAX_REPLACEMENT_LENGTH = 200

/** 单条命中区间长度上限：校对命中都是短片段 */
const MAX_RANGE_LENGTH = 400

/** 控制字符：替换文本不允许携带换行与不可见字符 */
const CONTROL_CHARS = /\p{Cc}/u

/** 按相对路径取文档：优先复用已打开的实例，避免写回落到旧版本 */
export async function readDocumentByPath(relativePath: string): Promise<vscode.TextDocument> {
    const uri = resolveProofreadUri(relativePath)
    const opened = vscode.workspace.textDocuments.find(
        (document) => document.uri.fsPath.toLowerCase() === uri.fsPath.toLowerCase(),
    )
    return opened ?? vscode.workspace.openTextDocument(uri)
}

/** 单条替换是否可用：区间与原文逐字相符 */
interface ValidatedEdit {
    start: number
    end: number
    replacement: string
}

/** 校验单条替换：返回 null 表示跳过 */
function validateEdit(
    edit: ProofreadApplyRequest['edits'][number],
    offsetBase: number,
    fullText: string,
): ValidatedEdit | null {
    const { start, end, quote, replacement } = edit
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) {
        return null
    }
    if (end - start > MAX_RANGE_LENGTH || replacement.length > MAX_REPLACEMENT_LENGTH) {
        return null
    }
    if (CONTROL_CHARS.test(replacement)) {
        return null
    }
    const documentStart = offsetBase + start
    const documentEnd = offsetBase + end
    if (documentEnd > fullText.length) {
        return null
    }
    return fullText.slice(documentStart, documentEnd) === quote ? { start, end, replacement } : null
}

/** 批量写回：返回实际应用与跳过的条数 */
export async function applyProofreadEdits(
    request: ProofreadApplyRequest,
    beforeWrite?: (uri: vscode.Uri, content: string) => Promise<void>,
): Promise<ProofreadApplyResult> {
    const document = await readDocumentByPath(request.path)
    const fullText = document.getText()
    const offsetBase = request.offsetBase
    if (!Number.isInteger(offsetBase) || offsetBase < 0 || offsetBase > fullText.length) {
        throw new Error('写回失败：正文起始偏移非法，请重新校对')
    }
    const source = request.edits.slice(0, MAX_EDITS)
    const validated: ValidatedEdit[] = []
    let skipped = request.edits.length - source.length
    for (const edit of source) {
        const result = validateEdit(edit, offsetBase, fullText)
        if (result === null) {
            skipped += 1
            continue
        }
        validated.push(result)
    }
    validated.sort((left, right) => left.start - right.start)
    const workspaceEdit = new vscode.WorkspaceEdit()
    let previousEnd = -1
    let applied = 0
    for (const item of validated) {
        if (item.start < previousEnd) {
            skipped += 1
            continue
        }
        previousEnd = item.end
        workspaceEdit.replace(
            document.uri,
            new vscode.Range(document.positionAt(offsetBase + item.start), document.positionAt(offsetBase + item.end)),
            item.replacement,
        )
        applied += 1
    }
    if (applied === 0) {
        return { applied: 0, skipped }
    }
    if (beforeWrite) {
        await beforeWrite(document.uri, fullText)
    }
    const isApplied = await vscode.workspace.applyEdit(workspaceEdit)
    if (!isApplied) {
        throw new Error('写回失败：编辑器拒绝应用本次修改')
    }
    return { applied, skipped }
}

/** 定位区间：打开文档并选中，让用户直接看到命中位置 */
export async function revealProofreadRange(request: ProofreadRevealRequest): Promise<ProofreadRevealResult> {
    const document = await readDocumentByPath(request.path)
    const length = document.getText().length
    const start = Math.min(Math.max(request.documentStart, 0), length)
    const end = Math.min(Math.max(request.documentEnd, start), length)
    const selection = new vscode.Range(document.positionAt(start), document.positionAt(end))
    await vscode.window.showTextDocument(document, { selection, preserveFocus: false })
    return { revealed: true }
}
