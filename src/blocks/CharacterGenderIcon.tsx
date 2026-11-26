/**
 * 性别图标：按人物性别渲染 Mars（男，蓝）/ Venus（女，红），供人物列表、大纲出场名单、AI 对话候选与微博主页共用。
 * 复用约定：图标取 lucide，配色沿用项目图表语义色（男 chart-1 / 女 chart-5），类名经 cn 合并，调用方可用 className 覆盖尺寸。
 * 关键约束：图标参与读屏，必须带 role="img" 与中文 aria-label；本组件只表达性别，不承载姓名或章数等业务文案；
 * gender 只接受 male / female 两值，与 press 的 CharacterGender 同构，未知性别由调用方决定是否渲染。
 */
import { cn } from 'cn'
import { Mars, Venus } from 'lucide-react'
import type { JSX } from 'react'

interface CharacterGenderIconProps {
    /** 人物性别：只接受男 / 女两值，未知性别由调用方过滤 */
    gender: 'male' | 'female'
    /** 尺寸与配色覆盖：默认 size-3.5，与人物列表口径一致 */
    className?: string
}

/** 性别图标：男性蓝、女性红，默认尺寸对齐人物卡 */
export function CharacterGenderIcon({ gender, className }: CharacterGenderIconProps): JSX.Element {
    if (gender === 'male') {
        return <Mars className={cn('size-3.5 shrink-0 text-chart-1', className)} role="img" aria-label="男" />
    }
    return <Venus className={cn('size-3.5 shrink-0 text-chart-5', className)} role="img" aria-label="女" />
}
