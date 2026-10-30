/**
 * 取名页：以 app-page 骨架承载「标题区 + 条件字段区 + 底部操作区」，作为写作管理页的取名分区独立成页。
 * 复用约定：外壳取 components/AppPage（分类栏进 AppMenu、生成方式开关进 AppFooter 左端、条件区走 isScrollable），
 * 条件收集与结果渲染由 layout/ 与 hooks/ 承担；本文件只做三态分流与就绪态编排，
 * 结果按分类缓存在 useNamingGenerate 内，生成后由 NamingResultDialog 弹层展示，
 * 关闭后经底部「查看结果」再次打开，未生成过的分类自动随机生成一批。
 * 关键约束：生成方式开关、生成 / 取消按钮与结果弹层入口都收敛在底部操作区，条件与结果均不落本地存储，
 * 历史由宿主 naming.db 持有；无缓存结果的分类「查看结果」按钮禁用；加载态与失败态复用同一标题区文案；
 * 就绪态拆为 NamingWorkspace，catalog 由页面判空后传入，工作区内不再重复判空。
 */
import { Dices, Eye } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Alert, AlertDescription } from '@components/ui/alert'
import { Skeleton } from '@components/ui/skeleton'
import { Spinner } from '@components/ui/spinner'
import type { NamingCatalog, NamingCategory, NamingRequest, NamingSurnameKind } from '@shared/types/naming'
import {
    AppContent,
    AppDescription,
    AppFooter,
    AppHeader,
    AppMenu,
    AppPage,
    AppTitle,
} from '@webview/components/AppPage'
import { Button } from '@webview/components/Button'
import { Switch } from '@webview/components/Switch'
import {
    ABORT_LABEL,
    DEFAULT_REQUEST,
    GENERATE_LABEL,
    PAGE_DESCRIPTION,
    PAGE_TITLE,
    VIEW_RESULT_LABEL,
} from './constants'
import { useNamingCatalog } from './hooks/useNamingCatalog'
import { useNamingGenerate } from './hooks/useNamingGenerate'
import { NamingCategoryRail } from './layout/NamingCategoryRail'
import { NamingConditionFields } from './layout/NamingConditionFields'
import { NamingResultDialog } from './layout/NamingResultDialog'
import { pickRandom, readCategoryMeta, readSuffixSamples, readSurnameSamples } from './utils'
import type { JSX, ReactNode } from 'react'

interface NamingShellProps {
    /** 标题行下方的分类栏：仅就绪态传入 */
    menu?: ReactNode
    /** 底部操作区：仅就绪态传入，壳统一为左开关、右按钮的两端对齐 */
    footer?: ReactNode
    /** 内容区自行滚动：占位态由占位块撑高，不需要滚动 */
    isScrollable?: boolean
    children: ReactNode
}

/** 页面骨架：加载态、失败态与就绪态共用同一标题区与外壳，避免三处各写一份标题 */
function NamingShell({ menu, footer, isScrollable = false, children }: NamingShellProps): JSX.Element {
    return (
        <AppPage>
            <AppHeader>
                <AppTitle>{PAGE_TITLE}</AppTitle>
                <AppDescription>{PAGE_DESCRIPTION}</AppDescription>
                {menu === undefined ? null : <AppMenu>{menu}</AppMenu>}
            </AppHeader>
            <AppContent isScrollable={isScrollable}>{children}</AppContent>
            {footer === undefined ? null : <AppFooter className="justify-between">{footer}</AppFooter>}
        </AppPage>
    )
}

/** 加载占位：分类栏、条件区与底栏入口各一块，高度按就绪态布局给出 */
function NamingLoading(): JSX.Element {
    return (
        <div className="flex h-full flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-64 w-full" />
            <Skeleton className="min-h-0 flex-1" />
        </div>
    )
}

interface NamingWorkspaceProps {
    /** 已就绪的选项摘要：分类、枚举与样本，页面判空后传入 */
    catalog: NamingCatalog
}

/** 就绪态：编排条件、生成与结果弹层，catalog 必不为空，回调内不再判空 */
function NamingWorkspace({ catalog }: NamingWorkspaceProps): JSX.Element {
    const [request, setRequest] = useState<NamingRequest>(DEFAULT_REQUEST)
    const [isResultOpen, setIsResultOpen] = useState(false)
    const { items, isGenerating, generate, abort, hasResult } = useNamingGenerate(request.category)
    /** 当前分类文案：结果弹窗描述用，分类表缺项时回落到页面标题 */
    const categoryLabel = readCategoryMeta(catalog, request.category)?.label ?? PAGE_TITLE
    /** 主按钮文案：生成中转为取消 */
    const primaryLabel = isGenerating ? ABORT_LABEL : GENERATE_LABEL

    const handleChange = useCallback((patch: Partial<NamingRequest>): void => {
        setRequest((previous) => ({ ...previous, ...patch }))
    }, [])

    /** 生成方式：开关只表达 AI / 本地两态，其余条件保持不变 */
    const handleSourceChange = useCallback(
        (checked: boolean): void => {
            handleChange({ source: checked ? 'ai' : 'local' })
        },
        [handleChange],
    )

    /** 切换分类：变体回到该分类首项，清空不适用的姓氏 / 后缀；未生成过的分类自动随机一批 */
    const handleCategoryChange = useCallback(
        (category: NamingCategory): void => {
            if (category === request.category) {
                return
            }
            const meta = readCategoryMeta(catalog, category)
            const [firstVariant] = meta?.variants ?? []
            const next: NamingRequest = {
                ...request,
                category,
                variant: firstVariant?.value ?? request.variant,
                surname: meta?.isPerson === true ? request.surname : '',
                suffix: meta?.hasSuffix === true ? request.suffix : '',
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
            const sample = pickRandom(readSurnameSamples(catalog, kind))
            setRequest((previous) => ({ ...previous, surnameKind: kind, surname: sample ?? previous.surname }))
        },
        [catalog],
    )

    const handleRandomSurname = useCallback((): void => {
        const sample = pickRandom(readSurnameSamples(catalog, request.surnameKind))
        if (sample) {
            setRequest((previous) => ({ ...previous, surname: sample }))
        }
    }, [catalog, request.surnameKind])

    const handleRandomSuffix = useCallback((): void => {
        const sample = pickRandom(readSuffixSamples(catalog, request.category, request.variant))
        if (sample) {
            setRequest((previous) => ({ ...previous, suffix: sample }))
        }
    }, [catalog, request.category, request.variant])

    /** 主按钮：生成中为取消；否则先打开结果弹窗（生成中显示等待态）再提交当前条件，结果回来后直接落到弹窗里 */
    const handlePrimaryAction = useCallback((): void => {
        if (isGenerating) {
            void abort()
            return
        }
        setIsResultOpen(true)
        void generate(request)
    }, [abort, generate, isGenerating, request])

    /** 查看结果：仅读缓存，不触发生成；无缓存时按钮已禁用 */
    const handleViewResult = useCallback((): void => {
        setIsResultOpen(true)
    }, [])

    return (
        <>
            <NamingShell
                isScrollable
                menu={
                    <NamingCategoryRail
                        catalog={catalog}
                        activeCategory={request.category}
                        onSelect={handleCategoryChange}
                    />
                }
                footer={
                    <>
                        <Switch
                            id="naming-source"
                            label="AI 生成"
                            checked={request.source === 'ai'}
                            disabled={!catalog.aiAvailable}
                            tooltip={
                                catalog.aiAvailable
                                    ? '生成方式：开启为 AI 生成，关闭为本地生成'
                                    : 'AI 通道未就绪，AI 生成不可用'
                            }
                            onCheckedChange={handleSourceChange}
                        />
                        <div className="flex items-center gap-1.5">
                            <Button
                                variant="outline"
                                disabled={!hasResult(request.category)}
                                onClick={handleViewResult}
                            >
                                <Eye />
                                {VIEW_RESULT_LABEL}
                            </Button>
                            <Button variant={isGenerating ? 'outline' : 'default'} onClick={handlePrimaryAction}>
                                {isGenerating ? <Spinner /> : <Dices />}
                                {primaryLabel}
                            </Button>
                        </div>
                    </>
                }
            >
                <NamingConditionFields
                    catalog={catalog}
                    request={request}
                    onChange={handleChange}
                    onSurnameKindChange={handleSurnameKindChange}
                    onRandomSurname={handleRandomSurname}
                    onRandomSuffix={handleRandomSuffix}
                />
            </NamingShell>
            <NamingResultDialog
                open={isResultOpen}
                categoryLabel={categoryLabel}
                items={items}
                isGenerating={isGenerating}
                onOpenChange={setIsResultOpen}
            />
        </>
    )
}

export function PressNamingPage(): JSX.Element {
    const { catalog, error, isLoading } = useNamingCatalog()

    if (isLoading) {
        return (
            <NamingShell>
                <NamingLoading />
            </NamingShell>
        )
    }

    if (catalog === null) {
        return (
            <NamingShell>
                <Alert variant="destructive">
                    <AlertDescription>{error ?? '取名选项加载失败，请重新打开面板'}</AlertDescription>
                </Alert>
            </NamingShell>
        )
    }

    return <NamingWorkspace catalog={catalog} />
}
