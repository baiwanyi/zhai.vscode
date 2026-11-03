/**
 * 生图参考图选择器：工具栏「参考图片」按钮，点击由宿主弹出本地文件选择框。
 * 复用约定：触发器取 @webview/components/Button（尺寸 icon，secondary 底色与工具栏其余入口一致），
 * 宿主请求经 @shared/utils/bridge，失败统一 toastError。
 * 关键约束：文件校验与路径登记都在宿主完成，前端只持有回传的文件名、路径与预览地址；
 * 用户取消时宿主返回 null，前端静默忽略；选择期间与达到上限时按钮禁用，
 * 前者避免连点弹出多个选择框，后者避免挂上会被宿主按上限丢弃的图。
 */
import { ImagePlus } from 'lucide-react'
import { useState } from 'react'
import type { ImageReferenceItem, ImageReferencePickResult } from '@shared/types/imagegen'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

/** 选择超时：文件对话框由用户操作，可能停留数分钟，不能用默认的十秒 */
const PICK_TIMEOUT_MS = 300_000

interface ImageReferencePickerProps {
    /** 已达参考图上限：按钮禁用，避免加上去却被宿主按上限丢弃 */
    disabled: boolean
    /** 选中并校验通过的图片：由输入卡片挂成参考芯片 */
    onPick: (reference: ImageReferenceItem) => void
}

export function ImageReferencePicker({ disabled, onPick }: ImageReferencePickerProps): JSX.Element {
    /** 选择框打开中：宿主对话框期间按钮保持禁用，避免重复弹窗 */
    const [isPicking, setIsPicking] = useState(false)

    const runPick = async (): Promise<void> => {
        setIsPicking(true)
        try {
            const result = await request<ImageReferencePickResult>(
                'pressAi/pickReferenceImage',
                undefined,
                PICK_TIMEOUT_MS,
            )
            if (result.reference !== null) {
                onPick(result.reference)
            }
        } catch (cause) {
            toastError(cause)
        } finally {
            setIsPicking(false)
        }
    }

    const handleClick = (): void => {
        void runPick()
    }

    return (
        <Button
            size="icon"
            variant="secondary"
            tooltip="参考图片"
            aria-label={disabled ? '参考图已达上限' : '添加参考图片'}
            disabled={isPicking || disabled}
            onClick={handleClick}
        >
            <ImagePlus />
        </Button>
    )
}
