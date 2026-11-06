import { FileSearch, ListChecks, MailCheck } from 'lucide-react'
import { ApiStatus } from '@/components/api-status'
import { SiteFooter } from '@/components/ui/site-footer'
import { SiteHeader } from '@/components/ui/site-header'
import { CARD, SECTION_LABEL } from '@/components/ui/styles'
import { WebsiteForm } from '@/components/website-form'

// Facts about how Leadex works, not claims about customers.
const FACTS = ['Reads your own website', 'A source for every claim', 'Only verified emails']

const STEPS = [
  { icon: FileSearch, title: 'Paste your website', text: 'We read your public pages and work out what you sell, linking each claim to the page it came from.' },
  { icon: ListChecks, title: 'See who buys from you', text: 'Competitors in your markets and the buyer groups that fit, each with its share and who decides.' },
  { icon: MailCheck, title: 'Build leads', text: 'Pick groups and get people at those companies with verified emails and a first draft each. Opens with accounts.' },
]

function Hero() {
  return (
    <section className="relative overflow-hidden px-4 pt-36 pb-20">
      {/* RigaChat's hero glow (design.md "Background Patterns"). */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -top-24 -left-24 h-96 w-96 rounded-full bg-violet-200/30 blur-3xl" />
        <div className="absolute -top-16 right-0 h-80 w-80 rounded-full bg-pink-200/25 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-sky-200/20 blur-3xl" />
      </div>
      <div className="relative mx-auto max-w-3xl text-center">
        <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-violet-100 bg-violet-50 px-3.5 py-1.5 text-xs font-semibold text-violet-700">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-violet-500" />
          Free website analysis
        </span>
        <h1 className="mb-6 text-5xl font-extrabold leading-[1.1] tracking-tight text-gray-900 sm:text-6xl">
          Paste your website.{' '}
          <span className="bg-linear-to-r from-violet-600 to-purple-500 bg-clip-text text-transparent">Get buyers who fit.</span>
        </h1>
        <p className="mx-auto mb-10 max-w-xl text-lg leading-relaxed text-gray-500">
          We read your site, work out who buys from you, and find those people with verified emails and a first draft for each.
        </p>
        <div className={`${CARD} mx-auto max-w-xl text-left shadow-2xl shadow-violet-100/60`}>
          <WebsiteForm />
        </div>
        <ul className="mt-8 flex flex-wrap justify-center gap-2">
          {FACTS.map((fact) => (
            <li key={fact} className="rounded-full border border-gray-200 bg-white/70 px-3 py-1 text-xs font-semibold text-gray-600">{fact}</li>
          ))}
        </ul>
        {/* A health check for local development; visitors never need it. */}
        {process.env.NODE_ENV === 'development' ? <ApiStatus /> : null}
      </div>
    </section>
  )
}

function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-28 px-4 py-24">
      <div className="mx-auto max-w-6xl">
        <p className={`${SECTION_LABEL} mb-3 text-center`}>How it works</p>
        <h2 className="mb-14 text-center text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl">From your website to your buyers</h2>
        <ol className="grid grid-cols-1 gap-8 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className={CARD}>
              <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-linear-to-br from-violet-600 to-purple-500 text-white shadow-lg shadow-violet-200/60" aria-hidden="true">
                <step.icon className="h-5 w-5" />
              </span>
              <h3 className="mb-2 text-lg font-bold text-gray-900">{index + 1}. {step.title}</h3>
              <p className="text-sm leading-relaxed text-gray-500">{step.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

export default function HomePage() {
  return (
    <>
      <SiteHeader links={[{ label: 'How it works', href: '#how-it-works' }]} />
      <main>
        <Hero />
        <HowItWorks />
      </main>
      <SiteFooter />
    </>
  )
}
