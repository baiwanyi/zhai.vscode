/**
 * 提示词库数据生成：把上游按 object 分片的 zh/*.json 合并成一份紧凑分组结构，
 * 输出 src/workflow/imagegen/prompt/data/promptTags.json，供 promptLibrary 读取。
 * 复用约定：只做字段裁剪与分组，不翻译、不改写提示词正文，权重剥离留给运行时。
 * 关键约束：preview 只保留文件名（目录由宿主决定）；输出必须紧凑单行——缩进格式会让体积翻倍；
 * 源目录由命令行传入，脚本内不写死任何本机绝对路径。
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'

const rootDir = path.resolve(import.meta.dirname, '..')
const sourceDir = process.argv[2]
const outFile = process.argv[3] ?? path.join(rootDir, 'src/workflow/imagegen/prompt/data/promptTags.json')

if (!sourceDir) {
    console.error('用法：node scripts/build-prompt-tags.mjs <上游 zh 目录> [输出文件]')
    process.exit(1)
}

/** 分片按数字序号排序，保证生成结果与文件名顺序一致 */
const chunkNames = readdirSync(sourceDir)
    .filter((name) => name.endsWith('.json'))
    .sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10))

if (chunkNames.length === 0) {
    console.error(`源目录没有 json 分片：${sourceDir}`)
    process.exit(1)
}

/** object → attribute → 词条，Map 保留上游出现顺序 */
const groups = new Map()

for (const chunkName of chunkNames) {
    const text = readFileSync(path.join(sourceDir, chunkName), 'utf8')
    const entries = JSON.parse(text)
    if (!Array.isArray(entries)) {
        throw new Error(`分片不是数组：${chunkName}`)
    }
    for (const entry of entries) {
        const { object, attribute, langName, displayName, preview } = entry
        if (typeof object !== 'string' || typeof attribute !== 'string' || typeof langName !== 'string') {
            throw new Error(`分片字段缺失：${chunkName}`)
        }
        if (typeof displayName !== 'string' || displayName.length === 0) {
            throw new Error(`提示词为空：${chunkName} / ${langName}`)
        }
        const fileName = typeof preview === 'string' ? path.posix.basename(preview) : ''
        if (!groups.has(object)) {
            groups.set(object, new Map())
        }
        const attributes = groups.get(object)
        if (!attributes.has(attribute)) {
            attributes.set(attribute, [])
        }
        attributes.get(attribute).push({ name: langName, prompt: displayName, preview: fileName })
    }
}

const payload = {
    groups: [...groups].map(([object, attributes]) => ({
        object,
        attributes: [...attributes].map(([name, tags]) => ({ name, tags })),
    })),
}

const serialized = `${JSON.stringify(payload)}\n`
mkdirSync(path.dirname(outFile), { recursive: true })
writeFileSync(outFile, serialized, 'utf8')

const total = payload.groups.reduce(
    (sum, group) => sum + group.attributes.reduce((inner, attribute) => inner + attribute.tags.length, 0),
    0,
)
const attributeTotal = payload.groups.reduce((sum, group) => sum + group.attributes.length, 0)
console.log(
    `已生成 ${path.relative(rootDir, outFile)}：${payload.groups.length} 个一级分类 / ${attributeTotal} 个二级分类 / ${total} 条词条 / ${Math.round(Buffer.byteLength(serialized) / 1024)} KB`,
)
