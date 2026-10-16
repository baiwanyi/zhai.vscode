/**
 * 工作流占位页：模块或场景尚未接入专属工作流时的统一落点，避免视图出现空白。
 * 复用 @/components/ui 的 empty / button 组合，文案按模块键与场景分派，不发起任何宿主请求。
 * 关键约束：必须保留「仍然使用 AI 对话」出口，否则笔记编辑场景下用户会被挡在对话能力之外。
 */
import { MessagesSquare, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import type { WorkflowContextState, WorkflowId } from '@/shared/types/workflow'
import type { JSX } from 'react'

/** 公众号管理模块键：占位页据此切换文案与图标 */
const WECHAT_MODULE_KEY = 'wechat'

interface WorkflowPlaceholderProps {
    context: WorkflowContextState
    onOverride: (workflowId: WorkflowId) => void
}

interface PlaceholderText {
    title: string
    description: string
}

/** 模块键 → 占位文案；未登记的模块回落到场景文案 */
const MODULE_TEXT: Readonly<Record<string, PlaceholderText>> = {
    wechat: {
        title: '公众号管理',
        description: '公众号管理的专属工作流尚未接入，当前场景暂以占位页承接。',
    },
}

/** 笔记编辑场景文案 */
const EDITOR_NOTE_TEXT: PlaceholderText = {
    title: '笔记编辑',
    description: '笔记编辑场景的专属工作流尚未接入，当前场景暂以占位页承接。',
}

/** 无匹配时的兜底文案 */
const FALLBACK_TEXT: PlaceholderText = {
    title: '工作流待接入',
    description: '当前场景尚未匹配到专属工作流页面。',
}

/** 按模块键优先、场景次之的顺序选取文案 */
function readText(context: WorkflowContextState): PlaceholderText {
    const byModule = MODULE_TEXT[context.module]
    if (byModule !== undefined) {
        return byModule
    }
    return context.scene === 'editorNote' ? EDITOR_NOTE_TEXT : FALLBACK_TEXT
}

export function WorkflowPlaceholder({ context, onOverride }: WorkflowPlaceholderProps): JSX.Element {
    const text = readText(context)
    const isWechat = context.module === WECHAT_MODULE_KEY
    return (
        <div className="flex h-screen flex-col justify-center p-4">
            <Empty>
                <EmptyHeader>
                    <EmptyMedia variant="icon" className="size-12 rounded-2xl">
                        {isWechat ? <MessagesSquare className="size-5" /> : <Pencil className="size-5" />}
                    </EmptyMedia>
                    <EmptyTitle>{text.title}</EmptyTitle>
                    <EmptyDescription>{text.description}</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                    <Button size="sm" variant="outline" onClick={() => onOverride('chat')}>
                        <MessagesSquare data-icon="inline-start" />
                        仍然使用 AI 对话
                    </Button>
                </EmptyContent>
            </Empty>
        </div>
    )
}
