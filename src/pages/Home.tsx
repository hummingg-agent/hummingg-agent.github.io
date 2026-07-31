import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ComposedChart, Area, Line, LineChart, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceDot, Legend,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { ASSETS, loadDaily, type Currency } from '@/data/assets'
import {
  computeDca, computeAllStarts, computeFreqComparison, summarizeComparison,
  fmtPct, fmtMoney, type PricePoint,
} from '@/lib/dca'
import { downloadShareImage } from '@/lib/share'

const DURATION_PRESETS = [12, 24, 36, 60, 120]

function durationLabel(m: number) {
  return m % 12 === 0 ? `${m / 12} 年` : `${m} 个月`
}

const CURRENCY_SYMBOL: Record<Currency, string> = { USD: '$', CNY: '¥', HKD: 'HK$' }

const ASSET_COLORS: Record<string, string> = {
  qqq: '#2563eb',
  spx: '#7c3aed',
  hs300: '#dc2626',
  zz500: '#ea580c',
  hsi: '#16a34a',
}

export default function Home() {
  const [assetKey, setAssetKey] = useState(ASSETS[0].key)
  const [amountInput, setAmountInput] = useState('')
  const [startMonth, setStartMonth] = useState('')
  const [duration, setDuration] = useState(60)

  const asset = ASSETS.find((a) => a.key === assetKey) ?? ASSETS[0]
  const PRICES = asset.data
  const MONTHS = useMemo(() => PRICES.map((p) => p.d.slice(0, 7)), [PRICES])
  const FIRST_MONTH = MONTHS[0]
  const LAST_START_MONTH = MONTHS[MONTHS.length - 2] // 起点至少要有 2 期

  const monthly = useMemo(() => {
    const v = parseFloat(amountInput)
    return Number.isFinite(v) && v > 0 ? v : asset.defaultAmount
  }, [amountInput, asset.defaultAmount])

  // 起始月份下标（最后一个不可作为起点）
  const startIdx = useMemo(() => {
    const def = Math.max(0, MONTHS.length - 61)
    const i = MONTHS.indexOf(startMonth)
    if (i < 0) return def
    return Math.min(Math.max(i, 0), MONTHS.length - 2)
  }, [startMonth, MONTHS])
  const effectiveStartMonth = MONTHS[startIdx]

  // 明细：从起始月份一直定投到最新月份
  const { series, summary } = useMemo(
    () => computeDca(PRICES, startIdx, monthly),
    [PRICES, startIdx, monthly]
  )

  // 对比：不同起始月份定投 duration 期的收益率
  const comparison = useMemo(
    () => computeAllStarts(PRICES, duration, monthly),
    [PRICES, duration, monthly]
  )
  const compStats = useMemo(() => summarizeComparison(comparison), [comparison])
  const selectedPoint = comparison.find((p) => p.month === effectiveStartMonth)

  const up = summary.totalReturn >= 0
  const cur = asset.currency
  const sym = CURRENCY_SYMBOL[cur]
  const fmt = (v: number, digits = 0) => fmtMoney(v, cur, digits)

  // 日线数据（按需加载，用于频率对比）
  const dailyCache = useRef<Record<string, PricePoint[]>>({})
  const [dailyData, setDailyData] = useState<PricePoint[] | null>(null)
  useEffect(() => {
    let cancelled = false
    const cached = dailyCache.current[assetKey]
    if (cached) {
      setDailyData(cached)
      return
    }
    setDailyData(null)
    loadDaily(assetKey).then((d) => {
      if (cancelled) return
      dailyCache.current[assetKey] = d
      setDailyData(d)
    })
    return () => {
      cancelled = true
    }
  }, [assetKey])

  // 定投频率对比：日 / 周 / 月（同月预算）
  const freqSeries = useMemo(
    () => (dailyData ? computeFreqComparison(dailyData, effectiveStartMonth) : []),
    [dailyData, effectiveStartMonth]
  )
  const freqLast = freqSeries.length ? freqSeries[freqSeries.length - 1] : null
  const freqSpread = freqLast
    ? Math.max(freqLast.monthly, freqLast.weekly, freqLast.daily) -
      Math.min(freqLast.monthly, freqLast.weekly, freqLast.daily)
    : 0

  // 定投 vs 一次性买入：同一起点，两条累计收益率曲线（%）
  const dcaVsLump = useMemo(() => {
    const base = series[0]?.close
    if (!base) return []
    return series.map((pt) => ({
      month: pt.month,
      dca: Math.round(pt.totalReturn * 1000) / 10,
      lump: Math.round((pt.close / base - 1) * 1000) / 10,
    }))
  }, [series])
  const lumpFinalPct = dcaVsLump.length ? dcaVsLump[dcaVsLump.length - 1].lump : 0
  const dcaFinalPct = dcaVsLump.length ? dcaVsLump[dcaVsLump.length - 1].dca : 0
  const dcaWins = dcaFinalPct >= lumpFinalPct

  // 多标的对比：同一起点，各标的定投累计收益率（%）
  const multiSeries = useMemo(() => {
    const byMonth = new Map<string, Record<string, number | string>>()
    for (const a of ASSETS) {
      const idx = a.data.findIndex((p) => p.d.slice(0, 7) >= effectiveStartMonth)
      if (idx < 0 || idx >= a.data.length - 1) continue
      const { series: s } = computeDca(a.data, idx, 100)
      for (const pt of s) {
        const row = byMonth.get(pt.month) ?? { month: pt.month }
        row[a.key] = Math.round(pt.totalReturn * 1000) / 10
        byMonth.set(pt.month, row)
      }
    }
    return [...byMonth.values()].sort((x, y) =>
      String(x.month).localeCompare(String(y.month))
    )
  }, [effectiveStartMonth])

  // 各标的期末收益率（用于图上方的小结标签）
  const multiFinals = useMemo(() => {
    return ASSETS.map((a) => {
      const idx = a.data.findIndex((p) => p.d.slice(0, 7) >= effectiveStartMonth)
      if (idx < 0 || idx >= a.data.length - 1) return null
      const { summary: s } = computeDca(a.data, idx, 100)
      return { key: a.key, name: a.name, value: s.totalReturn, from: a.data[idx].d.slice(0, 7) }
    }).filter((x): x is NonNullable<typeof x> => x !== null)
  }, [effectiveStartMonth])

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {/* 头部 */}
        <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              指数基金定投收益计算器
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              {asset.name}（{asset.code}）· {asset.desc} · 前复权月收盘价计算，含分红再投资 ·
              数据区间 {FIRST_MONTH} ~ {MONTHS[MONTHS.length - 1]} · 数据来源：{asset.source}
            </p>
          </div>
          <button
            onClick={() =>
              downloadShareImage({
                assetName: asset.name,
                assetCode: asset.code,
                currency: cur,
                startMonth: effectiveStartMonth,
                endMonth: MONTHS[MONTHS.length - 1],
                monthly,
                series,
                summary,
                siteUrl: 'dingtouji.com',
              })
            }
            className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            分享结果图
          </button>
        </header>

        {/* 标的切换 */}
        <div className="mb-6 flex flex-wrap gap-2">
          {ASSETS.map((a) => (
            <button
              key={a.key}
              onClick={() => {
                setAssetKey(a.key)
                setAmountInput('')
                setStartMonth('')
              }}
              className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                assetKey === a.key
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-slate-300 bg-white text-slate-600 hover:border-blue-400 hover:text-blue-600'
              }`}
            >
              {a.name}
              <span className={`ml-1.5 text-xs ${assetKey === a.key ? 'text-blue-100' : 'text-slate-400'}`}>
                {a.label}
              </span>
            </button>
          ))}
        </div>

        {/* 控制区：金额 + 起始月份 */}
        <Card className="mb-6">
          <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Label htmlFor="amount" className="mb-2 block text-sm font-medium">
                每月定投金额（{cur}）
              </Label>
              <div className="relative sm:w-56">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                  {sym}
                </span>
                <input
                  id="amount"
                  type="number"
                  min={1}
                  step={cur === 'USD' ? 10 : 100}
                  placeholder={String(asset.defaultAmount)}
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  className="h-10 w-full rounded-md border border-slate-300 bg-white pl-8 pr-3 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>
            </div>
            <div className="flex-1">
              <Label htmlFor="start" className="mb-2 block text-sm font-medium">
                开始定投的月份
              </Label>
              <input
                id="start"
                type="month"
                min={FIRST_MONTH}
                max={LAST_START_MONTH}
                value={effectiveStartMonth}
                onChange={(e) => e.target.value && setStartMonth(e.target.value)}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 sm:w-56"
              />
            </div>
            <div className="text-sm text-slate-500">
              每月定投 <span className="text-lg font-semibold text-slate-900">{fmt(monthly)}</span>
              ，月末按当月收盘价买入，一直定投到最新月份
            </div>
          </CardContent>
        </Card>

        {/* 导航目录：吸顶锚点跳转 */}
        <nav className="sticky top-2 z-20 mb-6 flex gap-1 overflow-x-auto rounded-full border border-slate-200 bg-white/90 p-1 shadow-sm backdrop-blur">
          {[
            ['chart-value', '收益曲线'],
            ['chart-return', '累计收益率'],
            ['chart-lumpsum', 'vs 一次性买入'],
            ['chart-startmonths', '全起点对比'],
            ['chart-freq', '频率对比'],
            ['chart-multi', '多标的对比'],
          ].map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-blue-50 hover:text-blue-600 sm:text-sm"
            >
              {label}
            </a>
          ))}
        </nav>

        {/* 指标卡 */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard title="定投期数" value={`${summary.months} 期`} />
          <StatCard title="累计投入" value={fmt(summary.totalInvested)} />
          <StatCard title="期末市值" value={fmt(summary.finalValue)} />
          <StatCard
            title="累计收益率"
            value={fmtPct(summary.totalReturn)}
            accent={up ? 'up' : 'down'}
            sub={fmt(summary.profit)}
          />
          <StatCard
            title="年化收益率"
            value={summary.xirr !== null ? fmtPct(summary.xirr) : '—'}
            accent={summary.xirr !== null && summary.xirr >= 0 ? 'up' : 'down'}
            sub="XIRR"
          />
          <StatCard
            title="期间最大浮亏"
            value={fmtPct(summary.maxDrawdown)}
            accent="down"
            sub={summary.maxDrawdownDate}
          />
        </div>

        {/* 收益曲线：定投到最新月份 */}
        <Card id="chart-value" className="mb-6 scroll-mt-20">
          <CardHeader>
            <CardTitle className="text-base">
              {effectiveStartMonth} 起每月定投 {fmt(monthly)} 至今 —— 账户市值 vs 累计投入
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#64748b' }} minTickGap={40} />
                  <YAxis
                    tick={{ fontSize: 12, fill: '#64748b' }}
                    tickFormatter={(v: number) => sym + (v >= 1000 ? `${Math.round(v / 100) / 10}k` : v)}
                    width={70}
                  />
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      fmt(value),
                      name === 'marketValue' ? '账户市值' : '累计投入',
                    ]}
                    labelFormatter={(label: string) => label}
                  />
                  <Area
                    type="monotone"
                    dataKey="marketValue"
                    name="marketValue"
                    stroke="#2563eb"
                    fill="#bfdbfe"
                    fillOpacity={0.6}
                    strokeWidth={2}
                  />
                  <Line
                    type="monotone"
                    dataKey="invested"
                    name="invested"
                    stroke="#94a3b8"
                    strokeDasharray="5 4"
                    strokeWidth={1.5}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* 累计收益率曲线：定投到最新月份 */}
        <Card id="chart-return" className="mb-6 scroll-mt-20">
          <CardHeader>
            <CardTitle className="text-base">定投累计收益率变化</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#64748b' }} minTickGap={40} />
                  <YAxis
                    tick={{ fontSize: 12, fill: '#64748b' }}
                    tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                    width={60}
                  />
                  <Tooltip
                    formatter={(value: number) => [fmtPct(value), '累计收益率']}
                    labelFormatter={(label: string) => label}
                  />
                  <ReferenceLine y={0} stroke="#334155" strokeWidth={1} />
                  <Area
                    type="monotone"
                    dataKey="totalReturn"
                    stroke={up ? '#16a34a' : '#dc2626'}
                    fill={up ? '#bbf7d0' : '#fecaca'}
                    fillOpacity={0.5}
                    strokeWidth={2}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* 定投 vs 一次性买入 */}
        <Card id="chart-lumpsum" className="mb-6 scroll-mt-20">
          <CardHeader>
            <CardTitle className="text-base">
              定投 vs 一次性买入（{effectiveStartMonth} 起）
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: '#2563eb' }} />
                  每月定投 {fmt(monthly)}
                </div>
                <div className={`mt-0.5 text-base font-bold ${dcaFinalPct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {dcaFinalPct >= 0 ? '+' : ''}{dcaFinalPct}%
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: '#f59e0b' }} />
                  期初一次性买入 {fmt(summary.totalInvested)}
                </div>
                <div className={`mt-0.5 text-base font-bold ${lumpFinalPct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {lumpFinalPct >= 0 ? '+' : ''}{lumpFinalPct}%
                </div>
              </div>
              <div className="col-span-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 sm:col-span-1">
                <div className="text-xs text-slate-500">结论</div>
                <div className="mt-0.5 text-base font-bold text-slate-900">
                  {dcaWins ? '定投跑赢' : '一次性买入跑赢'}{' '}
                  <span className="text-sm font-semibold text-slate-500">
                    {Math.abs(dcaFinalPct - lumpFinalPct).toFixed(1)} 个百分点
                  </span>
                </div>
              </div>
            </div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dcaVsLump} margin={{ top: 8, right: 12, bottom: 0, left: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#64748b' }} minTickGap={40} />
                  <YAxis
                    tick={{ fontSize: 12, fill: '#64748b' }}
                    tickFormatter={(v: number) => `${v}%`}
                    width={60}
                  />
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      `${value}%`,
                      name === 'dca' ? '每月定投' : '一次性买入',
                    ]}
                    labelFormatter={(label: string) => label}
                  />
                  <Legend formatter={(value: string) => (value === 'dca' ? '每月定投' : '一次性买入')} />
                  <ReferenceLine y={0} stroke="#334155" strokeWidth={1} />
                  <Line
                    type="monotone"
                    dataKey="dca"
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="lump"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              一次性买入 = 在起始月份一次性投入与定投方案相同的总金额（{fmt(summary.totalInvested)}）。
              注意：一次性买入的资金从第一天起全额占用，而定投资金是分批占用的，
              定投的资金效率请参考年化收益率（XIRR）。
            </p>
          </CardContent>
        </Card>

        {/* 全起点对比图（含定投月数控制） */}
        <Card id="chart-startmonths" className="mb-6 scroll-mt-20">
          <CardHeader>
            <CardTitle className="text-base">不同起始月份的定投收益率对比</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="mb-2 flex items-center justify-between">
                <Label className="text-sm font-medium">定投月数</Label>
                <span className="text-sm font-semibold text-blue-600">
                  {duration} 个月（{durationLabel(duration)}）
                </span>
              </div>
              <Slider
                value={[duration]}
                min={6}
                max={240}
                step={6}
                onValueChange={([v]) => setDuration(v)}
                className="w-full"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {DURATION_PRESETS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setDuration(p)}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      duration === p
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-slate-300 bg-white text-slate-600 hover:border-blue-400 hover:text-blue-600'
                    }`}
                  >
                    {p / 12} 年
                  </button>
                ))}
              </div>
            </div>

            {compStats && (
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <MiniStat label="正收益起点占比" value={fmtPct(compStats.winRate, 0)} />
                <MiniStat label="所有起点平均收益" value={fmtPct(compStats.avg)} />
                <MiniStat
                  label={`最佳起点 ${compStats.best.month}`}
                  value={fmtPct(compStats.best.totalReturn)}
                  tone="up"
                />
                <MiniStat
                  label={`最差起点 ${compStats.worst.month}`}
                  value={fmtPct(compStats.worst.totalReturn)}
                  tone="down"
                />
              </div>
            )}
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={comparison} margin={{ top: 8, right: 12, bottom: 0, left: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#64748b' }} minTickGap={40} />
                  <YAxis
                    tick={{ fontSize: 12, fill: '#64748b' }}
                    tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                    width={60}
                  />
                  <Tooltip
                    formatter={(value: number) => [fmtPct(value), `定投${duration}期收益率`]}
                    labelFormatter={(label: string) => `从 ${label} 开始`}
                  />
                  <ReferenceLine y={0} stroke="#334155" strokeWidth={1} />
                  <Area
                    type="monotone"
                    dataKey="totalReturn"
                    stroke="#2563eb"
                    fill="#bfdbfe"
                    fillOpacity={0.5}
                    strokeWidth={2}
                  />
                  {selectedPoint && (
                    <ReferenceDot
                      x={selectedPoint.month}
                      y={selectedPoint.totalReturn}
                      r={6}
                      fill="#2563eb"
                      stroke="#fff"
                      strokeWidth={2}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              横轴为定投起始月份，纵轴为该起点连续定投 {duration} 期后的累计收益率
              {selectedPoint ? `；蓝点为当前选中的起始月份 ${effectiveStartMonth}` : ''}。
            </p>
          </CardContent>
        </Card>

        {/* 定投频率对比：日 / 周 / 月 */}
        <Card id="chart-freq" className="mb-6 scroll-mt-20">
          <CardHeader>
            <CardTitle className="text-base">
              定投频率对比：{asset.name}（{asset.code}）每天 / 每周 / 每月（{effectiveStartMonth} 起）
            </CardTitle>
          </CardHeader>
          <CardContent>
            {freqLast ? (
              <>
                <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: '#2563eb' }} />
                      每月一次
                    </div>
                    <div className={`mt-0.5 text-base font-bold ${freqLast.monthly >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {freqLast.monthly >= 0 ? '+' : ''}{freqLast.monthly}%
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: '#f59e0b' }} />
                      每周一次
                    </div>
                    <div className={`mt-0.5 text-base font-bold ${freqLast.weekly >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {freqLast.weekly >= 0 ? '+' : ''}{freqLast.weekly}%
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: '#16a34a' }} />
                      每天一次
                    </div>
                    <div className={`mt-0.5 text-base font-bold ${freqLast.daily >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {freqLast.daily >= 0 ? '+' : ''}{freqLast.daily}%
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-xs text-slate-500">三种频率最大差异</div>
                    <div className="mt-0.5 text-base font-bold text-slate-900">
                      {freqSpread.toFixed(1)} 个百分点
                    </div>
                  </div>
                </div>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={freqSeries} margin={{ top: 8, right: 12, bottom: 0, left: 12 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#64748b' }} minTickGap={40} />
                      <YAxis
                        tick={{ fontSize: 12, fill: '#64748b' }}
                        tickFormatter={(v: number) => `${v}%`}
                        width={60}
                      />
                      <Tooltip
                        formatter={(value: number, name: string) => [
                          `${value}%`,
                          name === 'monthly' ? '每月一次' : name === 'weekly' ? '每周一次' : '每天一次',
                        ]}
                        labelFormatter={(label: string) => label}
                      />
                      <Legend
                        formatter={(value: string) =>
                          value === 'monthly' ? '每月一次' : value === 'weekly' ? '每周一次' : '每天一次'
                        }
                      />
                      <ReferenceLine y={0} stroke="#334155" strokeWidth={1} />
                      <Line type="monotone" dataKey="monthly" stroke="#2563eb" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="weekly" stroke="#f59e0b" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="daily" stroke="#16a34a" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  基于 {asset.name}（{asset.code}）全历史日线数据实测：每月预算相同，每月一次（月末买入）/ 每周一次（周末买入）/ 每天一次（每日买入）。
                  三条曲线几乎重合——频率对长期收益的影响很小，按你的资金节奏选择即可。切换上方标的可查看其他指数的对比结果。
                </p>
              </>
            ) : (
              <div className="flex h-64 items-center justify-center text-sm text-slate-400">
                正在加载日线数据…
              </div>
            )}
          </CardContent>
        </Card>

        {/* 多标的定投收益率对比 */}
        <Card id="chart-multi" className="mb-6 scroll-mt-20">
          <CardHeader>
            <CardTitle className="text-base">
              多标的定投收益率对比（{effectiveStartMonth} 起）
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex flex-wrap gap-2">
              {multiFinals.map((f) => (
                <div
                  key={f.key}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                >
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: ASSET_COLORS[f.key] }}
                    />
                    {f.name}
                    {f.from !== effectiveStartMonth && (
                      <span className="text-slate-400">（{f.from} 起）</span>
                    )}
                  </div>
                  <div
                    className={`mt-0.5 text-base font-bold ${
                      f.value >= 0 ? 'text-green-600' : 'text-red-600'
                    }`}
                  >
                    {fmtPct(f.value)}
                  </div>
                </div>
              ))}
            </div>
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={multiSeries} margin={{ top: 8, right: 12, bottom: 0, left: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#64748b' }} minTickGap={40} />
                  <YAxis
                    tick={{ fontSize: 12, fill: '#64748b' }}
                    tickFormatter={(v: number) => `${v}%`}
                    width={60}
                  />
                  <Tooltip
                    formatter={(value: number, name: string) => [`${value}%`, name]}
                    labelFormatter={(label: string) => label}
                  />
                  <Legend />
                  <ReferenceLine y={0} stroke="#334155" strokeWidth={1} />
                  {ASSETS.map((a) => (
                    <Line
                      key={a.key}
                      type="monotone"
                      dataKey={a.key}
                      name={a.name}
                      stroke={ASSET_COLORS[a.key]}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              同一起点每月定投，各标的累计收益率对比（收益率与币种、金额无关）；
              数据起点晚于所选起点的标的，从其最早可得月份开始。
            </p>
          </CardContent>
        </Card>

        {/* 参考信息 */}
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
          <p>
            定投平均持仓成本 {fmt(summary.avgCost, 2)}，期末收盘价 {fmt(summary.latestClose, 2)}。
          </p>
          <p className="mt-2 text-xs text-slate-400">
            说明：本工具仅基于历史行情做回测演示，未考虑汇率、手续费与税费，不构成投资建议。历史收益不代表未来表现。
          </p>
        </div>
      </div>
    </div>
  )
}

function StatCard({
  title,
  value,
  sub,
  accent,
}: {
  title: string
  value: string
  sub?: string
  accent?: 'up' | 'down'
}) {
  const color =
    accent === 'up' ? 'text-green-600' : accent === 'down' ? 'text-red-600' : 'text-slate-900'
  return (
    <Card>
      <CardContent className="px-4 py-3">
        <div className="text-xs text-slate-500">{title}</div>
        <div className={`mt-1 text-lg font-bold leading-tight ${color}`}>{value}</div>
        {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
      </CardContent>
    </Card>
  )
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  const color =
    tone === 'up' ? 'text-green-600' : tone === 'down' ? 'text-red-600' : 'text-slate-900'
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-0.5 text-base font-bold ${color}`}>{value}</div>
    </div>
  )
}
