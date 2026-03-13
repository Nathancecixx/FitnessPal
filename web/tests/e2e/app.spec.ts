import { expect, test, type Page, type Route } from '@playwright/test'

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

function jsonRoute(route: Route, payload: JsonValue, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  })
}

async function installBaseMocks(page: Page) {
  const now = new Date().toISOString()
  await page.route('**/api/v1/auth/session', (route) => jsonRoute(route, {
    actor: { id: 'session-test', type: 'session', display_name: 'owner', scopes: ['*'] },
    user: { id: 'user-test', username: 'owner', is_admin: true, is_active: true, has_password: true, created_at: now },
  }))
  await page.route('**/api/v1/dashboard', (route) => jsonRoute(route, { cards: [], available_modules: ['nutrition', 'training', 'metrics', 'insights'] }))
  await page.route('**/api/v1/assistant/feed', (route) => jsonRoute(route, {
    feed: {
      generated_at: now,
      source: 'deterministic',
      freshness: {
        timezone: 'America/Toronto',
        local_date: '2026-03-12',
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
        title: 'Stay ahead of the easy wins',
        summary: 'Keep logging tight, hit protein earlier, and make the next session look cleaner than the last one.',
        route: '/coach',
        cta_label: 'Open coach board',
      },
      actions: ['Hit protein early.', 'Repeat the last session with cleaner reps.'],
      watchouts: [],
      nudges: [
        {
          id: 'training-repeat-session',
          surface: 'training',
          title: 'Repeat the last session with cleaner execution',
          body: 'Use the previous session as the template and beat it with steadier reps.',
          tone: 'positive',
          route: '/training',
          cta_label: 'Log workout',
        },
      ],
      quick_prompts: [
        'What should I focus on over the next 3 days based on my current logs?',
        'Give me a pre-workout primer before my next session.',
      ],
      stats: { average_calories_7: 2400, weekly_volume_kg: 5200, weight_trend_kg_per_week: -0.2, today_protein_g: 150, protein_target_g: 180 },
      brief: {
        id: 'brief-1',
        status: 'ready',
        source: 'deterministic',
        title: 'Coach feed',
        summary: 'Stay consistent.',
        body_markdown: 'Keep protein high.',
        actions: ['Hit protein early.'],
        stats: { average_calories_7: 2400, weekly_volume_kg: 5200, weight_trend_kg_per_week: -0.2 },
        persona_name: 'FitnessPal Coach',
        persona_tagline: 'Clarity over noise.',
        created_at: now,
        updated_at: now,
      },
      today_check_in: {
        id: 'check-in-1',
        check_in_date: '2026-03-12',
        sleep_hours: 7.5,
        readiness_1_5: 4,
        soreness_1_5: 2,
        hunger_1_5: 3,
        note: 'Ready to train.',
        timezone: 'America/Toronto',
        is_today: true,
        created_at: now,
        updated_at: now,
      },
    },
  }))
  await page.route('**/api/v1/assistant/feed/refresh', (route) => jsonRoute(route, { status: 'ok' }))
  await page.route('**/api/v1/assistant/check-in', async (route) => {
    if (route.request().method() === 'PUT') {
      return jsonRoute(route, {
        check_in: {
          id: 'check-in-1',
          check_in_date: '2026-03-12',
          sleep_hours: 8,
          readiness_1_5: 4,
          soreness_1_5: 2,
          hunger_1_5: 3,
          note: 'Saved from test',
          timezone: 'America/Toronto',
          is_today: true,
          created_at: now,
          updated_at: now,
        },
      })
    }
    return jsonRoute(route, {
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
        created_at: now,
        updated_at: now,
      },
    })
  })
  await page.route('**/api/v1/assistant/brief', (route) => jsonRoute(route, {
    brief: {
      id: 'brief-1',
      status: 'ready',
      source: 'deterministic',
      title: 'Coach feed',
      summary: 'Stay consistent.',
      body_markdown: 'Keep protein high.',
      actions: ['Hit protein early.'],
      stats: { average_calories_7: 2400, weekly_volume_kg: 5200, weight_trend_kg_per_week: -0.2 },
      persona_name: 'FitnessPal Coach',
      persona_tagline: 'Clarity over noise.',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  }))
  await page.route('**/api/v1/insights/summary?days=90', (route) => jsonRoute(route, {
    summary: {
      nutrition: {
        daily_calories: { '2026-03-06': 2400, '2026-03-07': 2500 },
        average_calories_7: 2450,
        goal_calories: 2500,
        adherence_ratio: 0.98,
      },
      body: {
        latest_weight_kg: 82.1,
        weight_trend_kg_per_week: -0.2,
        trend_7: [82.4, 82.3, 82.2, 82.1],
        trend_30: [82.7, 82.5, 82.3, 82.1],
      },
      training: {
        weekly_volume_kg: 5200,
        volume_delta_kg: 200,
        session_count_7: 3,
        last_session_at: new Date().toISOString(),
        pr_count: 1,
      },
      recovery_flags: [],
      recommendations: ['Stay on plan.'],
      generated_at: new Date().toISOString(),
      window_days: 90,
    },
  }))
}

test('dashboard can create a quick-capture draft and apply it', async ({ page }) => {
  await installBaseMocks(page)
  await page.route('**/api/v1/exercises', (route) => jsonRoute(route, { items: [], total: 0 }))
  await page.route('**/api/v1/assistant/parse', (route) => jsonRoute(route, {
    drafts: [
      {
        kind: 'meal_entry',
        summary: 'Log lunch',
        payload: {
          meal_type: 'lunch',
          items: [{ label: 'Chicken rice bowl', calories: 640, protein_g: 48, carbs_g: 62, fat_g: 16, source_type: 'manual' }],
        },
      },
    ],
    warnings: [],
  }))

  let createdMeal = false
  await page.route('**/api/v1/meals', async (route) => {
    if (route.request().method() === 'POST') {
      createdMeal = true
      return jsonRoute(route, {
        id: 'meal-1',
        logged_at: new Date().toISOString(),
        meal_type: 'lunch',
        source: 'manual',
        notes: null,
        tags_json: [],
        totals: { calories: 640, protein_g: 48, carbs_g: 62, fat_g: 16, fiber_g: 0, sodium_mg: 0 },
        items: [{ label: 'Chicken rice bowl', calories: 640, protein_g: 48, carbs_g: 62, fat_g: 16, source_type: 'manual' }],
      })
    }
    return jsonRoute(route, { items: [], total: 0, has_more: false, next_cursor: null })
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'Draft actions' }).click()
  await expect(page.getByText('Log lunch')).toBeVisible()
  await page.getByRole('button', { name: 'Apply' }).click()
  await expect.poll(() => createdMeal).toBeTruthy()
})

test('training can launch a routine day and submit a session', async ({ page }) => {
  await installBaseMocks(page)
  await page.route('**/api/v1/exercises/01/progression', (route) => jsonRoute(route, {
    recommendation: { recommendation: 'hold', next_load_kg: 100, reason: 'Hold steady.' },
  }))
  await page.route('**/api/v1/exercises', (route) => jsonRoute(route, {
    items: [
      { id: '01', name: 'Bench press', category: 'strength', rep_target_min: 6, rep_target_max: 10, load_increment: 2.5 },
    ],
    total: 1,
  }))
  await page.route('**/api/v1/routines', async (route) => {
    if (route.request().method() === 'GET') {
      return jsonRoute(route, {
        items: [
          {
            id: 'routine-1',
            name: 'Upper / Lower',
            items: [
              {
                id: 'item-1',
                exercise_id: '01',
                exercise_name: 'Bench press',
                day_label: 'Day 1',
                order_index: 0,
                target_sets: 3,
                target_reps_min: 6,
                target_reps_max: 10,
                target_rir: 2,
              },
            ],
            created_at: new Date().toISOString(),
          },
        ],
        total: 1,
      })
    }
    return jsonRoute(route, { status: 'deleted', id: 'routine-1' })
  })
  await page.route('**/api/v1/workout-templates', (route) => jsonRoute(route, { items: [], total: 0 }))
  let createdSession = false
  await page.route('**/api/v1/workout-sessions**', async (route) => {
    if (route.request().method() === 'POST') {
      createdSession = true
      return jsonRoute(route, {
        id: 'session-1',
        routine_id: 'routine-1',
        started_at: new Date().toISOString(),
        notes: 'Upper / Lower - Day 1',
        total_volume_kg: 2400,
        total_sets: 3,
        sets: [{ exercise_id: '01', set_index: 1, reps: 8, load_kg: 100 }],
      })
    }
    return jsonRoute(route, { items: [], total: 0, has_more: false, next_cursor: null })
  })

  await page.goto('/training')
  await page.getByRole('button', { name: 'Start Day 1' }).click()
  await expect(page.getByText('Routine session: Upper / Lower')).toBeVisible()
  await page.getByRole('button', { name: 'Log workout' }).click()
  await expect.poll(() => createdSession).toBeTruthy()
})

test('coach hub shows the shared feed and saves a daily check-in', async ({ page }) => {
  await installBaseMocks(page)
  const now = new Date().toISOString()
  let savedCheckIn = false
  await page.route('**/api/v1/assistant/advice', (route) => jsonRoute(route, {
    advice: {
      source: 'deterministic',
      question: 'Give me a pre-workout primer before my next session.',
      title: 'Precision day',
      summary: 'Keep load steady and own cleaner reps.',
      body_markdown: 'Treat the next session like a precision day.',
      actions: ['Repeat the last top set with cleaner reps.'],
      watchouts: ['Do not turn one flat day into a program rewrite.'],
      focus_area: 'Execution',
      follow_up_prompt: 'How did the last working set feel?',
      stats: { weekly_volume_kg: 5200 },
      generated_at: new Date().toISOString(),
    },
  }))
  await page.route('**/api/v1/assistant/check-in', async (route) => {
    if (route.request().method() === 'PUT') {
      savedCheckIn = true
      return jsonRoute(route, {
        check_in: {
          id: 'check-in-1',
          check_in_date: '2026-03-12',
          sleep_hours: 8,
          readiness_1_5: 4,
          soreness_1_5: 2,
          hunger_1_5: 3,
          note: 'Saved from test',
          timezone: 'America/Toronto',
          is_today: true,
          created_at: now,
          updated_at: now,
        },
      })
    }
    return jsonRoute(route, {
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
        created_at: now,
        updated_at: now,
      },
    })
  })

  await page.goto('/coach')
  await expect(page.getByRole('heading', { name: 'FitnessPal Coach' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Stay ahead of the easy wins' })).toBeVisible()

  await page.getByLabel('Sleep hours').fill('8')
  await page.getByLabel('Note').fill('Saved from test')
  await page.getByRole('button', { name: 'Save check-in' }).click()
  await expect.poll(() => savedCheckIn).toBeTruthy()
})
