/**
 * 个人主页链接识别单元测试：确认只有主页形态被接管，其余链接仍交给浏览器打开。
 * 纯函数测试，不触及 React 与宿主桥。
 */
import { describe, expect, it } from 'vitest'
import { readProfileTarget } from '../src/weibo/utils/weiboLinks'

describe('readProfileTarget', () => {
    it('/u/{uid} 识别为 uid 目标', () => {
        expect(readProfileTarget('https://weibo.com/u/2129704452')).toEqual({ kind: 'uid', value: '2129704452' })
        expect(readProfileTarget('https://weibo.com/u/2129704452/')).toEqual({ kind: 'uid', value: '2129704452' })
    })

    it('/n/{昵称} 识别为昵称目标并解码', () => {
        expect(readProfileTarget('https://weibo.com/n/%E5%B0%8F%E5%A4%AA%E9%98%B3%E6%AF%95%E9%9B%AA')).toEqual({
            kind: 'name',
            value: '小太阳毕雪',
        })
    })

    it('/profile/{uid} 与 /u/{微博号} 分别落到 uid 与昵称', () => {
        expect(readProfileTarget('https://weibo.com/profile/2129704452')).toEqual({
            kind: 'uid',
            value: '2129704452',
        })
        expect(readProfileTarget('https://weibo.com/u/abc123')).toEqual({ kind: 'name', value: 'abc123' })
    })

    it('/{uid} 短形式识别为 uid，详情页仍返回 null', () => {
        expect(readProfileTarget('https://weibo.com/2129704452')).toEqual({ kind: 'uid', value: '2129704452' })
        expect(readProfileTarget('https://weibo.com/2129704452/')).toEqual({ kind: 'uid', value: '2129704452' })
        expect(readProfileTarget('https://weibo.com/2129704452/RrlI3shRn')).toBeNull()
    })

    it('非主页链接、非 https 与非微博域名一律返回 null', () => {
        expect(readProfileTarget('https://weibo.com/1234567890/RrlI3shRn')).toBeNull()
        expect(readProfileTarget('https://weibo.com/ttarticle/p/show?id=1')).toBeNull()
        expect(readProfileTarget('http://weibo.com/u/2129704452')).toBeNull()
        expect(readProfileTarget('https://weibo.com.evil.com/u/2129704452')).toBeNull()
        expect(readProfileTarget('https://t.cn/RrlI3shRn')).toBeNull()
        expect(readProfileTarget('not a url')).toBeNull()
    })

    it('畸形转义与超长昵称返回 null', () => {
        expect(readProfileTarget('https://weibo.com/n/%E0%A4%A')).toBeNull()
        expect(readProfileTarget(`https://weibo.com/n/${'a'.repeat(65)}`)).toBeNull()
    })
})
