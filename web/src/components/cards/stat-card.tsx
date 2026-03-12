import { EChart } from '../charts/echart'
import type { DashboardCard } from '../../lib/api'

export function StatCard({ card }: { card: DashboardCard }) {
  const accent = {
    amber: 'dashboard-accent-amber',
    sky: 'dashboard-accent-sky',
    rose: 'dashboard-accent-rose',
    lime: 'dashboard-accent-lime',
    emerald: 'dashboard-accent-emerald',
  }[card.accent] ?? 'dashboard-accent-neutral'

  return (
    <div className={`dashboard-stat-card ${accent} rounded-[24px] border border-slate-200 p-4 text-slate-950 shadow-halo md:rounded-[28px] md:p-5`}>
      <div className="dashboard-stat-card-eyebrow text-xs font-semibold uppercase tracking-[0.25em] text-slate-600">{card.title}</div>
      <div className="dashboard-stat-card-value mt-5 font-display text-3xl md:text-4xl">{card.value ?? '...'}</div>
      <p className="dashboard-stat-card-copy mt-3 text-sm text-slate-700">{card.detail ?? card.description}</p>
    </div>
  )
}

export function TinyLineChart(props: { title: string; points: number[]; color: string }) {
  return (
    <div className="app-panel rounded-[24px] border p-4 shadow-halo md:rounded-[28px] md:p-5">
      <div className="app-text-primary font-display text-lg">{props.title}</div>
      <EChart
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
