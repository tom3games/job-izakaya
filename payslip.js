// payslip.js — 「1日だけ職場体験」シリーズ共通の給料明細（結果画像）。依存なし（Canvas 2D だけ）。
// 正本は ~/Desktop/claudecode/_shared/payslip.js。各ゲームへコピーして同梱する。型は2本で同じ、色だけ仕事ごとに変える。
//
// 使い方:
//   import { drawPayslip, PAYSLIP_W, PAYSLIP_H } from './payslip.js'
//   const c = drawPayslip(canvasOrNull, {
//     lang: 'ja', no: 1, job: '居酒屋ホール', date: '2026.11.01',
//     wage: 1100, hours: 6,                       // 基本給 = 時給 × 時間
//     pay: [{ label: '杯数手当', note: '42杯', yen: 2100 }],          // 基本給以外の支給（任意）
//     ded: [{ label: 'こぼした', note: '3.5杯分', yen: 1400 }, ...],   // 控除（減給）。yen は正の数で渡す
//     boss: '店長', comment: '一輪車はまあええわ。注文は覚えて。',
//     stamp: '要研修',            // ハンコの文字（2〜4字。\n で2行）
//     stampK: 1,                 // 0〜1 ハンコの押し込み（演出用。1で押した状態）
//     photo: canvasOrImage,      // 山場の写真（任意）
//     footer: 'tom3games.github.io/job-izakaya',
//   }, { main: '#9d2b25', dark: '#3b1411', accent: '#e9b44c', bg: '#2a1a14' })
//   → 1080x1350 の canvas を返す（X にそのまま貼れる 4:5）
export const PAYSLIP_W = 1080, PAYSLIP_H = 1350
const L = {
  ja: { series: '1日だけ職場体験', title: '給 料 明 細 書', name: '体験バイト　様', paid: '支給', ded: '控除（減給）', base: '基本給', wageNote: (w, h) => `時給${yen(w)} × ${h}時間`, totalPay: '支給合計', totalDed: '控除合計', net: '今日の手取り', boss: 'ひとこと', none: 'なし（えらい）', unit: '円' },
  en: { series: 'ONE-DAY JOB EXPERIENCE', title: 'PAYSLIP', name: 'One-day temp', paid: 'EARNINGS', ded: 'DEDUCTIONS', base: 'Base pay', wageNote: (w, h) => `¥${num(w)}/h × ${h}h`, totalPay: 'Total earnings', totalDed: 'Total deductions', net: 'TAKE-HOME TODAY', boss: 'says', none: 'None (nice)', unit: '' },
}
const num = n => Math.round(Math.abs(n)).toLocaleString('en-US')
const yen = n => `${n < 0 ? '−' : ''}¥${num(n)}`
const FJ = '"Zen Maru Gothic","Hiragino Maru Gothic ProN","Hiragino Sans","Yu Gothic",sans-serif'
const FD = '"Dela Gothic One","Zen Maru Gothic","Hiragino Sans",sans-serif'
const MONO = '"Dela Gothic One","Zen Maru Gothic",sans-serif'
function rr(x, X, Y, W, H, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + W, Y, X + W, Y + H, r); x.arcTo(X + W, Y + H, X, Y + H, r); x.arcTo(X, Y + H, X, Y, r); x.arcTo(X, Y, X + W, Y, r); x.closePath() }
function fitText(x, s, maxW, size, font, weight = '900') { let f = size; do { x.font = `${weight} ${f}px ${font}`; if (x.measureText(s).width <= maxW) break; f -= 2 } while (f > 12); return f }
function wrap(x, s, maxW) { const out = []; let line = ''; for (const ch of s.split(/(?<=[\s、。！？!?,.])|(?=[^\x00-\x7f])/u)) { if (x.measureText(line + ch).width > maxW && line) { out.push(line.trim()); line = ch } else line += ch } if (line.trim()) out.push(line.trim()); return out }

export function totals(d) {
  const base = Math.round(d.wage * d.hours)
  const pay = base + (d.pay || []).reduce((a, r) => a + r.yen, 0)
  const ded = (d.ded || []).reduce((a, r) => a + r.yen, 0)
  return { base, pay, ded, net: pay - ded }
}

export function drawPayslip(canvas, d, th) {
  const c = canvas || document.createElement('canvas'); c.width = PAYSLIP_W; c.height = PAYSLIP_H
  const x = c.getContext('2d'), T = L[d.lang] || L.ja, W = PAYSLIP_W, H = PAYSLIP_H, tt = totals(d)
  const ink = '#1d1a16', paper = '#fbf6ea', line = 'rgba(29,26,22,.22)'
  // 机（背景）
  x.fillStyle = th.bg; x.fillRect(0, 0, W, H)
  x.fillStyle = 'rgba(255,255,255,.04)'; for (let i = 0; i < 14; i++) x.fillRect(0, i * 100 + 30, W, 3)
  // 紙
  const P = { x: 54, y: 58, w: W - 108, h: H - 116 }
  x.save(); x.translate(W / 2, H / 2); x.rotate(-0.012); x.translate(-W / 2, -H / 2)
  x.fillStyle = 'rgba(0,0,0,.35)'; rr(x, P.x + 8, P.y + 14, P.w, P.h, 10); x.fill()
  x.fillStyle = paper; rr(x, P.x, P.y, P.w, P.h, 10); x.fill()
  // 帯
  x.fillStyle = th.main; x.fillRect(P.x, P.y, P.w, 150)
  x.fillStyle = th.accent; x.fillRect(P.x, P.y + 150, P.w, 8)
  // シリーズ名（小さく）
  x.textBaseline = 'middle'; x.textAlign = 'left'
  x.font = `900 26px ${FJ}`; const sw = x.measureText(T.series).width + 32
  x.fillStyle = 'rgba(255,255,255,.16)'; rr(x, P.x + 36, P.y + 26, sw, 42, 21); x.fill()
  x.fillStyle = '#fff'; x.fillText(T.series, P.x + 52, P.y + 48)
  x.textAlign = 'right'; x.font = `900 26px ${FJ}`; x.fillStyle = 'rgba(255,255,255,.85)'; x.fillText(`#${d.no}  ${d.job}`, P.x + P.w - 36, P.y + 48)
  x.textAlign = 'left'; x.fillStyle = '#fff'; fitText(x, T.title, P.w - 72, 60, d.lang === 'ja' ? FJ : FD); x.fillText(T.title, P.x + 36, P.y + 108)
  // 宛名と日付
  let y = P.y + 205
  x.fillStyle = ink; x.font = `900 34px ${FJ}`; x.fillText(T.name, P.x + 36, y)
  x.textAlign = 'right'; x.font = `700 26px ${FJ}`; x.fillStyle = 'rgba(29,26,22,.7)'; x.fillText(d.date || '', P.x + P.w - 36, y)
  x.strokeStyle = ink; x.lineWidth = 3; x.beginPath(); x.moveTo(P.x + 36, y + 30); x.lineTo(P.x + P.w * 0.55, y + 30); x.stroke()
  // 写真（右上）
  const ph = { x: P.x + P.w - 36 - 300, y: y + 52, w: 300, h: 300 }
  // 支給
  y += 70
  const colL = P.x + 36, colR = d.photo ? ph.x - 30 : P.x + P.w - 36
  const head = (label, col) => { x.fillStyle = col; x.fillRect(colL, y - 22, 10, 44); x.textAlign = 'left'; x.font = `900 32px ${FJ}`; x.fillStyle = ink; x.fillText(label, colL + 22, y); y += 50 }
  const row = (label, note, v, neg) => {
    x.textAlign = 'left'; x.fillStyle = ink; fitText(x, label, (colR - colL) * 0.5, 30, FJ); x.fillText(label, colL + 22, y)
    if (note) { const lw = x.measureText(label).width; x.font = `700 22px ${FJ}`; x.fillStyle = 'rgba(29,26,22,.6)'; const room = colR - colL - lw - 230; if (room > 40) { fitText(x, note, room, 22, FJ, '700'); x.fillText(note, colL + 34 + lw, y + 2) } }
    x.textAlign = 'right'; x.font = `32px ${MONO}`; x.fillStyle = neg ? '#c62828' : ink; x.fillText((neg ? '−' : '') + '¥' + num(v), colR, y)
    x.strokeStyle = line; x.lineWidth = 2; x.setLineDash([6, 6]); x.beginPath(); x.moveTo(colL + 22, y + 26); x.lineTo(colR, y + 26); x.stroke(); x.setLineDash([])
    y += 56
  }
  head(T.paid, th.main)
  row(T.base, T.wageNote(d.wage, d.hours), tt.base)
  for (const r of d.pay || []) row(r.label, r.note, r.yen)
  y += 10
  head(T.ded, '#c62828')
  const ded = (d.ded || []).filter(r => r.yen > 0)
  if (!ded.length) { x.textAlign = 'left'; x.font = `700 28px ${FJ}`; x.fillStyle = 'rgba(29,26,22,.6)'; x.fillText(T.none, colL + 22, y); y += 56 }
  for (const r of ded.slice(0, 6)) row(r.label, r.note, r.yen, true)
  if (d.photo) {
    x.save(); x.translate(ph.x + ph.w / 2, ph.y + ph.h / 2); x.rotate(0.035)
    x.fillStyle = '#fff'; x.shadowColor = 'rgba(0,0,0,.25)'; x.shadowBlur = 14; x.shadowOffsetY = 6; x.fillRect(-ph.w / 2 - 12, -ph.h / 2 - 12, ph.w + 24, ph.h + 24); x.shadowColor = 'transparent'
    try { x.drawImage(d.photo, -ph.w / 2, -ph.h / 2, ph.w, ph.h) } catch (e) {}
    x.fillStyle = 'rgba(233,180,76,.75)'; x.fillRect(-60, -ph.h / 2 - 26, 120, 34)
    x.restore()
  }
  // 手取り
  const ny = Math.max(y + 6, P.y + 860)
  x.fillStyle = th.dark; rr(x, P.x + 36, ny, P.w - 72, 150, 14); x.fill()
  x.textAlign = 'left'; x.fillStyle = th.accent; x.font = `900 32px ${FJ}`; x.fillText(T.net, P.x + 66, ny + 44)
  x.font = `700 22px ${FJ}`; x.fillStyle = 'rgba(255,255,255,.7)'; x.fillText(`${T.totalPay} ¥${num(tt.pay)}  /  ${T.totalDed} −¥${num(tt.ded)}`, P.x + 66, ny + 118)
  x.textAlign = 'right'; x.fillStyle = tt.net < 0 ? '#ff6b6b' : '#fff'; fitText(x, yen(tt.net), P.w * 0.55, 96, MONO, '400'); x.fillText(yen(tt.net), P.x + P.w - 66, ny + 66)
  // 店長のひとこと
  const by = ny + 190
  x.textAlign = 'left'; x.fillStyle = th.main; x.font = `900 28px ${FJ}`; x.fillText(`${d.boss} ${T.boss}`, P.x + 36, by)
  x.fillStyle = '#fff'; x.strokeStyle = ink; x.lineWidth = 3; rr(x, P.x + 36, by + 24, P.w - 72 - 200, 130, 16); x.fill(); x.stroke()
  x.fillStyle = ink; x.font = `900 30px ${FJ}`; const ls = wrap(x, d.comment || '', P.w - 72 - 240).slice(0, 3)
  ls.forEach((s, i) => x.fillText(s, P.x + 58, by + 24 + 65 + (i - (ls.length - 1) / 2) * 40))
  // フッタ
  x.textAlign = 'left'; x.font = `700 22px ${FJ}`; x.fillStyle = 'rgba(29,26,22,.5)'; x.fillText(d.footer || '', P.x + 36, P.y + P.h - 30)
  // ハンコ
  const k = d.stampK ?? 1
  if (k > 0 && d.stamp) {
    const sx = P.x + P.w - 130, sy = by + 80, sc = 1 + (1 - k) * 1.6
    x.save(); x.translate(sx, sy); x.rotate(-0.22); x.scale(sc, sc); x.globalAlpha = Math.min(1, k * 1.4)
    x.strokeStyle = '#d32f2f'; x.lineWidth = 9; x.beginPath(); x.arc(0, 0, 92, 0, Math.PI * 2); x.stroke()
    x.lineWidth = 3; x.beginPath(); x.arc(0, 0, 78, 0, Math.PI * 2); x.stroke()
    x.fillStyle = '#d32f2f'; x.textAlign = 'center'; const st = String(d.stamp).split('\n')
    const fs = st.length > 1 ? 40 : 46
    st.forEach((s, i) => { fitText(x, s, 130, fs, FJ); x.fillText(s, 0, (i - (st.length - 1) / 2) * (fs + 6)) })
    x.restore()
  }
  x.restore()
  return c
}
