/**
 * 输入区粘贴拦截：把文本里的 `@zhai\` 路径交给宿主添加为上下文引用，成功的令牌从正文中剥离。
 * 复用约定：令牌识别与按位置切片取 @shared/utils/zhaiPath，添加动作与落字位置由输入卡片注入。
 * 关键约束：未命中令牌时完全不干预默认粘贴；多个令牌并发添加，单条失败（含请求异常）只让该令牌留在正文；
 * 剥离点只归一留白、段内缩进保留；输入区已锁定或卸载时剩余正文回落到受控值，不丢内容。
 */
import { useCallback } from 'react'
import { readZhaiTargets, splitZhaiSegments } from '@shared/utils/zhaiPath'
import type { AiPastedRefTarget } from './useAiChatMention'
import type { ClipboardEvent } from 'react'

/** 粘贴引用 hook 的对外依赖：添加动作与落字方式由输入卡片注入 */
export interface UseZhaiPasteRefsOptions {
    /** 添加引用：缺省表示不接管粘贴，事件原样放行 */
    addRef?: (target: AiPastedRefTarget) => Promise<boolean>
    /** 把剩余正文插到光标处：返回是否插入成功（输入区锁定或未挂载时为 false） */
    insertAtCaret: (text: string) => boolean
    /** 插入失败时追加到受控正文 */
    appendToInput: (text: string) => void
}

/** 粘贴拦截对外暴露的操作 */
export interface ZhaiPasteRefsState {
    /** 粘贴拦截：未命中 @zhai 令牌时不拦截、不阻止默认粘贴 */
    capturePaste: (event: ClipboardEvent<HTMLDivElement>) => void
}

/**
 * 剥离点拼接：令牌被摘掉后把左右两段接上，两侧留白合并成一个分隔 ——
 * 中间有换行就留一个换行（避免留下空行），否则留一个空格；段内的缩进与连续空格原样保留。
 */
function joinAtCut(left: string, right: string): string {
    const tail = /[ \t\n]*$/u.exec(left)?.[0] ?? ''
    const head = /^[ \t\n]*/u.exec(right)?.[0] ?? ''
    if (tail.length === 0 && head.length === 0) {
        return `${left}${right}`
    }
    const separator = `${tail}${head}`.includes('\n') ? '\n' : ' '
    return `${left.slice(0, left.length - tail.length)}${separator}${right.slice(head.length)}`
}

/**
 * 粘贴的路径引用：交给宿主添加，成功的令牌从文本中剥离，失败的留在正文里让用户看得见。
 * 关键约束：同一段粘贴里的令牌互不依赖，一次并发发出，避免 N 个引用产生 N 次串行往返；
 * 切片位置取 splitZhaiSegments（与宿主展开共用同一份下标规则），留白只在剥离点归一；
 * 全部成功时返回空串。
 */
async function consumeZhaiTokens(
    text: string,
    matches: ReturnType<typeof readZhaiTargets>,
    addRef: (target: AiPastedRefTarget) => Promise<boolean>,
): Promise<string> {
    const results = await Promise.all(matches.map((match) => addRef(match.target).catch((): boolean => false)))
    const handled = matches.filter((_, index) => results[index] === true)
    if (handled.length === 0) {
        return text
    }
    const segments = splitZhaiSegments(text, handled)
    let rest = segments[0] ?? ''
    for (let index = 1; index < segments.length; index += 1) {
        rest = joinAtCut(rest, segments[index] ?? '')
    }
    // 只清理整段首尾：用户正文里的排版与缩进保持原样
    return rest.trim()
}

export function useZhaiPasteRefs({
    addRef,
    insertAtCaret,
    appendToInput,
}: UseZhaiPasteRefsOptions): ZhaiPasteRefsState {
    const capturePaste = useCallback(
        (event: ClipboardEvent<HTMLDivElement>): void => {
            if (addRef === undefined) {
                return
            }
            const text = event.clipboardData.getData('text/plain')
            if (!text.includes('@zhai')) {
                return
            }
            const matches = readZhaiTargets(text)
            if (matches.length === 0) {
                return
            }
            event.preventDefault()
            event.stopPropagation()
            void consumeZhaiTokens(text, matches, addRef).then((rest) => {
                if (rest.length === 0) {
                    return
                }
                // 输入区还可用就插到光标处；已被锁定或卸载（如添加引用期间已发送）则回落到受控正文
                if (insertAtCaret(rest)) {
                    return
                }
                appendToInput(rest)
            })
        },
        [addRef, appendToInput, insertAtCaret],
    )

    return { capturePaste }
}
