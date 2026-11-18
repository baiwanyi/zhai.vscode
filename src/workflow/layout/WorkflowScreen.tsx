/**
 * 工作流屏幕：按当前文档的内容归属渲染内容区，右侧常驻全局侧边导航，并托管分区与宿主视图请求。
 * 复用约定：路由事实来自 hooks/useWorkflowRouting，归属、可用分区与作用域目录来自 contentScope，
 * 作品文档交给 press 模块的 WorkflowPress（内部分区路由），其余文档交给 WorkflowResidentSection（常驻分区）。
 * 关键约束：分区（section）由本层托管后同时下发给内容区与导航，两侧不会各持一份；
 * 内容归属变化导致当前分区不可用时，渲染期回落到 AI 对话而不改写 state，切回原归属仍能回到上次分区；
 * 宿主视图请求在本层对齐，不沉到子页面；归档文档只切分区，切换文档归属由宿主事实驱动，
 * 归属切换后当前分区在新归属下仍可用则保留，不可用才落回 AI 对话；
 * 工作流区只服务 Markdown：宿主事实 isMarkdown 为假时整块不可用，只给一张居中的空白页（产品 logo）——
 * 导航、内容与任何提示文案都不渲染，避免非 md 文件被工作流区接管时露出多余说明；
 * 该判定只看宿主下发的字段，本层不按路径自行推断；
 * 路由事实未就绪时渲染全屏加载空态，避免先闪出空白内容区。
 * 全局提示：sonner 的 Toaster 只在本层挂载一次，且挂在内容之外 —— 面板未就绪、空白页与正常页共用同一个实例，
 * 切换文档不卸载，空白页期间宿主推来的提示也能即时显示；页面内的操作结果统一用 toast 上报，页面不再自挂；
 * 宿主侧命令结果经 useHostToast 订阅 toast 广播，在本层同样用 sonner 呈现。
 */
import { useCallback, useState } from 'react'
import { Toaster } from '@components/ui/sonner'
import { Image } from '@webview/components/Image'
import { StateEmpty } from '@webview/components/StateEmpty'
import { useHostToast } from '@webview/hooks/useHostToast'
import { useVscodeTheme } from '@webview/hooks/useVscodeTheme'
import logoIcon from '@resources/icon.svg'
import { readAvailableSections, readContentScope, readScopeDir } from './contentScope'
import { WorkflowNav } from './WorkflowNav'
import { WorkflowResidentSection } from './WorkflowResidentSection'
import { isWorkflowSection } from './workflowSections'
import type { WorkflowSection } from './workflowSections'
import type { JSX } from 'react'
import { useWorkflowRouting } from '../hooks/useWorkflowRouting'
import { WorkflowPress } from '../press/WorkflowPress'
import { WorkflowWechat } from '../wechat/WorkflowWechat'

/** 默认分区：页面主体即 AI 对话，默认高亮与当前可见内容一致 */
const DEFAULT_SECTION: WorkflowSection = 'chat'

export function WorkflowScreen(): JSX.Element {
    const { context, viewRequest, isReady } = useWorkflowRouting()
    const theme = useVscodeTheme()
    const [activeSection, setActiveSection] = useState<WorkflowSection>(DEFAULT_SECTION)
    const [appliedViewSeq, setAppliedViewSeq] = useState<number | null>(null)
    const scope = readContentScope(context)
    const [appliedScope, setAppliedScope] = useState(scope)
    useHostToast()

    /**
     * 内容归属切换（作品 ↔ 笔记 ↔ 其他文档）时按新归属校正分区：
     * 当前分区在新归属下仍可用（如两侧都有「校对」）就原样保留，用户不必再点一次；
     * 只有不可用（如作品的「设定」切到笔记）才落回 AI 对话。
     * 在渲染期对齐而非放进 effect，避免多一轮渲染才切换；同一归属内切换文档不做校正，
     * 用户在该归属下停留的分区得以保留。
     */
    if (appliedScope !== scope) {
        setAppliedScope(scope)
        if (!readAvailableSections(scope).includes(activeSection)) {
            setActiveSection(DEFAULT_SECTION)
        }
    }

    /**
     * 宿主发起的页内跳转（如「添加到宅对话」后落到对话分区）：同样在渲染期对齐，且排在归属对齐之后，
     * 保证同一次切换里宿主的意图优先。按序号比对，同一分区被连续请求时也会重新落位；
     * 不属于本页的视图标识只记序号、不切分区，宿主新增页面时不会把这里切到空白。
     */
    if (viewRequest !== null && viewRequest.seq !== appliedViewSeq) {
        setAppliedViewSeq(viewRequest.seq)
        if (isWorkflowSection(viewRequest.view)) {
            setActiveSection(viewRequest.view)
        }
    }

    const handleSelectSection = useCallback((section: WorkflowSection): void => {
        setActiveSection(section)
    }, [])

    /**
     * 内容区：未就绪与非 Markdown 共用同一套空态骨架，其余情况才进正常页面。
     * 只产出内容、不挂提示容器 —— Toaster 在下方与内容同级只挂一次，切换文档时不被卸载，
     * 正在显示的宿主提示不会被打断后再补发重放。
     */
    const renderContent = (): JSX.Element => {
        // 未就绪与非 Markdown 共用同一个空态骨架：logo 与图标位常驻，只有标题位在变 ——
        // 就绪前 StateEmpty 把标题位换成转圈、不渲染文字（此时 title 仅作转圈的可访问名），就绪后显示 slogan；
        // 两态都传 title，避免加载态退回 Spinner 默认的英文 "Loading" 播报
        if (!isReady || !context.isMarkdown) {
            const isPending = !isReady
            return (
                <StateEmpty
                    className="h-screen"
                    title={isPending ? '正在读取工作流' : '宅于一隅，落笔千言'}
                    icon={BrandLogo}
                    iconClassName="size-32 rounded-none bg-transparent"
                    isLoading={isPending}
                />
            )
        }
        // 归属变化后当前分区可能不可用（如从作品切到笔记时停在「设定」）：渲染期回落，不改写 state
        const section = readAvailableSections(scope).includes(activeSection) ? activeSection : DEFAULT_SECTION
        return (
            <div className="flex h-screen min-h-0">
                <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                    {scope === 'press' ? (
                        <WorkflowPress context={context} section={section} onSelectSection={handleSelectSection} />
                    ) : scope === 'wechat' ? (
                        <WorkflowWechat
                            section={section}
                            scopeDir={readScopeDir(context, scope)}
                            docPath={context.docPath}
                        />
                    ) : (
                        <WorkflowResidentSection
                            section={section}
                            scopeDir={readScopeDir(context, scope)}
                            docPath={context.docPath}
                        />
                    )}
                </div>
                <WorkflowNav activeSection={section} scope={scope} onSelect={handleSelectSection} />
            </div>
        )
    }

    return (
        <>
            {renderContent()}
            <Toaster theme={theme} />
        </>
    )
}

/**
 * 空白页 logo：StateEmpty 的 icon 只接受组件形式，提取到模块层保持稳定身份 ——
 * 内联箭头函数每轮渲染都是新类型，会让 Image 被卸载重挂，加载态跟着重置。
 */
function BrandLogo(): JSX.Element {
    return <Image src={logoIcon} alt="" className="size-32 object-contain opacity-10" />
}
