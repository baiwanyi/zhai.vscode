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

    /**
     * 迁移置顶记录：文档跟随标题改名后，原位替换路径以保持置顶状态与原有顺序。
     * 关键约束：旧路径不在列表或新路径已被占用时不做改动，避免出现重复项；无变化时不写回。
     */
    public async renamePath(previousPath: string, nextPath: string): Promise<void> {
        const current = this.list()
        if (!current.includes(previousPath) || current.includes(nextPath)) {
            return
        }
        await this.state.update(
            PINNED_PATHS_KEY,
            current.map((item) => (item === previousPath ? nextPath : item)),
        )
    }

    /**
     * 目录改名后的批量迁移：该目录下所有置顶笔记原位换前缀，其余条目保持原顺序。
     * 关键约束：只替换完整路径段前缀，notes/AMZ 不会误伤 notes/AMZ2 下的笔记；无变化时不写回。
     */
    public async renamePrefix(previousPrefix: string, nextPrefix: string): Promise<void> {
        const current = this.list()
        const previous = `${previousPrefix}/`
        const next = `${nextPrefix}/`
        if (!current.some((item) => item.startsWith(previous))) {
            return
        }
        const migrated = current.map((item) =>
            item.startsWith(previous) ? `${next}${item.slice(previous.length)}` : item,
        )
        // 迁移后可能与既有路径重复（目标目录已有同名笔记），去重后再落库
        await this.state.update(PINNED_PATHS_KEY, [...new Set(migrated)])
    }

    /**
     * 目录被删后的清理：移除该目录下全部置顶记录，避免偏好里残留失效路径。
     * 关键约束：同样按完整路径段前缀匹配，无命中时不写回。
     */
    public async removeUnder(prefix: string): Promise<void> {
        const current = this.list()
        const scope = `${prefix}/`
        const next = current.filter((item) => !item.startsWith(scope))
        if (next.length === current.length) {
            return
        }
        await this.state.update(PINNED_PATHS_KEY, next)
    }
}
