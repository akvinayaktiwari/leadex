import { LeadexLogo } from './leadex-logo'

export function SiteFooter() {
  return (
    <footer className="border-t border-gray-100 px-4 py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <LeadexLogo />
        <p className="text-sm text-gray-500">Buyers from your own website, with a source for every claim.</p>
        <p className="text-xs text-gray-400">© {new Date().getFullYear()} Leadex</p>
      </div>
    </footer>
  )
}
