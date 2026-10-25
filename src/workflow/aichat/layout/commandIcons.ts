/**
 * 写作命令图标映射：命令 id 到 Lucide 图标，供命令菜单与输入区徽章共用。
 * 复用约定：与 ../constants 的命令表解耦，避免常量文件依赖 UI 图标库。
 * 关键约束：键集须覆盖 AiCommandId 全部取值，新增命令时同步补充。
 */
import { PenLine, Sparkles, Type, Wand2 } from 'lucide-react'
import type { AiCommandId } from '../constants'
import type { LucideIcon } from 'lucide-react'

/** 命令图标映射 */
export const COMMAND_ICONS: Record<AiCommandId, LucideIcon> = {
    rewrite: PenLine,
    polish: Wand2,
    typo: Type,
    deai: Sparkles,
}
