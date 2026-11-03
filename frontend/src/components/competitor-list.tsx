import type { Competitor } from '@/types'

const HOW: Record<Competitor['countrySource'], string> = {
  structured_data: 'from their site details', phone: 'from their phone numbers', cctld: 'from their web address', text: 'named on their site',
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' })

export function CompetitorList({ competitors }: { competitors: Competitor[] }) {
  if (competitors.length === 0) return null
  return (
    <section className="panel" aria-label="Competitors">
      <h2>Competitors in your markets</h2>
      <ul className="cards">
        {competitors.map((competitor) => (
          <li key={competitor.domain} className="card">
            <a href={`https://${competitor.domain}`} target="_blank" rel="noreferrer"><strong>{competitor.name}</strong></a>
            <span className="hint"> · {regionNames.of(competitor.country) ?? competitor.country} ({HOW[competitor.countrySource]})</span>
            <p>{competitor.reason}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
