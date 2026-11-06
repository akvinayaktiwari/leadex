import { ExternalLink } from 'lucide-react'
import type { Competitor } from '@/types'
import { CARD } from './ui/styles'

const HOW: Record<Competitor['countrySource'], string> = {
  structured_data: 'from their site details', phone: 'from their phone numbers', cctld: 'from their web address', text: 'named on their site',
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' })

export function CompetitorList({ competitors }: { competitors: Competitor[] }) {
  if (competitors.length === 0) return null
  return (
    <section className={CARD} aria-label="Competitors">
      <h2 className="mb-4 text-xl font-bold text-gray-900">Competitors in your markets</h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {competitors.map((competitor) => (
          <li key={competitor.domain} className="rounded-xl border border-gray-100 bg-gray-50/60 p-4">
            <a href={`https://${competitor.domain}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-semibold text-gray-900 hover:text-violet-700">
              <strong>{competitor.name}</strong>
              <ExternalLink className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
            </a>
            <p className="mt-0.5 text-xs text-gray-500">{regionNames.of(competitor.country) ?? competitor.country} ({HOW[competitor.countrySource]})</p>
            <p className="mt-2 text-sm text-gray-700">{competitor.reason}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
