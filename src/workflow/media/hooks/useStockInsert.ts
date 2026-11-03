/**
 * 在线图库插入钩子：一次点击 → 宿主下载/复用 → 写入光标处，失败按原因分支提示并留重试入口。
 * 复用约定：请求走 stock/insert，异常统一 toastError；成功回调由页面决定如何更新列表。
 * 关键约束：同一时刻只允许一张在途——宿主也会拒绝并发，前端先禁用其余卡片避免用户连点；
 * 失败原因分四类给不同文案，「没有活动编辑器」不再静默，因为用户是主动点的；
 * 下载失败保留重试入口，文件已落盘的场景由宿主在回执里说明。
 */
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import type { StockInsertResult } from '@shared/types/stock'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'

interface UseStockInsertOptions {
    /** 插入成功：带上图片标识，页面据此更新「已下载」列表或标记卡片 */
    onInserted?: (id: string, result: StockInsertResult) => void
}

interface UseStockInsertResult {
    /** 正在处理的图片标识：卡片据此转圈并禁用其余按钮 */
    insertingId: string | null
    /** 上次失败的图片标识：卡片据此显示「重试」 */
    failedId: string | null
    insert: (id: string) => void
}

export function useStockInsert(options?: UseStockInsertOptions): UseStockInsertResult {
    const [insertingId, setInsertingId] = useState<string | null>(null)
    const [failedId, setFailedId] = useState<string | null>(null)
    const onInserted = options?.onInserted

    const run = useCallback(
        async (id: string): Promise<void> => {
            setInsertingId(id)
            setFailedId(null)
            try {
                const result = await request<StockInsertResult>('stock/insert', { id })
                if (result.inserted) {
                    toast.success(
                        result.duplicated === true
                            ? '已插入（该文档此前已引用过这张图）'
                            : result.source === 'local'
                              ? '已插入到光标处（复用本地图片）'
                              : '已插入到光标处',
                    )
                    onInserted?.(id, result)
                    return
                }
                switch (result.reason) {
                    case 'no-editor':
                        toast.error('请先把光标放到一个 Markdown 文档中')
                        break
                    case 'not-markdown':
                        toast.error('仅在 Markdown 文件中支持插入')
                        break
                    case 'unsaved':
                        toast.error('请先保存当前文档再插入')
                        break
                    case 'download':
                        setFailedId(id)
                        toast.error('图片下载失败，可点卡片上的「重试」')
                        break
                    case 'write':
                        setFailedId(id)
                        toast.error('写入文档失败，请重试')
                        break
                    default:
                        toast.error('插入失败，请重试')
                        break
                }
            } catch (cause) {
                setFailedId(id)
                toastError(cause)
            } finally {
                setInsertingId(null)
            }
        },
        [onInserted],
    )

    /** 对外只给同步回调：JSX 属性不收返回 Promise 的处理函数 */
    const insert = useCallback(
        (id: string): void => {
            if (insertingId !== null) {
                return
            }
            void run(id)
        },
        [insertingId, run],
    )

    return { insertingId, failedId, insert }
}
