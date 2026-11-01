// Which pages the people extractor reads (#23): the site's own links to team, leadership, about and contact pages.
import type { CrawlOptions } from './pipeline-steps/crawl-step.js'

export const PEOPLE_CRAWL: CrawlOptions = {
  priorityPaths: [
    /team|our-people|people|staff|leadership|management|founders?|meet-|board|directors|partners|attorneys|lawyers|doctors|dentists|physicians|agents|advisors|experts/,
    /about|who-we-are|our-story|story|company|history/,
    /contact/,
  ],
  maxExtraPages: 6,
  maxPagesPerSection: 2,
  onlyMatching: true,
}
