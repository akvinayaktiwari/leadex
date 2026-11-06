import type { Metadata } from 'next'
import { Inter, Plus_Jakarta_Sans } from 'next/font/google'
import type { ReactNode } from 'react'
import './globals.css'

// RigaChat's fonts: Inter for body text, Plus Jakarta Sans for headings. next/font serves them from this site at build
// time, so visitors' browsers never call Google.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['500', '600', '700', '800'], variable: '--font-jakarta', display: 'swap' })

export const metadata: Metadata = {
  title: 'Leadex',
  description: 'Paste your website. Get buyers who fit, with verified emails and drafts ready to send.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jakarta.variable}`}>
      <body>{children}</body>
    </html>
  )
}
