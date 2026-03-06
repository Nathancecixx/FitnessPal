import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { api } from '../../lib/api'
import { queryClient } from '../../lib/query-client'

const navItems = [
  { to: '/', label: 'Today' },
  { to: '/nutrition', label: 'Nutrition' },
  { to: '/training', label: 'Training' },
  { to: '/weight', label: 'Weight' },
  { to: '/templates', label: 'Templates' },
  { to: '/insights', label: 'Insights' },
  { to: '/settings', label: 'Settings' },
] as const

function LoginScreen() {
  const [username, setUsername] = useState('owner')
  const [password, setPassword] = useState('fitnesspal')
  const login = useMutation({
    mutationFn: () => api.login(username, password),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['session'] })
    },
  })

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas bg-mesh px-4 py-10">
      <div className="w-full max-w-lg rounded-[36px] bg-slate-950/95 p-8 text-canvas shadow-halo backdrop-blur">
        <div className="text-xs uppercase tracking-[0.35em] text-amber-300/75">FitnessPal</div>
        <h1 className="mt-4 font-display text-4xl">Local login</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">Use the bootstrap credentials for the first local sign-in, then issue an API key for OpenClaw from the Settings page.</p>
        <form className="mt-6 grid gap-4" onSubmit={(event) => { event.preventDefault(); login.mutate() }}>
          <label className="block">
            <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-400">Username</span>
            <input className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none" value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label className="block">
            <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-400">Password</span>
            <input className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <button className="rounded-full bg-lime px-4 py-3 text-sm font-semibold text-slate-950" type="submit">Sign in</button>
          {login.isError ? <div className="rounded-2xl bg-rose-500/15 px-4 py-3 text-sm text-rose-100">{login.error.message}</div> : null}
        </form>
      </div>
    </div>
  )
}

export function AppShell() {
  const [denseMode, setDenseMode] = useState(false)
  const sessionQuery = useQuery({ queryKey: ['session'], queryFn: api.getSession, retry: false })
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const currentLabel = useMemo(() => navItems.find((item) => item.to === pathname)?.label ?? 'FitnessPal', [pathname])

  if (sessionQuery.isLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-canvas font-display text-3xl text-slate-700">Booting FitnessPal...</div>
  }

  if (sessionQuery.isError) {
    return <LoginScreen />
  }

  return (
    <div className={`min-h-screen bg-canvas bg-mesh px-4 py-4 font-sans text-slate-900 ${denseMode ? 'tracking-tight' : ''}`}>
      <div className="mx-auto grid min-h-[calc(100vh-2rem)] max-w-[1600px] gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-[32px] bg-slate-950/95 p-6 text-white shadow-halo backdrop-blur">
          <div className="rounded-[24px] border border-white/10 bg-white/5 p-5">
            <div className="text-xs uppercase tracking-[0.35em] text-amber-300/75">FitnessPal</div>
            <div className="mt-3 font-display text-3xl">Gym-bro HQ</div>
            <p className="mt-3 text-sm leading-6 text-slate-300">Local-first tracking for nutrition, training, bodyweight, and agent-driven workflows.</p>
          </div>
          <nav className="mt-8 space-y-2">
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="block rounded-2xl px-4 py-3 text-sm font-semibold text-slate-300 transition hover:bg-white/10 hover:text-white"
                activeProps={{ className: 'block rounded-2xl bg-lime text-slate-950 px-4 py-3 text-sm font-semibold shadow-lg' }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="mt-8 rounded-[24px] border border-white/10 bg-white/5 p-4">
            <div className="text-xs uppercase tracking-[0.25em] text-slate-400">View Mode</div>
            <button className="mt-3 w-full rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-950" onClick={() => setDenseMode((value) => !value)}>
              {denseMode ? 'Switch to spacious dashboard' : 'Switch to dense dashboard'}
            </button>
          </div>
        </aside>

        <main className="space-y-4 overflow-hidden rounded-[36px] bg-white/45 p-4 backdrop-blur md:p-6">
          <header className="flex flex-col gap-4 rounded-[28px] border border-white/80 bg-white/75 px-5 py-4 shadow-halo md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.25em] text-slate-400">Control Center</div>
              <div className="mt-1 font-display text-2xl text-slate-950">{currentLabel}</div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.15em] text-slate-500">
              <span className="rounded-full bg-slate-100 px-3 py-2">24/7 local runtime</span>
              <span className="rounded-full bg-slate-100 px-3 py-2">Agent-ready REST API</span>
              <span className="rounded-full bg-slate-100 px-3 py-2">Photo-to-meal pipeline</span>
            </div>
          </header>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
