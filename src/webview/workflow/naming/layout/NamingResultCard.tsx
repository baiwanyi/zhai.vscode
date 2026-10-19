/**
 * 结果卡片：整张卡片即复制按钮，名字居中显示，复制结果统一由 sonner 提示。
 * 复用约定：卡片复用 ui/button 的 outline 变体，复制走 ../utils 的 copyName（写剪贴板）。
 * 关键约束：卡片不提供多余提示属性（title 等），复制成功 / 失败均通过 toast 反馈，不在卡片内变化图标。
 */
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { NamingCandidate } from '@/shared/types/naming'
import type { JSX } from 'react'
import { copyName } from '../utils'

interface NamingResultCardProps {
    candidate: NamingCandidate
}

export function NamingResultCard({ candidate }: NamingResultCardProps): JSX.Element {
    const handleCopy = async (): Promise<void> => {
        const isSuccess = await copyName(candidate.name)
        if (isSuccess) {
            toast.success(`已复制「${candidate.name}」`)
            return
        }
        toast.error('复制失败，请手动选中后复制')
    }

    return (
        <Button
            variant="outline"
            className="h-8 w-full min-w-0 justify-center px-2 font-normal"
            aria-label={`复制 ${candidate.name}`}
            onClick={() => void handleCopy()}
        >
            <span className="truncate">{candidate.name}</span>
        </Button>
    )
}
