/**
 * 取名页：上方「分类栏 + 条件卡片」、下方「结果区」的上下布局，承接写作管理页的取名分区。
 * 复用约定：条件收集、生成请求与结果渲染分别由 layout/ 与 hooks/ 承担，本文件只做状态编排；
 * 后缀与姓氏的随机取样使用宿主下发的样本，切换分类时按分类元信息重置不适用的字段。
 * 关键约束：页面不自带滚动容器（结果区为唯一滚动层）；条件与结果均不落本地存储，历史由宿主 naming.db 持有。
 */
import { useCallback, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import type { NamingCategory, NamingRequest, NamingSurnameKind } from '@/shared/types/naming'
import { DEFAULT_REQUEST } from './constants'
import { useNamingCatalog } from './hooks/useNamingCatalog'
import { useNamingGenerate } from './hooks/useNamingGenerate'
import { NamingCategoryRail } from './layout/NamingCategoryRail'
import { NamingConditionCard } from './layout/NamingConditionCard'
import { NamingResultGrid } from './layout/NamingResultGrid'
import {
    copyName,
    joinNames,
    pickRandom,
    readCategoryMeta,
    readSuffixSamples,
    readSurnameSamples,
} from './utils'
import type { JSX } from 'react'

export function NamingPage(): JSX.Element {
    const { catalog, error: catalogError, isLoading } = useNamingCatalog()
    const { items, isGenerating, error: generateError, generate, abort } = useNamingGenerate()
    const [request, setRequest] = useState<NamingRequest>(DEFAULT_REQUEST)
    const [notice, setNotice] = useState<string | null>(null)

    const handleChange = useCallback((patch: Partial<NamingRequest>): void => {
        setNotice(null)
        setRequest((previous) => ({ ...previous, ...patch }))
    }, [])

    /** 切换分类：变体回到该分类首项，清空不适用的姓氏 / 后缀 */
    const handleCategoryChange = useCallback(
        (category: NamingCategory): void => {
            setNotice(null)
            setRequest((previous) => {
                const meta = catalog ? readCategoryMeta(catalog, category) : null
                const [firstVariant] = meta?.variants ?? []
                return {
                    ...previous,
                    category,
                    variant: firstVariant ? firstVariant.value : previous.variant,
                    surname: meta?.isPerson ? previous.surname : '',
                    suffix: meta?.hasSuffix ? previous.suffix : '',
                }
            })
        },
        [catalog],
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
        setNotice(null)
        void generate(request)
    }, [generate, request])

    const handleAbort = useCallback((): void => {
        void abort()
    }, [abort])

    const handleCopy = useCallback((name: string): void => {
        void copyName(name).then((copied) => {
            setNotice(copied ? `已复制「${name}」` : '复制失败，请手动选中后复制')
        })
    }, [])

    const handleCopyAll = useCallback((): void => {
        void copyName(joinNames(items)).then((copied) => {
            setNotice(copied ? `已复制 ${items.length} 个名字` : '复制失败，请手动选中后复制')
        })
    }, [items])

    if (isLoading) {
        return (
            <div className="flex h-full flex-col gap-2 p-3">
                <div className="flex shrink-0 gap-2">
                    <Skeleton className="h-64 w-12" />
                    <Skeleton className="h-64 flex-1" />
                </div>
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
        <div className="flex h-full flex-col gap-2 p-3">
            <div className="flex shrink-0 items-start gap-2">
                <NamingCategoryRail
                    catalog={catalog}
                    activeCategory={request.category}
                    onSelect={handleCategoryChange}
                />
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
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
                <NamingResultGrid
                    items={items}
                    error={generateError}
                    notice={notice}
                    onCopy={handleCopy}
                    onCopyAll={handleCopyAll}
                />
            </div>
        </div>
    )
}
