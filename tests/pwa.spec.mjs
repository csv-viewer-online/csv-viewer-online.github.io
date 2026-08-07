import { test, expect } from '@playwright/test'

test('the manifest is served, parses, and declares what installation needs', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest')
  expect(res.status()).toBe(200)
  // Served as octet-stream the browser rejects it and the install prompt
  // never appears, with nothing in the console to say why.
  expect(res.headers()['content-type']).toContain('application/manifest+json')

  const m = JSON.parse(await res.text())
  expect(m.name).toBe('CSV Viewer & Editor Online')
  expect(m.short_name).toBe('CSV Viewer')
  expect(m.start_url).toBe('/')
  expect(m.scope).toBe('/')
  expect(m.display).toBe('standalone')
  expect(m.theme_color).toBe('#126BCF')
  expect(m.background_color).toBe('#126BCF')

  expect(m.icons).toHaveLength(3)
  expect(m.icons.some((i) => i.purpose === 'maskable'), 'Android needs a maskable icon').toBe(true)
  expect(m.file_handlers[0].accept['text/csv']).toContain('.csv')
})

test('every icon the manifest declares is served at the size it claims', async ({ page }) => {
  await page.goto('/')
  const declared = await page.evaluate(async () => {
    const href = document.querySelector('link[rel=manifest]').href
    return (await (await fetch(href)).json()).icons.map((i) => ({ src: i.src, sizes: i.sizes }))
  })
  expect(declared.length).toBe(3)

  for (const icon of declared) {
    // A manifest that names a missing icon still parses, so the install
    // prompt appears and the icon silently falls back to a screenshot.
    const real = await page.evaluate(async (src) => {
      const res = await fetch(src)
      if (!res.ok) return `HTTP ${res.status}`
      const bmp = await createImageBitmap(await res.blob())
      return `${bmp.width}x${bmp.height}`
    }, icon.src)
    expect(real, `${icon.src} must exist at ${icon.sizes}`).toBe(icon.sizes)
  }
})

test('the head links the manifest, theme colour and apple touch icon', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('link[rel=manifest]')).toHaveAttribute('href', '/manifest.webmanifest')
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#126BCF')
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/icons/apple-touch-180.png')
})
