export interface PricePoint {
  d: string // YYYY-MM-DD
  c: number // 前复权月收盘价
}

export interface DcaPoint {
  date: string
  month: string // YYYY-MM
  close: number
  invested: number
  marketValue: number
  profit: number
  totalReturn: number // 小数，如 0.15 = 15%
}

export interface DcaSummary {
  months: number
  totalInvested: number
  finalValue: number
  profit: number
  totalReturn: number
  xirr: number | null
  avgCost: number
  latestClose: number
  maxDrawdown: number // 定投累计收益率最低点（<=0）
  maxDrawdownDate: string
  lumpSumReturn: number // 同期一次性投入收益率
}

export function computeDca(
  prices: PricePoint[],
  startIndex: number,
  monthlyAmount: number
): { series: DcaPoint[]; summary: DcaSummary } {
  const slice = prices.slice(startIndex)
  let shares = 0
  const series: DcaPoint[] = slice.map((p, i) => {
    shares += monthlyAmount / p.c
    const invested = monthlyAmount * (i + 1)
    const marketValue = shares * p.c
    return {
      date: p.d,
      month: p.d.slice(0, 7),
      close: p.c,
      invested,
      marketValue,
      profit: marketValue - invested,
      totalReturn: marketValue / invested - 1,
    }
  })

  const last = series[series.length - 1]
  const totalInvested = last.invested
  const finalValue = last.marketValue

  // XIRR（年化内部收益率）：每月一笔 -amount，期末 +finalValue
  let xirr: number | null = null
  if (series.length >= 2) {
    const t0 = new Date(slice[0].d).getTime()
    const flows = slice.map((p) => ({ t: new Date(p.d).getTime(), cf: -monthlyAmount }))
    flows.push({ t: new Date(slice[slice.length - 1].d).getTime(), cf: finalValue })
    const xnpv = (rate: number) =>
      flows.reduce((acc, f) => acc + f.cf / Math.pow(1 + rate, (f.t - t0) / (365 * 86400000)), 0)
    let lo = -0.9999
    let hi = 10
    if (xnpv(lo) * xnpv(hi) <= 0) {
      for (let i = 0; i < 200; i++) {
        const mid = (lo + hi) / 2
        if (xnpv(mid) > 0) lo = mid
        else hi = mid
      }
      xirr = (lo + hi) / 2
    }
  }

  let maxDrawdown = 0
  let maxDrawdownDate = series[0].month
  for (const p of series) {
    if (p.totalReturn < maxDrawdown) {
      maxDrawdown = p.totalReturn
      maxDrawdownDate = p.month
    }
  }

  return {
    series,
    summary: {
      months: series.length,
      totalInvested,
      finalValue,
      profit: finalValue - totalInvested,
      totalReturn: finalValue / totalInvested - 1,
      xirr,
      avgCost: totalInvested / shares,
      latestClose: last.close,
      maxDrawdown,
      maxDrawdownDate,
      lumpSumReturn: slice[slice.length - 1].c / slice[0].c - 1,
    },
  }
}

const CURRENCY_PREFIX: Record<string, string> = { USD: '$', CNY: '¥', HKD: 'HK$' }

export const fmtMoney = (v: number, currency: string = 'USD', digits = 0) =>
  (CURRENCY_PREFIX[currency] ?? currency + ' ') +
  v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })

export const fmtPct = (v: number, digits = 1) =>
  (v >= 0 ? '+' : '') + (v * 100).toFixed(digits) + '%'

/** 指定起始下标 + 定投月数的单方案计算（复用 computeDca，截取窗口） */
export function computeDcaWindow(
  prices: PricePoint[],
  startIndex: number,
  months: number,
  monthlyAmount: number
) {
  const window = prices.slice(startIndex, startIndex + months)
  return computeDca(window, 0, monthlyAmount)
}

export interface StartComparisonPoint {
  month: string // 起始月份 YYYY-MM
  totalReturn: number // 该起点定投 months 期后的累计收益率
}

/** 对比：每个可能的起始月份，定投 months 期后的最终收益率 */
export function computeAllStarts(
  prices: PricePoint[],
  months: number,
  monthlyAmount: number
): StartComparisonPoint[] {
  const out: StartComparisonPoint[] = []
  for (let i = 0; i + months <= prices.length; i++) {
    let shares = 0
    for (let j = i; j < i + months; j++) shares += monthlyAmount / prices[j].c
    const finalValue = shares * prices[i + months - 1].c
    out.push({
      month: prices[i].d.slice(0, 7),
      totalReturn: finalValue / (monthlyAmount * months) - 1,
    })
  }
  return out
}

export interface ComparisonStats {
  winRate: number // 正收益起点占比
  best: StartComparisonPoint
  worst: StartComparisonPoint
  avg: number
}

export function summarizeComparison(points: StartComparisonPoint[]): ComparisonStats | null {
  if (points.length === 0) return null
  let best = points[0]
  let worst = points[0]
  let sum = 0
  let wins = 0
  for (const p of points) {
    if (p.totalReturn > best.totalReturn) best = p
    if (p.totalReturn < worst.totalReturn) worst = p
    sum += p.totalReturn
    if (p.totalReturn > 0) wins++
  }
  return { winRate: wins / points.length, best, worst, avg: sum / points.length }
}
