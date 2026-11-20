/**
 * 微博纯文本切分测试：覆盖 @账号、话题与微博域名链接的识别、边界与越界降级。
 * 全部为纯函数断言，不触网。
 */
import { describe, expect, it } from 'vitest'
import { splitPlainTextLinks } from '../src/shared/utils/weiboText'

describe('splitPlainTextLinks', () => {
    it('切出 @账号、话题与微博短链，其余文本保持原样', () => {
        expect(splitPlainTextLinks('谢谢@小明，看#热门话题#，原文 https://t.cn/A6xyz 结束')).toEqual([
            { type: 'text', text: '谢谢' },
            { type: 'link', text: '@小明', url: 'https://weibo.com/n/%E5%B0%8F%E6%98%8E', kind: 'mention' },
            { type: 'text', text: '，看' },
            {
                type: 'link',
                text: '#热门话题#',
                url: 'https://s.weibo.com/weibo?q=%23%E7%83%AD%E9%97%A8%E8%AF%9D%E9%A2%98%23',
                kind: 'topic',
            },
            { type: 'text', text: '，原文 ' },
            { type: 'link', text: 'https://t.cn/A6xyz', url: 'https://t.cn/A6xyz', kind: 'link' },
            { type: 'text', text: ' 结束' },
        ])
    })

    it('@昵称支持 emoji 与连字符，遇到中文标点即断开', () => {
        expect(splitPlainTextLinks('@小明🔥-2号。后面')).toEqual([
            {
                type: 'link',
                text: '@小明🔥-2号',
                url: 'https://weibo.com/n/%E5%B0%8F%E6%98%8E%F0%9F%94%A5-2%E5%8F%B7',
                kind: 'mention',
            },
            { type: 'text', text: '。后面' },
        ])
    })

    it('@ 前紧邻邮箱本地部分字符时不当账号', () => {
        expect(splitPlainTextLinks('联系 a@b.com 即可')).toEqual([{ type: 'text', text: '联系 a@b.com 即可' }])
    })

    it('非微博域名的链接保留原文', () => {
        expect(splitPlainTextLinks('https://evil.example.com/x')).toEqual([
            { type: 'text', text: 'https://evil.example.com/x' },
        ])
    })

    it('空串返回空数组', () => {
        expect(splitPlainTextLinks('')).toEqual([])
    })
})
