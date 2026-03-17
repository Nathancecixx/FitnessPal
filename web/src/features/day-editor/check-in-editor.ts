import type { CoachCheckIn } from '../../lib/api'

export type CheckInDraft = {
  sleep_hours: string
  readiness_1_5: string
  soreness_1_5: string
  hunger_1_5: string
  note: string
}

export function createCheckInDraft(): CheckInDraft {
  return {
    sleep_hours: '',
    readiness_1_5: '',
    soreness_1_5: '',
    hunger_1_5: '',
    note: '',
  }
}

export function toCheckInDraft(checkIn: CoachCheckIn | null | undefined): CheckInDraft {
  if (!checkIn) {
    return createCheckInDraft()
  }

  return {
    sleep_hours: checkIn.sleep_hours == null ? '' : String(checkIn.sleep_hours),
    readiness_1_5: checkIn.readiness_1_5 == null ? '' : String(checkIn.readiness_1_5),
    soreness_1_5: checkIn.soreness_1_5 == null ? '' : String(checkIn.soreness_1_5),
    hunger_1_5: checkIn.hunger_1_5 == null ? '' : String(checkIn.hunger_1_5),
    note: checkIn.note ?? '',
  }
}

export function getCheckInDraftError(draft: CheckInDraft) {
  return [draft.readiness_1_5, draft.soreness_1_5, draft.hunger_1_5]
    .some((value) => value && (Number(value) < 1 || Number(value) > 5))
    ? 'Readiness, soreness, and hunger must stay between 1 and 5.'
    : ''
}

export function buildCheckInPayload(draft: CheckInDraft, checkInDate?: string) {
  return {
    check_in_date: checkInDate,
    sleep_hours: draft.sleep_hours ? Number(draft.sleep_hours) : null,
    readiness_1_5: draft.readiness_1_5 ? Number(draft.readiness_1_5) : null,
    soreness_1_5: draft.soreness_1_5 ? Number(draft.soreness_1_5) : null,
    hunger_1_5: draft.hunger_1_5 ? Number(draft.hunger_1_5) : null,
    note: draft.note || null,
  }
}
