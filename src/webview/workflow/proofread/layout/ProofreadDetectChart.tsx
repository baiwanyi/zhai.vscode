/**
 * AI 特征检测环形图：三类占比的饼图与图例，单独成文件以便按需加载。
 * 复用约定：图表容器取 @components/ui/chart（依赖 recharts），配色与名称取 ../constants；
 * 本组件是页面里唯一引入 recharts 的位置，被 ProofreadAiDetectCard 以 React.lazy 动态载入。
 * 关键约束：始终使用固定色（绿/红/橙）而非主题色，保证深浅主题下三类占比可区分；
 * 数据全 0 时仍渲染空心环，避免出现整块空白但图例显示 0% 的割裂感。
 */
import { Cell, Pie, PieChart } from 'recharts'
import { ChartContainer } from '@components/ui/chart'
import type { ChartConfig } from '@components/ui/chart'
import type { ProofreadAiDetectResult } from '@shared/types/proofread'
import type { JSX } from 'react'
import { DETECT_LABEL_NAMES } from '../constants'

/** 三类占比的配色：绿=人工、红=AI、橙=疑似 */
const DETECT_COLORS: Readonly<Record<0 | 1 | 2, string>> = {
    0: 'hsl(160 84% 39%)',
    1: 'hsl(0 84% 60%)',
    2: 'hsl(38 92% 50%)',
}

/** 环形图配置：交给 ChartContainer 生成主题变量 */
const DETECT_CHART_CONFIG: ChartConfig = {
    human: { label: DETECT_LABEL_NAMES[0], color: DETECT_COLORS[0] },
    ai: { label: DETECT_LABEL_NAMES[1], color: DETECT_COLORS[1] },
    suspect: { label: DETECT_LABEL_NAMES[2], color: DETECT_COLORS[2] },
}

interface ProofreadDetectChartProps {
    result: ProofreadAiDetectResult
}

/** 百分比展示：保留两位，与检测报告口径一致 */
function toPercent(value: number): string {
    return `${(value * 100).toFixed(2)}%`
}

export function ProofreadDetectChart({ result }: ProofreadDetectChartProps): JSX.Element {
    const chartData = [
        { key: 'human', name: DETECT_LABEL_NAMES[0], value: result.humanRatio, fill: DETECT_COLORS[0] },
        { key: 'ai', name: DETECT_LABEL_NAMES[1], value: result.aiRatio, fill: DETECT_COLORS[1] },
        { key: 'suspect', name: DETECT_LABEL_NAMES[2], value: result.suspectRatio, fill: DETECT_COLORS[2] },
    ]
    return (
        <div className="flex flex-col gap-2">
            <ChartContainer config={DETECT_CHART_CONFIG} className="mx-auto aspect-square max-h-44">
                <PieChart>
                    <Pie
                        data={chartData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius="58%"
                        outerRadius="86%"
                        paddingAngle={2}
                        isAnimationActive={false}
                    >
                        {chartData.map((item) => (
                            <Cell key={item.key} fill={item.fill} stroke="none" />
                        ))}
                    </Pie>
                </PieChart>
            </ChartContainer>
            <div className="flex flex-col gap-1">
                {chartData.map((item) => (
                    <div key={item.key} className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5">
                            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: item.fill }} />
                            {item.name}
                        </span>
                        <span className="text-muted-foreground">{toPercent(item.value)}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}
