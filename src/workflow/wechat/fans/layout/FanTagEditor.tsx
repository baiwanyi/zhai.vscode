/**
 * 标签编辑器：行内图标按钮与 Popover，列出候选标签并即时切换勾选态。
 * 复用约定：面板壳复用 @webview/components/ActionPopover，已打标签用 useMemo 构造 Set 做 O(1) 查找。
 * 关键约束：写操作期间禁用所有按钮防重复提交；空标签列表给出提示而不是空白面板。
 */
import { Tags } from 'lucide-react'
import { useMemo } from 'react'
import type { WechatFanSummary, WechatFanTag } from '@shared/types/wechat'
import { ActionPopover } from '@webview/components/ActionPopover'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

interface FanTagEditorProps {
    fan: WechatFanSummary
    tags: WechatFanTag[]
    isMutating: boolean
    onToggleTag: (openid: string, tagId: number, action: 'add' | 'remove') => Promise<boolean>
}

export function FanTagEditor({ fan, tags, isMutating, onToggleTag }: FanTagEditorProps): JSX.Element {
    const taggedIdSet = useMemo(() => new Set(fan.tagIds), [fan.tagIds])

    return (
        <ActionPopover
            variant="secondary"
            tooltip="编辑标签"
            buttonProps={{ 'aria-label': `编辑标签 ${fan.openid}` }}
            icon={<Tags className="size-3.5" />}
            disabled={isMutating}
        >
            {() =>
                tags.length === 0 ? (
                    <p className="text-xs text-muted-foreground">暂无标签</p>
                ) : (
                    <div className="flex max-h-64 flex-wrap gap-1.5 overflow-y-auto">
                        {tags.map((tag) => {
                            const isTagged = taggedIdSet.has(tag.id)
                            return (
                                <Button
                                    key={tag.id}
                                    size="sm"
                                    variant={isTagged ? 'default' : 'outline'}
                                    disabled={isMutating}
                                    onClick={() => void onToggleTag(fan.openid, tag.id, isTagged ? 'remove' : 'add')}
                                >
                                    {tag.name}
                                </Button>
                            )
                        })}
                    </div>
                )
            }
        </ActionPopover>
    )
}
