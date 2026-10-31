// SNS用サムネ og.png（1200x630）。node og.mjs
// 一輪車でジョッキ10杯、急に立ち上がった酔っ払いの前で大きく傾いてビールが飛ぶ瞬間。右にタイトルと一言
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { MUTE_LAUNCH, muteContext } from './mute.mjs'
const ROOT = import.meta.dirname
const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: '5473' } })
await new Promise(r => setTimeout(r, 400))
const b = await chromium.launch(MUTE_LAUNCH), ctx = await b.newContext({ viewport: { width: 1200, height: 630 }, locale: 'ja-JP' }); await muteContext(ctx)
const p = await ctx.newPage()
await p.goto('http://localhost:5473/'); await p.waitForFunction(() => window.__izReady && IZ.charsReady, null, { timeout: 15000 })
await p.evaluate(() => document.fonts.ready)
await p.evaluate(() => {
  IZ.dbg.start(5); IZ.dbg.pause(true); IZ.S.tut = -1; IZ.dbg.noCalls(); IZ.dbg.noObs()
  const t = IZ.S.tables[2]
  IZ.dbg.tray(['beer', 'beer', 'beer', 'beer', 'beer', 'beer', 'hb', 'hb', 'lemon', 'oolong'])
  IZ.dbg.stand(2); IZ.dbg.step(40)
  const st = IZ.S.obs.find(o => o.kind === 'stand')
  IZ.dbg.set({ x: st.x - 1.7, v: 0, dir: 1, camHalfW: 4.6 })
  IZ.dbg.step(2); IZ.dbg.snap()
  IZ.dbg.set({ th: 0.42, om: 1.6, v: 3.2, acc: 0 })
  for (const c of IZ.S.tray) { c.liq.scale.y *= 0.7 }
  IZ.dbg.step(3); IZ.S.camHalfW = 4.6; IZ.dbg.snap(); IZ.S.camX = 0
  document.querySelectorAll('#fx > *').forEach(e => e.remove())
})
await p.addStyleTag({ content: `#corner,.hudTop,.hint,#finger,#loading,.ctl,#counter{display:none!important}
  body::after{content:'';position:fixed;inset:0 0 0 52%;background:linear-gradient(90deg,rgba(42,26,20,0),rgba(42,26,20,.95) 24%);z-index:30}` })
await p.evaluate(() => {
  IZ.S.dbgPause = true
  document.querySelectorAll('#fx > *').forEach(e => e.remove())
  const S = IZ.S, ono = (t, x, y, size, rot, col) => { const d = document.createElement('div'); d.textContent = t; d.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:20;font-family:'Dela Gothic One';font-size:${size}px;color:${col};-webkit-text-stroke:4px #1d1a16;paint-order:stroke fill;text-shadow:0 6px 0 #1d1a16;transform:rotate(${rot}deg);white-space:nowrap`; document.body.appendChild(d) }
  const bub = (t, x, y, size, bg = '#fff', col = '#1d1a16') => { const d = document.createElement('div'); d.innerHTML = t; d.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:21;background:${bg};color:${col};border:4px solid #1d1a16;border-radius:18px;padding:8px 16px;font-family:'Zen Maru Gothic';font-weight:900;font-size:${size}px;line-height:1.3;white-space:nowrap`; document.body.appendChild(d) }
  const r = IZ.toScreen(IZ.P.tray.getWorldPosition(new IZ.P.tray.position.constructor()))
  ono('こぼれる', r.x - 230, r.y - 150, 62, -10, '#f2a91a')
  const st = S.obs.find(o => o.kind === 'stand')
  const sp = IZ.toScreen(st.c.head.getWorldPosition(new IZ.P.tray.position.constructor())); bub('トイレどこー', sp.x - 190, sp.y - 70, 30, '#ffe08a')
  bub('えーと…生<span style="color:#c8372d;font-family:Dela Gothic One">×6</span><br>ハイボール<span style="color:#c8372d;font-family:Dela Gothic One">×2</span><br>レモンサワー…', 24, 24, 26)
  const d = document.createElement('div'); d.style.cssText = 'position:fixed;right:24px;top:0;bottom:0;width:500px;z-index:31;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:22px;color:#fff;text-align:center'
  d.innerHTML = `<div style="font-family:'Zen Maru Gothic';font-weight:900;font-size:28px;letter-spacing:.08em;color:#1d1a16;background:#e9b44c;padding:6px 16px 5px;border:4px solid #1d1a16;transform:rotate(-3deg);box-shadow:4px 4px 0 #1d1a16">1日だけ職場体験 #1</div>
  <div style="font-family:'Zen Maru Gothic';font-weight:900;font-size:84px;line-height:1.05;white-space:nowrap;-webkit-text-stroke:4px #1d1a16;paint-order:stroke fill;text-shadow:0 7px 0 #1d1a16">居酒屋<span style="font-family:'Dela Gothic One';font-weight:400;color:#f2a91a">ホール</span></div>
  <div style="font-weight:900;font-size:31px;line-height:1.55;font-family:'Zen Maru Gothic'">なぜか<span style="color:#f2a91a">一輪車</span>で生ジョッキ10杯。<br>注文は<span style="color:#ff6b5e">一回しか</span>言われない。<br>手取りは給料明細で。</div>`
  document.body.appendChild(d)
  IZ.dbg.render()
})
await p.waitForTimeout(400)
await p.screenshot({ path: ROOT + '/og.png' })
await b.close(); server.kill()
console.log('ok')
