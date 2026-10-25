/**
 * 富文本可编辑区的 DOM 工具：读取与写入纯文本、定位光标、识别与插入芯片节点。
 * 复用约定：芯片统一用 data-chip 标记且 contentEditable=false，芯片文案不计入正文；
 * 供 @webview/components/RichChipInput 与 aichat 的富文本输入区共用，本文件不掺业务语义。
 * 关键约束：读写正文必须跳过芯片；<br> 还原为换行；移动光标前先确认编辑器已聚焦，避免抢走其它输入框的焦点。
 */

/** 判断节点是否为不可编辑芯片 */
export function isChip(node: Node | null | undefined): node is HTMLElement {
    return node instanceof HTMLElement && node.dataset.chip !== undefined
}

/** 读取可编辑区纯文本：芯片文案不计入，换行由 `<br>` 还原为 `\n` */
export function readEditableText(host: HTMLElement): string {
    let text = ''
    const walk = (node: Node): void => {
        if (isChip(node)) {
            return
        }
        if (node.nodeType === Node.TEXT_NODE) {
            text += node.nodeValue ?? ''
            return
        }
        if (!(node instanceof HTMLElement)) {
            return
        }
        if (node.tagName === 'BR') {
            text += '\n'
            return
        }
        node.childNodes.forEach(walk)
    }
    host.childNodes.forEach(walk)
    return text
}

/** 用纯文本重写可编辑区（保留芯片节点），用于外部改值 */
export function writeEditableText(host: HTMLElement, value: string): void {
    Array.from(host.childNodes).forEach((node) => {
        if (isChip(node)) {
            return
        }
        host.removeChild(node)
    })
    if (value.length > 0) {
        host.appendChild(document.createTextNode(value))
    }
}

/** 把光标置于可编辑区末尾：仅在编辑器已聚焦时执行 */
export function moveCaretToEnd(host: HTMLElement): void {
    if (document.activeElement !== host) {
        return
    }
    const selection = window.getSelection()
    if (!selection) {
        return
    }
    const range = document.createRange()
    range.selectNodeContents(host)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
}

/** 查找光标紧邻的芯片：用于 Backspace / Delete 改走状态删除，避免 DOM 与状态不同步 */
export function findAdjacentChip(host: HTMLElement | null, direction: 'backward' | 'forward'): HTMLElement | null {
    if (!host) {
        return null
    }
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
        return null
    }
    const range = selection.getRangeAt(0)
    if (!host.contains(range.startContainer)) {
        return null
    }
    const { startContainer, startOffset } = range
    if (startContainer.nodeType === Node.TEXT_NODE) {
        const text = startContainer.nodeValue ?? ''
        if (direction === 'backward' ? startOffset !== 0 : startOffset !== text.length) {
            return null
        }
        const sibling = direction === 'backward' ? startContainer.previousSibling : startContainer.nextSibling
        return isChip(sibling) ? sibling : null
    }
    if (startContainer !== host) {
        return null
    }
    const sibling = direction === 'backward' ? host.childNodes[startOffset - 1] : host.childNodes[startOffset]
    return isChip(sibling) ? sibling : null
}

/** 在光标处插入纯文本：选区落在芯片上时先收敛到末尾，避免连带删除芯片 */
export function insertPlainText(host: HTMLElement, text: string): void {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) {
        host.appendChild(document.createTextNode(text))
        return
    }
    const range = selection.getRangeAt(0)
    const anchor = range.startContainer
    const isInsideChip =
        anchor instanceof HTMLElement
            ? anchor.closest('[data-chip]') !== null
            : anchor.parentElement?.closest('[data-chip]') !== null
    if (!host.contains(anchor) || isInsideChip === true) {
        host.focus()
        moveCaretToEnd(host)
        insertPlainText(host, text)
        return
    }
    range.deleteContents()
    const node = document.createTextNode(text)
    range.insertNode(node)
    range.setStartAfter(node)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
}
