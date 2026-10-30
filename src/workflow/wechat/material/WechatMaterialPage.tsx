/**
 * 素材管理页：当前账号已上传的永久素材列表，支持从本地导入与复制图片地址。
 * 复用约定：数据取 hooks/useWechatMaterials，外壳取 components/AppPage，列表用 ui/item，
 * 复制走 shared/utils/clipboard，结果用 sonner 提示。
 * 关键约束：本页只列本地映射表里的素材（即真正上传过的图片），不逐条回查平台详情——
 * 平台接口有频率限制，回查会让列表在弱网下长时间转圈；
 * 正文里的本地图片在生成草稿时已自动上传，这里因此会出现「没主动上传却有记录」的情况，空态文案要说明。
 */
import { Copy, ImagePlus, Images } from 'lucide-react'
import { toast } from 'sonner'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@components/ui/empty'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@components/ui/item'
import { Skeleton } from '@components/ui/skeleton'
import type { WechatAccountSummary, WechatMaterialSummary } from '@shared/types/wechat'
import { copyToClipboard } from '@shared/utils/clipboard'
import { AppContent, AppDescription, AppFooter, AppHeader, AppPage, AppTitle } from '@webview/components/AppPage'
import { Button } from '@webview/components/Button'
import { Image } from '@webview/components/Image'
import type { JSX } from 'react'
import { useWechatMaterials } from '../hooks/useWechatMaterials'

/** 体积展示：素材多为图片，按 KB / MB 两档即可 */
function formatSize(bytes: number): string {
    if (bytes < 1024 * 1024) {
        return `${String(Math.max(Math.round(bytes / 1024), 1))} KB`
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface WechatMaterialPageProps {
    /** 当前账号：由 WorkflowWechat 定位后下发 */
    account: WechatAccountSummary
}

export function WechatMaterialPage({ account }: WechatMaterialPageProps): JSX.Element {
    const { materials, status, error, isImporting, reload, importImage } = useWechatMaterials(account.id)

    /** 复制图片地址：正文里要手写外链时可以省去去后台翻素材 */
    const handleCopy = async (material: WechatMaterialSummary): Promise<void> => {
        const isSuccess = await copyToClipboard(material.url)
        if (isSuccess) {
            toast.success('已复制图片地址')
            return
        }
        toast.error('复制失败，请手动选择复制')
    }

    const renderBody = (): JSX.Element => {
        if (status === 'loading') {
            return (
                <div className="flex w-full flex-col gap-2">
                    <Skeleton className="h-16 w-full rounded-xl" />
                    <Skeleton className="h-16 w-full rounded-xl" />
                    <Skeleton className="h-16 w-full rounded-xl" />
                </div>
            )
        }
        if (status === 'error') {
            return (
                <Empty>
                    <EmptyHeader>
                        <EmptyTitle>素材列表加载失败</EmptyTitle>
                        <EmptyDescription>{error ?? '请稍后重试'}</EmptyDescription>
                    </EmptyHeader>
                </Empty>
            )
        }
        if (materials.length === 0) {
            return (
                <Empty>
                    <EmptyHeader>
                        <EmptyMedia variant="icon" className="size-12 rounded-2xl">
                            <Images className="size-5" />
                        </EmptyMedia>
                        <EmptyTitle>还没有素材</EmptyTitle>
                        <EmptyDescription>
                            正文里的本地图片在生成草稿时会自动上传并出现在这里；也可以用下方按钮主动上传一张。
                        </EmptyDescription>
                    </EmptyHeader>
                </Empty>
            )
        }
        return (
            <div className="flex w-full flex-col gap-2">
                {materials.map((material) => (
                    <Item key={material.id} variant="outline" className="flex-nowrap">
                        <ItemMedia variant="image">
                            <Image src={material.url} alt={material.name} />
                        </ItemMedia>
                        <ItemContent className="min-w-0">
                            <ItemTitle className="w-full">
                                <span className="block min-w-0 flex-1 truncate">{material.name}</span>
                            </ItemTitle>
                            <ItemDescription className="truncate text-xs">
                                {`${formatSize(material.sizeBytes)} · ${new Date(material.createdAt).toLocaleDateString()}`}
                            </ItemDescription>
                        </ItemContent>
                        <ItemActions className="shrink-0">
                            <Button
                                size="icon"
                                variant="ghost"
                                aria-label={`复制 ${material.name} 的地址`}
                                tooltip="复制图片地址"
                                onClick={() => void handleCopy(material)}
                            >
                                <Copy />
                            </Button>
                        </ItemActions>
                    </Item>
                ))}
            </div>
        )
    }

    return (
        <AppPage onContextMenu={(event) => event.preventDefault()}>
            <AppHeader align="start">
                <AppTitle>素材管理</AppTitle>
                <AppDescription>{`${account.name} · ${String(materials.length)} 张图片素材`}</AppDescription>
            </AppHeader>
            <AppContent isScrollable>{renderBody()}</AppContent>
            <AppFooter className="justify-between">
                <Button variant="outline" onClick={() => void reload()}>
                    刷新
                </Button>
                <Button variant="primary" isLoading={isImporting} onClick={() => void importImage()}>
                    <ImagePlus data-icon="inline-start" />
                    上传图片
                </Button>
            </AppFooter>
        </AppPage>
    )
}
