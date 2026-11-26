/**
 * 卷末统计对话框：把本卷的进度、伏笔、出场人物与结构覆盖聚合到一处，供每写完一卷时集中核对。
 * 复用约定：统计口径一律取 press/utils 的 summarizeVolume / summarizeVolumeCast / findClueWarnings，
 * 章节引用匹配取 isClueRefMatched；卡片取 ui/card，出场名单取 block/VolumeCastList（与卷卡片共用），
 * 按钮取 @webview/components/Button。
 * 关键约束：只读展示，不新增判定、不改任何状态；伏笔逾期数与线索页预警同源，人物章数与按 characterIds 聚合一致，
 * 只列出有出场章节的人物（零出场人物不进本卡）；跳转只上报模块与卷 id，由调用方决定切页与卷筛选。
 */
import { BookOpen, GitBranch, Layers, Lightbulb } from 'lucide-react'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@components/ui/card'
import { Button } from '@webview/components/Button'
import { Dialog } from '@webview/components/Dialog'
import type { CharacterCard, OutlineModuleKey, OutlinePlan, OutlineVolume } from '../../types'
import type { JSX } from 'react'
import {
    findClueWarnings,
    formatWordCount,
    isClueRefMatched,
    readOutlineVolumeOrder,
    summarizeVolume,
    summarizeVolumeCast,
    volumeTitleLabel,
} from '../../utils'
import { VolumeCastList } from '../block/VolumeCastList'

interface VolumeStatsDialogProps {
    isOpen: boolean
    onOpenChange: (isOpen: boolean) => void
    /** 统计目标卷：null 时对话框不渲染内容 */
    volume: OutlineVolume | null
    /** 该卷在卷列表中的位置：用于展示卷号 */
    volumeIndex: number
    /** 全部卷：伏笔逾期按全书写作位置判定，不能只看本卷 */
    volumes: readonly OutlineVolume[]
    plan: OutlinePlan
    characters: CharacterCard[]
    /** 跳转到对应模块：章纲页带上卷 id 以收窄列表 */
    onNavigate: (module: OutlineModuleKey, volumeId?: string) => void
}

/** 卷末统计：四张只读卡片，每张带一个跳转入口 */
export function VolumeStatsDialog({
    isOpen,
    onOpenChange,
    volume,
    volumeIndex,
    volumes,
    plan,
    characters,
    onNavigate,
}: VolumeStatsDialogProps): JSX.Element {
    const title = volume === null ? '卷末统计' : `${volumeTitleLabel(volume.name, volumeIndex)} · 卷末统计`
    const handleNavigate = (module: OutlineModuleKey, volumeId?: string): void => {
        onNavigate(module, volumeId)
        onOpenChange(false)
    }

    const renderBody = (): JSX.Element => {
        if (volume === null) {
            return <></>
        }
        const stats = summarizeVolume(volume)
        const volumeOrder = readOutlineVolumeOrder(volume.name, volumeIndex)
        const target = { volumeOrder }
        const warnings = findClueWarnings(plan, volumes).filter(
            (warning) => isClueRefMatched(warning.clue.plant, target) || isClueRefMatched(warning.clue.payoff, target),
        )
        const openClues = plan.clues.filter(
            (clue) =>
                clue.status === 'planted' &&
                (isClueRefMatched(clue.plant, target) || isClueRefMatched(clue.payoff, target)),
        )
        const overdueCount = warnings.filter((warning) => warning.severity === 'warning').length
        const cast = summarizeVolumeCast(volume, characters)
        const acts = plan.acts.filter((act) => act.volumeOrder === volumeOrder)
        return (
            <div className="flex flex-col gap-3">
                <Card size="sm">
                    <CardHeader>
                        <CardTitle>章节进度</CardTitle>
                        <CardAction>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={(): void => handleNavigate('chapter', volume.id)}
                            >
                                <BookOpen />
                                查看章纲
                            </Button>
                        </CardAction>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground text-sm">
                            共 {stats.total} 章 · 已写 {stats.done} 章 · {formatWordCount(stats.wordCount)} 字
                        </p>
                    </CardContent>
                </Card>
                <Card size="sm">
                    <CardHeader>
                        <CardTitle>伏笔</CardTitle>
                        <CardAction>
                            <Button variant="ghost" size="sm" onClick={(): void => handleNavigate('clue')}>
                                <Lightbulb />
                                查看伏笔
                            </Button>
                        </CardAction>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground text-sm">
                            未收 {openClues.length} 条 · 逾期 {overdueCount} 条
                        </p>
                    </CardContent>
                </Card>
                <Card size="sm">
                    <CardHeader>
                        <CardTitle>本卷出场</CardTitle>
                        <CardAction>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={(): void => handleNavigate('chapter', volume.id)}
                            >
                                <Layers />
                                查看章纲
                            </Button>
                        </CardAction>
                    </CardHeader>
                    <CardContent>
                        <VolumeCastList cast={cast} emptyText="本卷还没有出场人物" />
                    </CardContent>
                </Card>
                <Card size="sm">
                    <CardHeader>
                        <CardTitle>结构覆盖</CardTitle>
                        <CardAction>
                            <Button variant="ghost" size="sm" onClick={(): void => handleNavigate('structure')}>
                                <GitBranch />
                                查看结构
                            </Button>
                        </CardAction>
                    </CardHeader>
                    <CardContent>
                        <p className="wrap-break-word text-muted-foreground text-sm">
                            {acts.length > 0 ? acts.map((act) => act.name).join('、') : '本卷还没有已定的结构阶段'}
                        </p>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <Dialog
            open={isOpen}
            onOpenChange={onOpenChange}
            title={title}
            description="每写完一卷核对一次；全部为只读统计，不修改任何数据"
            showFooter={false}
        >
            {renderBody()}
        </Dialog>
    )
}
