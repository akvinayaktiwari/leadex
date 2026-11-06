import { LeadexLogo } from './leadex-logo'

interface Props {
  // Same-page links (e.g. "How it works" on the home page); none on the analysis page.
  links?: { label: string; href: string }[]
}

// RigaChat's floating navbar: a frosted, rounded bar 16 px below the top of the page.
export function SiteHeader({ links = [] }: Props) {
  return (
    <header className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-4">
      <nav aria-label="Main" className="flex w-full max-w-6xl items-center justify-between rounded-2xl border border-black/6 bg-white/80 px-5 py-3 shadow-lg shadow-black/4 backdrop-blur-xl">
        <a href="/" aria-label="Leadex">
          <LeadexLogo />
        </a>
        <div className="flex items-center gap-6">
          {links.map((link) => (
            <a key={link.href} href={link.href} className="text-sm font-medium text-gray-500 transition-colors hover:text-gray-900">
              {link.label}
            </a>
          ))}
        </div>
      </nav>
    </header>
  )
}
