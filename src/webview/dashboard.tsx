/**
 * 仪表盘页面：统计卡 + 快捷入口 + 模块分布 + 最近更新，数据由宿主 dashboard/stats 聚合。
 * 交互约束：重建索引期间按固定间隔轮询刷新，直到宿主回报 isRebuilding 为 false。
 */
import { Database, FileText, Loader2, RefreshCw, Settings, Tags, Trash2, Type } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import type { DashboardStats, ModuleStat } from '@/shared/types/dashboard'
import { request } from './bridge'
import type { JSX } from 'react'

/** 重建期间轮询间隔，使按钮态与统计随宿主进度收敛 */
const POLL_INTERVAL_MS = 1500

/** 过万折算阈值 */
const TEN_THOUSAND = 10_000

export function Dashboard(): JSX.Element {
    const [stats, setStats] = useState<DashboardStats | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [pendingAction, setPendingAction] = useState<string | null>(null)

    const load = useCallback(async (): Promise<void> => {
        try {
            setStats(await request<DashboardStats>('dashboard/stats'))
            setError(null)
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause))
        }
    }, [])

    useEffect(() => {
        void load()
    }, [load])

    const isRebuilding = stats?.isRebuilding === true
    useEffect(() => {
        if (!isRebuilding) {
            return
        }
        const timer = setInterval(() => void load(), POLL_INTERVAL_MS)
        return (): void => clearInterval(timer)
    }, [isRebuilding, load])

    /** 触发宿主动作：重建走索引协议，清空缓存与打开设置走白名单命令协议 */
    const runAction = useCallback(
        async (action: string, method: string, payload?: unknown): Promise<void> => {
            setPendingAction(action)
            try {
                await request(method, payload)
                await load()
                setError(null)
            } catch (cause) {
                setError(cause instanceof Error ? cause.message : String(cause))
            } finally {
                setPendingAction(null)
            }
        },
        [load],
    )

    if (!stats) {
        return (
            <div className="flex flex-col gap-2 p-3">
                <p className="text-sm text-muted-foreground">正在读取索引统计…</p>
                {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </div>
        )
    }

    const isBusy = pendingAction !== null

    return (
        <div className="flex flex-col gap-3 p-3">
            <div className="grid grid-cols-2 gap-2">
                <StatCard icon={<FileText />} label="已索引文件" value={stats.indexedCount.toLocaleString()} />
                <StatCard icon={<Type />} label="字数合计" value={formatWords(stats.totalWords)} />
                <StatCard icon={<Tags />} label="标签数" value={stats.tagCount.toLocaleString()} />
                <StatCard
                    icon={isRebuilding ? <Loader2 className="animate-spin" /> : <Database />}
                    label="索引状态"
                    value={isRebuilding ? '重建中' : '就绪'}
                    hint={formatRelativeTime(stats.lastBuiltAt)}
                />
            </div>

            <Card size="sm">
                <CardHeader>
                    <CardTitle>快捷入口</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                    <Button
                        size="sm"
                        disabled={isRebuilding || isBusy}
                        onClick={() => void runAction('rebuild', 'index/rebuild')}
                    >
                        {isRebuilding ? (
                            <Loader2 className="animate-spin" data-icon="inline-start" />
                        ) : (
                            <RefreshCw data-icon="inline-start" />
                        )}
                        重建索引
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={isBusy}
                        onClick={() => void runAction('clear', 'host/command', 'zhai.clearIndex')}
                    >
                        <Trash2 data-icon="inline-start" />
                        清空缓存
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={isBusy}
                        onClick={() => void runAction('settings', 'host/command', 'zhai.openSettings')}
                    >
                        <Settings data-icon="inline-start" />
                        插件设置
                    </Button>
                </CardContent>
            </Card>

            <Card size="sm">
                <CardHeader>
                    <CardTitle>模块分布</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                    {stats.moduleStats.length === 0 ? (
                        <Empty text="暂无已索引文件，可先执行「重建索引」" />
                    ) : (
                        stats.moduleStats.map((item) => (
                            <ModuleRow key={item.name} item={item} max={maxWordCount(stats.moduleStats)} />
                        ))
                    )}
                </CardContent>
            </Card>

            <Card size="sm">
                <CardHeader>
                    <CardTitle>最近更新</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                    {stats.recentFiles.length === 0 ? (
                        <Empty text="暂无记录" />
                    ) : (
                        stats.recentFiles.map((file) => (
                            <div key={file.path} className="flex items-center justify-between gap-2">
                                <span className="truncate" title={file.path}>
                                    {file.title}
                                </span>
                                <span className="shrink-0 text-xs text-muted-foreground">
                                    {formatWords(file.wordCount)} 字 · {formatRelativeTime(file.mtime)}
                                </span>
                            </div>
                        ))
                    )}
                </CardContent>
            </Card>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
    )
}

/** 统计卡：图标 + 指标名 + 指标值 + 可选补充说明 */
function StatCard({
    icon,
    label,
    value,
    hint,
}: {
    icon: JSX.Element
    label: string
    value: string
    hint?: string
}): JSX.Element {
    return (
        <Card size="sm">
            <CardContent className="flex flex-col gap-1">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {icon}
                    {label}
                </span>
                <span className="font-heading text-lg leading-none font-medium">{value}</span>
                {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
            </CardContent>
        </Card>
    )
}

/** 模块行：名称 + 篇数/字数 + 相对最大字数的占比条 */
function ModuleRow({ item, max }: { item: ModuleStat; max: number }): JSX.Element {
    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
                <span className="truncate">{item.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                    {item.fileCount} 篇 · {formatWords(item.wordCount)} 字
                </span>
            </div>
            <Progress value={(item.wordCount / max) * 100} aria-label={`${item.name} 字数占比`} />
        </div>
    )
}

function Empty({ text }: { text: string }): JSX.Element {
    return <p className="text-sm text-muted-foreground">{text}</p>
}

/** 取最大字数用于占比归一，避免除零 */
function maxWordCount(items: ModuleStat[]): number {
    return Math.max(...items.map((item) => item.wordCount), 1)
}

/** 字数格式化：过万折算为「万」，保留一位小数 */
function formatWords(value: number): string {
    if (value >= TEN_THOUSAND) {
        return `${(value / TEN_THOUSAND).toFixed(1)} 万`
    }
    return value.toLocaleString()
}

/** 相对时间：仅展示到「天/小时/分钟」粒度，避免侧栏出现完整时间戳 */
function formatRelativeTime(iso: string | null): string {
    if (!iso) {
        return '从未构建'
    }
    const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
    if (Number.isNaN(minutes)) {
        return '时间未知'
    }
    if (minutes < 1) {
        return '刚刚'
    }
    if (minutes < 60) {
        return `${minutes} 分钟前`
    }
    const hours = Math.floor(minutes / 60)
    if (hours < 24) {
        return `${hours} 小时前`
    }
    return `${Math.floor(hours / 24)} 天前`
}
