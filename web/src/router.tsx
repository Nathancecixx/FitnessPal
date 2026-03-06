import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'

import { AppShell } from './components/layout/app-shell'
import { DashboardPage } from './features/dashboard/dashboard-page'
import { InsightsPage } from './features/insights/insights-page'
import { NutritionPage } from './features/nutrition/nutrition-page'
import { SettingsPage } from './features/settings/settings-page'
import { TemplatesPage } from './features/templates/templates-page'
import { TrainingPage } from './features/training/training-page'
import { WeightPage } from './features/weight/weight-page'

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
