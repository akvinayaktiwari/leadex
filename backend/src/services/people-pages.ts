// Which pages the people extractor reads (#23): the site's own links to team, leadership, about and contact pages.
import type { CrawlOptions } from './pipeline-steps/crawl-step.js'

// Matches a whole path segment (optionally with a file extension), so "/company-news" or "/about-our-products" are not
// people pages but "/about", "/our-team/" and "/meet-the-team" are.
function segment(words: string): RegExp {
  return new RegExp(`(^|/)(${words})(\\.[a-z]+)?(/|$)`)
}

export const PEOPLE_CRAWL: CrawlOptions = {
  priorityPaths: [
    segment('team|our-team|the-team|meet-the-team|meet-our-team|meet-us|our-people|people|staff|leadership|leadership-team|management|management-team|founders?|board|directors|partners|our-partners|attorneys|lawyers|doctors|our-doctors|dentists|physicians|agents|advisors|experts|meet-the-[a-z-]+'),
    segment('about|about-us|aboutus|who-we-are|our-story|story|company|history'),
    segment('contact|contact-us|contactus'),
  ],
  maxExtraPages: 6,
  maxPagesPerSection: 2,
  onlyMatching: true,
}
