// 自動プレイで1シフト通して、給料の分布を見る。node sim.mjs
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { MUTE_LAUNCH, muteContext } from './mute.mjs'
const PORT = 5481
const server = spawn(process.execPath, ['server.mjs'], { cwd: import.meta.dirname, env: { ...process.env, PORT: String(PORT) } })
await new Promise(r => setTimeout(r, 400))
const b = await chromium.launch(MUTE_LAUNCH), ctx = await b.newContext({ viewport: { width: 844, height: 390 } }); await muteContext(ctx)
const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(`http://localhost:${PORT}/`); await p.waitForFunction(() => window.__izReady && IZ.charsReady, null, { timeout: 15000 })
await p.addScriptTag({ path: 'bot.js' })
for (const [name, o] of [['careful', { vcap: 3.2, heatMax: 1.0 }], ['normal', { vcap: 4.6 }], ['reckless', { vcap: 6.4, heatMax: 2.4 }], ['nolean', { vcap: 4.6, lean: false }], ['nojump', { vcap: 4, jump: false }], ['forgetful', { vcap: 3.5, wrong: 0.3 }], ['multi2', { vcap: 4.6, multi: 2 }], ['multi3', { vcap: 4.6, multi: 3 }]]) {
  for (const seed of (process.env.SEEDS || '1').split(',').map(Number)) {
    const r = await p.evaluate(([o, seed]) => { IZ.dbg.pause(true); IZ.dbg.start(seed); IZ.dbg.pause(true); IZ.S.tut = -1; IZBot.run(60 * 182, o); return { st: IZ.state(), net: IZ.calcResult().net, mode: IZ.S.mode } }, [o, seed])
    console.log(name, seed, 'served', r.st.served, 'falls', r.st.falls, (r.st.fallWhy||[]).join('/'), JSON.stringify(r.st.money), 'mode', r.mode, JSON.stringify(r.st.spillBy, (k, v) => typeof v === 'number' ? +v.toFixed(1) : v), 'net', r.net ?? JSON.stringify(r.st.result))
  }
}
console.log('errors', errs)
await b.close(); server.kill()
