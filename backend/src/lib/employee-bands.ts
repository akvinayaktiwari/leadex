import type { EmployeeBand } from '../types/index.js'

const BANDS: { band: EmployeeBand; min: number; max: number }[] = [
  { band: '1-10', min: 1, max: 10 },
  { band: '11-50', min: 11, max: 50 },
  { band: '51-200', min: 51, max: 200 },
  { band: '201-500', min: 201, max: 500 },
  { band: '501-1000', min: 501, max: 1000 },
  { band: '1001-5000', min: 1001, max: 5000 },
  { band: '5001+', min: 5001, max: Number.POSITIVE_INFINITY },
]

// Bands that overlap [min, max]. A max of 0 or less means "no size constraint" and returns [].
export function employeeBandsBetween(min: number, max: number): EmployeeBand[] {
  if (max <= 0) return []
  const low = Math.max(0, min)
  return BANDS.filter((entry) => entry.min <= max && entry.max >= low).map((entry) => entry.band)
}

export function employeeBandFor(count: number): EmployeeBand | undefined {
  if (!Number.isFinite(count) || count < 1) return undefined
  return BANDS.find((entry) => count >= entry.min && count <= entry.max)?.band
}
