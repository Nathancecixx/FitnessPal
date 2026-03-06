import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { api } from '../../lib/api'
import { queryClient } from '../../lib/query-client'

const navItems = [
  { to: '/', label: 'Today', hint: 'Dashboard and quick actions' },
  { to: '/nutrition', label: 'Food', hint: 'Meals, photos, and recipes' },
  { to: '/training', label: 'Train', hint: 'Sets, sessions, and overload' },
  { to: '/weight', label: 'Weight', hint: 'Fast weigh-ins and trends' },
  { to: '/templates', label: 'Templates', hint: 'Repeat what you use often' },
  { to: '/insights', label: 'Coach', hint: 'Signals and recommendations' },
  { to: '/settings', label: 'Settings', hint: 'Agent keys and runtime' },
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
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-md rounded-[32px] bg-slate-950/95 p-6 text-canvas shadow-halo backdrop-blur md:p-8">
        <div className="text-[11px] uppercase tracking-[0.35em] text-amber-300/75">FitnessPal</div>
        <h1 className="mt-4 font-display text-4xl leading-none">Phone-first local login</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">Sign in once on your phone, then handle everyday tracking from the bottom navigation and quick logging cards.</p>
        <form className="mt-6 grid gap-4" onSubmit={(event) => { event.preventDefault(); login.mutate() }}>
          <label className="block">
            <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-400">Username</span>
            <input className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-[16px] text-white outline-none" value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label className="block">
            <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-400">Password</span>
            <input className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-[16px] text-white outline-none" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <button className="min-h-[52px] rounded-full bg-lime px-4 py-3 text-sm font-semibold text-slate-950" type="submit">Sign in</button>
          {login.isError ? <div className="rounded-2xl bg-rose-500/15 px-4 py-3 text-sm text-rose-100">{login.error.message}</div> : null}
        </form>
      </div>
    </div>
  )
}

function MobileNav({ pathname }: { pathname: string }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/80 bg-white/92 backdrop-blur lg:hidden">
      <div className="mx-auto flex max-w-screen-sm gap-2 overflow-x-auto px-3 pb-[calc(0.85rem+env(safe-area-inset-bottom))] pt-3">
        {navItems.map((item) => {
          const active = pathname === item.to
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`min-w-[78px] rounded-[22px] px-3 py-3 text-center text-xs font-semibold transition ${
                active ? 'bg-slate-950 text-canvas shadow-halo' : 'bg-slate-100 text-slate-600'
              }`}
            >
              <div className="text-[11px] uppercase tracking-[0.22em]">{item.label}</div>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

export function AppShell() {
  const [denseMode, setDenseMode] = useState(false)
  const sessionQuery = useQuery({ queryKey: ['session'], queryFn: api.getSession, retry: false })
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const currentItem = useMemo(() => navItems.find((item) => item.to === pathname) ?? navItems[0], [pathname])

  if (sessionQuery.isLoading) {
    return <div className="flex min-h-screen items-center justify-center font-display text-3xl text-slate-700">Booting FitnessPal...</div>
  }

  if (sessionQuery.isError) {
    return <LoginScreen />
  }

  return (
    <div className={`min-h-screen font-sans text-slate-900 ${denseMode ? 'tracking-tight' : ''}`}>
      <div className="mx-auto max-w-[1600px] lg:grid lg:min-h-screen lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-4 lg:px-4 lg:py-4">
        <aside className="sticky top-4 hidden h-[calc(100vh-2rem)] self-start rounded-[32px] bg-slate-950/95 p-6 text-white shadow-halo backdrop-blur lg:flex lg:flex-col">
          <div className="rounded-[24px] border border-white/10 bg-white/5 p-5">
            <div className="text-xs uppercase tracking-[0.35em] text-amber-300/75">FitnessPal</div>
            <div className="mt-3 font-display text-3xl leading-none">Daily tracking, built for repeat use</div>
            <p className="mt-3 text-sm leading-6 text-slate-300">Quick daily entries up front. Deeper builders and agent tooling where you need them.</p>
          </div>

          <nav className="mt-8 space-y-2">
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="block rounded-2xl px-4 py-3 text-sm font-semibold text-slate-300 transition hover:bg-white/10 hover:text-white"
                activeProps={{ className: 'block rounded-2xl bg-lime px-4 py-3 text-sm font-semibold text-slate-950 shadow-lg' }}
              >
                <div>{item.label}</div>
                <div className="mt-1 text-xs font-normal text-inherit/80">{item.hint}</div>
              </Link>
            ))}
          </nav>

          <div className="mt-auto rounded-[24px] border border-white/10 bg-white/5 p-4">
            <div className="text-xs uppercase tracking-[0.25em] text-slate-400">View mode</div>
            <button className="mt-3 w-full rounded-full bg-white px-4 py-3 text-sm font-semibold text-slate-950" onClick={() => setDenseMode((value) => !value)}>
              {denseMode ? 'Use relaxed spacing' : 'Use dense spacing'}
            </button>
          </div>
        </aside>

        <div className="pb-24 lg:pb-0">
          <header className="sticky top-0 z-20 px-3 pt-3 lg:px-0 lg:pt-0">
            <div className="rounded-[28px] border border-white/80 bg-white/82 px-4 py-4 shadow-halo backdrop-blur md:px-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">FitnessPal</div>
                  <div className="mt-1 font-display text-3xl leading-none text-slate-950">{currentItem.label}</div>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{currentItem.hint}</p>
                </div>
                <button className="hidden rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-900 lg:inline-flex" onClick={() => setDenseMode((value) => !value)}>
                  {denseMode ? 'Relax' : 'Dense'}
                </button>
              </div>
              <div className="mt-4 flex gap-2 overflow-x-auto lg:hidden">
                {navItems.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    className="whitespace-nowrap rounded-full bg-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600"
                    activeProps={{ className: 'whitespace-nowrap rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-canvas' }}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          </header>

          <main className="px-3 pb-3 pt-3 lg:px-0 lg:pb-0">
            <div className="space-y-4 rounded-[32px] bg-white/45 p-3 shadow-halo backdrop-blur md:p-4 lg:p-6">
              <Outlet />
            </div>
          </main>
        </div>
      </div>

      <MobileNav pathname={pathname} />
    </div>
  )
}
