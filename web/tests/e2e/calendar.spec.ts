import { expect, test, type Page, type Route } from '@playwright/test'

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

function jsonRoute(route: Route, payload: JsonValue, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  })
}

function buildMonthCell(date: string, overrides: Record<string, JsonValue> = {}) {
  return {
    date,
    is_in_month: true,
    is_today: date === '2026-03-12',
    is_future: date > '2026-03-12',
    is_editable: date <= '2026-03-12',
    meal_count: 0,
    total_calories: 0,
    workout_count: 0,
    latest_weight_kg: null,
    has_check_in: false,
    ...overrides,
  }
}

async function installCalendarBaseMocks(page: Page) {
  const now = '2026-03-12T15:00:00.000Z'

  await page.route('**/api/v1/auth/session', (route) => jsonRoute(route, {
    actor: { id: 'session-test', type: 'session', display_name: 'owner', scopes: ['*'] },
    user: { id: 'user-test', username: 'owner', is_admin: true, is_active: true, has_password: true, created_at: now },
  }))

  await page.route('**/api/v1/preferences', (route) => jsonRoute(route, {
    weight_unit: 'kg',
    timezone: 'America/Toronto',
  }))

  await page.route('**/api/v1/exercises', (route) => jsonRoute(route, {
    items: [
      { id: 'exercise-1', name: 'Bench press', category: 'strength', rep_target_min: 6, rep_target_max: 10, load_increment: 2.5 },
    ],
    total: 1,
  }))
}

test.use({ timezoneId: 'America/Toronto' })

test('calendar switches days and saves meal/check-in against the selected date', async ({ page }) => {
  await installCalendarBaseMocks(page)

  const createdMeals: Array<Record<string, unknown>> = []
  const savedCheckIns: Array<Record<string, unknown>> = []

  const dayResponses: Record<string, Record<string, JsonValue>> = {
    '2026-03-11': {
      date: '2026-03-11',
      today: '2026-03-12',
      timezone: 'America/Toronto',
      is_today: false,
      is_future: false,
      is_editable: true,
      summary: buildMonthCell('2026-03-11'),
      meals: [],
      workouts: [],
      weight_entries: [],
      check_in: null,
    },
    '2026-03-12': {
      date: '2026-03-12',
      today: '2026-03-12',
      timezone: 'America/Toronto',
      is_today: true,
      is_future: false,
      is_editable: true,
      summary: buildMonthCell('2026-03-12', {
        meal_count: 1,
        total_calories: 680,
        has_check_in: true,
      }),
      meals: [
        {
          id: 'meal-1',
          logged_at: '2026-03-12T17:00:00.000Z',
          meal_type: 'lunch',
          source: 'manual',
          notes: 'Lunch',
          tags_json: [],
          totals: { calories: 680, protein_g: 50, carbs_g: 62, fat_g: 18, fiber_g: 6, sodium_mg: 420 },
          items: [
            {
              label: 'Chicken rice bowl',
              grams: 400,
              calories: 680,
              protein_g: 50,
              carbs_g: 62,
              fat_g: 18,
              fiber_g: 6,
              sodium_mg: 420,
              source_type: 'manual',
            },
          ],
        },
      ],
      workouts: [],
      weight_entries: [],
      check_in: {
        id: 'check-in-1',
        check_in_date: '2026-03-12',
        sleep_hours: 7.5,
        readiness_1_5: 4,
        soreness_1_5: 2,
        hunger_1_5: 3,
        note: 'Ready to train.',
        timezone: 'America/Toronto',
        is_today: true,
        created_at: '2026-03-12T10:00:00.000Z',
        updated_at: '2026-03-12T10:00:00.000Z',
      },
    },
  }

  await page.route('**/api/v1/calendar/month**', (route) => {
    const requestUrl = new URL(route.request().url())
    const anchorDate = requestUrl.searchParams.get('anchor_date') ?? '2026-03-12'

    return jsonRoute(route, {
      anchor_date: anchorDate,
      month_start: '2026-03-01',
      month_end: '2026-03-31',
      grid_start: '2026-03-08',
      grid_end: '2026-03-21',
      today: '2026-03-12',
      timezone: 'America/Toronto',
      weeks: [
        [
          buildMonthCell('2026-03-08'),
          buildMonthCell('2026-03-09'),
          buildMonthCell('2026-03-10'),
          buildMonthCell('2026-03-11'),
          buildMonthCell('2026-03-12', { meal_count: 1, total_calories: 680, has_check_in: true }),
          buildMonthCell('2026-03-13', { is_future: true, is_editable: false }),
          buildMonthCell('2026-03-14', { is_future: true, is_editable: false }),
        ],
        [
          buildMonthCell('2026-03-15', { is_future: true, is_editable: false }),
          buildMonthCell('2026-03-16', { is_future: true, is_editable: false }),
          buildMonthCell('2026-03-17', { is_future: true, is_editable: false }),
          buildMonthCell('2026-03-18', { is_future: true, is_editable: false }),
          buildMonthCell('2026-03-19', { is_future: true, is_editable: false }),
          buildMonthCell('2026-03-20', { is_future: true, is_editable: false }),
          buildMonthCell('2026-03-21', { is_future: true, is_editable: false }),
        ],
      ],
    })
  })

  await page.route('**/api/v1/calendar/days/*', (route) => {
    const date = route.request().url().split('/').at(-1) ?? '2026-03-12'
    return jsonRoute(route, dayResponses[date] ?? dayResponses['2026-03-12'])
  })

  await page.route('**/api/v1/meals', async (route) => {
    if (route.request().method() !== 'POST') {
      return jsonRoute(route, { items: [], total: 0, has_more: false, next_cursor: null })
    }

    const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>
    createdMeals.push(body)

    return jsonRoute(route, {
      id: 'meal-new',
      logged_at: body.logged_at,
      meal_type: body.meal_type ?? 'meal',
      source: 'manual',
      notes: body.notes ?? null,
      tags_json: [],
      totals: { calories: 220, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sodium_mg: 0 },
      items: body.items ?? [],
    })
  })

  await page.route('**/api/v1/assistant/check-in', async (route) => {
    if (route.request().method() !== 'PUT') {
      return jsonRoute(route, { check_in: null })
    }

    const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>
    savedCheckIns.push(body)

    return jsonRoute(route, {
      check_in: {
        id: 'check-in-2',
        check_in_date: body.check_in_date ?? '2026-03-11',
        sleep_hours: body.sleep_hours ?? null,
        readiness_1_5: body.readiness_1_5 ?? null,
        soreness_1_5: body.soreness_1_5 ?? null,
        hunger_1_5: body.hunger_1_5 ?? null,
        note: body.note ?? null,
        timezone: 'America/Toronto',
        is_today: body.check_in_date === '2026-03-12',
        created_at: '2026-03-11T13:00:00.000Z',
        updated_at: '2026-03-11T13:00:00.000Z',
      },
    })
  })

  await page.goto('/calendar/2026-03-12')
  await expect(page.getByRole('heading', { name: 'Thursday, March 12, 2026' })).toBeVisible()

  const monthPanel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'March 2026' }) })
  await monthPanel.locator('button').filter({ hasText: '11' }).click()

  await expect(page).toHaveURL(/\/calendar\/2026-03-11$/)
  await expect(page.getByRole('heading', { name: 'Wednesday, March 11, 2026' })).toBeVisible()

  const mealsPanel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Meals' }) })
  await mealsPanel.getByLabel('Label').fill('Greek yogurt')
  await mealsPanel.getByLabel('Calories').fill('220')
  await mealsPanel.getByRole('button', { name: 'Create meal' }).click()

  await expect.poll(() => createdMeals.at(-1)?.logged_at as string | undefined).toMatch(/^2026-03-11T/)
  await expect.poll(() => {
    const meal = createdMeals.at(-1)
    if (!meal || !Array.isArray(meal.items)) {
      return ''
    }
    const firstItem = meal.items[0] as { label?: string } | undefined
    return firstItem?.label ?? ''
  }).toBe('Greek yogurt')

  const checkInPanel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Coach check-in' }) })
  await checkInPanel.getByLabel('Sleep hours').fill('8')
  await checkInPanel.getByLabel('Note').fill('Recovered well')
  await checkInPanel.getByRole('button', { name: 'Save check-in' }).click()

  await expect.poll(() => savedCheckIns.at(-1)?.check_in_date as string | undefined).toBe('2026-03-11')
  await expect.poll(() => savedCheckIns.at(-1)?.note as string | undefined).toBe('Recovered well')
})

test('calendar keeps future dates visible but read-only', async ({ page }) => {
  await installCalendarBaseMocks(page)

  await page.route('**/api/v1/calendar/month**', (route) => jsonRoute(route, {
    anchor_date: '2026-03-21',
    month_start: '2026-03-01',
    month_end: '2026-03-31',
    grid_start: '2026-03-15',
    grid_end: '2026-03-28',
    today: '2026-03-12',
    timezone: 'America/Toronto',
    weeks: [
      [
        buildMonthCell('2026-03-15', { is_future: true, is_editable: false }),
        buildMonthCell('2026-03-16', { is_future: true, is_editable: false }),
        buildMonthCell('2026-03-17', { is_future: true, is_editable: false }),
        buildMonthCell('2026-03-18', { is_future: true, is_editable: false }),
        buildMonthCell('2026-03-19', { is_future: true, is_editable: false }),
        buildMonthCell('2026-03-20', { is_future: true, is_editable: false }),
        buildMonthCell('2026-03-21', { is_future: true, is_editable: false }),
      ],
    ],
  }))

  await page.route('**/api/v1/calendar/days/*', (route) => jsonRoute(route, {
    date: '2026-03-21',
    today: '2026-03-12',
    timezone: 'America/Toronto',
    is_today: false,
    is_future: true,
    is_editable: false,
    summary: buildMonthCell('2026-03-21', { is_future: true, is_editable: false }),
    meals: [],
    workouts: [],
    weight_entries: [],
    check_in: null,
  }))

  await page.goto('/calendar/2026-03-21')
  await expect(page.getByText('Future dates are visible here, but editing stays disabled in v1.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add meal' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Add workout' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Add weight' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Create meal' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Create workout' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Create weight' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Save check-in' })).toBeDisabled()
})

test('calendar nav can leave the page without bouncing back', async ({ page }) => {
  await installCalendarBaseMocks(page)

  await page.route('**/api/v1/calendar/month**', (route) => jsonRoute(route, {
    anchor_date: '2026-03-12',
    month_start: '2026-03-01',
    month_end: '2026-03-31',
    grid_start: '2026-03-08',
    grid_end: '2026-03-14',
    today: '2026-03-12',
    timezone: 'America/Toronto',
    weeks: [[
      buildMonthCell('2026-03-08'),
      buildMonthCell('2026-03-09'),
      buildMonthCell('2026-03-10'),
      buildMonthCell('2026-03-11'),
      buildMonthCell('2026-03-12'),
      buildMonthCell('2026-03-13', { is_future: true, is_editable: false }),
      buildMonthCell('2026-03-14', { is_future: true, is_editable: false }),
    ]],
  }))

  await page.route('**/api/v1/calendar/days/*', (route) => jsonRoute(route, {
    date: '2026-03-12',
    today: '2026-03-12',
    timezone: 'America/Toronto',
    is_today: true,
    is_future: false,
    is_editable: true,
    summary: buildMonthCell('2026-03-12'),
    meals: [],
    workouts: [],
    weight_entries: [],
    check_in: null,
  }))

  await page.route('**/api/v1/assistant/feed', (route) => jsonRoute(route, {
    feed: {
      generated_at: '2026-03-12T15:00:00.000Z',
      source: 'deterministic',
      freshness: {
        timezone: 'America/Toronto',
        local_date: '2026-03-12',
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
  await page.route('**/api/v1/foods**', (route) => jsonRoute(route, { items: [], total: 0, has_more: false, next_cursor: null }))
  await page.route('**/api/v1/recipes', (route) => jsonRoute(route, { items: [], total: 0 }))
  await page.route('**/api/v1/meal-templates', (route) => jsonRoute(route, { items: [], total: 0 }))
  await page.route('**/api/v1/meals**', (route) => jsonRoute(route, { items: [], total: 0, has_more: false, next_cursor: null }))
  await page.route('**/api/v1/meal-photos', (route) => jsonRoute(route, { items: [], total: 0 }))

  await page.goto('/calendar/2026-03-12')
  await expect(page.getByRole('heading', { name: 'Thursday, March 12, 2026' })).toBeVisible()

  await page.locator('aside').getByRole('link', { name: 'Food' }).click()

  await expect(page).toHaveURL(/\/nutrition$/)
  await expect(page.getByRole('heading', { name: 'Quick food logging first' })).toBeVisible()
})
