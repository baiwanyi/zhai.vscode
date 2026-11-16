/**
 * 笔记本偏好存储：以 Memento 键值持久化置顶列表、排序方式、已展开集合与默认落点。
 * 复用 vscode.Memento（globalState）承载视图偏好，避免为展示顺序改动索引库表结构。
 * 关键约束：读取时剔除非字符串、非笔记本 id 的脏项并去重，列表顺序即展示顺序；
 * 目录改名后须调用 renameId 同步三个集合，否则置顶丢失、默认落点指向已不存在的目录；
 * 目录被删后须调用 removeUnder，默认落点被删时回落 null 由调用方决定新落点。
 */
import { isNotebookId, isNotebookSort } from '@shared/types/notebook'
import type { NotebookPrefs, NotebookSort } from '@shared/types/notebook'
import type { Memento } from 'vscode'

/** globalState 中承载笔记置顶笔记本的键名 */
const PINNED_IDS_KEY = 'zhai.note.notebookPinnedIds'

/** globalState 中承载排序、展开集合与默认落点的键名 */
const PREFS_KEY = 'zhai.note.notebookPrefs'

/** 默认排序：按修改时间降序，符合「最近动过的笔记本优先」的使用习惯 */
const DEFAULT_SORT: NotebookSort = 'mtime'

/** 偏好缺省值：首次使用时没有任何展开与默认落点 */
const DEFAULT_PREFS: NotebookPrefs = { sort: DEFAULT_SORT, openIds: [], defaultId: null }

/** 剔除重复与非法项后返回副本，保证写入与读取口径一致 */
function toNotebookIds(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return []
    }
    return [...new Set(value.filter((item): item is string => isNotebookId(item)))]
}

export class NotebookStore {
    public constructor(private readonly state: Memento) {}

    /** 读取置顶笔记本 id 列表：顺序即展示顺序（最近置顶在前） */
    public listPinned(): string[] {
        return toNotebookIds(this.state.get<unknown>(PINNED_IDS_KEY))
    }

    /** 批量设置置顶并返回更新后的列表：置顶时按传入顺序前插，取消时整体移除 */
    public async setPinned(ids: string[], isPinned: boolean): Promise<string[]> {
        const current = this.listPinned()
        const targets = new Set(ids)
        const untouched = current.filter((item) => !targets.has(item))
        const next = isPinned ? [...new Set(ids), ...untouched] : untouched
        await this.state.update(PINNED_IDS_KEY, next)
        return next
    }

    /** 读取视图偏好：残缺字段逐项回落到缺省值，不让脏数据影响渲染 */
    public readPrefs(): NotebookPrefs {
        const raw = this.state.get<unknown>(PREFS_KEY)
        if (typeof raw !== 'object' || raw === null) {
            return { ...DEFAULT_PREFS }
        }
        const candidate = raw as { sort?: unknown; openIds?: unknown; defaultId?: unknown }
        const sort = isNotebookSort(candidate.sort) ? candidate.sort : DEFAULT_SORT
        const defaultId = isNotebookId(candidate.defaultId) ? candidate.defaultId : null
        return { sort, openIds: toNotebookIds(candidate.openIds), defaultId }
    }

    /** 写入排序方式并回传生效值 */
    public async setSort(sort: NotebookSort): Promise<NotebookSort> {
        await this.writePrefs({ ...this.readPrefs(), sort })
        return sort
    }

    /** 覆盖已展开集合并回传生效值 */
    public async setOpen(ids: string[]): Promise<string[]> {
        const openIds = toNotebookIds(ids)
        await this.writePrefs({ ...this.readPrefs(), openIds })
        return openIds
    }

    /** 设置新建笔记的默认落点，传 null 表示暂无默认 */
    public async setDefault(id: string | null): Promise<void> {
        await this.writePrefs({ ...this.readPrefs(), defaultId: id === null ? null : id })
    }

    /**
     * 目录改名后的偏好迁移：置顶、展开与默认落点逐项原位替换。
     * 关键约束：新 id 已存在时不改动，避免产生重复项；无变化时不写回。
     */
    public async renameId(previousId: string, nextId: string): Promise<void> {
        const pinned = this.listPinned()
        const prefs = this.readPrefs()
        const hasPinned = pinned.includes(previousId)
        const hasOpen = prefs.openIds.includes(previousId)
        const isDefault = prefs.defaultId === previousId
        if (!hasPinned && !hasOpen && !isDefault) {
            return
        }
        if (hasPinned) {
            const next = pinned.map((item) => (item === previousId ? nextId : item))
            await this.state.update(PINNED_IDS_KEY, [...new Set(next)])
        }
        await this.writePrefs({
            sort: prefs.sort,
            openIds: prefs.openIds.map((item) => (item === previousId ? nextId : item)),
            defaultId: isDefault ? nextId : prefs.defaultId,
        })
    }

    /** 目录被删后的偏好清理：置顶、展开与默认落点一并移除，默认落点随之回落 null */
    public async removeUnder(id: string): Promise<void> {
        const pinned = this.listPinned()
        const prefs = this.readPrefs()
        const nextPinned = pinned.filter((item) => item !== id)
        const nextOpen = prefs.openIds.filter((item) => item !== id)
        const nextDefault = prefs.defaultId === id ? null : prefs.defaultId
        if (nextPinned.length !== pinned.length) {
            await this.state.update(PINNED_IDS_KEY, nextPinned)
        }
        if (nextOpen.length !== prefs.openIds.length || nextDefault !== prefs.defaultId) {
            await this.writePrefs({ sort: prefs.sort, openIds: nextOpen, defaultId: nextDefault })
        }
    }

    /**
     * 自愈：磁盘上已不存在的笔记本不再出现在偏好里。
     * 关键约束：只在集合真的变化时写回，避免每次打开面板都触发一次 globalState 写入。
     */
    public async prune(validIds: ReadonlySet<string>): Promise<void> {
        const pinned = this.listPinned()
        const prefs = this.readPrefs()
        const nextPinned = pinned.filter((item) => validIds.has(item))
        const nextOpen = prefs.openIds.filter((item) => validIds.has(item))
        const nextDefault = prefs.defaultId !== null && validIds.has(prefs.defaultId) ? prefs.defaultId : null
        if (nextPinned.length !== pinned.length) {
            await this.state.update(PINNED_IDS_KEY, nextPinned)
        }
        if (nextOpen.length !== prefs.openIds.length || nextDefault !== prefs.defaultId) {
            await this.writePrefs({ sort: prefs.sort, openIds: nextOpen, defaultId: nextDefault })
        }
    }

    /** 统一写入口径：只落三个受控字段，避免把调用方的临时结构写进 globalState */
    private async writePrefs(prefs: NotebookPrefs): Promise<void> {
        await this.state.update(PREFS_KEY, {
            sort: prefs.sort,
            openIds: prefs.openIds,
            defaultId: prefs.defaultId,
        })
    }
}
