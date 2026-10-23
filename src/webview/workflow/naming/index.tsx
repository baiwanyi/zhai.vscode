/**
 * 取名页：纵向三段——顶部分类栏、条件卡片、底部结果区，承接写作管理页的取名分区。
 * 复用约定：条件收集、生成请求与结果渲染分别由 layout/ 与 hooks/ 承担，本文件只做状态编排；
 * 结果按分类缓存在 useNamingGenerate 内，切换分类时已有结果直接回显，未生成过的分类自动随机生成一批。
 * 关键约束：页面不自带滚动容器（结果区为唯一滚动层，复用 ui/scroll-area）；条件与结果均不落本地存储，
 * 历史由宿主 naming.db 持有。
 */
import { useCallback, useState } from 'react'
import { Alert, AlertDescription } from '@components/ui/alert'
import { ScrollArea } from '@components/ui/scroll-area'
import { Skeleton } from '@components/ui/skeleton'
import type { NamingCategory, NamingRequest, NamingSurnameKind } from '@shared/types/naming'
import { DEFAULT_REQUEST } from './constants'
import { useNamingCatalog } from './hooks/useNamingCatalog'
import { useNamingGenerate } from './hooks/useNamingGenerate'
import { NamingCategoryRail } from './layout/NamingCategoryRail'
import { NamingConditionCard } from './layout/NamingConditionCard'
import { NamingResultGrid } from './layout/NamingResultGrid'
import { pickRandom, readCategoryMeta, readSuffixSamples, readSurnameSamples } from './utils'
import type { JSX } from 'react'

export function NamingPage(): JSX.Element {
    const { catalog, error: catalogError, isLoading } = useNamingCatalog()
    const [request, setRequest] = useState<NamingRequest>(DEFAULT_REQUEST)
    const { items, isGenerating, generate, abort, hasResult } = useNamingGenerate(request.category)

    const handleChange = useCallback((patch: Partial<NamingRequest>): void => {
        setRequest((previous) => ({ ...previous, ...patch }))
    }, [])

    /** 切换分类：变体回到该分类首项，清空不适用的姓氏 / 后缀；未生成过的分类自动随机一批 */
    const handleCategoryChange = useCallback(
        (category: NamingCategory): void => {
            if (category === request.category) {
                return
            }
            const meta = catalog ? readCategoryMeta(catalog, category) : null
            const [firstVariant] = meta?.variants ?? []
            const next: NamingRequest = {
                ...request,
                category,
                variant: firstVariant ? firstVariant.value : request.variant,
                surname: meta?.isPerson ? request.surname : '',
                suffix: meta?.hasSuffix ? request.suffix : '',
            }
            setRequest(next)
            if (!hasResult(category)) {
                void generate(next)
            }
        },
        [catalog, generate, hasResult, request],
    )

    /** 单姓 / 复姓：切换即随机填入一个对应类型的姓氏 */
    const handleSurnameKindChange = useCallback(
        (kind: NamingSurnameKind): void => {
            if (!catalog) {
                return
            }
            const sample = pickRandom(readSurnameSamples(catalog, kind))
            setRequest((previous) => ({ ...previous, surnameKind: kind, surname: sample ?? previous.surname }))
        },
        [catalog],
    )

    const handleRandomSurname = useCallback((): void => {
        if (!catalog) {
            return
        }
        const sample = pickRandom(readSurnameSamples(catalog, request.surnameKind))
        if (sample) {
            setRequest((previous) => ({ ...previous, surname: sample }))
        }
    }, [catalog, request.surnameKind])

    const handleRandomSuffix = useCallback((): void => {
        if (!catalog) {
            return
        }
        const sample = pickRandom(readSuffixSamples(catalog, request.category, request.variant))
        if (sample) {
            setRequest((previous) => ({ ...previous, suffix: sample }))
        }
    }, [catalog, request.category, request.variant])

    const handleGenerate = useCallback((): void => {
        void generate(request)
    }, [generate, request])

    const handleAbort = useCallback((): void => {
        void abort()
    }, [abort])

    if (isLoading) {
        return (
            <div className="flex h-full flex-col gap-2 p-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-64 w-full" />
                <Skeleton className="min-h-0 flex-1" />
            </div>
        )
    }

    if (!catalog) {
        return (
            <div className="flex h-full flex-col gap-2 p-3">
                <Alert variant="destructive">
                    <AlertDescription>{catalogError ?? '取名选项加载失败，请重新打开面板'}</AlertDescription>
                </Alert>
            </div>
        )
    }

    return (
        <div className="@container flex h-full min-h-0 flex-col gap-2 p-3">
            <NamingCategoryRail catalog={catalog} activeCategory={request.category} onSelect={handleCategoryChange} />
            <NamingConditionCard
                catalog={catalog}
                request={request}
                isGenerating={isGenerating}
                onChange={handleChange}
                onSurnameKindChange={handleSurnameKindChange}
                onRandomSurname={handleRandomSurname}
                onRandomSuffix={handleRandomSuffix}
                onGenerate={handleGenerate}
                onAbort={handleAbort}
            />
            <ScrollArea className="min-h-0 flex-1">
                <NamingResultGrid items={items} />
            </ScrollArea>
        </div>
    )
}
