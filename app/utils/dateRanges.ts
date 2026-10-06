/** Calendar-based period helpers (local timezone). */

export type Timeframe = 'day' | 'week' | 'month' | 'custom'

/** Start of today at local midnight. */
export function startOfDay(date: Date = new Date()): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

/** End of the day at 23:59:59. */
export function endOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}

/** Start of the week (Monday) at local midnight. */
export function startOfWeek(date: Date = new Date()): Date {
  const d = startOfDay(date)
  const day = d.getDay() // 0 Sun … 6 Sat
  const daysFromMonday = day === 0 ? 6 : day - 1
  d.setDate(d.getDate() - daysFromMonday)
  return d
}

/** Start of the calendar month at local midnight. */
export function startOfMonth(date: Date = new Date()): Date {
  const d = startOfDay(date)
  d.setDate(1)
  return d
}

/** Shift a date by a certain number of timeframes (e.g. -1 day/week/month). */
export function shiftDate(date: Date, timeframe: Timeframe, offset: number): Date {
  if (offset === 0 || timeframe === 'custom') return date
  const d = new Date(date)
  if (timeframe === 'day') {
    d.setDate(d.getDate() + offset)
  } else if (timeframe === 'week') {
    d.setDate(d.getDate() + offset * 7)
  } else if (timeframe === 'month') {
    d.setMonth(d.getMonth() + offset)
  }
  return d
}

export function getPeriodBounds(
  timeframe: Timeframe, 
  referenceDate: Date = new Date(),
  customStart?: Date,
  customEnd?: Date
): { start: Date; end: Date } {
  if (timeframe === 'custom' && customStart && customEnd) {
    return { start: startOfDay(customStart), end: endOfDay(customEnd) }
  }

  if (timeframe === 'day') {
    return { start: startOfDay(referenceDate), end: endOfDay(referenceDate) }
  }
  
  if (timeframe === 'week') {
    const start = startOfWeek(referenceDate)
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    return { start, end: endOfDay(end) }
  }
  
  // month
  const start = startOfMonth(referenceDate)
  const end = new Date(start)
  end.setMonth(end.getMonth() + 1)
  end.setDate(0) // last day of current month
  return { start, end: endOfDay(end) }
}

/** Previous period of the exact same length (meaning offset by -1). */
export function getPreviousPeriodBounds(
  timeframe: Timeframe, 
  referenceDate: Date = new Date(),
  customStart?: Date,
  customEnd?: Date
): { start: Date; end: Date } {
  if (timeframe === 'custom' && customStart && customEnd) {
    // Exact same duration offset backward
    const duration = customEnd.getTime() - customStart.getTime()
    const start = new Date(startOfDay(customStart).getTime() - duration - 86400000) // Rough approximation, moving back by duration + 1 day
    return { start: startOfDay(start), end: endOfDay(new Date(start.getTime() + duration)) }
  }

  const prevRef = shiftDate(referenceDate, timeframe, -1)
  return getPeriodBounds(timeframe, prevRef)
}

export function isInRange(dateIso: string, start: Date, end: Date): boolean {
  const t = new Date(dateIso).getTime()
  return t >= start.getTime() && t <= end.getTime()
}

/** Local YYYY-MM-DD key for grouping sales by calendar day. */
export function dayKey(dateIso: string): string {
  const d = new Date(dateIso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function formatDayLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}
