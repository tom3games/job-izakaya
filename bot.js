// 検証用の自動プレイ（本番では読まない）。IZBot.run(steps, { vcap, heatMax, jump, wrong, lean })
window.IZBot = {
  rest: false, loading: false,
  tick(o) {
    const S = IZ.S
    S.keyF = 0; S.keyB = 0
    if (S.mode !== 'play' || S.fallT > 0) return
    let target = null
    const near = ts => ts.length ? ts.reduce((a, b) => Math.abs(a.x - S.x) < Math.abs(b.x - S.x) ? a : b) : null
    const maxO = o.multi || 1, calls = S.tables.filter(t => t.st === 'call')
    if (S.orders.some(x => x.showT > 0)) return
    if (!S.tray.length && S.orders.length < maxO && calls.length && !(S.orders.length && this.loading)) target = near(calls).x
    else if (!S.orders.length) target = 6
    else if (!S.tray.length) {
      this.loading = true
      if (S.x < 2.4 && Math.abs(S.v) < 1.5) { for (const od of S.orders) for (const it of od.list) for (let k = 0; k < it.n; k++) { const id = o.wrong && Math.random() < o.wrong ? 'oolong' : it.id; const b = document.querySelector(`.dk[data-id="${id}"]`); if (b) b.click() } this.loading = false; return }
      target = 1.4
    } else target = near(S.orders.map(x => x.t)).x
    const dx = target - S.x, dist = Math.abs(dx), vr = S.v * S.dir
    if (dist > 0.9 && Math.sign(dx) !== S.dir) { S.turnQ = 1; return }
    for (const b of S.obs) {
      const ahead = (b.x - S.x) * S.dir
      if (b.kind === 'stand' && b.up > 0.3 && ahead > 0 && ahead < 2.2) { if (vr > 0) S.keyB = 1; return }
      if ((b.kind === 'sleep' || b.kind === 'towel' || b.kind === 'step') && ahead - b.w - 0.3 > -0.1 && ahead - b.w - 0.3 < 0.15 + Math.abs(S.v) * 0.1 && S.y <= 0) { if (o.jump !== false) S.jumpQ = 0.1 }
    }
    // 傾き: 熱が上がったら一回こぐのをやめる
    if (o.lean !== false) { if (S.heat > (o.heatMax ?? 1.3)) this.rest = true; else if (S.heat < 0.25) this.rest = false } else this.rest = false
    const vcap = Math.min(o.vcap ?? 4, Math.sqrt(2 * 6 * Math.max(0, dist - 0.4)))
    if (dist < 0.8) { if (vr > 0.4) S.keyB = 1; return }
    if (vr < vcap - 0.3 && !this.rest) S.keyF = 1
    else if (vr > vcap + 0.6) S.keyB = 1
  },
  run(n, o = {}) { this.rest = false; this.loading = false; for (let i = 0; i < n && IZ.S.mode === 'play'; i++) { this.tick(o); IZ.dbg.tick(1) } return IZ.state() },
}
