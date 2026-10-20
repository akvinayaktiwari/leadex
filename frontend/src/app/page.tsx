import { ApiStatus } from '@/components/api-status'
import { WebsiteForm } from '@/components/website-form'

export default function HomePage() {
  return (
    <main className="home">
      <p className="eyebrow">Leadex</p>
      <h1>Paste your website. Get buyers who fit.</h1>
      <p className="lede">
        We read your site, work out who buys from you, and find those people with verified emails and a
        first draft for each.
      </p>
      <WebsiteForm />
      <ApiStatus />
    </main>
  )
}
