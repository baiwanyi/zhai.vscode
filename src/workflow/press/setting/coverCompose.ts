/**
 * 封面书名合成：在已生成的无字底图上用画布叠加书名与笔名，导出 PNG data URL 交给宿主落盘。
 * 复用约定：字体、位置与配色选项集中在此一份，组件只读选项表，不各写一套字体栈；
 * 画布尺寸取底图原始像素，不拉伸、不裁切，避免与出图比例不一致。
 * 关键约束：书名按画布宽度自动折行并逐档缩小字号，最多三行；折行按字符而非单词（中文无空格）；
 * 文件名与配额由宿主决定，本模块只负责像素；底图来自 asWebviewUri，同源才能 toDataURL，
 * 被跨源污染时导出会抛错，由调用方提示用户改用其他封面。
 */

/** 标题位置：按画布高度分三档，参考网文封面以中下部为主 */
export type CoverTitlePosition = 'top' | 'middle' | 'bottom'

/** 文字配色：深墨字配浅描边、浅米字配深描边，保证在不同底图亮度下都可读 */
export type CoverTitleTone = 'ink' | 'light'

/** 字体选项：value 作存储键，stack 直接用于 canvas 的 font 属性 */
export interface CoverFontOption {
    value: string
    label: string
    stack: string
}

/** 可选字体：只列 Windows / macOS 常见中文字体，缺失时按栈尾的通用族回落 */
export const COVER_FONT_OPTIONS: readonly CoverFontOption[] = [
    {
        value: 'hei',
        label: '黑体',
        stack: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif',
    },
    {
        value: 'song',
        label: '宋体',
        stack: 'SimSun, "Songti SC", "Noto Serif SC", serif',
    },
    {
        value: 'kai',
        label: '楷体',
        stack: 'KaiTi, "Kaiti SC", "STKaiti", serif',
    },
    {
        value: 'round',
        label: '圆体',
        stack: '"YouYuan", "Yuanti SC", "Microsoft YaHei", sans-serif',
    },
]

/** 位置选项：与 CoverTitlePosition 一一对应 */
export const COVER_POSITION_OPTIONS: readonly { value: CoverTitlePosition; label: string }[] = [
    { value: 'top', label: '上部' },
    { value: 'middle', label: '居中' },
    { value: 'bottom', label: '中下部' },
]

/** 配色选项：与 CoverTitleTone 一一对应 */
export const COVER_TONE_OPTIONS: readonly { value: CoverTitleTone; label: string }[] = [
    { value: 'ink', label: '深墨字' },
    { value: 'light', label: '浅米字' },
]

/** 书名排版入参：书名与笔名为空时由调用方决定是否跳过对应元素 */
export interface CoverTitleLayout {
    title: string
    author: string
    /** 字体键：取 COVER_FONT_OPTIONS 的 value，未知值回落为首项 */
    font: string
    position: CoverTitlePosition
    tone: CoverTitleTone
}

/** 书名最多折行数：超过则继续缩小字号，避免压住画面主体 */
const TITLE_MAX_LINES = 3
/** 书名最大宽度占比：两侧各留约 9% 安全边 */
const TITLE_WIDTH_RATIO = 0.82
/** 书名最大字号占比（相对画布高度） */
const TITLE_MAX_SIZE_RATIO = 0.16
/** 书名最小字号占比：再小在缩略图里已不可读 */
const TITLE_MIN_SIZE_RATIO = 0.06
/** 行高倍数：中文标题需要比字号更松的行距 */
const TITLE_LINE_HEIGHT_RATIO = 1.18
/** 笔名最大字号占比：作为署名，明显小于书名 */
const AUTHOR_SIZE_RATIO = 0.042
/** 笔名距画布底部的距离占比：落在出图预留的署名留白里 */
const AUTHOR_BOTTOM_RATIO = 0.055

/**
 * 在底图上合成书名与笔名
 * @param baseUrl 已落盘封面的 webview URL（同源，可直接绘制）
 * @returns PNG data URL，可直接交给 pressAi/saveCover
 */
export async function composeCover(baseUrl: string, layout: CoverTitleLayout): Promise<string> {
    const image = await loadImage(baseUrl)
    const width = image.naturalWidth
    const height = image.naturalHeight
    if (width === 0 || height === 0) {
        throw new Error('底图尺寸异常，无法合成封面')
    }
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (context === null) {
        throw new Error('当前环境不支持画布合成')
    }
    context.drawImage(image, 0, 0, width, height)
    const font = COVER_FONT_OPTIONS.find((option) => option.value === layout.font) ?? COVER_FONT_OPTIONS[0]
    const stack = font?.stack ?? '"Microsoft YaHei", sans-serif'
    drawTitle(context, canvas, layout, stack)
    drawAuthor(context, canvas, layout, stack)
    return canvas.toDataURL('image/png')
}

/** 加载底图：decode 完成后再绘制，避免画布画出空白帧 */
async function loadImage(url: string): Promise<HTMLImageElement> {
    const image = new Image()
    image.src = url
    await image.decode()
    return image
}

/** 书名：按宽度折行并从最大字号逐档缩小，直到行数满足上限 */
function drawTitle(
    context: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    layout: CoverTitleLayout,
    stack: string,
): void {
    const title = layout.title.trim()
    if (title.length === 0) {
        return
    }
    const maxWidth = canvas.width * TITLE_WIDTH_RATIO
    const { lines, size } = fitTitle(context, title, stack, maxWidth, canvas.height)
    const lineHeight = size * TITLE_LINE_HEIGHT_RATIO
    const blockHeight = lineHeight * lines.length
    const top = resolveBlockTop(canvas.height, blockHeight, layout.position)
    const palette = readPalette(layout.tone)
    context.font = `700 ${String(size)}px ${stack}`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.lineJoin = 'round'
    context.lineWidth = Math.max(2, size * 0.1)
    context.strokeStyle = palette.stroke
    context.fillStyle = palette.fill
    lines.forEach((line, index) => {
        const y = top + lineHeight * index + lineHeight / 2
        // 先描边再填色：浅描边勾出字的外轮廓，深色底图与浅色底图都能压住
        context.strokeText(line, canvas.width / 2, y)
        context.fillText(line, canvas.width / 2, y)
    })
}

/** 笔名：贴画布底部居中，始终使用浅色 + 细描边，避免与书名抢视觉 */
function drawAuthor(
    context: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    layout: CoverTitleLayout,
    stack: string,
): void {
    const author = layout.author.trim()
    if (author.length === 0) {
        return
    }
    const size = Math.round(canvas.height * AUTHOR_SIZE_RATIO)
    const palette = readPalette(layout.tone)
    context.font = `500 ${String(size)}px ${stack}`
    context.textAlign = 'center'
    context.textBaseline = 'alphabetic'
    context.lineJoin = 'round'
    context.lineWidth = Math.max(2, size * 0.12)
    context.strokeStyle = palette.stroke
    context.fillStyle = palette.fill
    const y = canvas.height * (1 - AUTHOR_BOTTOM_RATIO)
    context.strokeText(author, canvas.width / 2, y)
    context.fillText(author, canvas.width / 2, y)
}

/** 按画布宽度逐字符折行：中文书名没有空格，只能在字符边界断行 */
function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const lines: string[] = []
    let current = ''
    for (const char of text) {
        if (char === '\n') {
            lines.push(current)
            current = ''
            continue
        }
        const next = current + char
        if (current.length > 0 && context.measureText(next).width > maxWidth) {
            lines.push(current)
            current = char
            continue
        }
        current = next
    }
    if (current.length > 0) {
        lines.push(current)
    }
    return lines
}

/** 书名排版：从最大字号逐档缩小，直到折行数不超过上限 */
function fitTitle(
    context: CanvasRenderingContext2D,
    title: string,
    stack: string,
    maxWidth: number,
    canvasHeight: number,
): { lines: string[]; size: number } {
    const maxSize = Math.round(canvasHeight * TITLE_MAX_SIZE_RATIO)
    const minSize = Math.round(canvasHeight * TITLE_MIN_SIZE_RATIO)
    for (let size = maxSize; size >= minSize; size -= 2) {
        context.font = `700 ${String(size)}px ${stack}`
        const lines = wrapText(context, title, maxWidth)
        if (lines.length <= TITLE_MAX_LINES) {
            return { lines, size }
        }
    }
    context.font = `700 ${String(minSize)}px ${stack}`
    return { lines: wrapText(context, title, maxWidth).slice(0, TITLE_MAX_LINES), size: minSize }
}

/** 标题块顶部位置：上部留 10% 边，中下部则把块底压到 82% 处 */
function resolveBlockTop(canvasHeight: number, blockHeight: number, position: CoverTitlePosition): number {
    if (position === 'top') {
        return canvasHeight * 0.1
    }
    if (position === 'middle') {
        return (canvasHeight - blockHeight) / 2
    }
    return canvasHeight * 0.82 - blockHeight
}

/** 配色：深墨字用浅描边，浅米字用深描边 */
function readPalette(tone: CoverTitleTone): { fill: string; stroke: string } {
    return tone === 'ink'
        ? { fill: '#161616', stroke: 'rgba(255, 255, 255, 0.92)' }
        : { fill: '#faf7f0', stroke: 'rgba(0, 0, 0, 0.55)' }
}
