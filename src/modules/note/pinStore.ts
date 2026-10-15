/**
 * 笔记置顶存储：以 Memento 键值持久化置顶路径列表，向上提供顺序稳定、幂等的读写能力。
 * 复用 vscode.Memento（globalState）承载视图偏好，避免为展示顺序改动索引库表结构。
 * 关键约束：读取时剔除非法项与重复项，列表顺序即展示顺序（最近置顶在前）；
 * 传入路径须由调用方先用索引库校验存在性，本模块不做路径合法性判断。
 */
import type { Memento } from 'vscode'

/** globalState 中承载置顶路径的键名 */
const PINNED_PATHS_KEY = 'zhai.note.pinnedPaths'

export class PinStore {
    public constructor(private readonly state: Memento) {}

    /** 读取置顶路径列表：非数组、非字符串项与重复项一律剔除，其余保持既有顺序 */
    public list(): string[] {
        const raw = this.state.get<unknown>(PINNED_PATHS_KEY)
        if (!Array.isArray(raw)) {
            return []
        }
        const paths = raw.filter((item): item is string => typeof item === 'string')
        return [...new Set(paths)]
    }

    /** 批量设置置顶状态并返回更新后的列表：置顶时按传入顺序前插，取消时整体移除 */
    public async setPinned(paths: string[], isPinned: boolean): Promise<string[]> {
        const current = this.list()
        const targets = new Set(paths)
        const untouched = current.filter((item) => !targets.has(item))
        const next = isPinned ? [...new Set(paths), ...untouched] : untouched
        await this.state.update(PINNED_PATHS_KEY, next)
        return next
    }
}
