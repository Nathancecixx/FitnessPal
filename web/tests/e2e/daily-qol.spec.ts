import { expect, test, type Page, type Route } from '@playwright/test'

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

function jsonRoute(route: Route, payload: JsonValue, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  })
}

async function installSessionMocks(page: Page) {
  const now = new Date().toISOString()
  await page.route('**/api/v1/auth/session', (route) => jsonRoute(route, {
    actor: { id: 'session-test', type: 'session', display_name: 'owner', scopes: ['*'] },
    user: { id: 'user-test', username: 'owner', is_admin: true, is_active: true, has_password: true, created_at: now },
  }))
  await page.route('**/api/v1/preferences', (route) => jsonRoute(route, {
    weight_unit: 'kg',
    timezone: 'America/Toronto',
  }))
}

test('weight draft survives refresh and delete requires typed confirmation', async ({ page }) => {
  await installSessionMocks(page)
  const now = new Date().toISOString()
  let deletedWeight = false

  await page.route('**/api/v1/assistant/feed', (route) => jsonRoute(route, {
    feed: {
      generated_at: now,
      source: 'deterministic',
      freshness: {
        timezone: 'America/Toronto',
        local_date: '2026-03-13',
        last_meal_at: now,
        last_workout_at: now,
        last_weight_at: now,
        last_check_in_at: now,
        meals_logged_today: true,
        weight_logged_today: true,
        check_in_completed_today: true,
        workout_logged_last_72h: true,
        stale_signals: [],
      },
      top_focus: {
        title: 'Stay consistent',
        summary: 'Keep the basics tight.',
        route: '/coach',
        cta_label: 'Open coach board',
      },
      actions: [],
      watchouts: [],
      nudges: [],
      quick_prompts: [],
      stats: {},
      brief: null,
      today_check_in: null,
    },
  }))
  await page.route('**/api/v1/weight-entries/trends**', (route) => jsonRoute(route, {
    points: [
      { logged_at: '2026-03-10T08:00:00Z', weight_kg: 82.8, trend_7: 82.8, trend_30: 82.8 },
      { logged_at: '2026-03-11T08:00:00Z', weight_kg: 82.5, trend_7: 82.65, trend_30: 82.65 },
      { logged_at: '2026-03-12T08:00:00Z', weight_kg: 82.4, trend_7: 82.56, trend_30: 82.56 },
    ],
    weight_trend_kg_per_week: -0.2,
  }))
  await page.route('**/api/v1/weight-entries**', async (route) => {
    if (route.request().method() === 'DELETE') {
      deletedWeight = true
      return jsonRoute(route, { status: 'deleted', id: 'weight-1' })
    }

    return jsonRoute(route, {
      items: [
        {
          id: 'weight-1',
          logged_at: '2026-03-12T08:00:00Z',
          weight_kg: 82.4,
          body_fat_pct: 15.2,
          waist_cm: 84.5,
          notes: 'Baseline',
        },
      ],
      total: 1,
      has_more: false,
      next_cursor: null,
    })
  })

  await page.goto('/weight')
  await page.getByLabel('Weight (kg)').fill('82.1')
  await page.reload()
  await expect(page.getByLabel('Weight (kg)')).toHaveValue('82.1')

  await page.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Delete weigh-in' })).toBeDisabled()
  await page.getByLabel('Type 82.4 kg to confirm').fill('82.4 kg')
  await page.getByRole('button', { name: 'Delete weigh-in' }).click()
  await expect.poll(() => deletedWeight).toBeTruthy()
})

test('nutrition food library can search, favorite, and edit foods', async ({ page }) => {
  await installSessionMocks(page)
  let lastFoodPatch: Record<string, unknown> | null = null
  const foods = [
    {
      id: 'food-1',
      name: 'Rice',
      brand: 'Staples',
      serving_name: '100 g',
      calories: 130,
      protein_g: 2.4,
      carbs_g: 28,
      fat_g: 0.2,
      fiber_g: 0.4,
      sugar_g: 0.1,
      sodium_mg: 1,
      notes: '',
      is_favorite: false,
      tags_json: [],
      created_at: new Date().toISOString(),
    },
    {
      id: 'food-2',
      name: 'Chicken breast',
      brand: 'Staples',
      serving_name: '100 g',
      calories: 165,
      protein_g: 31,
      carbs_g: 0,
      fat_g: 3.6,
      fiber_g: 0,
      sugar_g: 0,
      sodium_mg: 74,
      notes: '',
      is_favorite: true,
      tags_json: [],
      created_at: new Date().toISOString(),
    },
  ]

  await page.route('**/api/v1/assistant/feed', (route) => jsonRoute(route, {
    feed: {
      generated_at: new Date().toISOString(),
      source: 'deterministic',
      freshness: {
        timezone: 'America/Toronto',
        local_date: '2026-03-13',
        last_meal_at: null,
        last_workout_at: null,
        last_weight_at: null,
        last_check_in_at: null,
        meals_logged_today: false,
        weight_logged_today: false,
        check_in_completed_today: false,
        workout_logged_last_72h: false,
        stale_signals: [],
      },
      top_focus: {
        title: 'Get the basics in',
        summary: 'Start logging.',
        route: '/nutrition',
        cta_label: 'Open nutrition',
      },
      actions: [],
      watchouts: [],
      nudges: [],
      quick_prompts: [],
      stats: {},
      brief: null,
      today_check_in: null,
    },
  }))
  await page.route('**/api/v1/recipes', (route) => jsonRoute(route, { items: [], total: 0 }))
  await page.route('**/api/v1/meal-templates', (route) => jsonRoute(route, { items: [], total: 0 }))
  await page.route('**/api/v1/meals**', (route) => jsonRoute(route, { items: [], total: 0, has_more: false, next_cursor: null }))
  await page.route('**/api/v1/meal-photos', (route) => jsonRoute(route, { items: [], total: 0 }))
  await page.route('**/api/v1/foods**', async (route) => {
    const requestUrl = new URL(route.request().url())
    if (route.request().method() === 'PATCH') {
      const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>
      const foodId = requestUrl.pathname.split('/').at(-1) ?? ''
      const food = foods.find((item) => item.id === foodId)
      if (food) {
        Object.assign(food, body)
        lastFoodPatch = body
      }
      return jsonRoute(route, food ?? {})
    }

    const search = requestUrl.searchParams.get('search')?.toLowerCase() ?? ''
    const favoritesOnly = requestUrl.searchParams.get('favorites_only') === 'true'
    let items = foods
    if (favoritesOnly) {
      items = items.filter((item) => item.is_favorite)
    }
    if (search) {
      items = items.filter((item) => item.name.toLowerCase().includes(search) || (item.brand ?? '').toLowerCase().includes(search))
    }
    return jsonRoute(route, { items, total: items.length, has_more: false, next_cursor: null })
  })

  await page.goto('/nutrition')
  const foodLibrary = page.locator('details').filter({ hasText: 'Food library' })
  const favoriteFoodsPanel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Favorite foods' }) })

  await page.getByText('Food library').click()
  await foodLibrary.getByLabel('Search foods').fill('rice')
  await expect(foodLibrary.locator('div.font-semibold', { hasText: 'Rice' }).first()).toBeVisible()
  await foodLibrary.getByRole('button', { name: 'Favorite' }).click()
  await expect(favoriteFoodsPanel).toContainText('Rice')

  await foodLibrary.getByRole('button', { name: 'Edit' }).click()
  await foodLibrary.getByLabel('Brand').fill('Updated Brand')
  await foodLibrary.getByRole('button', { name: 'Save food changes' }).click()
  await expect.poll(() => lastFoodPatch?.brand).toBe('Updated Brand')
})
