import { load } from 'cheerio'

export interface ExtractedPage {
  title: string
  description: string
  text: string
  // Absolute http(s) URLs in document order, navigation links first.
  links: string[]
}

const NON_CONTENT = 'script, style, noscript, svg, template, iframe, canvas'

const collapse = (value: string): string => value.replace(/\s+/g, ' ').trim()

function absoluteLinks(hrefs: string[], pageUrl: string): string[] {
  const seen = new Set<string>()
  const links: string[] = []
  for (const href of hrefs) {
    if (!URL.canParse(href, pageUrl)) continue
    const url = new URL(href, pageUrl)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue
    url.hash = ''
    if (seen.has(url.href)) continue
    seen.add(url.href)
    links.push(url.href)
  }
  return links
}

export function extractPage(html: string, pageUrl: string): ExtractedPage {
  const $ = load(html)
  const meta = (selector: string): string => collapse($(selector).first().attr('content') ?? '')
  const title = collapse($('title').first().text()) || meta('meta[property="og:title"]')
  const description = meta('meta[name="description"]') || meta('meta[property="og:description"]')
  const hrefsIn = (selector: string): string[] => $(selector).map((_, el) => $(el).attr('href') ?? '').get()
  const links = absoluteLinks([...hrefsIn('nav a[href], header a[href]'), ...hrefsIn('a[href]')], pageUrl)
  $(NON_CONTENT).remove()
  // Pad every element so adjacent blocks don't fuse into one word ("PricingAbout").
  $('body *').each((_, el) => {
    $(el).append(' ')
  })
  return { title, description, text: collapse($('body').text()), links }
}
