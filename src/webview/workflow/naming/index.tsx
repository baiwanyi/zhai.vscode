/**
 * 取名页：以 app-page 骨架承载「标题区 + 条件字段区 + 底部操作区」，承接写作管理页的取名分区。
 * 复用约定：外壳取 components/AppPage（分类栏进 AppAction、生成方式开关进 AppFooter 的 start、条件区走 isScrollable），
 * 条件收集与结果渲染由 layout/ 与 hooks/ 承担，本文件只做状态编排；
 * 结果按分类缓存在 useNamingGenerate 内，生成后由 NamingResultDialog 弹层展示，
 * 关闭后经底部「查看结果」再次打开，未生成过的分类自动随机生成一批。
 * 关键约束：生成方式开关、生成 / 取消按钮与结果弹层入口都收敛在底部操作区，条件与结果均不落本地存储，
 * 历史由宿主 naming.db 持有；无缓存结果的分类「查看结果」按钮禁用；加载态与失败态复用同一标题区文案。
 */
import { Dices, Eye } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Alert, AlertDescription } from '@components/ui/alert'
import { Label } from '@components/ui/label'
import { Skeleton } from '@components/ui/skeleton'
import { Spinner } from '@components/ui/spinner'
import { Switch } from '@components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@components/ui/tooltip'
import type { NamingCategory, NamingRequest, NamingSurnameKind } from '@shared/types/naming'
import {
    AppAction,
    AppContent,
    AppDescription,
    AppFooter,
    AppHeader,
    AppPage,
    AppTitle,
} from '@webview/components/AppPage'
import { Button } from '@webview/components/Button'
import { DEFAULT_REQUEST, GENERATE_LABEL, PAGE_DESCRIPTION, PAGE_TITLE, VIEW_RESULT_LABEL } from './constants'
import { useNamingCatalog } from './hooks/useNamingCatalog'
import { useNamingGenerate } from './hooks/useNamingGenerate'
import { NamingCategoryRail } from './layout/NamingCategoryRail'
import { NamingConditionFields } from './layout/NamingConditionFields'
import { NamingResultDialog } from './layout/NamingResultDialog'
import { pickRandom, readCategoryMeta, readSuffixSamples, readSurnameSamples } from './utils'
import type { JSX } from 'react'

export function NamingPage(): JSX.Element {
    const { catalog, error: catalogError, isLoading } = useNamingCatalog()
    const [request, setRequest] = useState<NamingRequest>(DEFAULT_REQUEST)
    const [isResultOpen, setIsResultOpen] = useState(false)
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

    /** 主动取名：先打开结果弹窗（生成中显示等待态），再提交请求，返回后结果直接落到弹窗里 */
    const handleGenerate = useCallback((): void => {
        setIsResultOpen(true)
        void generate(request)
    }, [generate, request])

    const handleAbort = useCallback((): void => {
        void abort()
    }, [abort])

    /** 查看结果：仅读缓存，不触发生成；无缓存时按钮已禁用 */
    const handleViewResult = useCallback((): void => {
        setIsResultOpen(true)
    }, [])

    if (isLoading) {
        return (
            <AppPage>
                <AppHeader>
                    <AppTitle>{PAGE_TITLE}</AppTitle>
                    <AppDescription>{PAGE_DESCRIPTION}</AppDescription>
                </AppHeader>
                <AppContent>
                    <div className="flex h-full flex-col gap-2">
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-64 w-full" />
                        <Skeleton className="min-h-0 flex-1" />
                    </div>
                </AppContent>
            </AppPage>
        )
    }

    if (!catalog) {
        return (
            <AppPage>
                <AppHeader>
                    <AppTitle>{PAGE_TITLE}</AppTitle>
                    <AppDescription>{PAGE_DESCRIPTION}</AppDescription>
                </AppHeader>
                <AppContent>
                    <Alert variant="destructive">
                        <AlertDescription>{catalogError ?? '取名选项加载失败，请重新打开面板'}</AlertDescription>
                    </Alert>
                </AppContent>
            </AppPage>
        )
    }

    return (
        <>
            <AppPage>
                <AppHeader>
                    <AppTitle>{PAGE_TITLE}</AppTitle>
                    <AppDescription>{PAGE_DESCRIPTION}</AppDescription>
                    <AppAction>
                        <NamingCategoryRail
                            catalog={catalog}
                            activeCategory={request.category}
                            onSelect={handleCategoryChange}
                        />
                    </AppAction>
                </AppHeader>
                <AppContent isScrollable>
                    <NamingConditionFields
                        catalog={catalog}
                        request={request}
                        onChange={handleChange}
                        onSurnameKindChange={handleSurnameKindChange}
                        onRandomSurname={handleRandomSurname}
                        onRandomSuffix={handleRandomSuffix}
                    />
                </AppContent>
                <AppFooter
                    start={
                        <>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    {/* Trigger 的 data-state 会覆盖 Switch 自身的 checked / unchecked 状态，故用 span 承接 */}
                                    <span className="inline-flex">
                                        <Switch
                                            id="naming-source"
                                            checked={request.source === 'ai'}
                                            disabled={!catalog.aiAvailable}
                                            onCheckedChange={(checked) =>
                                                handleChange({ source: checked ? 'ai' : 'local' })
                                            }
                                        />
                                    </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                    {catalog.aiAvailable
                                        ? '生成方式：开启为 AI 生成，关闭为本地生成'
                                        : 'AI 通道未就绪，AI 生成不可用'}
                                </TooltipContent>
                            </Tooltip>
                            <Label htmlFor="naming-source" className="text-muted-foreground">
                                AI 生成
                            </Label>
                        </>
                    }
                >
                    <Button variant="outline" disabled={!hasResult(request.category)} onClick={handleViewResult}>
                        <Eye data-icon="inline-start" />
                        {VIEW_RESULT_LABEL}
                    </Button>
                    <Button
                        variant={isGenerating ? 'outline' : 'default'}
                        onClick={isGenerating ? handleAbort : handleGenerate}
                    >
                        {isGenerating ? <Spinner data-icon="inline-start" /> : <Dices data-icon="inline-start" />}
                        {isGenerating ? '取消' : GENERATE_LABEL}
                    </Button>
                </AppFooter>
            </AppPage>
            <NamingResultDialog
                open={isResultOpen}
                categoryLabel={readCategoryMeta(catalog, request.category)?.label ?? '取名'}
                items={items}
                isGenerating={isGenerating}
                onOpenChange={setIsResultOpen}
            />
        </>
    )
}
