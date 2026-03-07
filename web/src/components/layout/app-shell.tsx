import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import { api } from '../../lib/api'
import { queryClient } from '../../lib/query-client'

const navItems = [
  { to: '/', label: 'Today', hint: 'Dashboard and quick actions' },
  { to: '/nutrition', label: 'Food', hint: 'Meals, photos, and recipes' },
  { to: '/training', label: 'Train', hint: 'Sets, sessions, and overload' },
  { to: '/weight', label: 'Weight', hint: 'Fast weigh-ins and trends' },
  { to: '/templates', label: 'Templates', hint: 'Repeat what you use often' },
  { to: '/insights', label: 'Coach', hint: 'Signals and recommendations' },
  { to: '/settings', label: 'Settings', hint: 'AI control, keys, and runtime' },
] as const

const THEME_STORAGE_KEY = 'fitnesspal-theme'

type ThemeMode = 'light' | 'dark'

function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'light'
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
  if (storedTheme === 'light' || storedTheme === 'dark') {
    return storedTheme
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function ThemeToggle(props: { theme: ThemeMode; onToggle: () => void; className?: string }) {
  const isDark = props.theme === 'dark'

  return (
    <button
      type="button"
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} theme`}
      className={`theme-toggle ${isDark ? 'theme-toggle-dark' : 'theme-toggle-light'} ${props.className ?? ''}`}
      onClick={props.onToggle}
    >
      <span className="theme-toggle-labels" aria-hidden="true">
        <span>Light</span>
        <span>Dark</span>
      </span>
      <span className="theme-toggle-thumb" aria-hidden="true">
        {isDark ? 'Dark' : 'Light'}
      </span>
    </button>
  )
}

function LoginScreen(props: { theme: ThemeMode; onToggleTheme: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const login = useMutation({
    mutationFn: () => api.login(username, password),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['session'] })
    },
  })

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-md rounded-[32px] bg-slate-950/95 p-6 text-canvas shadow-halo backdrop-blur md:p-8">
        <div className="flex items-start justify-between gap-4">
          <div className="text-[11px] uppercase tracking-[0.35em] text-amber-300/75">FitnessPal</div>
          <ThemeToggle theme={props.theme} onToggle={props.onToggleTheme} />
        </div>
        <h1 className="mt-4 font-display text-4xl leading-none">Multi-user local login</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">The admin account comes from server config. Admins can issue password setup links for other users from Settings after signing in.</p>
        <form className="mt-6 grid gap-4" onSubmit={(event) => { event.preventDefault(); login.mutate() }}>
          <label className="block">
            <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-400">Username</span>
            <input className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-[16px] text-white outline-none" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Admin or user name" />
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
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme)
  const sessionQuery = useQuery({ queryKey: ['session'], queryFn: api.getSession, retry: false })
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const currentItem = useMemo(() => navItems.find((item) => item.to === pathname) ?? navItems[0], [pathname])
  const sessionUser = sessionQuery.data?.user
  const isSetupRoute = pathname === '/setup-password'
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: async () => {
      queryClient.clear()
      await queryClient.invalidateQueries({ queryKey: ['session'] })
    },
  })

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('theme-dark', theme === 'dark')
    root.style.colorScheme = theme
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  if (sessionQuery.isLoading) {
    return <div className="flex min-h-screen items-center justify-center font-display text-3xl text-slate-700">Booting FitnessPal...</div>
  }

  if (isSetupRoute && sessionQuery.isError) {
    return (
      <div className="min-h-screen px-3 py-4 md:px-4">
        <div className="mx-auto max-w-5xl">
          <div className="mb-4 flex items-center justify-between rounded-[28px] border border-white/80 bg-white/82 px-4 py-4 shadow-halo backdrop-blur">
            <div>
              <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">FitnessPal</div>
              <div className="mt-1 font-display text-3xl leading-none text-slate-950">Password setup</div>
            </div>
            <ThemeToggle theme={theme} onToggle={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')} className="shrink-0" />
          </div>
          <Outlet />
        </div>
      </div>
    )
  }

  if (sessionQuery.isError) {
    return <LoginScreen theme={theme} onToggleTheme={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')} />
  }

  return (
    <div className="min-h-screen font-sans text-slate-900">
      <div className="mx-auto max-w-[1600px] lg:grid lg:min-h-screen lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-4 lg:px-4 lg:py-4">
        <aside className="sticky top-4 hidden h-[calc(100vh-2rem)] self-start rounded-[32px] bg-slate-950/95 p-6 text-white shadow-halo backdrop-blur lg:flex lg:flex-col">
          <div className="rounded-[24px] border border-white/10 bg-white/5 p-5">
            <div className="text-xs uppercase tracking-[0.35em] text-amber-300/75">FitnessPal</div>
            <div className="mt-3 font-display text-3xl leading-none">Daily tracking with AI coach</div>
            <p className="mt-3 text-sm leading-6 text-slate-300">Quick daily entries. AI coaching and analytics where you may need.</p>
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
                <div className="flex items-start gap-3">
                  <div className="hidden rounded-[22px] bg-slate-100 px-4 py-3 text-right text-xs text-slate-500 md:block">
                    <div className="font-semibold text-slate-900">{sessionUser?.username}</div>
                    <div>{sessionUser?.is_admin ? 'Admin' : 'User'}</div>
                  </div>
                  <button
                    type="button"
                    className="rounded-full bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700 ring-1 ring-slate-200"
                    onClick={() => logout.mutate()}
                  >
                    Sign out
                  </button>
                  <ThemeToggle theme={theme} onToggle={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')} className="shrink-0" />
                </div>
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
