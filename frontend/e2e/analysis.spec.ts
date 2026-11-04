import { expect, test } from '@playwright/test'

// protects=#6 done-when: pasting a URL shows the first step within 2 s, all segments render, and a network drop mid-run resumes
// (Last-Event-ID) with no duplicate cards even though the server repeats an event on every resume;
// fails_when=the first step takes longer than 2 s to appear, the page does not reconnect, a card shows twice, the page opens a
// second stream for the same run, or it reconnects to a finished run;
// no_claim=fake backend with scripted events; real model timing (criterion 1, 30 s p50) is measured with the eval fixtures (#15).
test('analysis streams, survives a drop and shows each card once', async ({ page, request }) => {
  await page.goto('/')
  await page.getByLabel('Your website').fill('https://qdnco.com')
  const started = Date.now()
  await page.getByRole('button', { name: 'Find my buyers' }).click()
  await expect(page.getByText('Reading the website')).toBeVisible({ timeout: 2_000 })
  expect(Date.now() - started).toBeLessThan(2_000)
  await expect(page).toHaveURL(/\/analysis\?run=run_e2e&domain=qdnco\.com/)

  for (const name of ['Villa developers', 'Plotted developers', 'Brokerage firms', 'Commercial developers']) {
    await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 10_000 })
  }
  await expect(page.getByText('Xion Media')).toHaveCount(1)
  await expect(page.getByText('Villa developers', { exact: true })).toHaveCount(1)
  await expect(page.getByText('Read 6 pages from qdnco.com')).toHaveCount(1)
  await expect(page.locator('.step')).toHaveCount(4)

  // The form sent the browser's device id (no Turnstile site key in this build, so no token).
  const bodies = (await (await request.get('/__e2e/analysis-bodies')).json()) as { url: string; deviceId?: string }[]
  expect(bodies).toEqual([{ url: 'https://qdnco.com', deviceId: expect.stringMatching(/^[0-9a-f-]{36}$/) }])

  // One stream for the page, resumed by the browser after the drop with Last-Event-ID, and nothing reopened after the end.
  const streamRequests = (await (await request.get('/__e2e/stream-requests')).json()) as { lastEventId?: string; after: string | null }[]
  expect(streamRequests.filter((r) => !r.lastEventId && !r.after)).toHaveLength(1)
  expect(streamRequests.some((r) => r.lastEventId === '8')).toBe(true)
  expect(streamRequests.some((r) => r.after === '16' || r.lastEventId === '16')).toBe(false)
})
