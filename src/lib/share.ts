import { fmtMoney, fmtPct, type DcaPoint, type DcaSummary } from './dca'

export interface ShareOpts {
  assetName: string
  assetCode: string
  currency: string
  startMonth: string
  endMonth: string
  monthly: number
  series: DcaPoint[]
  summary: DcaSummary
  siteUrl: string
}

const FONT = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** 生成回测结果分享图并触发下载（PNG，900×1280） */
export function downloadShareImage(o: ShareOpts) {
  const W = 900
  const H = 1280
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const up = o.summary.totalReturn >= 0
  const accent = up ? '#16a34a' : '#dc2626'
  const fmt = (v: number, d = 0) => fmtMoney(v, o.currency, d)

  // 背景
  ctx.fillStyle = '#f8fafc'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#ffffff'
  roundRect(ctx, 40, 40, W - 80, H - 80, 24)
  ctx.fill()

  // 顶部品牌
  ctx.fillStyle = '#2563eb'
  ctx.font = `bold 30px ${FONT}`
  ctx.textAlign = 'left'
  ctx.fillText('指数基金定投收益计算器', 90, 120)
  ctx.fillStyle = '#94a3b8'
  ctx.font = `22px ${FONT}`
  ctx.textAlign = 'right'
  ctx.fillText(o.siteUrl, W - 90, 120)

  // 标的与参数
  ctx.textAlign = 'left'
  ctx.fillStyle = '#0f172a'
  ctx.font = `bold 44px ${FONT}`
  ctx.fillText(o.assetName, 90, 200)
  ctx.fillStyle = '#64748b'
  ctx.font = `24px ${FONT}`
  ctx.fillText(
    `${o.assetCode} · ${o.startMonth} 起每月定投 ${fmt(o.monthly)} · 截至 ${o.endMonth}`,
    90, 245
  )

  // 主数字：累计收益率
  ctx.fillStyle = accent
  ctx.font = `bold 110px ${FONT}`
  ctx.fillText(fmtPct(o.summary.totalReturn), 90, 380)
  ctx.fillStyle = '#64748b'
  ctx.font = `24px ${FONT}`
  ctx.fillText('累计收益率', 95, 425)

  // 指标格
  const stats: Array<[string, string]> = [
    ['年化收益率 (XIRR)', o.summary.xirr !== null ? fmtPct(o.summary.xirr) : '—'],
    ['累计投入', fmt(o.summary.totalInvested)],
    ['期末市值', fmt(o.summary.finalValue)],
    ['定投期数', `${o.summary.months} 期`],
    ['期间最大浮亏', fmtPct(o.summary.maxDrawdown)],
    ['同期一次性买入', fmtPct(o.summary.lumpSumReturn)],
  ]
  const colW = (W - 180 - 40) / 3
  stats.forEach(([label, value], i) => {
    const cx = 90 + (i % 3) * (colW + 20)
    const cy = 470 + Math.floor(i / 3) * 110
    ctx.fillStyle = '#f1f5f9'
    roundRect(ctx, cx, cy, colW, 90, 12)
    ctx.fill()
    ctx.fillStyle = '#64748b'
    ctx.font = `20px ${FONT}`
    ctx.fillText(label, cx + 20, cy + 32)
    ctx.fillStyle = '#0f172a'
    ctx.font = `bold 30px ${FONT}`
    ctx.fillText(value, cx + 20, cy + 70)
  })

  // 迷你走势图：账户市值(面积) vs 累计投入(虚线)
  const chart = { x: 90, y: 740, w: W - 180, h: 340 }
  const pts = o.series
  const step = Math.max(1, Math.floor(pts.length / 90))
  const sampled = pts.filter((_, i) => i % step === 0 || i === pts.length - 1)
  const maxV = Math.max(...sampled.map((p) => Math.max(p.marketValue, p.invested))) * 1.05
  const minV = 0
  const px = (i: number) => chart.x + (i / (sampled.length - 1)) * chart.w
  const py = (v: number) => chart.y + chart.h - ((v - minV) / (maxV - minV)) * chart.h

  ctx.fillStyle = '#f8fafc'
  roundRect(ctx, chart.x, chart.y, chart.w, chart.h, 12)
  ctx.fill()

  // 市值面积
  ctx.beginPath()
  ctx.moveTo(px(0), py(minV))
  sampled.forEach((p, i) => ctx.lineTo(px(i), py(p.marketValue)))
  ctx.lineTo(px(sampled.length - 1), py(minV))
  ctx.closePath()
  ctx.fillStyle = 'rgba(37, 99, 235, 0.18)'
  ctx.fill()
  ctx.beginPath()
  sampled.forEach((p, i) => (i === 0 ? ctx.moveTo(px(i), py(p.marketValue)) : ctx.lineTo(px(i), py(p.marketValue))))
  ctx.strokeStyle = '#2563eb'
  ctx.lineWidth = 3
  ctx.stroke()

  // 投入虚线
  ctx.beginPath()
  ctx.setLineDash([8, 6])
  sampled.forEach((p, i) => (i === 0 ? ctx.moveTo(px(i), py(p.invested)) : ctx.lineTo(px(i), py(p.invested))))
  ctx.strokeStyle = '#94a3b8'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.setLineDash([])

  // 图例
  ctx.fillStyle = '#2563eb'
  ctx.fillRect(chart.x, chart.y + chart.h + 24, 18, 6)
  ctx.fillStyle = '#64748b'
  ctx.font = `20px ${FONT}`
  ctx.fillText('账户市值', chart.x + 26, chart.y + chart.h + 32)
  ctx.fillStyle = '#94a3b8'
  ctx.fillRect(chart.x + 140, chart.y + chart.h + 24, 18, 6)
  ctx.fillStyle = '#64748b'
  ctx.fillText('累计投入', chart.x + 166, chart.y + chart.h + 32)

  // 底部声明
  ctx.fillStyle = '#94a3b8'
  ctx.font = `19px ${FONT}`
  ctx.fillText('数据来源：iFinD / Wind · 前复权月收盘价 · 未含汇率、手续费与税费', 90, H - 120)
  ctx.fillText('历史收益不代表未来表现，本图不构成投资建议', 90, H - 88)

  canvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `定投回测_${o.assetName}_${o.startMonth}.png`
    a.click()
    URL.revokeObjectURL(url)
  }, 'image/png')
}
