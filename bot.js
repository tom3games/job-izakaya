// 検証用の自動プレイ（本番では読まない）。IZBot.run(steps, { vcap, careful, memory })
window.IZBot = {
  tick(o) {
    const S = IZ.S, d = IZ.D, st = S
    st.keyF = 0; st.keyB = 0
    if (S.mode !== 'play' || S.fallT > 0) return
    const ob = S.obs
    let target = null
    if (!S.order) { const c = S.tables.filter(t => t.st === 'call'); if (c.length) target = c.reduce((a, b) => Math.abs(a.x - S.x) < Math.abs(b.x - S.x) ? a : b).x; else target = 6 }
    else if (!S.tray.length) {
      if (S.order.showT > 0) return
      if (S.x < 2.4 && Math.abs(S.v) < 1.5) { for (const it of S.order.list) for (let k = 0; k < it.n; k++) { const id = o.wrong && Math.random() < o.wrong ? 'oolong' : it.id; const b = document.querySelector(`.dk[data-id="${id}"]`); if (b) b.click() } return }
      target = 1.4
    } else target = S.order.t.x
    const dx = target - S.x, dir = Math.sign(dx), dist = Math.abs(dx)
    // 前方の障害物
    for (const b of ob) {
      const ahead = (b.x - S.x) * dir
      if (b.kind === 'stand' && b.up > 0.3 && ahead > 0 && ahead < 2.2) { if (S.v * dir > 0) { dir > 0 ? (st.keyB = 1) : (st.keyF = 1) } return }
      if ((b.kind === 'sleep' || b.kind === 'towel' || b.kind === 'step') && ahead - b.w - 0.3 > -0.1 && ahead - b.w - 0.3 < 0.15 + Math.abs(S.v) * 0.1 && S.y <= 0) { if (o.jump !== false) S.jumpQ = 0.1 }
    }
    const vcap = Math.min(o.vcap ?? 4, Math.sqrt(2 * 6 * Math.max(0, dist - 0.4)) )
    const v = S.v * dir
    if (dist < 0.8) { if (Math.abs(S.v) > 0.4) { S.v > 0 ? (st.keyB = 1) : (st.keyF = 1) } return }
    if (v < vcap - 0.3) dir > 0 ? (st.keyF = 1) : (st.keyB = 1)
    else if (v > vcap + 0.6) dir > 0 ? (st.keyB = 1) : (st.keyF = 1)
  },
  run(n, o = {}) { for (let i = 0; i < n && IZ.S.mode === 'play'; i++) { this.tick(o); IZ.dbg.tick(1) } return IZ.state() },
}
