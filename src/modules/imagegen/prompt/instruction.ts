/**
 * 出图指令模板：把已拼好的提示词包成一段交给模型的指令，明确「立即调用 ImageGen、按 JSON 回报产物路径」。
 * 复用约定：图像通道只负责驱动工具与解析产物，措辞集中在此；本函数纯字符串拼装，不发请求、不读配置。
 * 关键约束：不得在指令里复述画面内容，否则模型会用文字描述代替出图；参考图必须写清张数与用法，
 * 否则模型会把它当普通附图忽略；尺寸单列一行，便于模型按比例构图；
 * 回报格式须与图像通道 outputFormat 的 schema 一致（{"path": string}），两侧改动必须同步。
 */

/** 指令入参：提示词、期望尺寸与参考图张数 */
export interface ImageInstructionInput {
    /** 已拼装完成的提示词正文 */
    prompt: string
    /** 期望尺寸，形如 768x1024 */
    size: string
    /** 随附参考图张数：0 表示纯文生图 */
    referenceCount: number
}

/** 拼出交给模型的出图指令：要求只调用工具并回报路径，避免它继续解释画面 */
export function buildImageInstruction({ prompt, size, referenceCount }: ImageInstructionInput): string {
    const lines = [
        '请立即调用 ImageGen 工具生成一张图片，不要先用文字说明或复述画面，也不要用文字描述代替出图。',
        referenceCount > 0
            ? `随附 ${String(referenceCount)} 张参考图片：先观察其中的主体、构图、色调与光影，把它们作为本次画面的参考，不要原样复刻。`
            : '',
        `画面要求：${prompt}`,
        `尺寸：${size}`,
        '完成后只回报 {"path": "图片的本地绝对路径或可访问链接"}，不要附加其他说明。',
    ]
    return lines.filter((line) => line.length > 0).join('\n')
}
