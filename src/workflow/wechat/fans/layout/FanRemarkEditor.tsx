/**
 * 备注编辑器：行内图标按钮与 Popover，持有草稿并在保存成功后收起面板。
 * 复用约定：面板壳复用 @webview/components/ActionPopover，输入用 ui/input-group，长度上限复用 WECHAT_FAN_REMARK_MAX。
 * 关键约束：每次打开按最新 fan.remark 重置草稿；比较与提交都做 trim，避免平台备注含首尾空格时误启用保存；
 * 异步回包先判挂载再关闭面板，避免切页后幽灵回写。
 */
import { CornerDownLeft, SquarePen } from 'lucide-react'
import { useState } from 'react'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@components/ui/input-group'
import type { WechatFanSummary } from '@shared/types/wechat'
import { WECHAT_FAN_REMARK_MAX } from '@shared/types/wechat'
import { ActionPopover } from '@webview/components/ActionPopover'
import { useIsMounted } from '@webview/hooks/useIsMounted'
import type { JSX } from 'react'

interface FanRemarkEditorProps {
    fan: WechatFanSummary
    isMutating: boolean
    onRemark: (openid: string, remark: string) => Promise<boolean>
}

export function FanRemarkEditor({ fan, isMutating, onRemark }: FanRemarkEditorProps): JSX.Element {
    const [remarkDraft, setRemarkDraft] = useState(fan.remark ?? '')
    const isMountedRef = useIsMounted()

    const saveRemark = async (close: () => void): Promise<void> => {
        const isSaved = await onRemark(fan.openid, remarkDraft.trim())
        if (isSaved && isMountedRef.current) {
            close()
        }
    }

    return (
        <ActionPopover
            variant="secondary"
            tooltip="编辑备注"
            buttonProps={{ 'aria-label': `编辑备注 ${fan.openid}` }}
            icon={<SquarePen className="size-3.5" />}
            disabled={isMutating}
            onOpen={() => setRemarkDraft(fan.remark ?? '')}
        >
            {(close) => (
                <InputGroup>
                    <InputGroupInput
                        value={remarkDraft}
                        maxLength={WECHAT_FAN_REMARK_MAX}
                        placeholder="输入备注"
                        aria-label="备注"
                        disabled={isMutating}
                        onChange={(event) => setRemarkDraft(event.target.value)}
                    />
                    <InputGroupAddon align="inline-end">
                        <InputGroupButton
                            variant="default"
                            size="icon-xs"
                            aria-label="保存备注"
                            tooltip="保存备注"
                            disabled={isMutating || remarkDraft.trim() === (fan.remark ?? '').trim()}
                            onClick={() => void saveRemark(close)}
                        >
                            <CornerDownLeft className="size-3.5" />
                        </InputGroupButton>
                    </InputGroupAddon>
                </InputGroup>
            )}
        </ActionPopover>
    )
}
