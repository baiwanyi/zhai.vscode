/**
 * 生图页多选操作区：标题行右侧的「选择」开关，以及进入选择模式后展开的全选与批量删除。
 * 复用约定：外壳固定为 components/AppPage 的 AppAction（自带标题行右侧定位与对齐），
 * 按钮取 components/Button（图标按钮借 tooltip 作视觉提示），图标取 lucide-react：
 * 未选择时 ListChecks、已选择时 X。
 * 关键约束：tooltip 依赖挂载器的 TooltipProvider（见 bootstrap），单独渲染时须自行包裹；
 * 图标按钮无可见文字，可访问名由 aria-label 承担，tooltip 只作补充、不参与名称计算；
 * 常态只渲染开关按钮，多选信息与批量删除仅在 isSelecting 时出现，避免标题行长期多占位；
 * 全选只覆盖已渲染图片，删除入口在无选中或正在删除时禁用；动作与落盘都由页面持有。
 */
import { ListChecks, Trash2, X } from 'lucide-react'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

interface ImageSelectionActionsProps {
    /** 是否处于多选模式：决定展开批量操作与切换按钮的图标 */
    isSelecting: boolean
    /** 当前已选张数 */
    selectedCount: number
    /** 已渲染张数：为 0 时全选无意义 */
    visibleCount: number
    /** 已选与已渲染张数相等：全选按钮改为取消 */
    isAllVisibleSelected: boolean
    /** 批量删除中的张数：非空表示进行中，期间禁止重复触发 */
    removingTotal: number | null
    onToggleSelecting: () => void
    onSelectAll: () => void
    /** 请求删除选中：由页面弹出二次确认 */
    onRequestDelete: () => void
}

export function ImageSelectionActions({
    isSelecting,
    selectedCount,
    visibleCount,
    isAllVisibleSelected,
    removingTotal,
    onToggleSelecting,
    onSelectAll,
    onRequestDelete,
}: ImageSelectionActionsProps): JSX.Element {
    /** 批量删除进行中：整组入口冻结，避免中途改动正在删除的那批选择集 */
    const isBusy = removingTotal !== null
    /** 全选只在有已渲染图片时可用，删除进行中一并冻结 */
    const canSelectAll = visibleCount > 0 && !isBusy
    /** 删除入口在无选中或删除进行中禁用，防止空提交与重复触发 */
    const canDelete = selectedCount > 0 && !isBusy
    const toggleLabel = isSelecting ? '退出选择' : '选择'

    return (
        <div className="flex items-center gap-2">
            {isSelecting ? (
                <>
                    {/* 数量变化需要读屏播报：切换筛选或勾选时用户能听到「已选 N 张」 */}
                    <span aria-live="polite" className="text-muted-foreground text-xs whitespace-nowrap tabular-nums">
                        已选 {selectedCount} 张
                    </span>
                    <Button variant="secondary" disabled={!canSelectAll} onClick={onSelectAll}>
                        {isAllVisibleSelected ? '取消全选' : '全选'}
                    </Button>
                    <Button variant="destructive" disabled={!canDelete} onClick={onRequestDelete}>
                        <Trash2 />
                        {isBusy ? `正在删除 ${String(removingTotal)} 张` : '删除选中'}
                    </Button>
                </>
            ) : null}
            {/* 图标按钮没有可见文字，可访问名必须由 aria-label 承担，tooltip 仅作视觉补充 */}
            <Button
                size="icon"
                variant="secondary"
                aria-label={toggleLabel}
                aria-pressed={isSelecting}
                tooltip={toggleLabel}
                disabled={isBusy}
                onClick={onToggleSelecting}
            >
                {isSelecting ? <X /> : <ListChecks />}
            </Button>
        </div>
    )
}
