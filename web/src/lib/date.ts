function pad(value: number) {
  return String(value).padStart(2, '0')
}

function parseDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) {
    throw new Error(`Invalid date key: ${value}`)
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  return { year, month, day }
}

function toUtcDate(value: string) {
  const { year, month, day } = parseDateKey(value)
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
}

function formatDateParts(date: Date, timeZone?: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = formatter.formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970'
  const month = parts.find((part) => part.type === 'month')?.value ?? '01'
  const day = parts.find((part) => part.type === 'day')?.value ?? '01'
  return `${year}-${month}-${day}`
}

export function getTodayDateKey(timeZone?: string) {
  return formatDateParts(new Date(), timeZone)
}

export function addDays(dateKey: string, amount: number) {
  const { year, month, day } = parseDateKey(dateKey)
  const next = new Date(Date.UTC(year, month - 1, day + amount, 12, 0, 0))
  return formatDateParts(next, 'UTC')
}

export function addMonthsClamped(dateKey: string, amount: number) {
  const { year, month, day } = parseDateKey(dateKey)
  const targetMonthIndex = (month - 1) + amount
  const nextYear = year + Math.floor(targetMonthIndex / 12)
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12
  const nextMonth = normalizedMonthIndex + 1
  const maxDay = new Date(Date.UTC(nextYear, nextMonth, 0, 12, 0, 0)).getUTCDate()
  return `${nextYear}-${pad(nextMonth)}-${pad(Math.min(day, maxDay))}`
}

export function isSameMonth(left: string, right: string) {
  return left.slice(0, 7) === right.slice(0, 7)
}

export function formatMonthLabel(dateKey: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(toUtcDate(dateKey))
}

export function formatWeekdayLabel(dateKey: string, format: 'short' | 'long' = 'short') {
  return new Intl.DateTimeFormat('en-US', {
    weekday: format,
    timeZone: 'UTC',
  }).format(toUtcDate(dateKey))
}

export function formatLongDateLabel(dateKey: string) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(toUtcDate(dateKey))
}

export function getDayOfMonth(dateKey: string) {
  return parseDateKey(dateKey).day
}

export function createDateTimeInputValue(dateKey: string, fallbackTime: string, todayDateKey: string) {
  if (dateKey === todayDateKey) {
    const now = new Date()
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`
  }
  return `${dateKey}T${fallbackTime}`
}

export function toLocalDateTimeInputValue(value: string | null | undefined) {
  if (!value) {
    return ''
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return ''
  }

  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
}

export function toIsoFromDateTimeInput(value: string | null | undefined) {
  if (!value) {
    return undefined
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
}
