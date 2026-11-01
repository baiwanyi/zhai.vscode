/**
 * 发布脚本：整理提交记录 → 打包 vsix → 推送分支与附注 tag → 调用 gh 创建带附件的 GitHub Release。
 * 复用约定：由 `pnpm run release` 调用；打包交给 `pnpm run package -- --no-install`（只取产物、不装本机），
 * Release 正文由本文件的 buildReleaseNotes 按 Conventional Commits 前缀分组生成，它只吃切好的标题数组、
 * 不读 git、不落盘，因此可单独验证分组规则。
 * 关键约束：发布前校验工作区是否干净、tag 是否指向 HEAD、Release 是否已存在，防止把未提交的代码打进包
 * 或覆盖已有版本；tag 一律建附注标签，message 复用同一份变更摘要，保证 `git tag -n` 与 Release 页面一致；
 * 需先 `gh auth login`，市场分发另跑 `pnpm run market`。
 */
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ALLOW_DIRTY = process.argv.includes('--allow-dirty')
/** 发布主分支：tag 应打在该分支的 HEAD 上，其他分支只警告不阻断 */
const EXPECTED_BRANCH = 'VSCode'

/** 前缀到分组标题的映射，数组顺序即 notes 的输出顺序 */
const CATEGORY_TITLES = [
    ['feat', '新功能'],
    ['fix', '修复'],
    ['perf', '性能'],
    ['refactor', '重构'],
    ['docs', '文档'],
    ['test', '测试'],
    ['build', '构建'],
    ['ci', '持续集成'],
]

/** 未列出的前缀（chore、style、revert 等）与不符合约定的标题统一落到这里 */
const OTHER_TITLE = '其他'

/** 发布流程自身的提交：发布版本号、同步更新清单，都不该出现在本版变更里 */
const RELEASE_NOISE = /^chore(?:\([^)]*\))?:\s*(?:发布|更新版本清单)/u

/** 解析 `type(scope)!: 描述`，不符合规范时返回 null 交给兜底 */
const COMMIT_PATTERN = /^([a-zA-Z]+)(?:\([^)]*\))?!?:\s*(.+)$/u

/** 执行并继承输出：打包与 gh 的日志要原样透给用户 */
function run(command) {
    execSync(command, { cwd: ROOT, stdio: 'inherit' })
}

/** 执行并取回 stdout，只用于 git 状态这类只读查询 */
function capture(command) {
    return execSync(command, { cwd: ROOT, encoding: 'utf8' }).trim()
}

/** 失败即退出：发布流程中途停下，比带着半成品继续安全 */
function fail(message) {
    console.error(`✗ ${message}`)
    process.exit(1)
}

/** 把一条标题拆成「分组 + 描述」，无法识别类型时整条归入「其他」 */
function parseSubject(subject) {
    const match = COMMIT_PATTERN.exec(subject)
    if (!match) {
        return { title: OTHER_TITLE, summary: subject }
    }
    const [, type, summary] = match
    const known = CATEGORY_TITLES.find(([prefix]) => prefix === type)
    return { title: known ? known[1] : OTHER_TITLE, summary }
}

/** 生成 Release notes markdown：只输出命中的分组，避免出现一堆空标题；无条目时返回空串 */
function buildReleaseNotes(subjects) {
    const groups = new Map()
    for (const subject of subjects) {
        const trimmed = subject.trim()
        if (!trimmed || trimmed.startsWith('Merge ') || RELEASE_NOISE.test(trimmed)) {
            continue
        }
        const { title, summary } = parseSubject(trimmed)
        const list = groups.get(title) ?? []
        list.push(summary)
        groups.set(title, list)
    }
    if (groups.size === 0) {
        return ''
    }
    const lines = ['## 变更内容', '']
    for (const [, title] of [...CATEGORY_TITLES, [undefined, OTHER_TITLE]]) {
        const list = groups.get(title)
        if (!list) {
            continue
        }
        lines.push(`### ${title}`, ...list.map((item) => `- ${item}`), '')
    }
    return lines.join('\n').trim()
}

/** 上一个 tag：按版本倒序取第一个非当前 tag，没有就返回空串（表示取全部历史） */
function findPreviousTag(currentTag) {
    const tags = capture('git tag --sort=-v:refname')
        .split(/\r?\n/u)
        .filter((item) => item && item !== currentTag)
    return tags[0] ?? ''
}

/** 收集区间内的提交标题；rev 传 HEAD 时可在 tag 建立前取到本版内容 */
function collectSubjects(previousTag, rev) {
    const range = previousTag ? `${previousTag}..${rev}` : rev
    return capture(`git log ${range} --pretty=format:%s`).split(/\r?\n/u)
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const version = typeof manifest.version === 'string' ? manifest.version : ''
if (!/^\d+\.\d+\.\d+$/u.test(version)) {
    fail(`package.json 的 version 不是 x.y.z：${version || '(空)'}`)
}

const tag = `v${version}`
const vsix = join('releases', `${manifest.name}-${version}.vsix`)

const dirty = capture('git status --porcelain')
if (dirty && !ALLOW_DIRTY) {
    fail(`工作区有未提交的改动，先提交，或加 --allow-dirty 跳过检查：\n${dirty}`)
}

const headCommit = capture('git rev-parse HEAD')
const tagExists = Boolean(capture(`git tag --list ${tag}`))
// tag 已存在时只允许指向当前 HEAD：否则发布会把旧提交打包进新版本
if (tagExists && capture(`git rev-parse ${tag}`) !== headCommit) {
    fail(`tag ${tag} 已存在但不指向当前 HEAD，先删掉旧 tag 或升版本号`)
}

try {
    capture('gh auth status')
} catch {
    fail('gh 未认证，先执行 gh auth login')
}

try {
    capture(`gh release view ${tag}`)
    fail(`Release ${tag} 已存在，如需替换先执行 gh release delete ${tag}`)
} catch {
    // 查不到即为预期状态：该 tag 还没有 Release
}

const branch = capture('git rev-parse --abbrev-ref HEAD')
if (branch !== EXPECTED_BRANCH) {
    console.warn(`! 当前分支是 ${branch}（期望 ${EXPECTED_BRANCH}），tag 会打在这个分支的 HEAD 上`)
}

console.log(`→ 打包 ${tag}`)
// --no-install：发布只取 vsix 产物，不把包顺带装进跑发布流程的这台机器
run('pnpm run package -- --no-install')
if (!existsSync(join(ROOT, vsix))) {
    fail(`没有生成 ${vsix}，检查 vsce package 的输出`)
}

// 摘要要在打 tag 之前算好：附注标签的 message 直接用这份内容，随 tag 一起推送
const previousTag = findPreviousTag(tag)
const notes = buildReleaseNotes(collectSubjects(previousTag, 'HEAD'))
const notesPath = join(tmpdir(), `zhai-vscode-release-notes-${version}.md`)
if (notes) {
    writeFileSync(notesPath, notes, 'utf8')
}

console.log('→ 推送分支与 tag')
run(`git push origin ${branch}`)
if (!tagExists) {
    // 附注标签（-a）：没有摘要时至少写上版本号，避免退回无信息的轻量标签
    run(notes ? `git tag -a ${tag} -F "${notesPath}"` : `git tag -a ${tag} -m ${tag}`)
}
run(`git push origin ${tag}`)

console.log(`→ 创建 GitHub Release ${tag}`)
try {
    // 有整理好的正文就用文件传入，避免长文本与引号在命令行里转义出错；空历史时退回 GitHub 自动生成
    run(
        `gh release create ${tag} "${vsix}" --title "${tag}" ${notes ? `--notes-file "${notesPath}"` : '--generate-notes'}`,
    )
} finally {
    if (notes) {
        unlinkSync(notesPath)
    }
}

console.log(`\n✓ 已发布 ${tag}`)
console.log('下一步：pnpm run market 上架市场，此后由市场自动推送更新。')
