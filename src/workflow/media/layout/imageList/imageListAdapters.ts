/**
 * 图片列表适配器：把媒体、在线图库、已下载与上传文件四类领域条目折算成统一列表条目与分组。
 * 复用约定：只做纯映射，不触碰宿主协议；出处、类型与体积文案在此收口，组件层不再认识领域字段；
 * 分组结构取 hooks/mediaMonth 的 MediaMonthGroup，组头文案与月份下拉同源。
 * 关键约束：source 原样保留领域对象，动作回调据此拿到完整条目；missing 只灰显、不可点由 isDisabled 表达；
 * 媒体条目的激活语义是「插入到文章」，类型与丢失态占左上、引用计数占左下，引用标题只在悬停时按需查询；
 * 上传条目的左下角标给出像素与体积，url 为 null 时走文件图标占位，缩略图缺失走缺图图标占位，二者不混用。
 */
import { File as FileIcon, ImageOff, Link2 } from 'lucide-react'
import type { MediaItem, MediaKind } from '@shared/types/media'
import type { StockLocalPhoto, StockPhoto } from '@shared/types/stock'
import type { UploadFileItem } from '@shared/types/upload'
import type { ImageListBadge, ImageListGroup, ImageListItem } from './imageListModel'
import type { MediaMonthGroup } from '../../hooks/mediaMonth'

/** 类型标签：仅展示，不参与筛选 */
const KIND_LABEL: Readonly<Record<MediaKind, string>> = {
    portrait: '角色',
    lore: '设定',
    photo: '普通',
    unknown: '未归类',
}

/** 条目级运行态：由页面按插入中、失败与并发禁用状态注入 */
export interface ImageListItemFlags {
    isBusy?: boolean
    isFailed?: boolean
    isDisabled?: boolean
}

/** 出处一行文案：角色名优先，其次条目名，再次所属作品，全空时显示未关联 */
function toOriginLabel(image: MediaItem): string {
    if (image.characterName !== null && image.characterName.length > 0) {
        return `角色 · ${image.characterName}`
    }
    if (image.loreName !== null && image.loreName.length > 0) {
        return `设定 · ${image.loreName}`
    }
    if (image.pressName !== null && image.pressName.length > 0) {
        return `作品 · ${image.pressName}`
    }
    return '无出处'
}

/** 体积文案：不足 1KB 按字节、不足 1MB 按 KB，其余保留一位小数 */
function formatSize(bytes: number): string {
    if (bytes < 1024) {
        return `${String(bytes)} B`
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * 媒体条目映射：左上角是类型或丢失态，左下角是引用角标。
 * loadUsageTitles 由页面注入按需查询，缺省时角标只作图标与计数展示，不提供悬停内容。
 */
export function toMediaItem(
    image: MediaItem,
    flags: ImageListItemFlags = {},
    loadUsageTitles?: (id: string) => Promise<readonly string[]>,
): ImageListItem<MediaItem> {
    const originLabel = toOriginLabel(image)
    const badges: ImageListBadge[] = [
        { text: image.missing ? '已丢失' : KIND_LABEL[image.kind], position: 'top-left', variant: 'secondary' },
    ]
    if (image.usageCount > 0) {
        badges.push({
            text: String(image.usageCount),
            position: 'bottom-left',
            variant: 'secondary',
            icon: Link2,
            hoverTitles:
                loadUsageTitles === undefined ? undefined : (): Promise<readonly string[]> => loadUsageTitles(image.id),
        })
    }
    return {
        id: image.id,
        src: image.url,
        alt: originLabel,
        title: originLabel,
        activateLabel: `插入到文章：${originLabel}`,
        badges,
        state: image.missing ? 'missing' : 'normal',
        isBusy: flags.isBusy,
        isFailed: flags.isFailed,
        isDisabled: flags.isDisabled,
        source: image,
    }
}

export function toStockPhotoItem(photo: StockPhoto, flags: ImageListItemFlags = {}): ImageListItem<StockPhoto> {
    const alt = photo.alt.length > 0 ? photo.alt : photo.id
    return {
        id: photo.id,
        src: photo.thumbUrl,
        alt,
        title: photo.photographer,
        activateLabel: `插入图片：${alt}`,
        badges: photo.downloaded ? [{ text: '已下载', position: 'top-left', variant: 'secondary' }] : [],
        fallback: { icon: ImageOff },
        state: 'normal',
        isBusy: flags.isBusy,
        isFailed: flags.isFailed,
        isDisabled: flags.isDisabled,
        source: photo,
    }
}

export function toStockLocalItem(
    photo: StockLocalPhoto,
    flags: ImageListItemFlags = {},
): ImageListItem<StockLocalPhoto> {
    const alt = photo.alt.length > 0 ? photo.alt : photo.id
    return {
        id: photo.id,
        src: photo.url,
        alt,
        title: photo.photographer ?? '本地图片',
        activateLabel: `插入图片：${alt}`,
        badges: photo.missing ? [{ text: '已丢失', position: 'top-left', variant: 'outline' }] : [],
        state: photo.missing ? 'missing' : 'normal',
        isBusy: flags.isBusy,
        isFailed: flags.isFailed,
        isDisabled: photo.missing || flags.isDisabled === true,
        source: photo,
    }
}

/**
 * 上传条目映射：左下角角标给出图片像素与体积，非图片文件只给体积。
 * pixel 由页面在图片加载后回报并缓存，未回报前先只显示体积。
 */
export function toUploadFileItem(
    item: UploadFileItem,
    flags: ImageListItemFlags = {},
    pixel?: { width: number; height: number },
): ImageListItem<UploadFileItem> {
    const sizeText = formatSize(item.byteSize)
    const metaText =
        pixel === undefined || item.url === null
            ? sizeText
            : `${String(pixel.width)}×${String(pixel.height)} · ${sizeText}`
    return {
        id: item.path,
        src: item.url,
        alt: item.name,
        title: item.name,
        meta: metaText,
        activateLabel: `复制路径：${item.name}`,
        badges: [{ text: metaText, position: 'bottom-left', variant: 'secondary' }],
        fallback: { icon: FileIcon, label: item.ext },
        state: 'normal',
        isBusy: flags.isBusy,
        isFailed: flags.isFailed,
        isDisabled: flags.isDisabled,
        source: item,
    }
}

/** 把年月分组折算成列表分组：组头计数取组内总数，条目逐张经适配器映射 */
export function toImageListGroups<T extends { month: string }, U>(
    groups: readonly MediaMonthGroup<T>[],
    toItem: (value: T) => ImageListItem<U>,
): ImageListGroup<U>[] {
    return groups.map((group) => ({
        key: group.month,
        label: group.label,
        total: group.total,
        items: group.items.map((value) => toItem(value)),
    }))
}
