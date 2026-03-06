import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { Suspense, lazy } from 'react'

import { AppShell } from './components/layout/app-shell'

const LazyDashboardPage = lazy(async () => ({ default: (await import('./features/dashboard/dashboard-page')).DashboardPage }))
const LazyNutritionPage = lazy(async () => ({ default: (await import('./features/nutrition/nutrition-page')).NutritionPage }))
const LazyTrainingPage = lazy(async () => ({ default: (await import('./features/training/training-page')).TrainingPage }))
const LazyWeightPage = lazy(async () => ({ default: (await import('./features/weight/weight-page')).WeightPage }))
const LazyTemplatesPage = lazy(async () => ({ default: (await import('./features/templates/templates-page')).TemplatesPage }))
const LazyInsightsPage = lazy(async () => ({ default: (await import('./features/insights/insights-page')).InsightsPage }))
const LazySettingsPage = lazy(async () => ({ default: (await import('./features/settings/settings-page')).SettingsPage }))

function LoadingFallback() {
  return <div className="rounded-[24px] bg-white/80 px-4 py-8 text-center text-sm text-slate-500 shadow-halo">Loading page...</div>
}

function DashboardPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <LazyDashboardPage />
    </Suspense>
  )
}

function NutritionPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <LazyNutritionPage />
    </Suspense>
  )
}

function TrainingPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <LazyTrainingPage />
    </Suspense>
  )
}

function WeightPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <LazyWeightPage />
    </Suspense>
  )
}

function TemplatesPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <LazyTemplatesPage />
    </Suspense>
  )
}

function InsightsPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <LazyInsightsPage />
    </Suspense>
  )
}

function SettingsPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <LazySettingsPage />
    </Suspense>
  )
}

const rootRoute = createRootRoute({ component: AppShell })

const dashboardRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: DashboardPage })
const nutritionRoute = createRoute({ getParentRoute: () => rootRoute, path: '/nutrition', component: NutritionPage })
const trainingRoute = createRoute({ getParentRoute: () => rootRoute, path: '/training', component: TrainingPage })
const weightRoute = createRoute({ getParentRoute: () => rootRoute, path: '/weight', component: WeightPage })
const templatesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/templates', component: TemplatesPage })
const insightsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/insights', component: InsightsPage })
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: SettingsPage })

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  nutritionRoute,
  trainingRoute,
  weightRoute,
  templatesRoute,
  insightsRoute,
  settingsRoute,
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
