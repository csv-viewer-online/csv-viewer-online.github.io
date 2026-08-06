// Minimal static server for the test run and for local preview.
// Deliberately dependency-free: the site has no build step and no runtime deps.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
// Matches playwright.config.mjs, and deliberately not a common dev-server
// default (3000/4173/5173/8080) — sharing one risks talking to another project.
const PORT = Number(process.env.PORT || 4319)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8'
}

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  // normalize() collapses ../ so requests cannot escape the site root
  const rel = normalize(path).replace(/^(\.\.[/\\])+/, '')
  const file = join(ROOT, rel.endsWith('/') ? rel + 'index.html' : rel)

  try {
    const body = await readFile(file)
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      // Always fresh, so a reload always reflects the working tree
      'Cache-Control': 'no-store, must-revalidate'
    })
    res.end(body)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('404')
  }
}).listen(PORT, () => {
  console.log(`serving ${ROOT} on http://localhost:${PORT}/`)
})
