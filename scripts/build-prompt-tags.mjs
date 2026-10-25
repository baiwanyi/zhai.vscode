/**
 * 提示词库数据生成：把上游按 object 分片的 zh/*.json 合并成一份紧凑分组结构，
 * 输出 src/workflow/imagegen/prompt/data/promptTags.json，供 promptLibrary 读取。
 * 复用约定：只做字段裁剪与分组，不翻译、不改写提示词正文，权重剥离留给运行时。
 * 关键约束：preview 只存文件名（目录由宿主决定）；输出必须紧凑单行——缩进格式会让体积翻倍；
 * 传 --images 时按「sha1(原始 CDN URL) 前 10 位」反查本地图片真实文件名，未命中则回退原名；
 * 源目录与图库目录都由命令行传入，脚本内不写死任何本机绝对路径。
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'

/** 上游 CDN 前缀：本地文件名里的哈希就是这条完整 URL 的 sha1 前 10 位 */
const CDN_PREFIX = 'https://img.aishort.top/imgprompt/'
/** 本地文件名里哈希段的长度 */
const HASH_LENGTH = 10

const rootDir = path.resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)

/** 取 `--flag value` 形式的参数值 */
const flagValue = (name) => {
    const index = args.indexOf(name)
    return index >= 0 ? args[index + 1] : undefined
}

const usage = '用法：node scripts/build-prompt-tags.mjs <上游 zh 目录> [--images <图库目录>] [--out <输出文件>]'
const sourceDir = args[0]
if (!sourceDir || sourceDir.startsWith('--')) {
    console.error(usage)
    process.exit(1)
}

const imagesDir = flagValue('--images')
const outFile = flagValue('--out') ?? path.join(rootDir, 'src/workflow/imagegen/prompt/data/promptTags.json')

/** 上游原始文件名 → 本地文件名：下载器按 `{标题}_{sha1 前 10 位}.webp` 命名，只能由哈希反查 */
const localImageNames = new Map()
if (imagesDir !== undefined) {
    for (const name of readdirSync(imagesDir)) {
        const match = /_([0-9a-f]{10})\.webp$/i.exec(name)
        if (match !== null) {
            localImageNames.set(match[1].toLowerCase(), name)
        }
    }
    if (localImageNames.size === 0) {
        console.error(`图库目录里没有符合 {标题}_{哈希}.webp 命名的文件：${imagesDir}`)
        process.exit(1)
    }
}

/** 原始文件名对应的本地文件名；没传图库或没下载该图时回退到原始名 */
const resolveLocalName = (originName) => {
    if (localImageNames.size === 0) {
        return { name: originName, matched: false }
    }
    const hash = createHash('sha1').update(`${CDN_PREFIX}${originName}`).digest('hex').slice(0, HASH_LENGTH)
    const localName = localImageNames.get(hash)
    return localName === undefined ? { name: originName, matched: false } : { name: localName, matched: true }
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
/** 本地图片命中统计 */
const imageStats = { matched: 0, missing: [] }

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
        const originName = typeof preview === 'string' ? path.posix.basename(preview) : ''
        const local = resolveLocalName(originName)
        if (localImageNames.size > 0) {
            if (local.matched) {
                imageStats.matched += 1
            } else {
                imageStats.missing.push(`${displayName} → ${originName}`)
            }
        }
        if (!groups.has(object)) {
            groups.set(object, new Map())
        }
        const attributes = groups.get(object)
        if (!attributes.has(attribute)) {
            attributes.set(attribute, [])
        }
        attributes.get(attribute).push({ name: langName, prompt: displayName, preview: local.name })
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
const summary = `已生成 ${path.relative(rootDir, outFile)}：${payload.groups.length} 个一级分类 / ${attributeTotal} 个二级分类 / ${total} 条词条 / ${Math.round(Buffer.byteLength(serialized) / 1024)} KB`
console.log(summary)

if (localImageNames.size > 0) {
    console.log(`本地图片命中 ${imageStats.matched} 条，未命中 ${imageStats.missing.length} 条`)
    for (const item of imageStats.missing.slice(0, 10)) {
        console.log(`  未命中：${item}`)
    }
}
