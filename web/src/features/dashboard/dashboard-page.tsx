import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { StatCard, TinyLineChart } from '../../components/cards/stat-card'
import { EmptyState, PageIntro, Panel } from '../../components/ui'
import { api } from '../../lib/api'

const quickActions = [
  { to: '/nutrition', title: 'Log food', subtitle: 'Meal, photo, recipe, or template', accent: 'from-amber-300 via-orange-100 to-white' },
  { to: '/training', title: 'Log workout', subtitle: 'Sets first, details second', accent: 'from-sky-300 via-cyan-100 to-white' },
  { to: '/weight', title: 'Log weight', subtitle: 'Fast weigh-in with optional extras', accent: 'from-rose-300 via-orange-100 to-white' },
  { to: '/templates', title: 'Use repeats', subtitle: 'Meals and sessions you do often', accent: 'from-lime-300 via-yellow-100 to-white' },
] as const

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
        eyebrow="Today"
        title="Quick check-in"
        description="Make the common stuff frictionless: log food, add sets, check your weight trend, and only open the deeper builders when you need them."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {quickActions.map((action) => (
          <Link key={action.to} to={action.to} className={`rounded-[24px] border border-slate-200 bg-gradient-to-br ${action.accent} p-4 shadow-halo`}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-600">Quick action</div>
            <div className="mt-3 font-display text-2xl text-slate-950">{action.title}</div>
            <p className="mt-2 text-sm leading-6 text-slate-700">{action.subtitle}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.8fr)]">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {cards.map((card) => <StatCard key={card.key} card={card} />)}
          </div>
          {cards.length === 0 ? <EmptyState title="No dashboard data yet" body="Log your first meal, workout, or weigh-in to populate the live summary cards." /> : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <TinyLineChart title="7-day calories" points={calorieSeries.length ? calorieSeries : [0]} color="#d97706" />
            <TinyLineChart title="7-day weight trend" points={weightSeries.length ? weightSeries : [0]} color="#fb7185" />
          </div>
        </div>

        <Panel title="Coach feed" subtitle="Keep the next useful action visible without turning the app into homework.">
          <div className="space-y-3">
            {(insights?.recommendations ?? []).slice(0, 4).map((note) => (
              <div key={note} className="rounded-[20px] bg-slate-950 px-4 py-3 text-sm leading-6 text-canvas">
                {note}
              </div>
            ))}
            {!insights?.recommendations?.length ? (
              <EmptyState title="No recommendations yet" body="As soon as the API has enough meals, workouts, and weigh-ins it will start surfacing coaching signals here." />
            ) : null}
          </div>

          <div className="mt-5 grid gap-3 rounded-[24px] bg-slate-100 p-4 sm:grid-cols-3">
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
