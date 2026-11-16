/**
 * 回收站内容分派：按加载状态、失败与空集合选择提示或列表，自身不取数、不持有待处理状态。
 * 复用 StateEmpty 承载加载与空态、ListErrorAlert 承载失败提示、TrashItemRow 承载行；
 * 空态说明取 constants 的保留规则文案，与页头描述同源。
 * 关键约束：四个分支互斥且按 loading → error → empty → list 早返回；列表 key 用条目 id；
 * 回调只上抛条目 id，行内绑定由本组件完成，调用方不必为每行创建闭包。
 */
import { Trash2 } from 'lucide-react'
import { ItemGroup } from '@components/ui/item'
import type { TrashItem } from '@shared/types/trash'
import { ListErrorAlert } from '@webview/components/ListErrorAlert'
import { StateEmpty } from '@webview/components/StateEmpty'
import { TRASH_RETENTION_HINT } from './constants'
import { TrashItemRow } from './TrashItemRow'
import type { TrashStatus } from './useTrash'
import type { JSX } from 'react'

interface TrashContentProps {
    status: TrashStatus
    error: string | null
    items: TrashItem[]
    /** 有操作在途时禁用行内入口，避免并发清除同一批条目 */
    isBusy: boolean
    onRestore: (id: string) => void
    onPurge: (id: string) => void
}

export function TrashContent({ status, error, items, isBusy, onRestore, onPurge }: TrashContentProps): JSX.Element {
    if (status === 'loading') {
        return <StateEmpty title="正在读取回收站" isLoading className="border px-3 py-4" />
    }
    if (status === 'error') {
        return <ListErrorAlert title="回收站读取失败" error={error} />
    }
    if (items.length === 0) {
        return (
            <StateEmpty
                title="回收站是空的"
                description={TRASH_RETENTION_HINT}
                icon={Trash2}
                className="border px-3 py-4"
            />
        )
    }
    return (
        <ItemGroup className="has-data-[size=sm]:gap-0">
            {items.map((item) => (
                <TrashItemRow
                    key={item.id}
                    item={item}
                    isBusy={isBusy}
                    onRestore={() => onRestore(item.id)}
                    onPurge={() => onPurge(item.id)}
                />
            ))}
        </ItemGroup>
    )
}
