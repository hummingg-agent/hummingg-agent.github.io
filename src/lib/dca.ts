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

export interface StartComparisonPoint {
  month: string // 起始月份 YYYY-MM
  totalReturn: number // 该起点定投 months 期后的累计收益率
}

export interface FreqPoint {
  month: string // YYYY-MM
  monthly: number // 每月一次累计收益率（%）
  weekly: number // 每周一次累计收益率（%）
  daily: number // 每日一次累计收益率（%）
}

/** ISO 周 key（用于把交易日分组到周） */
function isoWeekKey(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00Z')
  const day = d.getUTCDay() || 7
  const thu = new Date(d)
  thu.setUTCDate(d.getUTCDate() + (4 - day))
  const yearStart = new Date(Date.UTC(thu.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((thu.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${thu.getUTCFullYear()}-W${weekNo}`
}

/**
 * 定投频率对比：同一月预算下，每月一次（月末）/ 每周一次（周末）/ 每日一次
 * 的累计收益率曲线。需要日线数据。
 */
export function computeFreqComparison(
  dailyPrices: PricePoint[],
  startMonth: string,
  budget = 1000
): FreqPoint[] {
  const byMonth = new Map<string, PricePoint[]>()
  for (const p of dailyPrices) {
    const m = p.d.slice(0, 7)
    if (m < startMonth) continue
    const arr = byMonth.get(m) ?? []
    arr.push(p)
    byMonth.set(m, arr)
  }
  let shM = 0
  let shW = 0
  let shD = 0
  let invested = 0
  const series: FreqPoint[] = []
  const sortedMonths = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  for (const [m, arr] of sortedMonths) {
    // 每月一次：月末最后一个交易日买入
    shM += budget / arr[arr.length - 1].c
    // 每周一次：预算平摊到每个 ISO 周，周末最后交易日买入
    const weeks = new Map<string, PricePoint>()
    for (const p of arr) weeks.set(isoWeekKey(p.d), p) // 后写入覆盖 → 每周最后一天
    const weekDays = [...weeks.values()]
    for (const p of weekDays) shW += budget / weekDays.length / p.c
    // 每日一次：预算平摊到每个交易日
    for (const p of arr) shD += budget / arr.length / p.c
    invested += budget
    const last = arr[arr.length - 1].c
    series.push({
      month: m,
      monthly: Math.round((shM * last / invested - 1) * 1000) / 10,
      weekly: Math.round((shW * last / invested - 1) * 1000) / 10,
      daily: Math.round((shD * last / invested - 1) * 1000) / 10,
    })
  }
  return series
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
