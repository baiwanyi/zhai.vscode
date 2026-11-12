/**
 * 斜杠命令扩展：把 `/` 的输入捕获（Suggestion）接到 slashStore。
 * 复用约定：Suggestion 只负责「识别触发 / 计算查询词范围 / 给出定位矩形」，渲染与键盘交给 React 菜单；
 * 图标与命令清单一律来自 slashCommands，扩展本身不出现任何业务文案。
 * 关键约束：allowedPrefixes 限定为空白，避免路径、URL 或「1/2」这类正文误触发；
 * onExit 必须清空会话，否则按 Esc 之后弹层会僵在屏幕上无法关闭。
 */
import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { filterSlashCommands } from './slashCommands'
import { setSlashSession } from './slashStore'
import type { SlashCommand } from './slashCommands'
import type { Plugin } from '@tiptap/pm/state'
import type { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion'

/** Suggestion 的 renderer 形态：直接取官方签名，避免手写一遍生命周期方法 */
type SlashRenderer = ReturnType<NonNullable<SuggestionOptions<SlashCommand, SlashCommand>['render']>>

/** 把 Suggestion 的回传转成菜单会话：onStart 与 onUpdate 的载荷结构一致，共用一份转换 */
function publish(props: SuggestionProps<SlashCommand, SlashCommand>): void {
    const rect = props.clientRect?.()
    setSlashSession({
        items: props.items,
        range: props.range,
        anchor: { left: rect?.left ?? 0, top: (rect?.bottom ?? 0) + 4 },
        run: (item) => {
            props.command(item)
        },
    })
}

export const SlashCommandExtension = Extension.create({
    name: 'zhaiSlashCommand',

    addProseMirrorPlugins(): Plugin[] {
        const options: Omit<SuggestionOptions<SlashCommand, SlashCommand>, 'editor'> = {
            char: '/',
            allowSpaces: false,
            startOfLine: false,
            allowedPrefixes: [' '],
            items: ({ query }): SlashCommand[] => filterSlashCommands(query),
            command: ({ editor, range, props }) => {
                // props 即被选中的 SlashCommand：Suggestion 原样回传
                props.run(editor, range)
            },
            render: (): SlashRenderer => ({
                onStart: publish,
                onUpdate: publish,
                // 键盘由 React 菜单接管：这里返回 false 让 Suggestion 不做默认处理
                onKeyDown: () => false,
                onExit: (): void => {
                    setSlashSession(null)
                },
            }),
        }
        return [Suggestion({ editor: this.editor, ...options })]
    },
})
