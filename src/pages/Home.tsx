import { useMemo, useState } from 'react'
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceDot,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { ASSETS, type Currency } from '@/data/assets'
import {
  computeDca, computeAllStarts, summarizeComparison,
  fmtPct, fmtMoney,
} from '@/lib/dca'

const DURATION_PRESETS = [12, 24, 36, 60, 120]

function durationLabel(m: number) {
  return m % 12 === 0 ? `${m / 12} 年` : `${m} 个月`
}

const CURRENCY_SYMBOL: Record<Currency, string> = { USD: '$', CNY: '¥', HKD: 'HK$' }

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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {/* 头部 */}
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            指数基金定投收益计算器
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            {asset.name}（{asset.code}）· {asset.desc} · 前复权月收盘价计算，含分红再投资 ·
            数据区间 {FIRST_MONTH} ~ {MONTHS[MONTHS.length - 1]} · 数据来源：{asset.source}
          </p>
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
        <Card className="mb-6">
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
        <Card className="mb-6">
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

        {/* 全起点对比图（含定投月数控制） */}
        <Card className="mb-6">
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

        {/* 参考信息 */}
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
          <p>
            参考：同期若在 {effectiveStartMonth} 一次性投入，持有至今收益率为{' '}
            <span className={summary.lumpSumReturn >= 0 ? 'font-semibold text-green-600' : 'font-semibold text-red-600'}>
              {fmtPct(summary.lumpSumReturn)}
            </span>
            。定投平均持仓成本 {fmt(summary.avgCost, 2)}，期末收盘价 {fmt(summary.latestClose, 2)}。
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
