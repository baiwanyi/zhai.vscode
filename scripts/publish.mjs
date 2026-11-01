/**
 * 上架市场脚本：把已打包的 vsix 交给 vsce publish，版本与产物路径全部从 package.json 推导。
 * 复用约定：与 scripts/release.mjs 分工明确——那边只产出 GitHub Release（vsix + 变更说明），
 * 这边只负责市场分发，先发 GitHub 再上架市场，两个渠道拿到的是同一份产物。
 * 关键约束：这里不重新打包，vsix 必须已存在（先跑 `pnpm run package`），否则可能发出与已验证产物
 * 不一致的包；同名版本在市场侧不可覆盖，重复发布会直接失败，只能升版本号重发；
 * 令牌由 vsce login 或 VSCE_PAT 提供，发布前先 verify-pat，避免走到一半才报未授权。
 */
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const version = typeof manifest.version === 'string' ? manifest.version : ''
const publisher = typeof manifest.publisher === 'string' ? manifest.publisher : ''

/** 失败即退出：市场发布不可撤销，宁可停在本地也不发半成品 */
function fail(message) {
    console.error(`✗ ${message}`)
    process.exit(1)
}

if (!/^\d+\.\d+\.\d+$/u.test(version)) {
    fail(`package.json 的 version 不是 x.y.z：${version || '(空)'}`)
}
if (!publisher) {
    fail('package.json 缺少 publisher，市场发布必须指明发布者')
}

const vsix = join(ROOT, 'releases', `${manifest.name}-${version}.vsix`)
if (!existsSync(vsix)) {
    fail(`没有找到 ${relative(ROOT, vsix)}，先执行 pnpm run package`)
}

try {
    execSync(`vsce verify-pat ${publisher}`, { cwd: ROOT, stdio: 'ignore' })
} catch {
    fail(`发布令牌无效：先执行 pnpm exec vsce login ${publisher}，或设置 VSCE_PAT`)
}

const extensionId = `${publisher}.${manifest.name}`
console.log(`→ 上架 ${extensionId}@${version}`)
execSync(`vsce publish --packagePath "${vsix}" --no-dependencies`, { cwd: ROOT, stdio: 'inherit' })

console.log(`\n✓ 已提交市场，分发通常需要几分钟：https://marketplace.visualstudio.com/items?itemName=${extensionId}`)
