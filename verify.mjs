import './mute-auto.mjs'  // テスト中は絶対に音を出さない（playwright を無音に差し替え）
import { MUTE_LAUNCH, muteContext } from './mute.mjs'
// verify.mjs の共通部品。コピーして iz を置き換え、ゲーム固有のテストを足す。node verify.mjs
import { chromium, webkit } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
const ROOT = import.meta.dirname
mkdirSync(ROOT + '/shots', { recursive: true })
const PORT = 5474
const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) } })
await new Promise(r => setTimeout(r, 400))
const URL0 = `http://localhost:${PORT}/`
let pass = 0, fail = 0
const results = []
// テストは必ず await する（しないと例外が素通りして全部 pass になる）
async function t(name, fn) {
  try { const r = await fn(); if (r === false) throw new Error('false'); pass++; results.push(`ok   ${name}${r && r !== true ? '  ' + JSON.stringify(r) : ''}`) }
  catch (e) { fail++; results.push(`FAIL ${name}  ${e.message.split('\n')[0]}`) }
}
const expect = (c, msg) => { if (!c) throw new Error(msg) }
// 日本語ロケール固定・エラー収集つきでページを開く
async function open(browser, opts = {}) {
  const ctx = await browser.newContext({ locale: 'ja-JP', viewport: { width: 390, height: 844 }, ...opts })
  await muteContext(ctx)
  await ctx.addInitScript(() => { try { localStorage.clear() } catch (e) {} })
  const p = await ctx.newPage(); p.errs = []
  p.on('pageerror', e => p.errs.push('pageerror ' + e.message))
  p.on('console', m => { if (m.type() === 'error') p.errs.push('console ' + m.text()) })
  p.on('requestfailed', r => { if (!/fonts\.(googleapis|gstatic)|job-traffic\/og\.png/.test(r.url())) p.errs.push('reqfail ' + r.url()) })
  await p.goto(URL0); await p.waitForFunction(() => window.__izReady && IZ.charsReady, null, { timeout: 15000 })
  return p
}
// 横のはみ出し
const overflow = p => p.evaluate(() => {
  const W = document.documentElement.clientWidth, bad = []
  for (const el of document.querySelectorAll('main:not([hidden]) *')) {
    if (el.closest('[hidden]') || (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true }))) continue
    const r = el.getBoundingClientRect(); if (r.width && (r.right > W + 1 || r.left < -1)) bad.push((el.id || el.className || el.tagName) + ':' + Math.round(r.left) + '-' + Math.round(r.right))
  }
  return { sw: document.documentElement.scrollWidth, W, bad: bad.slice(0, 5) }
})
// 一画面に収まる（縦スクロール不要・ボタンが画面内）
const fit = q => q.evaluate(() => {
  const H = innerHeight, de = document.documentElement, over = []
  if (de.scrollHeight > H + 1) over.push('page:' + de.scrollHeight)
  for (const el of document.querySelectorAll('main:not([hidden]) button,main:not([hidden]) canvas')) { if (!el.offsetParent) continue; const r = el.getBoundingClientRect(); if (r.bottom > H + 1 || r.top < -1) over.push((el.id || el.className) + ':' + Math.round(r.top) + '-' + Math.round(r.bottom)) }
  return { H, over: over.slice(0, 6) }
})
// 描画の輝度の散らばり（ほぼ単色＝何も描けていない）
const variance = (p, sel) => p.evaluate(sel => {
  const c = document.querySelector(sel), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  let s = 0, s2 = 0, n = 0; for (let i = 0; i < d.length; i += 4 * 13) { const v = d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11; s += v; s2 += v * v; n++ }
  return Math.round(s2 / n - (s / n) ** 2)
}, sel)
// スマホ縦だけ（横持ち・PC は本人が言った時だけ。2026-11-03）
const SIZES = [[360, 640, 'small'], [390, 844, 'phone'], [430, 932, 'large']]

const browser = await chromium.launch(MUTE_LAUNCH)
const p = await open(browser)
await t('起動時にエラーが出ない', async () => { expect(p.errs.length === 0, p.errs.join('|')) })
await t('ブラウザの拡大が起きない（viewport・ピンチ・Ctrl+ホイール・Ctrl+プラス）', async () => {
  const r = await p.evaluate(() => {
    const vp = document.querySelector('meta[name=viewport]').content
    const g = new Event('gesturestart', { cancelable: true }); document.dispatchEvent(g)
    const w = new WheelEvent('wheel', { ctrlKey: true, deltaY: -10, bubbles: true, cancelable: true }); window.dispatchEvent(w)
    const k = new KeyboardEvent('keydown', { key: '+', ctrlKey: true, bubbles: true, cancelable: true }); window.dispatchEvent(k)
    return { vp, gesture: g.defaultPrevented, wheel: w.defaultPrevented, key: k.defaultPrevented, ta: getComputedStyle(document.documentElement).touchAction, us: getComputedStyle(document.body).userSelect }
  })
  expect(/user-scalable=no/.test(r.vp) && r.gesture && r.wheel && r.key && r.ta === 'manipulation' && r.us === 'none', JSON.stringify(r)); return r
})
await t('OGP 一式がある', async () => {
  const r = await p.evaluate(() => ['og:title', 'og:description', 'og:image', 'og:url', 'og:type'].map(k => !!document.querySelector(`meta[property="${k}"]`)).concat(!!document.querySelector('meta[name="twitter:card"]')))
  expect(r.every(Boolean), JSON.stringify(r))
})


const ev = (q, f, a) => q.evaluate(f, a)
await t('タイトル: 文言と店長が出ている', async () => { const r = await ev(p, () => ({ logo: document.querySelector('.logo .main').textContent, lead: document.querySelector('[data-t=lead]').textContent })); expect(r.logo.includes('居酒屋') && r.lead.includes('一輪車'), JSON.stringify(r)); return r })
await t('HUD にゲージ（バー・メーター）が無い', async () => { const n = await ev(p, () => document.querySelectorAll('progress,meter,[class*=bar],[class*=gauge],[class*=meter]').length); expect(n === 0, n) })
await t('出勤: 遊ぶ画面・操作ボタン・時計', async () => { await p.click('#bStart'); await p.waitForTimeout(300); const r = await ev(p, () => ({ mode: IZ.S.mode, play: !document.querySelector('#vPlay').hidden, clock: document.querySelector('#hClock').textContent, btn: ['#bFwd', '#bBack', '#bJump', '#bTurn'].every(s => document.querySelector(s).getBoundingClientRect().width >= 44) })); expect(r.mode === 'play' && r.play && r.btn, JSON.stringify(r)); return r })
await t('初回のチュートリアル: 呼ばれた席へ の案内', async () => { await ev(p, () => { IZ.dbg.pause(true); IZ.dbg.step(120) }); const r = await ev(p, () => ({ hint: document.querySelector('#hint').textContent, hid: document.querySelector('#hint').hidden, call: IZ.S.tables.findIndex(t => t.st === 'call') })); expect(!r.hid && r.call >= 0 && /こぐ/.test(r.hint), JSON.stringify(r)); return r })
const down = (q, sel) => q.evaluate(sel => document.querySelector(sel).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1 })), sel)
await t('こぐは押している間だけ進み、離すと止まっていく', async () => {
  await ev(p, () => { IZ.dbg.noObs(); IZ.dbg.clearObs(); IZ.dbg.set({ x: 3, v: 0, dir: 1, heat: 0, th: 0, om: 0 }) })
  await p.evaluate(() => document.querySelector('#bFwd').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1 })))
  const r = await ev(p, () => { const x0 = IZ.S.x; IZ.dbg.step(60); return { x0, x1: IZ.S.x, on: IZ.S.inF, lit: document.querySelector('#bFwd').classList.contains('on') } })
  await p.evaluate(() => document.querySelector('#bFwd').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1 })))
  const r2 = await ev(p, () => { IZ.dbg.step(200); return { on: IZ.S.inF, v: IZ.S.v } })
  expect(r.x1 > r.x0 + 1.5 && r.on && r.lit && !r2.on && Math.abs(r2.v) < 0.1, JSON.stringify([r, r2])); return [r, r2] })
await t('うしろ: 走っている時はブレーキ、止まってから押し続けるとゆっくり下がる', async () => {
  const r = await ev(p, () => { IZ.dbg.set({ x: 10, v: 4, dir: 1, heat: 0, th: 0, om: 0, inB: 1 }); IZ.dbg.step(40); const a = { v: IZ.S.v, x: IZ.S.x }; IZ.dbg.step(90); const b = { v: IZ.S.v, x: IZ.S.x, dir: IZ.S.dir }; IZ.S.inB = 0; IZ.dbg.step(60); return { a, b, v2: IZ.S.v } })
  expect(Math.abs(r.a.v) < 0.5 && r.b.v < -1 && r.b.v >= -1.81 && r.b.x < r.a.x && r.b.dir === 1 && Math.abs(r.v2) < 0.1, JSON.stringify(r)); return r })
await t('こぎっぱなしだと後ろへ傾き、離すと戻る。こぎ続けると後ろに転ぶ', async () => {
  const r = await ev(p, () => {
    IZ.dbg.clearObs(); IZ.S.obs.length = 0; IZ.dbg.set({ x: 2, v: 0, dir: 1, heat: 0, th: 0, om: 0, keyF: 1, falls: 0, fallWhy: [] }); IZ.dbg.step(300); const a = IZ.S.th
    IZ.S.keyF = 0; IZ.dbg.step(150); const b = IZ.S.th
    IZ.S.obs.length = 0; IZ.dbg.set({ x: 2, v: 0, heat: 0, th: 0, om: 0, keyF: 1 }); let n = 0; for (; n < 60 * 14 && !IZ.S.falls; n += 10) IZ.dbg.step(10); IZ.S.keyF = 0; const f = IZ.S.falls, sec = n / 60; IZ.dbg.step(130)
    return { lean2s: a, after: b, falls: f, why: IZ.S.fallWhy, sec }
  })
  expect(r.lean2s < -0.15 && r.after > -0.08 && r.falls === 1, JSON.stringify(r)); return r })
await t('Uターン: 速いときは止まってから向きを変える', async () => {
  const r = await ev(p, () => { IZ.dbg.set({ x: 10, v: 4, dir: 1, heat: 0, th: 0, om: 0 }); IZ.S.turnQ = 1; IZ.dbg.step(2); const mid = IZ.S.dir; IZ.dbg.step(60); return { mid, dir: IZ.S.dir, v: IZ.S.v, x: IZ.S.x } })
  expect(r.mid === 1 && r.dir === -1 && Math.abs(r.v) < 0.1, JSON.stringify(r)); return r })
await t('呼ばれた席で止まると注文が出て、一瞬で消える', async () => {
  const r = await ev(p, () => { IZ.dbg.noCalls(); IZ.dbg.noObs(); if (IZ.S.order) { IZ.S.order.t.st = 'idle'; IZ.S.order = null } let t = IZ.S.tables.find(t => t.st === 'call'); if (!t) { IZ.dbg.call(2); t = IZ.S.tables[2] } IZ.dbg.set({ x: t.x - 0.3, v: 0 }); IZ.dbg.step(3); const a = { order: IZ.S.order && IZ.S.order.list, bub: !!document.querySelector('#fx .sb.order') }; IZ.dbg.step(60 * 6); const after = !!document.querySelector('#fx .sb.order')
    IZ.dbg.set({ x: t.x + 4 }); IZ.dbg.step(3); IZ.dbg.set({ x: t.x - 0.2 }); IZ.dbg.step(3); const again = document.querySelector('#fx .sb.order'); IZ.dbg.step(60 * 4)
    return { ...a, after, again: again && again.textContent, asked: IZ.S.order.asked, first: JSON.stringify(a.order) } })
  expect(r.order && r.bub && !r.after && /さっき/.test(r.again) && r.asked === 2 && r.first === '[{"id":"beer","n":2}]', JSON.stringify(r)); return r })
await t('カウンター: 注文中に戻るとトレーの画面が出て、押すとグラスが乗る', async () => {
  await ev(p, () => { IZ.dbg.set({ x: 1.3, v: 0 }); IZ.dbg.step(5) })
  const vis = await ev(p, () => !document.querySelector('#counter').hidden)
  await p.click('.dk[data-id=beer]'); await p.click('.dk[data-id=beer]')
  const r = await ev(p, vis => ({ vis, tray: IZ.S.tray.map(c => c.id), badge: document.querySelector('.dk[data-id=beer] i').textContent, n: document.querySelector('#trayN').textContent }), vis)
  expect(r.vis && r.tray.length === 2 && r.badge === '2', JSON.stringify(r)); return r })
await t('やり直しでトレーが空になる', async () => { await p.click('.dk[data-id=clear]'); const n = await ev(p, () => IZ.S.tray.length); expect(n === 0, n); await p.click('.dk[data-id=beer]'); await p.click('.dk[data-id=beer]') })
await t('正しく運ぶと乾杯・杯数手当', async () => { const r = await ev(p, () => { const t = IZ.S.order.t; IZ.dbg.set({ x: t.x - 0.2, v: 0 }); IZ.dbg.step(30); return { served: IZ.S.served, m: IZ.S.money, tray: IZ.S.tray.length, st: t.st, tut: IZ.S.tut } }); expect(r.served === 1 && r.m.cups === 2 && r.m.wrong === 0 && r.tray === 0 && r.tut === -1, JSON.stringify(r)); return r })
await t('そろっていない注文は渡さず「まだ全部そろってへんで」（怒らない・減らさない）。そろえて渡すと、誰も頼んでない余りだけ注文間違い', async () => { const r = await ev(p, () => {
  IZ.dbg.order(3, [{ id: 'beer', n: 2 }, { id: 'hb', n: 1 }]); IZ.dbg.tray(['beer', 'oolong', 'oolong']); IZ.dbg.set({ x: IZ.S.tables[3].x, v: 0 }); IZ.dbg.step(30)
  const a = { wrong: IZ.S.money.wrong, tray: IZ.S.tray.length, bub: [...document.querySelectorAll('#fx .sb')].map(e => e.textContent).join('|') }
  IZ.dbg.tray(['beer', 'beer', 'hb', 'oolong']); IZ.dbg.step(30)
  return { a, wrong: IZ.S.money.wrong, tray: IZ.S.tray.length } })
  expect(r.a.wrong === 0 && r.a.tray === 3 && /そろってへん/.test(r.a.bub) && r.wrong === 1 && r.tray === 0, JSON.stringify(r)); return r })
await t('通り過ぎるだけでは渡さない・怒られない（運んでいる時は、ちゃんと止まった時だけ）', async () => { const r = await ev(p, () => {
  IZ.dbg.noCalls(); IZ.dbg.noObs(); IZ.dbg.clearObs(); IZ.S.tables.forEach(t => { t.st = 'idle' }); IZ.S.orders.length = 0
  const m0 = { ...IZ.S.money }, x4 = IZ.S.tables[4].x
  IZ.dbg.order(4, [{ id: 'beer', n: 1 }], true); IZ.dbg.order(6, [{ id: 'hb', n: 1 }], true); IZ.dbg.tray(['beer', 'hb'])
  IZ.dbg.set({ x: x4 - 3, v: 1.2, dir: 1, keyF: 0 }); for (let i = 0; i < 300 && IZ.S.x < x4 + 2; i++) { IZ.S.v = Math.max(IZ.S.v, 1.2); IZ.dbg.step(1) }
  const r = { tray: IZ.S.tray.length, orders: IZ.S.orders.length, wrong: IZ.S.money.wrong - m0.wrong, cups: IZ.S.money.cups - m0.cups }
  IZ.dbg.tray([]); IZ.S.orders.length = 0; IZ.S.tables.forEach(t => { t.st = 'idle' }); return r })
  expect(r.tray === 2 && r.orders === 2 && r.wrong === 0 && r.cups === 0, JSON.stringify(r)); return r })
await t('注文は3席まで同時に持てる。席ごとに自分の分だけ降ろし、よその分は「それうちのちゃう」', async () => {
  const r = await ev(p, () => {
    IZ.dbg.noCalls(); IZ.dbg.noObs(); IZ.dbg.clearObs(); IZ.S.tables.forEach(t => { t.st = 'idle' }); IZ.S.order = null
    const m0 = { ...IZ.S.money }
    IZ.dbg.order(2, [{ id: 'beer', n: 2 }], true); IZ.dbg.order(5, [{ id: 'hb', n: 1 }, { id: 'oolong', n: 1 }], true); IZ.dbg.order(7, [{ id: 'beer', n: 1 }], true)
    IZ.dbg.call(8); IZ.dbg.set({ x: IZ.S.tables[8].x, v: 0, dir: 1 }); IZ.dbg.step(3); const fourth = IZ.S.orders.length
    IZ.dbg.tray(['beer', 'beer', 'hb', 'oolong', 'beer'])
    IZ.dbg.set({ x: IZ.S.tables[5].x, v: 0 }); IZ.dbg.step(30); const a = { left: IZ.S.tray.map(c => c.id).sort().join(','), orders: IZ.S.orders.length }
    IZ.dbg.order(2, [{ id: 'beer', n: 2 }]); IZ.dbg.order(7, [{ id: 'hb', n: 1 }], true)
    IZ.dbg.tray(['hb']); IZ.dbg.set({ x: IZ.S.tables[2].x - 0.1, v: 0 }); IZ.dbg.step(30); const notOurs = [...document.querySelectorAll('#fx .sb')].some(e => /うちのちゃう/.test(e.textContent)); const keep = IZ.S.orders.length
    IZ.S.tables[8].st = 'idle'; IZ.S.order = null; IZ.dbg.tray([])
    return { fourth, a, notOurs, keep, cups: IZ.S.money.cups - m0.cups, wrong: IZ.S.money.wrong - m0.wrong }
  })
  expect(r.fourth === 3 && r.a.left === 'beer,beer,beer' && r.a.orders === 2 && r.notOurs && r.keep === 2 && r.cups === 2 && r.wrong === 0, JSON.stringify(r)); return r })
await t('傾くとグラスの中身が減る（こぼれる）', async () => { const r = await ev(p, () => { IZ.dbg.tray(['beer', 'beer', 'beer', 'beer', 'beer', 'beer']); IZ.dbg.set({ x: 20, v: 0, th: 0.35, om: 0 }); IZ.dbg.step(20); return IZ.S.tray.map(c => c.fill) }); expect(r.every(f => f < 1) && r.some(f => f < 0.95), JSON.stringify(r)); return r })
await t('寝そべり客はジャンプで越えられる・ぶつかると減る', async () => {
  const r = await ev(p, () => {
    IZ.dbg.clearObs(); IZ.dbg.tray(['beer', 'beer']); IZ.dbg.obs('sleep', 24); IZ.dbg.set({ x: 22.6, v: 3, th: 0, om: 0, dir: 1, heat: 0 }); IZ.S.keyF = 1; IZ.S.jumpQ = 0.1; IZ.dbg.step(50); IZ.S.keyF = 0
    const a = { x: IZ.S.x, fill: IZ.S.tray.map(c => c.fill), falls: IZ.S.falls }
    IZ.dbg.clearObs(); IZ.dbg.tray(['beer', 'beer']); IZ.dbg.obs('sleep', 27.5); IZ.dbg.set({ x: 25.8, v: 3, th: 0, om: 0, dir: 1, keyF: 1, heat: 0 }); IZ.dbg.step(40); IZ.S.keyF = 0
    return { a, b: { fill: IZ.S.tray.map(c => c.fill) } }
  })
  expect(r.a.x > 25 && r.a.fill.every(f => f > 0.9) && r.b.fill.some(f => f < 0.9), JSON.stringify(r)); return r })
await t('寝そべり客は通路をまたいで寝ていて、体の真ん中が当たり判定の真ん中（6人とも）', async () => {
  const r = await ev(p, () => { IZ.dbg.clearObs(); for (let k = 0; k < 6; k++) IZ.dbg.obs('sleep', 8 + k * 4); IZ.dbg.step(1); const o = IZ.S.obs.map((ob, i) => ob.kind === 'sleep' ? IZ.dbg.body(i) : null).filter(Boolean); IZ.dbg.clearObs(); return o })
  const bad = r.filter(b => Math.abs((b.bx[0] + b.bx[1]) / 2 - b.x) > 0.05 || Math.abs(b.bz[0] + b.bz[1]) > 0.1 || b.bz[1] - b.bz[0] < 1.2 || b.by > 0.8)
  expect(r.length === 6 && !bad.length, JSON.stringify(bad.length ? bad : r)); return r.map(b => +((b.bx[0] + b.bx[1]) / 2 - b.x).toFixed(3)) })
await t('遅め（2.3m/s）でも寝そべり客をジャンプで越えられる', async () => {
  const r = await ev(p, () => { IZ.dbg.clearObs(); IZ.dbg.tray(['beer']); IZ.dbg.obs('sleep', 14); const ob = IZ.S.obs.at(-1); IZ.dbg.set({ x: 14 - ob.w - 0.22 - 0.25, v: 2.3, dir: 1, th: 0, om: 0, heat: 0 }); IZ.S.jumpQ = 0.1; IZ.dbg.step(60); const hit = ob.hit; IZ.dbg.clearObs(); return { hit, x: IZ.S.x } })
  expect(!r.hit && r.x > 14.7, JSON.stringify(r)); return r })
await t('止まる場所: 呼んでいる席の床だけ光り、入ると緑。ほかの床は光らない', async () => {
  const r = await ev(p, () => { IZ.S.order = null; IZ.dbg.tray([]); IZ.S.tables.forEach(t => { t.st = 'idle' }); IZ.dbg.step(2); const none = IZ.ZONE.list.filter(m => m.visible !== false).length
    IZ.dbg.call(4); IZ.dbg.set({ x: IZ.S.tables[4].x - 6, v: 0, dir: 1 }); IZ.dbg.step(2); const one = IZ.ZONE.list.map((m, i) => m.visible === true ? i : -1).filter(i => i >= 0); const far = IZ.ZONE.list[4].material === IZ.ZONE.far
    IZ.dbg.set({ x: IZ.S.tables[4].x - 0.8, v: 3 }); IZ.dbg.step(2); const inG = IZ.ZONE.list[4].material === IZ.ZONE.in; IZ.S.tables[4].st = 'idle'; IZ.S.order = null; IZ.dbg.tray([]); return { none, one, far, inG } })
  expect(r.none === 0 && r.one.length === 1 && r.one[0] === 4 && r.far && r.inG, JSON.stringify(r)); return r })
await t('後ろの席から呼ばれると「うしろ」と出て、見取り図の席が赤くなる', async () => {
  const r = await ev(p, () => { IZ.dbg.set({ x: 25, v: 0, dir: 1 }); const t = IZ.S.tables[1]; IZ.dbg.call(1); IZ.dbg.step(3); IZ.dbg.render(); window.dispatchEvent(new Event('resize')); return { bub: [...document.querySelectorAll('#fx .sb')].map(e => e.textContent).find(s => s.includes('2番')), map: document.querySelector('#mt1') && document.querySelector('#mt1').getAttribute('class') } })
  await p.waitForTimeout(100); const m = await ev(p, () => document.querySelector('#mt1').getAttribute('class'))
  expect(/うしろ/.test(r.bub || '') && /call/.test(m), JSON.stringify({ ...r, m })); await ev(p, () => { IZ.S.tables[1].st = 'idle' }); return { ...r, m } })
await t('転倒: グラスは全部割れて減給、しばらくして起き上がる', async () => { const r = await ev(p, () => { IZ.dbg.tray(['beer', 'hb', 'hb']); const b0 = IZ.S.money.broken; IZ.dbg.fall(); const a = { broken: IZ.S.money.broken - b0, tray: IZ.S.tray.length, falls: IZ.S.falls }; IZ.dbg.step(130); return { ...a, up: IZ.S.fallT <= 0 } }); expect(r.broken === 3 && r.tray === 0 && r.falls >= 1 && r.up, JSON.stringify(r)); return r })
await t('待たせすぎると客が帰る（1組で1回だけ数える）', async () => { const r = await ev(p, () => { IZ.dbg.set({ x: 2, v: 0, dir: 1 }); const l0 = IZ.S.money.left; const t = IZ.S.tables[6]; t.st = 'call'; t.wait = 49.9; IZ.dbg.step(30); return { left: IZ.S.money.left - l0, st: t.st } }); expect(r.left === 1 && r.st === 'gone', JSON.stringify(r)); return r })
await t('音: BGM と効果音が呼ばれている（鳴らさず回数で）', async () => { const r = await ev(p, () => ({ calls: window.__soundCalls || 0, played: IZ.Snd.played })); expect(r.calls > 0 && r.played['call'] > 0 && r.played['crash'] > 0 && r.played['clink'] >= 0, JSON.stringify(r)); return r })
await t('乾杯: 席で渡すと客がグラスを当てて泡が飛び、飲み干して消える（運んだ分だけ）', async () => {
  const r = await ev(p, () => {
    IZ.dbg.clearObs(); IZ.dbg.noObs(); IZ.dbg.noCalls(); const i = 7, x = IZ.S.tables[i].x
    IZ.dbg.order(i, [{ id: 'beer', n: 4 }, { id: 'hb', n: 2 }]); IZ.dbg.tray(['beer', 'beer', 'beer', 'beer', 'hb', 'hb']); IZ.dbg.set({ x, dir: 1, v: 0, fallT: 0 }); IZ.dbg.step(30)
    const a = IZ.dbg.toastInfo(), k0 = IZ.Snd.played.kanpai || 0, sc0 = IZ.S.scene
    IZ.dbg.step(30); const b = IZ.dbg.toastInfo(), k1 = IZ.Snd.played.kanpai || 0
    IZ.dbg.step(120); const c = IZ.dbg.toastInfo()
    return { a, b, c, sound: k1 - k0, cups: IZ.S.tray.length }
  })
  expect(r.a && r.a.n === 6 && !r.a.rung && r.b && r.b.rung && r.b.fill.every(f => f < 1) && r.c === null && r.sound === 1 && r.cups === 0, JSON.stringify(r)); return r.b.fill
})
await t('乾杯: 間違えた注文では乾杯しない', async () => {
  const r = await ev(p, () => { const i = 8, x = IZ.S.tables[i].x; IZ.dbg.order(i, [{ id: 'beer', n: 1 }]); IZ.dbg.tray(['beer', 'hb']); IZ.dbg.set({ x, dir: 1, v: 0, fallT: 0 }); IZ.dbg.step(40); const a = IZ.dbg.toastInfo(); IZ.dbg.step(10); return { a, tray: IZ.S.tray.length, st: IZ.S.tables[i].st } })
  expect(r.a === null, JSON.stringify(r)); await ev(p, () => { IZ.dbg.tray([]); IZ.S.orders = [] }); return r
})
await t('酔っ払い: 立つと通路で腕を広げてふらつき、席に戻ると元に戻る', async () => {
  const r = await ev(p, () => { IZ.dbg.clearObs(); const i = 3; IZ.S.tables[i].st = 'idle'; IZ.dbg.set({ x: IZ.S.tables[i].x - 6, v: 0, dir: 1 }); IZ.dbg.stand(i); IZ.dbg.step(50); const a = IZ.dbg.drunk(); IZ.dbg.step(17); const b = IZ.dbg.drunk(); const c = IZ.S.tables[i].cust[1]; IZ.dbg.step(260); return { a, b, after: { open: c.armOpen, flush: c.flush, rz: c.g.rotation.z, standing: IZ.S.tables[i].standing } } })
  expect(r.a.open === 1 && Math.abs(r.a.armL[0]) > 1 && Math.abs(r.a.armL[2]) > 0.4 && r.a.flush === 1 && r.a.z !== r.b.z && r.after.open === 0 && r.after.flush === 0 && r.after.rz === 0 && !r.after.standing, JSON.stringify(r)); return r.a
})
await t('音: 録音素材が読み込まれ、無音のまま（__muteOk・合成の関数なし）', async () => {
  await p.waitForFunction(() => Object.values(IZ.Snd.bufs).filter(b => b && b !== 'loading').length >= 20, null, { timeout: 15000 })
  const r = await ev(p, () => ({ ok: window.__muteOk(), tone: typeof IZ.Snd.tone, amb: !!IZ.Snd.loops.amb, bgm: !!IZ.Snd.loops.bgm }))
  expect(r.ok && r.tone === 'undefined' && r.amb && r.bgm, JSON.stringify(r)); return r
})
await t('終業 → 給料明細（ハンコ・手取り・Xの本文）', async () => {
  await ev(p, () => { IZ.dbg.end(); IZ.dbg.step(200) }); await p.waitForTimeout(400); await ev(p, () => { IZ.dbg.reveal(); IZ.dbg.step(10) })
  const r = await ev(p, () => ({ mode: IZ.S.mode, vis: !document.querySelector('#vResult').hidden, net: IZ.S.result.net, x: IZ.xPost(), btn: document.querySelector('#rBtns2').classList.contains('on') }))
  expect(r.mode === 'result' && r.vis && r.btn && /x\.com\/intent\/post/.test(r.x.href) && r.x.text.includes('手取り') && r.x.text.includes('#1日だけ職場体験') && r.x.url === 'https://tom3games.github.io/job-izakaya/', JSON.stringify(r)); return { net: r.net, text: r.x.text } })
await t('明細の絵が描けている（輝度の散らばり）', async () => { const v = await variance(p, '#slip'); expect(v > 500, v); return v })
await t('明細に控除の行（割ったグラス・注文間違い・帰らせた客）が載る', async () => { const r = await ev(p, () => IZ.S.result.slip.ded.filter(d => d.yen > 0).map(d => d.label)); expect(r.includes('割ったグラス') && r.includes('注文間違い') && r.includes('帰らせた客'), JSON.stringify(r)); return r })
await t('明細を保存（ダウンロード）', async () => { const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 5000 }), p.click('#bSave')]); expect(/job-izakaya-.*\.png/.test(dl.suggestedFilename()), dl.suggestedFilename()); return dl.suggestedFilename() })
await t('ほかのバカゲー: 4本・交通誘導を含む', async () => { await p.click('#bMore'); const r = await ev(p, () => [...document.querySelectorAll('#moreL a')].map(a => a.href)); await p.click('#bMoreX'); expect(r.length === 4 && r.some(u => u.includes('job-traffic')) && r.some(u => u.includes('elevator-fart')), JSON.stringify(r)); return r.length })
await t('英語に切り替え: 明細・ボタンが英語', async () => { await p.click('#bLang'); const r = await ev(p, () => ({ again: document.querySelector('#bAgain').textContent, share: IZ.xPost().text, ded: IZ.S.result.slip.ded.map(d => d.label)[0] })); await p.click('#bLang'); expect(r.again === 'Again' && /Take-home/.test(r.share) && r.ded === 'Wrong orders', JSON.stringify(r)); return r })
await t('もう一回: 状態が初期化される', async () => { await p.click('#bAgain'); const r = await ev(p, () => ({ mode: IZ.S.mode, t: IZ.S.t, tray: IZ.S.tray.length, m: IZ.S.money, falls: IZ.S.falls })); expect(r.mode === 'play' && r.t < 1 && r.tray === 0 && r.falls === 0 && r.m.broken === 0, JSON.stringify(r)); return r })
await t('自動プレイ1シフト（固定seed）が最後まで回り、明細まで行く', async () => {
  await p.addScriptTag({ path: ROOT + '/bot.js' })
  const r = await ev(p, () => { IZ.dbg.pause(true); IZ.dbg.start(7); IZ.dbg.pause(true); IZ.S.tut = -1; IZBot.run(60 * 182, { vcap: 4.6 }); IZ.dbg.tick(200); return { served: IZ.S.served, m: IZ.S.money, mode: IZ.S.mode } })
  await p.waitForTimeout(300)
  expect(r.served >= 3 && r.mode !== 'play', JSON.stringify(r)); return r })

await p.close()
// ---- 6サイズ × 全画面で一画面に収まる。画面の巡り方はゲームに合わせて書く
for (const [w, h, name] of SIZES) {
  const q = await open(browser, { viewport: { width: w, height: h }, hasTouch: w < 1000, isMobile: w < 1000 })
  const views = {}
  views.title = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-title.png` })
  await q.click('#bHow'); views.how = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-how.png` }); await q.click('#bHowBack')
  await q.click('#bMoreT'); views.more = await fit(q); await q.click('#bMoreX')
  await q.click('#bStart'); await q.waitForTimeout(200)
  await q.evaluate(() => { IZ.dbg.pause(true); IZ.S.tut = -1; IZ.dbg.noCalls(); IZ.dbg.noObs(); IZ.dbg.call(1); IZ.dbg.set({ x: IZ.S.tables[1].x }); IZ.dbg.step(20) })
  views.play = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-order.png` })
  await q.evaluate(() => { IZ.dbg.set({ x: 1.3, v: 0 }); IZ.dbg.step(10) }); for (let i = 0; i < 5; i++) await q.click('.dk[data-id=beer]')
  views.counter = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-counter.png` })
  await t(`カウンターの画面と操作ボタンが重ならない ${name}`, async () => { const r = await q.evaluate(() => { const a = document.querySelector('#counter').getBoundingClientRect(), o = []; for (const s of ['#bFwd', '#bBack', '#bJump', '#bTurn', '#corner']) { const b = document.querySelector(s).getBoundingClientRect(); if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) o.push(s) } return o }); expect(!r.length, r.join()) })
  await q.evaluate(() => { IZ.dbg.set({ x: 12, v: 4, dir: 1 }); IZ.dbg.obs('sleep', 15); IZ.dbg.step(40) }); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-carry.png` })
  await q.evaluate(() => { IZ.dbg.end(); IZ.dbg.step(200) }); await q.waitForTimeout(400); await q.evaluate(() => { IZ.dbg.reveal(); IZ.dbg.step(5) })
  views.result = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-result.png` })
  await t(`明細が画面内に収まり小さすぎない ${name}`, async () => { const r = await q.evaluate(() => { const b = document.querySelector('#slip').getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), top: Math.round(b.top), bottom: Math.round(b.bottom), H: innerHeight } }); expect(r.h >= 220 && r.top >= 0 && r.bottom <= r.H, JSON.stringify(r)); return r })
  for (const [v, r] of Object.entries(views)) await t(`一画面に収まる ${name} ${w}x${h} ${v}`, async () => { expect(!r.over.length, JSON.stringify(r)) })
  await t(`${name}: はみ出し・エラーなし`, async () => { const o = await overflow(q); expect(o.sw <= o.W && !o.bad.length && !q.errs.length, JSON.stringify(o) + q.errs.join('|')) })
  await q.close()
}
await browser.close()
// ---- WebKit（iPhone 相当）でタッチの通し
const wb = await webkit.launch(), wp = await open(wb, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
await t('WebKit: 2本指の touchmove を止める', async () => {
  const r = await wp.evaluate(() => { const e = new Event('touchmove', { cancelable: true, bubbles: true }); Object.defineProperty(e, 'touches', { value: [{}, {}] }); document.body.dispatchEvent(e); return e.defaultPrevented })
  expect(r, r)
})
await t('WebKit: 無音のまま（__muteOk）', async () => { const r = await wp.evaluate(() => ({ ok: window.__muteOk(), ctx: IZ.Snd.ctx && IZ.Snd.ctx.state, bufs: Object.keys(IZ.Snd.bufs).length })); expect(r.ok && r.ctx !== 'running', JSON.stringify(r)); return r })
await t('WebKit: エラーなし', async () => { expect(wp.errs.length === 0, wp.errs.join('|')) })
await wb.close()
server.kill()
console.log(results.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
