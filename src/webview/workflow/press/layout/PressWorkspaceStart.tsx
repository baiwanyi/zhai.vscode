/**
 * 写作管理初始页：尚未打开作品时的落点，列出索引库中的作品供选择。
 * 复用 @components/ui 的 empty / button 组合与 press/utils 的字数格式化；作品清单由工作流页从宿主拉取后传入。
 * 关键约束：打开动作交由宿主打开作品文档并广播新路由事实（projectDir），本组件不自行解析路由、不拼接作品路径；
 * 失败提示由调用方经 sonner 处理，本页只负责展示与回传选择。
 */
import { BookOpen, FolderOpen } from 'lucide-react'
import { Button } from '@components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@components/ui/empty'
import type { PressProjectSummary } from '@shared/types/press'
import type { JSX } from 'react'
import { formatWordCount } from '../utils'

interface PressWorkspaceStartProps {
    /** 索引库聚合出的作品清单，空数组表示还没有任何作品 */
    projects: PressProjectSummary[]
    /** 选择作品：由工作流页转发给宿主，成功与否不在本组件内处理 */
    onOpenProject: (dirPath: string) => void
}

export function PressWorkspaceStart({ projects, onOpenProject }: PressWorkspaceStartProps): JSX.Element {
    return (
        <div className="flex h-full min-h-0 flex-col justify-center p-4">
            <Empty>
                <EmptyHeader>
                    <EmptyMedia variant="icon" className="size-12 rounded-2xl">
                        <BookOpen className="size-5" />
                    </EmptyMedia>
                    <EmptyTitle>还没有打开作品</EmptyTitle>
                    <EmptyDescription>
                        打开一部作品后，设定、人物与大纲会分别读取作品目录下的 设定.md、角色设定.md 与 大纲.md。
                    </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                    {projects.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                            还没有作品。先在仪表盘的写作管理里新建一部作品，再回到这里打开。
                        </p>
                    ) : (
                        <div className="flex max-h-72 w-full flex-col gap-1 overflow-y-auto">
                            {projects.map((project) => (
                                <Button
                                    key={project.dirPath}
                                    variant="outline"
                                    size="sm"
                                    className="justify-start"
                                    onClick={() => {
                                        onOpenProject(project.dirPath)
                                    }}
                                >
                                    <FolderOpen data-icon="inline-start" />
                                    <span className="truncate">{project.name}</span>
                                    <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                                        {formatWordCount(project.wordCount)}
                                    </span>
                                </Button>
                            ))}
                        </div>
                    )}
                </EmptyContent>
            </Empty>
        </div>
    )
}
