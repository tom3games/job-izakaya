// 手早い撮影: node shot.mjs [w] [h] [scenario]
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { MUTE_LAUNCH, muteContext } from './mute.mjs'
const PORT = 5471, W = +(process.argv[2] || 390), H = +(process.argv[3] || 844), SC = process.argv[4] || 'all'
const server = spawn(process.execPath, ['server.mjs'], { cwd: import.meta.dirname, env: { ...process.env, PORT: String(PORT) } })
await new Promise(r => setTimeout(r, 400))
const b = await chromium.launch(MUTE_LAUNCH), ctx = await b.newContext({ viewport: { width: W, height: H }, locale: 'ja-JP', hasTouch: W < 900, isMobile: W < 900 })
await muteContext(ctx)
const p = await ctx.newPage(); const errs = []
p.on('pageerror', e => errs.push('pageerror ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
await p.goto(`http://localhost:${PORT}/`); await p.waitForFunction(() => window.__izReady && IZ.charsReady, null, { timeout: 15000 })
await p.waitForTimeout(600)
const tag = `${W}x${H}`
await p.screenshot({ path: `shots/s-title-${tag}.png` })
await p.evaluate(() => { IZ.dbg.start(3); IZ.dbg.noCalls(); IZ.dbg.noObs(); IZ.S.tut = -1 })
await p.evaluate(() => { IZ.dbg.call(1); IZ.dbg.set({ x: IZ.S.tables[1].x - 0.2 }); IZ.dbg.step(30) })
await p.screenshot({ path: `shots/s-order-${tag}.png` })
await p.evaluate(() => { IZ.dbg.set({ x: 1.2 }); IZ.dbg.step(20) })
await p.screenshot({ path: `shots/s-counter-${tag}.png` })
await p.evaluate(() => { IZ.dbg.tray(['beer', 'beer', 'beer', 'hb', 'hb', 'oolong', 'beer', 'beer']); IZ.dbg.set({ x: 5, v: 3, dir: 1, keyF: 1 }); IZ.dbg.step(25) })
await p.screenshot({ path: `shots/s-carry-${tag}.png` })
await p.evaluate(() => { IZ.dbg.set({ keyF: 0 }); IZ.dbg.obs('sleep', IZ.S.x + 3.2); IZ.dbg.stand(2); IZ.dbg.set({ x: IZ.S.tables[2].x - 3 }); IZ.dbg.step(40) })
await p.screenshot({ path: `shots/s-obs-${tag}.png` })
await p.evaluate(() => { IZ.dbg.set({ x: IZ.S.tables[2].x - 5.5, keyF: 1 }); IZ.dbg.step(20) })
await p.evaluate(() => { IZ.dbg.fall(); IZ.dbg.step(30) })
await p.screenshot({ path: `shots/s-fall-${tag}.png` })
await p.evaluate(() => { IZ.dbg.set({ keyF: 0 }); IZ.dbg.end(); IZ.dbg.step(200) })
await p.waitForTimeout(300); await p.evaluate(() => { IZ.dbg.reveal(); IZ.dbg.step(30) })
await p.screenshot({ path: `shots/s-result-${tag}.png` })
console.log(JSON.stringify(await p.evaluate(() => IZ.state())).slice(0, 600))
console.log('errors', errs)
await b.close(); server.kill()
