import { MUTE_LAUNCH, muteContext } from './mute.mjs'
// 公開URLの確認。node live.mjs（ログインしていないブラウザで見る）。SKIPGH=1 で GitHub ページの確認を省く
// job-izakaya __NS__ を置き換え、「遊びの通し」をゲームに合わせて書く
import { chromium, webkit } from 'playwright'
const URL0 = 'https://tom3games.github.io/job-izakaya/'
const out = []
for (const [name, bt, opts] of [['chromium', chromium, {}], ['webkit', webkit, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
  const b = await bt.launch(bt === chromium ? MUTE_LAUNCH : {}), ctx = await b.newContext({ locale: 'ja-JP', viewport: { width: 390, height: 844 }, ...opts }), p = await ctx.newPage()
  await muteContext(ctx)
  const errs = []
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
  p.on('requestfailed', r => errs.push('fail ' + r.url()))
  await p.goto(URL0 + '?t=' + Date.now(), { waitUntil: 'networkidle' })
  await p.waitForFunction(() => window.__izReady && IZ.charsReady, null, { timeout: 15000 })
  await p.click('#bStart'); await p.waitForTimeout(400)
  const flow = await p.evaluate(() => { IZ.dbg.pause(true); IZ.dbg.noCalls(); IZ.dbg.noObs(); IZ.S.tut = -1; IZ.dbg.call(0); IZ.dbg.set({ x: IZ.S.tables[0].x }); IZ.dbg.step(5); const o = IZ.S.order && IZ.S.order.list; IZ.dbg.set({ x: 1.3 }); IZ.dbg.step(5); for (const it of o) for (let k = 0; k < it.n; k++) document.querySelector(`.dk[data-id=${it.id}]`).click(); IZ.dbg.set({ x: IZ.S.tables[0].x }); IZ.dbg.step(5); const served = IZ.S.served; IZ.dbg.end(); IZ.dbg.step(200); return { o, served } })
  await p.waitForTimeout(600); await p.evaluate(() => { IZ.dbg.reveal(); IZ.dbg.step(5) })
  const res = await p.evaluate(() => ({ mode: IZ.S.mode, net: IZ.S.result && IZ.S.result.net }))
  out.push(`${name}: flow=${JSON.stringify(flow)} result=${JSON.stringify(res)}`)
  await p.screenshot({ path: `shots/live-${name}.png` })
  const og = await p.evaluate(async () => { const r = await fetch(document.querySelector('meta[property="og:image"]').content); return r.status + ' ' + r.headers.get('content-type') })
  out.push(`${name}: og=${og} errors=${errs.length ? errs.join(' | ') : 'none'}`)
  await b.close()
}
if (process.env.SKIPGH) { console.log(out.join('\n')); process.exit(0) }
// ログアウト状態でリポジトリ・更新履歴に個人のIDが出ていないか
const b = await chromium.launch(MUTE_LAUNCH), p = await b.newPage()
for (const u of ['https://github.com/tom3games/job-izakaya', 'https://github.com/tom3games/job-izakaya/commits/main']) {
  const res = await p.goto(u, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2500)
  out.push(`${u} status=${res.status()} owner-id=${new RegExp(['tmk', '4men'].join(''), 'i').test(await p.content()) ? 'FOUND' : 'none'}`)
}
await b.close()
console.log(out.join('\n'))
