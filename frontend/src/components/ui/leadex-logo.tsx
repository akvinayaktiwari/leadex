import { Target } from 'lucide-react'

// The RigaChat logo treatment (violet-to-purple tile, rounded-xl, soft violet shadow) with Leadex's own mark.
export function LeadexLogo() {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-linear-to-br from-violet-600 to-purple-500 shadow-md shadow-violet-200" aria-hidden="true">
        <Target className="h-4.5 w-4.5 text-white" strokeWidth={2.5} />
      </span>
      <span className="font-display text-lg font-bold tracking-tight text-gray-900">Leadex</span>
    </span>
  )
}
