import { expect, test, type Page, type Route } from '@playwright/test'

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

function jsonRoute(route: Route, payload: JsonValue, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  })
}

async function installSettingsMocks(page: Page) {
  const now = new Date().toISOString()

  await page.route('**/api/v1/auth/session', (route) => jsonRoute(route, {
    actor: { id: 'session-test', type: 'session', display_name: 'owner', scopes: ['*'] },
    user: { id: 'user-test', username: 'owner', is_admin: true, is_active: true, has_password: true, created_at: now },
  }))

  await page.route('**/api/v1/preferences', (route) => jsonRoute(route, {
    weight_unit: 'kg',
  }))

  await page.route('**/api/v1/goals', (route) => jsonRoute(route, {
    items: [
      { id: 'goal-1', title: 'Daily calories', category: 'nutrition', metric_key: 'calories', target_value: 2800, unit: 'kcal', period: 'daily' },
      { id: 'goal-2', title: 'Target weight', category: 'bodyweight', metric_key: 'weight_kg', target_value: 80, unit: 'kg', period: 'weekly' },
    ],
    total: 2,
  }))

  await page.route('**/api/v1/api-keys', (route) => jsonRoute(route, {
    items: [
      { id: 'key-1', name: 'Home dashboard', prefix: 'fp_live_home', scopes: ['assistant:use', 'platform:read'] },
      { id: 'key-2', name: 'Shortcut', prefix: 'fp_live_phone', scopes: ['nutrition:*', 'metrics:read'] },
    ],
    total: 2,
  }))

  await page.route('**/api/v1/users', (route) => jsonRoute(route, {
    items: [
      { id: 'user-1', username: 'alice', is_admin: false, has_password: true, created_at: now },
      { id: 'user-2', username: 'coach', is_admin: true, has_password: false, created_at: now },
    ],
    total: 2,
  }))

  await page.route('**/api/v1/exports**', (route) => jsonRoute(route, {
    items: [
      { id: 'export-1', path: 'exports/fitnesspal-2026-03-12.json', created_at: now },
      { id: 'export-2', path: 'exports/fitnesspal-2026-03-11.json', created_at: now },
    ],
    total: 2,
    has_more: false,
    next_cursor: null,
  }))

  await page.route('**/api/v1/jobs**', (route) => jsonRoute(route, {
    items: [
      { id: 'job-1', job_type: 'export.create', status: 'queued', attempts: 1, max_attempts: 3, created_at: now, last_error: null },
      { id: 'job-2', job_type: 'insights.recompute', status: 'running', attempts: 1, max_attempts: 3, created_at: now, last_error: null },
    ],
    total: 2,
    has_more: false,
    next_cursor: null,
  }))

  await page.route('**/api/v1/runtime', (route) => jsonRoute(route, {
    app_name: 'FitnessPal',
    uploads_root: '/storage/uploads',
    exports_root: '/storage/exports',
    api_prefix: '/api/v1',
    ai: {
      profiles: [
        {
          id: 'profile-1',
          name: 'Local Coach',
          provider: 'ollama',
          base_url: 'http://127.0.0.1:11434',
          description: 'Local model',
          default_model: 'llama3.2',
          timeout_seconds: 60,
          is_enabled: true,
          is_read_only: false,
          last_reachable: true,
          has_api_key: false,
          has_custom_headers: false,
          custom_header_keys: [],
          default_headers_json: {},
          advanced_settings_json: {},
        },
      ],
      configured_feature_count: 3,
      legacy_mode: false,
      persona: {
        display_name: 'Coach Nova',
        tagline: 'Lift with clarity',
        system_prompt: 'You are a helpful coach.',
        voice_guidelines_json: {},
      },
    },
    jobs: {
      queued: 2,
      running: 1,
      failed: 0,
    },
  }))

  await page.route('**/api/v1/ai/profiles', (route) => jsonRoute(route, {
    items: [
      {
        id: 'profile-1',
        name: 'Local Coach',
        provider: 'ollama',
        base_url: 'http://127.0.0.1:11434',
        description: 'Local model',
        default_model: 'llama3.2',
        timeout_seconds: 60,
        is_enabled: true,
        is_read_only: false,
        last_reachable: true,
        has_api_key: false,
        has_custom_headers: false,
        custom_header_keys: [],
        default_headers_json: {},
        advanced_settings_json: {},
      },
    ],
    total: 1,
  }))

  await page.route('**/api/v1/ai/features', (route) => jsonRoute(route, {
    items: [
      {
        feature_key: 'assistant.advice',
        profile_id: 'profile-1',
        profile: { id: 'profile-1', name: 'Local Coach' },
        model: 'llama3.2',
        temperature: 0.3,
        top_p: 0.9,
        max_output_tokens: 800,
        system_prompt: null,
        request_overrides_json: {},
        uses_legacy_fallback: false,
      },
      {
        feature_key: 'assistant.brief',
        profile_id: '',
        profile: null,
        model: '',
        temperature: null,
        top_p: null,
        max_output_tokens: null,
        system_prompt: null,
        request_overrides_json: {},
        uses_legacy_fallback: true,
      },
    ],
  }))

  await page.route('**/api/v1/ai/persona', (route) => jsonRoute(route, {
    persona: {
      display_name: 'Coach Nova',
      tagline: 'Lift with clarity',
      system_prompt: 'You are a helpful coach.',
      voice_guidelines_json: {},
    },
  }))
}

test('settings page groups primary controls on desktop', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1400 })
  await installSettingsMocks(page)

  await page.goto('/settings')

  await expect(page.getByRole('heading', { name: 'A cleaner control center for quick mobile edits and calmer desktop management.' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Preferences that affect everyday logging' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Credentials that are easy to manage without feeling risky' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Snapshot' })).toBeVisible()
  await expect(page.getByText('Jump to')).toBeVisible()

  await page.screenshot({ path: testInfo.outputPath('settings-desktop.png'), fullPage: true })
})

test('settings page stays usable on mobile', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installSettingsMocks(page)

  await page.goto('/settings')

  await expect(page.getByText('Jump to')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save preferences' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Generate key' })).toBeVisible()

  await page.getByRole('heading', { name: 'Backups and background work that stay easy to inspect' }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('heading', { name: 'Backups and background work that stay easy to inspect' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create export' })).toBeVisible()

  await page.screenshot({ path: testInfo.outputPath('settings-mobile.png'), fullPage: true })
})
