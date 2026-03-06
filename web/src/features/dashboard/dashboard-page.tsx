import { useQuery } from '@tanstack/react-query'

import { StatCard, TinyLineChart } from '../../components/cards/stat-card'
import { ActionButton, EmptyState, PageIntro, Panel } from '../../components/ui'
import { api } from '../../lib/api'

export function DashboardPage() {
  const dashboardQuery = useQuery({ queryKey: ['dashboard'], queryFn: api.getDashboard })
  const insightsQuery = useQuery({ queryKey: ['insights'], queryFn: api.getInsights })

  const cards = dashboardQuery.data?.cards ?? []
  const insights = insightsQuery.data?.snapshot.payload
  const calorieSeries = Object.values(insights?.nutrition.daily_calories ?? {}).slice(-7)
  const weightSeries = insights?.body.trend_7 ?? []

  return (
    <div className="space-y-4">
      <PageIntro
        eyebrow="Overview"
        title="Everything that matters today"
        description="Monitor calories, progressive overload, bodyweight trend, and recovery signals from one dense local dashboard that OpenClaw can consume through the same API contract."
        actions={<ActionButton tone="secondary">Local-only by design</ActionButton>}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(340px,0.8fr)]">
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {cards.map((card) => <StatCard key={card.key} card={card} />)}
          </div>
          {cards.length === 0 ? <EmptyState title="No dashboard data yet" body="Log your first meal, workout, or weigh-in to populate the live cards." /> : null}
          <div className="grid gap-4 lg:grid-cols-2">
            <TinyLineChart title="7-day calories" points={calorieSeries.length ? calorieSeries : [0]} color="#d97706" />
            <TinyLineChart title="7-day weight trend" points={weightSeries.length ? weightSeries : [0]} color="#fb7185" />
          </div>
        </div>
        <Panel title="Coach feed" subtitle="The first recommendation is what the app wants you to act on next.">
          <div className="space-y-3">
            {(insights?.recommendations ?? []).slice(0, 4).map((note) => (
              <div key={note} className="rounded-[20px] bg-slate-950 px-4 py-3 text-sm text-canvas">
                {note}
              </div>
            ))}
            {!insights?.recommendations?.length ? (
              <EmptyState title="No recommendations yet" body="As soon as the API has enough meals, workouts, and weigh-ins it will start surfacing coaching signals here." />
            ) : null}
          </div>
          <div className="mt-5 grid gap-3 rounded-[24px] bg-slate-100 p-4 md:grid-cols-3">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Calories</div>
              <div className="mt-2 font-display text-2xl">{Math.round(insights?.nutrition.average_calories_7 ?? 0)}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Weekly volume</div>
              <div className="mt-2 font-display text-2xl">{Math.round(insights?.training.weekly_volume_kg ?? 0)}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Weight trend</div>
              <div className="mt-2 font-display text-2xl">{insights?.body.weight_trend_kg_per_week?.toFixed(2) ?? '0.00'}</div>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  )
}
