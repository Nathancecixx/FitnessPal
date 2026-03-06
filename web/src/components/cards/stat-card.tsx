import ReactECharts from 'echarts-for-react'

import type { DashboardCard } from '../../lib/api'

export function StatCard({ card }: { card: DashboardCard }) {
  const accent = {
    amber: 'from-amber-300 via-orange-200 to-white',
    sky: 'from-sky-300 via-cyan-200 to-white',
    rose: 'from-rose-300 via-orange-100 to-white',
    lime: 'from-lime-300 via-yellow-100 to-white',
    emerald: 'from-emerald-300 via-teal-100 to-white',
  }[card.accent] ?? 'from-slate-300 via-slate-100 to-white'

  return (
    <div className={`rounded-[24px] border border-slate-200 bg-gradient-to-br ${accent} p-4 text-slate-950 shadow-halo md:rounded-[28px] md:p-5`}>
      <div className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-600">{card.title}</div>
      <div className="mt-5 font-display text-3xl md:text-4xl">{card.value ?? '...'}</div>
      <p className="mt-3 text-sm text-slate-700">{card.detail ?? card.description}</p>
    </div>
  )
}

export function TinyLineChart(props: { title: string; points: number[]; color: string }) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white/88 p-4 shadow-halo md:rounded-[28px] md:p-5">
      <div className="font-display text-lg text-slate-950">{props.title}</div>
      <ReactECharts
        style={{ height: 160 }}
        option={{
          animationDuration: 600,
          grid: { top: 20, right: 8, bottom: 20, left: 20 },
          xAxis: { type: 'category', show: false, data: props.points.map((_, index) => index + 1) },
          yAxis: { type: 'value', show: false },
          tooltip: { trigger: 'axis' },
          series: [
            {
              data: props.points,
              type: 'line',
              smooth: true,
              showSymbol: false,
              lineStyle: { color: props.color, width: 3 },
              areaStyle: { color: props.color, opacity: 0.15 },
            },
          ],
        }}
      />
    </div>
  )
}
