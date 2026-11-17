/**
 * 模型图标：按模型 id 前缀映射 resources/models 下的本地厂商图标，未命中统一回退 codebuddy.svg。
 * 复用约定：图标经 @resources 别名引入，由 Vite 打包为资源 URL（小文件内联为 data URI），
 * 展示走 @webview/components/Image，不做着色 —— 颜色完全由 SVG 文件自身决定。
 * 关键约束：映射依据是模型 id 前缀，清单里的 vendor 是内部代号（j/f/e），不能作为厂商依据；
 * 自定义模型（custom-local:*）不匹配任何厂商前缀，与未知模型一样落到 codebuddy.svg 兜底。
 */
import { Image } from '@webview/components/Image'
import codebuddyIcon from '@resources/models/codebuddy.svg'
import deepseekIcon from '@resources/models/deepseek.svg'
import glmIcon from '@resources/models/glm.svg'
import hunyuanIcon from '@resources/models/hunyuan.svg'
import kimiIcon from '@resources/models/kimi.svg'
import mimoIcon from '@resources/models/mimo.svg'
import minimaxIcon from '@resources/models/minimax.svg'
import stepfunIcon from '@resources/models/stepfun.svg'
import type { JSX } from 'react'

interface ModelIconSpec {
    /** 模型 id 前缀，命中即用该图标 */
    prefixes: readonly string[]
    /** 图标资源 URL */
    icon: string
}

const ICONS: readonly ModelIconSpec[] = [
    { prefixes: ['deepseek'], icon: deepseekIcon },
    { prefixes: ['glm', 'zhipu'], icon: glmIcon },
    { prefixes: ['hy'], icon: hunyuanIcon },
    { prefixes: ['kimi', 'moonshot'], icon: kimiIcon },
    { prefixes: ['minimax'], icon: minimaxIcon },
    { prefixes: ['mimo', 'xiaomi'], icon: mimoIcon },
    { prefixes: ['step'], icon: stepfunIcon },
]

/** 兜底图标：自定义模型与未提供厂商图形的模型统一显示 CodeBuddy 标志 */
const FALLBACK_ICON: ModelIconSpec = { prefixes: [], icon: codebuddyIcon }

interface ModelIconProps {
    /** 模型 id：品牌映射按前缀匹配 */
    modelId: string
    /** 展示名：作为图片的替代文本 */
    name: string
}

export function ModelIcon({ modelId, name }: ModelIconProps): JSX.Element {
    const label = name.length > 0 ? name : modelId
    const matched = ICONS.find((item) => item.prefixes.some((prefix) => modelId.startsWith(prefix))) ?? FALLBACK_ICON
    // 厂商图标并非等比（deepseek 1391×1024、minimax 1169×1024），须 contain，否则 14×14 的 cover 会裁掉左右
    return <Image src={matched.icon} alt={label} className="size-3.5 shrink-0 object-contain" />
}
