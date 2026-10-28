/**
 * 待办契约：清单摘要、清单详情与单条待办的结构，以及前端回传载荷的收窄函数。
 * 使用方：工作流待办页（src/workflow/todo）与宿主侧 todo 模块、AiChatViewProvider 的协议分发。
 * 复用约定：清单 id 即 todo/ 目录下的文件名主干，条目定位统一用「序号 + 文本」双因子，前端不拼装路径。
 * 关键约束：前端回传的 listId 只是候选值，宿主须先在目录扫描结果中命中才可用；
 * 收窄函数逐字段校验，任一字段形态不符即整体拒绝，不把可疑载荷透传给业务层。
 */

/** 单条待办：index 为该条在文件中的序号，text 为原文，done 为勾选态 */
export interface TodoItem {
    index: number
    text: string
    done: boolean
}

/** 清单摘要：id 为文件名主干，counts 供标签与空态直接展示 */
export interface TodoListSummary {
    id: string
    name: string
    doneCount: number
    totalCount: number
}

/** 清单详情：列表写操作一律回传完整详情，前端整体替换，避免逐条对账 */
export interface TodoListDetail {
    list: TodoListSummary
    items: TodoItem[]
}

/** 清单快照：清单列表 + 当前激活清单，附带目录路径供空态提示 */
export interface TodoListsSnapshot {
    lists: TodoListSummary[]
    activeListId: string | null
    dirPath: string
}

/** 清单定位请求：切换清单与清单内写操作共用 */
export interface TodoListRequest {
    listId: string
}

/** 重命名请求：只改清单名，文件内的一级标题由宿主同步 */
export interface TodoListRenameRequest extends TodoListRequest {
    name: string
}

/** 新增待办请求：texts 按行拆分后的原文，一次写盘 */
export interface TodoItemsAddRequest extends TodoListRequest {
    texts: string[]
}

/** 勾选请求：index 作首选定位、text 作校验，二者不符时由宿主按文本回查 */
export interface TodoItemToggleRequest extends TodoListRequest {
    index: number
    text: string
    done: boolean
}

/** 删除请求：与勾选同一套定位口径 */
export interface TodoItemDeleteRequest extends TodoListRequest {
    index: number
    text: string
}

/** 清单 id 形态上限：文件名主干远短于此值 */
const MAX_LIST_ID_LENGTH = 60

/** 单次新增条数上限：一次粘贴整篇清单时的保护性上限 */
export const MAX_TODO_TEXTS = 200

/** 单条待办文本上限：超出由宿主截断，避免单行撑爆界面 */
export const MAX_TODO_TEXT_LENGTH = 500

/** 判断是否为对象形态，供各收窄函数共用 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}

/** 收窄清单 id：非空且不超长，具体非法字符由宿主侧再校验 */
function readListId(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null
    }
    const text = value.trim()
    return text.length === 0 || text.length > MAX_LIST_ID_LENGTH ? null : text
}

/** 收窄清单定位请求 */
export function isTodoListRequest(payload: unknown): payload is TodoListRequest {
    return isRecord(payload) && readListId(payload.listId) !== null
}

/** 收窄重命名请求：名称形态只校验非空，非法字符与重名由宿主侧再校验 */
export function isTodoListRenameRequest(payload: unknown): payload is TodoListRenameRequest {
    if (!isRecord(payload) || readListId(payload.listId) === null) {
        return false
    }
    const { name } = payload
    return typeof name === 'string' && name.trim().length > 0
}

/** 收窄新增请求：文本数组逐项须为字符串 */
export function isTodoItemsAddRequest(payload: unknown): payload is TodoItemsAddRequest {
    if (!isRecord(payload) || readListId(payload.listId) === null) {
        return false
    }
    const { texts } = payload
    return Array.isArray(texts) && texts.length > 0 && texts.every((item) => typeof item === 'string')
}

/** 收窄勾选请求：index 须为非负整数，text 须为字符串，done 须为布尔 */
export function isTodoItemToggleRequest(payload: unknown): payload is TodoItemToggleRequest {
    return readItemTarget(payload) !== null && typeof (payload as { done?: unknown }).done === 'boolean'
}

/** 收窄删除请求 */
export function isTodoItemDeleteRequest(payload: unknown): payload is TodoItemDeleteRequest {
    return readItemTarget(payload) !== null
}

/** 条目定位三元组的共用校验：清单 id、序号与文本必须同时成立 */
function readItemTarget(payload: unknown): { listId: string; index: number; text: string } | null {
    if (!isRecord(payload)) {
        return null
    }
    const listId = readListId(payload.listId)
    const { index, text } = payload
    if (listId === null || typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
        return null
    }
    if (typeof text !== 'string' || text.length === 0) {
        return null
    }
    return { listId, index, text }
}
