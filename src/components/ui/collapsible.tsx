/**
 * 折叠容器：在有限空间内展开或收起一段内容，不承担导航语义。
 * 复用约定：基于 radix-ui 构建，样式经 cn 合并。
 * 关键约束：Trigger 与 Content 必须成对出现；若需要多项互斥或分组语义，应改用 Accordion。
 */
'use client'

import { Collapsible as CollapsiblePrimitive } from 'radix-ui'

function Collapsible({ ...props }: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
    return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger({ ...props }: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
    return <CollapsiblePrimitive.CollapsibleTrigger data-slot="collapsible-trigger" {...props} />
}

function CollapsibleContent({ ...props }: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
    return <CollapsiblePrimitive.CollapsibleContent data-slot="collapsible-content" {...props} />
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
