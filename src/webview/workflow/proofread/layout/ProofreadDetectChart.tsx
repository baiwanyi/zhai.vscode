/**
 * AI 特征检测环形图：三类占比的饼图与图例，单独成文件以便按需加载。
 * 复用约定：图表容器取 @components/ui/chart（依赖 recharts），三类名称与配色就地声明在本文件；
 * 「重新检测」与图表同列呈现，回调由父级传入；扣减回执与免责语也收在这里，图表区块自成一体；
 * 本组件是页面里唯一引入 recharts 的位置，由检测卡懒加载。
 * 关键约束：配色取主题图表色（--chart-2 绿 / --chart-5 红 / --chart-3 橙），跟随 VSCode 明暗主题；
 * 配色写在数据项的 fill 上，描边统一在 Pie 上关闭——Cell 组件已在 recharts 4.0 前弃用；
 * 容器宽高必须显式给出（size-32），只给 aspect-ratio 或依赖 fit-content 宽度会让 ResponsiveContainer 测到 0；
 * 三类占比全为 0 时 recharts 不绘制扇区，此时只有图例给出 0.00%，不会出现空心环。
 */
import { Pie, PieChart } from 'recharts'
import { ChartContainer } from '@components/ui/chart'
import type { ChartConfig } from '@components/ui/chart'
import type { ProofreadAiDetectResult } from '@shared/types/proofread'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

/** 三类占比的展示名：与朱雀 labels_ratio 的 0/1/2 对应 */
const DETECT_LABEL_NAMES: Readonly<Record<0 | 1 | 2, string>> = {
    0: '人工特征',
    1: 'AI 特征',
    2: '疑似 AI',
}

/** 三类占比的配色：绿=人工、红=AI、橙=疑似，取 VSCode 主题图表色，随明暗主题自动切换 */
const DETECT_COLORS: Readonly<Record<0 | 1 | 2, string>> = {
    0: 'var(--chart-1)',
    1: 'var(--chart-5)',
    2: 'var(--chart-3)',
}

/** 环形图配置：交给 ChartContainer 生成主题变量 */
const DETECT_CHART_CONFIG: ChartConfig = {
    human: { label: DETECT_LABEL_NAMES[0], color: DETECT_COLORS[0] },
    ai: { label: DETECT_LABEL_NAMES[1], color: DETECT_COLORS[1] },
    suspect: { label: DETECT_LABEL_NAMES[2], color: DETECT_COLORS[2] },
}

interface ProofreadDetectChartProps {
    result: ProofreadAiDetectResult
    /** 重新检测：由父级决定重跑流程，本组件只负责按钮外观与位置 */
    onDetect: () => void
}

/** 百分比展示：保留两位，与检测报告口径一致 */
function toPercent(value: number): string {
    return `${(value * 100).toFixed(2)}%`
}

export function ProofreadDetectChart({ result, onDetect }: ProofreadDetectChartProps): JSX.Element {
    const chartData = [
        { key: 'human', name: DETECT_LABEL_NAMES[0], value: result.humanRatio, fill: DETECT_COLORS[0] },
        { key: 'ai', name: DETECT_LABEL_NAMES[1], value: result.aiRatio, fill: DETECT_COLORS[1] },
        { key: 'suspect', name: DETECT_LABEL_NAMES[2], value: result.suspectRatio, fill: DETECT_COLORS[2] },
    ]
    return (
        <div className="flex items-center">
            <div className="flex w-1/2 shrink-0 flex-col items-center">
                <ChartContainer config={DETECT_CHART_CONFIG} className="size-32">
                    <PieChart>
                        {/* 扇区配色走数据项的 fill：Cell 已在 recharts 4 前弃用，3.x 会直接读取数据项上的样式 */}
                        <Pie
                            data={chartData}
                            dataKey="value"
                            nameKey="name"
                            innerRadius="58%"
                            outerRadius="86%"
                            paddingAngle={2}
                            stroke="none"
                            isAnimationActive={false}
                        />
                    </PieChart>
                </ChartContainer>
                <Button size="sm" variant="outline" onClick={onDetect}>
                    重新检测
                </Button>
            </div>
            <div className="flex min-w-0 flex-col gap-3">
                {chartData.map((item) => (
                    <div key={item.key} className="flex min-w-0 items-center justify-between gap-1.5 text-xs">
                        <span className="flex min-w-0 items-center gap-1.5">
                            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: item.fill }} />
                            <span className="truncate">{item.name}</span>
                        </span>
                        <span className="shrink-0 text-muted-foreground tabular-nums">{toPercent(item.value)}</span>
                    </div>
                ))}
                {/* 扣减回执与免责语随图表一起呈现：代价与结论边界不拆到别处 */}
                <div className="text-xs text-muted-foreground">
                    <p>扣减 {result.usedTokens} tokens</p>
                    <p>本结果仅为辅助判断，不应作为任何审核或处罚的决定性依据</p>
                </div>
            </div>
        </div>
    )
}
