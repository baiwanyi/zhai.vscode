/**
 * 批次文档纯函数的单元测试：覆盖目录时间戳、文件名去重、标题与正文的拼装与拆解。
 * 只测不落盘的部分——读写文件依赖宿主 workspace.fs，由集成验证覆盖。
 * 断言集中在「同名如何顺延序号」「标题与正文如何互相还原」两处，避免只验证快乐路径。
 */
import { describe, expect, it } from 'vitest'
import {
    buildWechatArticleContent,
    buildWechatDocFileName,
    buildWechatIssueStamp,
    parseWechatArticleContent,
    stripLeadingHeading,
} from '../src/modules/wechat/issueDocument'

describe('buildWechatIssueStamp', () => {
    it('按年月日时分拼成 12 位定宽字符串', () => {
        expect(buildWechatIssueStamp(new Date(2026, 10, 2, 15, 30))).toBe('202611021530')
    })

    it('月日时分补零，保证目录名可按字典序排序', () => {
        expect(buildWechatIssueStamp(new Date(2026, 0, 2, 3, 4))).toBe('202601020304')
    })
})

describe('buildWechatDocFileName', () => {
    it('标题直接作为文件名，目录为空时不做改动', () => {
        expect(buildWechatDocFileName('秋天的第一杯茶', new Set())).toBe('秋天的第一杯茶.md')
    })

    it('非法字符被替换并折叠空白', () => {
        expect(buildWechatDocFileName('标题/含:冒号', new Set())).toBe('标题 含 冒号.md')
    })

    it('同名时按笔记口径顺延空格序号', () => {
        expect(buildWechatDocFileName('同名', new Set(['同名.md']))).toBe('同名 2.md')
        expect(buildWechatDocFileName('同名', new Set(['同名.md', '同名 2.md']))).toBe('同名 3.md')
    })

    it('按小写比较，避免 Windows 上大小写不同却落到同一文件', () => {
        expect(buildWechatDocFileName('Post', new Set(['post.md']))).toBe('Post 2.md')
    })
})

describe('buildWechatArticleContent', () => {
    it('文件以一级标题开头，正文接在空行之后，不写 frontmatter', () => {
        expect(buildWechatArticleContent('秋天的第一杯茶', '正文第一段')).toBe('# 秋天的第一杯茶\n\n正文第一段\n')
    })

    it('正文为空时只留标题行', () => {
        expect(buildWechatArticleContent('未命名文章 1', '   ')).toBe('# 未命名文章 1\n')
    })

    it('正文首尾空白被裁掉，避免重复保存后换行越积越多', () => {
        expect(buildWechatArticleContent('标题', '\n\n正文\n\n')).toBe('# 标题\n\n正文\n')
    })
})

describe('parseWechatArticleContent', () => {
    it('标题取首个一级标题，正文剥掉标题行', () => {
        expect(parseWechatArticleContent('# 标题\n\n第一段\n第二段\n')).toEqual({
            title: '标题',
            body: '第一段\n第二段',
        })
    })

    it('正文中间的标题保留', () => {
        expect(parseWechatArticleContent('# 标题\n\n## 小标题\n\n正文')).toEqual({
            title: '标题',
            body: '## 小标题\n\n正文',
        })
    })

    it('不做 frontmatter 兼容：元数据块按普通正文处理，没有一级标题时标题为空', () => {
        expect(parseWechatArticleContent('---\ntitle: 旧标题\n---\n\n正文\n')).toEqual({
            title: '',
            body: '---\ntitle: 旧标题\n---\n\n正文',
        })
    })

    it('没有一级标题时标题为空，由调用方回落到库内标题', () => {
        expect(parseWechatArticleContent('只有正文')).toEqual({ title: '', body: '只有正文' })
    })
})

describe('stripLeadingHeading', () => {
    it('只剥正文最前的一级标题', () => {
        expect(stripLeadingHeading('\n# 标题\n\n正文')).toBe('正文')
        expect(stripLeadingHeading('正文\n\n# 后面的标题')).toBe('正文\n\n# 后面的标题')
    })
})
