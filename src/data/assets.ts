import qqq from './qqq.json'
import spx from './spx.json'
import hs300 from './hs300.json'
import zz500 from './zz500.json'
import hsi from './hsi.json'
import type { PricePoint } from '@/lib/dca'

const dailyLoaders = import.meta.glob<{ default: PricePoint[] }>('./*_daily.json')

/** 按需加载某标的的全历史日线（不在主 bundle 中） */
export async function loadDaily(key: string): Promise<PricePoint[]> {
  const loader = dailyLoaders[`./${key}_daily.json`]
  if (!loader) return []
  const mod = await loader()
  return mod.default
}

export type Currency = 'USD' | 'CNY' | 'HKD'

export interface AssetMeta {
  key: string
  /** 中文名，如 纳斯达克100 */
  name: string
  /** 短标签，如 QQQ */
  label: string
  code: string
  desc: string
  currency: Currency
  source: 'iFinD' | 'Wind'
  defaultAmount: number
  data: PricePoint[]
}

export const ASSETS: AssetMeta[] = [
  {
    key: 'qqq',
    name: '纳斯达克100',
    label: 'QQQ',
    code: 'QQQ.O',
    desc: '跟踪纳斯达克100指数的 ETF，美股科技成长代表',
    currency: 'USD',
    source: 'iFinD',
    defaultAmount: 100,
    data: qqq as PricePoint[],
  },
  {
    key: 'spx',
    name: '标普500',
    label: 'SPX',
    code: 'SPX.GI',
    desc: '美股大盘基准指数，500 家龙头企业',
    currency: 'USD',
    source: 'Wind',
    defaultAmount: 100,
    data: spx as PricePoint[],
  },
  {
    key: 'hs300',
    name: '沪深300',
    label: 'HS300',
    code: '000300.SH',
    desc: 'A 股大盘核心资产指数',
    currency: 'CNY',
    source: 'iFinD',
    defaultAmount: 1000,
    data: hs300 as PricePoint[],
  },
  {
    key: 'zz500',
    name: '中证500',
    label: 'ZZ500',
    code: '000905.SH',
    desc: 'A 股中盘成长代表指数',
    currency: 'CNY',
    source: 'iFinD',
    defaultAmount: 1000,
    data: zz500 as PricePoint[],
  },
  {
    key: 'hsi',
    name: '恒生指数',
    label: 'HSI',
    code: 'HSI.HI',
    desc: '港股大盘基准指数',
    currency: 'HKD',
    source: 'Wind',
    defaultAmount: 1000,
    data: hsi as PricePoint[],
  },
]
