/**
 * 菜单内容编辑器：图片与图文从素材列表单选，链接填写网页地址，小程序填写 appid 与页面路径。
 * 复用约定：类型切换用 components/SegmentedRail，表单排布用 ui/field 的 FieldGroup/Field，地址用 ui/input-group 按当前协议显示前置标签，图片网格用 ui/attachment、图文列表用 ui/item 的封面与选择动作，状态徽标走 blocks/Badge；三态与空态走 layout/PickerStateView，续载走 blocks/LoadMoreButton，内容构造与链接校验走 menu/utils；数据分别取 useWechatMaterials 与 useWechatNewsSources。
 * 关键约束：四种类型互斥，切换丢弃上一类型字段；素材选择器只在对应类型下挂载，避免打开对话框就拉取两个列表；
 * 图片网格按批次限量渲染，选中项打勾且禁用重复点击；图文只列已发布批次，链接与小程序兜底网页仅放行 http/https。
 */
'use client'

import { cn } from 'cn'
import { Check, ImageIcon, Link2, Newspaper, Smartphone } from 'lucide-react'
import {
    Attachment,
    AttachmentAction,
    AttachmentActions,
    AttachmentGroup,
    AttachmentMedia,
    AttachmentTrigger,
} from '@components/ui/attachment'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@components/ui/input-group'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@components/ui/item'
import type { WechatMenuContent, WechatMenuContentKind, WechatMaterialSummary } from '@shared/types/wechat'
import { Badge } from '@webview/blocks/Badge'
import { LoadMoreButton } from '@webview/blocks/LoadMoreButton'
import { Button } from '@webview/components/Button'
import { Image } from '@webview/components/Image'
import { SegmentedRail, type SegmentedRailItem } from '@webview/components/SegmentedRail'
import { useRenderLimit } from '@webview/hooks/useRenderLimit'
import { useWechatIssueCovers } from '@webview/hooks/useWechatIssueCovers'
import { PickerStateView } from './PickerStateView'
import type { JSX } from 'react'
import { useWechatMaterials } from '../../hooks/useWechatMaterials'
import { useWechatNewsSources } from '../../hooks/useWechatNewsSources'
import { readLinkHost, readLinkInput, readLinkProtocol } from '../utils/linkUrl'
import { createMenuContent, toImageContent, toNewsContent, type NewsSelectItem } from '../utils/menuContent'
import { toNewsItem } from '../utils/newsPickerModel'

/** 内容类型选项：显式标注 SegmentedRail 契约，图标直接传组件 */
const CONTENT_OPTIONS: readonly SegmentedRailItem<WechatMenuContentKind>[] = [
    { value: 'image', label: '图片', icon: ImageIcon },
    { value: 'news', label: '图文', icon: Newspaper },
    { value: 'link', label: '链接', icon: Link2 },
    { value: 'miniprogram', label: '小程序', icon: Smartphone },
]

interface ContentEditorProps {
    accountId: string
    value: WechatMenuContent
    onChange: (content: WechatMenuContent) => void
}

export function ContentEditor({ accountId, value, onChange }: ContentEditorProps): JSX.Element {
    return (
        <div className="flex flex-col gap-3">
            <SegmentedRail
                items={CONTENT_OPTIONS}
                value={value.kind}
                onChange={(next) => onChange(createMenuContent(next))}
                label="菜单内容类型"
            />

            {value.kind === 'image' && (
                <ImagePicker
                    accountId={accountId}
                    selectedId={value.materialId ?? ''}
                    onSelect={(material) => onChange(toImageContent(material))}
                />
            )}
            {value.kind === 'news' && (
                <NewsPicker
                    accountId={accountId}
                    selectedId={value.issueId ?? ''}
                    onSelect={(issue) => onChange(toNewsContent(issue))}
                />
            )}
            {value.kind === 'link' && (
                <InputGroup>
                    <InputGroupInput
                        aria-label="菜单跳转链接"
                        value={readLinkHost(value.linkUrl)}
                        placeholder="example.com"
                        onChange={(event) =>
                            onChange({
                                kind: 'link',
                                linkUrl: readLinkInput(event.target.value, readLinkProtocol(value.linkUrl)),
                            })
                        }
                    />
                    <InputGroupAddon align="inline-start">
                        <InputGroupText>{readLinkProtocol(value.linkUrl)}://</InputGroupText>
                    </InputGroupAddon>
                </InputGroup>
            )}
            {value.kind === 'miniprogram' && <MiniProgramFields value={value} onChange={onChange} />}
        </div>
    )
}

interface MiniProgramFieldsProps {
    value: WechatMenuContent
    onChange: (content: WechatMenuContent) => void
}

/** 小程序字段：appid / 页面路径 / 旧版本兜底网页，三者都必填 */
function MiniProgramFields({ value, onChange }: MiniProgramFieldsProps): JSX.Element {
    const update = (patch: Partial<WechatMenuContent>): void => {
        onChange({ ...value, ...patch })
    }
    return (
        <FieldGroup>
            <Field>
                <FieldLabel htmlFor="wechat-menu-mini-appid">AppID</FieldLabel>
                <Input
                    id="wechat-menu-mini-appid"
                    value={value.appid ?? ''}
                    placeholder="wx 开头"
                    onChange={(event) => update({ appid: event.target.value.trim().toLowerCase() })}
                />
            </Field>
            <Field>
                <FieldLabel htmlFor="wechat-menu-mini-pagepath">页面路径</FieldLabel>
                <Input
                    id="wechat-menu-mini-pagepath"
                    value={value.pagepath ?? ''}
                    placeholder="pages/index/index"
                    onChange={(event) => update({ pagepath: event.target.value.trim() })}
                />
            </Field>
            <Field>
                <FieldLabel htmlFor="wechat-menu-mini-url">兜底网页</FieldLabel>
                <InputGroup>
                    <InputGroupInput
                        id="wechat-menu-mini-url"
                        value={readLinkHost(value.miniUrl)}
                        placeholder="example.com"
                        onChange={(event) =>
                            update({ miniUrl: readLinkInput(event.target.value, readLinkProtocol(value.miniUrl)) })
                        }
                    />
                    <InputGroupAddon align="inline-start">
                        <InputGroupText>{readLinkProtocol(value.miniUrl)}://</InputGroupText>
                    </InputGroupAddon>
                </InputGroup>
                <FieldDescription>旧版微信打开，须为 http/https 地址</FieldDescription>
            </Field>
        </FieldGroup>
    )
}

/** 图片网格每批渲染张数与首批批次数：首批限量挂载，其余由加载更多逐批展开 */
const IMAGE_PAGE_SIZE = 30
const IMAGE_INITIAL_BATCHES = 10

interface ImagePickerProps {
    accountId: string
    selectedId: string
    onSelect: (material: WechatMaterialSummary) => void
}

/** 图片素材网格：单选，选中项打勾描边且禁用重复点击，按批次限量渲染 */
function ImagePicker({ accountId, selectedId, onSelect }: ImagePickerProps): JSX.Element {
    const { materials, status, error, reload } = useWechatMaterials(accountId)
    const { limit, hasMore, remaining, loadMore } = useRenderLimit(
        materials.length,
        IMAGE_PAGE_SIZE,
        accountId,
        IMAGE_INITIAL_BATCHES,
    )
    const stateView = (
        <PickerStateView
            status={status}
            error={error}
            isEmpty={materials.length === 0}
            icon={ImageIcon}
            loadingTitle="读取素材…"
            errorTitle="素材读取失败"
            emptyTitle="无图片素材"
            emptyDescription="请先在素材管理上传图片"
            onRetry={reload}
        />
    )
    if (stateView !== null) {
        return stateView
    }
    return (
        <AttachmentGroup className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto px-0.5">
            {materials.slice(0, limit).map((material) => {
                const isSelected = selectedId === material.id
                return (
                    <Attachment
                        key={material.id}
                        orientation="vertical"
                        state={isSelected ? 'done' : 'idle'}
                        className={cn(
                            'w-full has-data-[slot=attachment-media]:p-1',
                            isSelected && 'ring-1 ring-primary',
                        )}
                    >
                        <AttachmentMedia variant="image">
                            <Image src={material.url} alt={material.name} />
                        </AttachmentMedia>
                        {isSelected ? (
                            <AttachmentActions className="group-data-[orientation=vertical]/attachment:top-1 group-data-[orientation=vertical]/attachment:right-1">
                                <AttachmentAction variant="default" className="rounded-full" disabled>
                                    <Check data-icon />
                                </AttachmentAction>
                            </AttachmentActions>
                        ) : null}
                        <AttachmentTrigger
                            disabled={isSelected}
                            aria-label={`选择图片：${material.name}`}
                            aria-pressed={isSelected}
                            onClick={() => onSelect(material)}
                        />
                    </Attachment>
                )
            })}
            {hasMore ? (
                <LoadMoreButton
                    remaining={remaining}
                    onLoadMore={loadMore}
                    label={`加载更多（余 ${String(remaining)} 张）`}
                    className="col-span-3"
                />
            ) : null}
        </AttachmentGroup>
    )
}

interface NewsPickerProps {
    accountId: string
    selectedId: string
    onSelect: (issue: NewsSelectItem) => void
}

/** 图文素材列表：以已发布批次为图文单元，只有拿到平台 articleId 的批次可选 */
function NewsPicker({ accountId, selectedId, onSelect }: NewsPickerProps): JSX.Element {
    const { issues, status, error, reload } = useWechatNewsSources(accountId)
    const covers = useWechatIssueCovers(issues)
    const stateView = (
        <PickerStateView
            status={status}
            error={error}
            isEmpty={issues.length === 0}
            icon={Newspaper}
            loadingTitle="读取图文…"
            errorTitle="图文读取失败"
            emptyTitle="无可下发图文"
            emptyDescription="群发成功后的图文才可用于菜单"
            onRetry={reload}
        />
    )
    if (stateView !== null) {
        return stateView
    }
    return (
        <ItemGroup className="max-h-64 gap-1 overflow-y-auto">
            {issues.map((issue) => {
                const item = toNewsItem(issue, covers, selectedId)
                return (
                    <Item
                        key={issue.id}
                        variant="outline"
                        size="sm"
                        className={item.isSelected ? 'border border-primary' : undefined}
                    >
                        <ItemMedia variant="image">
                            <Image src={item.coverUrl} alt={item.title} />
                        </ItemMedia>
                        <ItemContent className="min-w-0">
                            <ItemTitle className="flex w-full items-center gap-1">
                                <span className="min-w-0 truncate">{item.title}</span>
                                <Badge variant={item.isPublished ? 'default' : 'outline'} className="shrink-0">
                                    {item.isPublished ? '已发布' : '草稿'}
                                </Badge>
                            </ItemTitle>
                            <ItemDescription className="text-xs">{`${String(item.articleCount)} 篇`}</ItemDescription>
                        </ItemContent>
                        <ItemActions className="shrink-0">
                            <Button variant="outline" disabled={item.isSelected} onClick={() => onSelect(issue)}>
                                {item.isSelected ? '已选择' : '选择'}
                            </Button>
                        </ItemActions>
                    </Item>
                )
            })}
        </ItemGroup>
    )
}
