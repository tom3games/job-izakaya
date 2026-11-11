// 1日だけ職場体験 #1 居酒屋ホール / ONE-DAY JOB: IZAKAYA
// 横に長い居酒屋を、なぜか一輪車で往復する。呼ばれた席で注文を聞き（一瞬で消える）、カウンターで覚えたとおりにトレーへ、
// 酔っ払い・おしぼり・段差をよけて運ぶ。ゲージは置かない。こぼれ具合はグラスの中身、忙しさは客と店長の声で見せる。
// 時間は固定60Hz（performance.now で数える）
import * as THREE from 'three'
import { GLTFLoader } from './vendor/jsm/loaders/GLTFLoader.js'
import { clone as skClone } from './vendor/jsm/utils/SkeletonUtils.js'
import { setupLook, castShadow, addBlobShadow, surfaceTex, createFx, look } from './look.js'
import { drawPayslip, totals } from './payslip.js'

const D = window.IZ_DATA
const $ = s => document.querySelector(s)
const STEP = 1 / 60
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const lerp = (a, b, k) => a + (b - a) * k
const ease = k => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k) }
const isTouch = matchMedia('(pointer:coarse)').matches || ('ontouchstart' in window && navigator.maxTouchPoints > 0)
function mulberry(seed) { let a = seed >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
const store = { get(k) { try { return localStorage.getItem('iz.' + k) } catch (e) { return null } }, set(k, v) { try { localStorage.setItem('iz.' + k, v) } catch (e) {} } }
const DK = Object.fromEntries(D.DRINKS.map(d => [d.id, d]))

// ---------- 寸法（世界の単位）
// 通路は x 方向にまっすぐ奥へ。席は通路の左右（z の負と正）に互い違い
const NT = 10, TX = i => 7 + i * 3.2, SIDE = i => (i % 2 ? 1 : -1), LEN = TX(NT - 1) + 4
const ZA_Y = 0.36, ZA_Z = 2.75, AISLE = 1.4, WALL_Z = 5
const W0 = -3.2, W1 = LEN + 3
const CH = 1.5                     // 人の背丈
const WR = 0.42, SEAT = 1.25       // 一輪車の車輪の半径・サドルの高さ
const VMAX = 4.8, ACC = 3.9, BRAKE = 9, DRAG = 4   // 本人: 勢いが強すぎて止まりにくい → 加速と最高速を下げ、離すと早く止まる
const THRESH = [TX(4) + 1.6]       // 段差（敷居）の位置
const COUNTER_X = 2.0

// ---------- 状態
const S = {
  lang: store.get('lang') || ((navigator.language || 'ja').toLowerCase().startsWith('ja') ? 'ja' : 'en'),
  mode: 'title', time: 0, rand: Math.random, dbgPause: false,
  t: 0, x: 1.2, v: 0, acc: 0, y: 0, vy: 0, dir: 1, face: Math.PI / 2, th: 0, om: 0, wheelA: 0, heat: 0, turnQ: 0, turns: 0, roll: 0,
  inF: 0, inB: 0, keyF: 0, keyB: 0, jumpQ: 0, fallT: 0, falls: 0,
  tray: [], orders: [], tables: [], obs: [], drops: [], puddles: [],
  money: { cups: 0, wrong: 0, spill: 0, broken: 0, left: 0 },
  nextCall: 2, tut: store.get('tut') === '1' ? -1 : 0, served: 0, resT: 0, result: null, photo: null, photoScore: 0,
  bossT: 0, ended: false, lastSay: 0,
}
// S.order は先頭の注文（検証・自動プレイ・チュートリアル用の互換）
Object.defineProperty(S, 'order', { get() { return S.orders[0] || null }, set(v) { S.orders = v ? [v] : [] } })
const TT = () => D.T[S.lang]
const R = () => S.rand()
const pick = a => a[Math.floor(R() * a.length) % a.length]

// ---------- 音（録音素材だけ。合成音は使わない。エンジンは sfx.js、出所は CREDITS.md）
const sf = (pre, n) => Array.from({ length: n }, (_, i) => `snd/${pre}${i + 1}.mp3`)
Snd.muted = store.get('mute') === '1'
Snd.def({
  tap: 'snd/tap.mp3', clink: sf('clink', 3), pour: 'snd/pour.mp3', splash: sf('splash', 3), crash: sf('crash', 3), jump: sf('jump', 2), land: sf('land', 2), bump: sf('bump', 2),
  call: sf('grunt', 3), order: sf('order', 2), ok: 'snd/ok.mp3', kanpai: sf('kanpai', 2), wrong: 'snd/wrong.mp3', boss: sf('grunt', 3), yorokonde: sf('grunt', 3), leave: 'snd/leave.mp3', end: 'snd/end.mp3', stamp: 'snd/stamp.mp3', squeak: sf('squeak', 3),
})
const SND_TRACKS = { title: ['snd/bgm.mp3', 0.2, 1], play: ['snd/bgm.mp3', 0.2, 1], end: ['snd/bgm.mp3', 0.14, 0.82] }
Object.assign(Snd, {
  want: null, busy: 0, _init: Snd.init, _setMute: Snd.setMute,
  init() { const first = !this.ctx; this._init(); if (first && this.ctx) { this.loop('amb', 'snd/amb_crowd.mp3', 0.16, 1); this.applyTrack() } },
  setMute(m) { this._setMute(m); store.set('mute', m ? '1' : '0') },
  setTrack(name) { if (this.want === name) return; this.want = name; this.applyTrack() },
  applyTrack() {
    if (!this.ctx) return
    const t = this.want && SND_TRACKS[this.want]; this.loop('bgm', t ? t[0] : null, t ? t[1] : 0, 0.3)
    if (t) this.played['bgm:' + this.want] = (this.played['bgm:' + this.want] || 0) + 1
  },
  // 忙しいほど曲が速くなる
  tick() { const l = this.loops.bgm; if (l && l.node) l.node.playbackRate.value = (SND_TRACKS[this.want] || [0, 0, 1])[2] * (this.want === 'play' ? 1 + this.busy * 0.18 : 1) },
  sfx(n, o = {}) {
    if (n === 'splash') return this.play(n, { vol: 0.5 + 0.5 * (o.v ?? 1) })
    if (n === 'call') return this.play(n, { vol: 0.7, rate: o.hot ? 1.5 : 1.25, room: 0.3 })
    if (n === 'boss') return this.play(n, { vol: 0.9, rate: 0.68, room: 0.3 })
    if (n === 'yorokonde') return this.play(n, { vol: 0.7, rate: 1.35 })
    if (n === 'leave') return this.play(n, { vol: 0.6 })
    if (n === 'kanpai') { this.play('clink', { vol: 0.7, rate: 1.08 }); this.play('clink', { vol: 0.55, rate: 0.94, delay: 0.05 }); return this.play(n, { vol: 0.95 }) }
    if (n === 'crash') this.duck(0.4, 0.9)
    if (n === 'end') this.duck(0.3, 1.8)
    return this.play(n, { vol: { tap: 0.45, squeak: 0.35, jump: 0.5, land: 0.55, order: 0.7, pour: 0.6 }[n] ?? 0.9 })
  },
})

// ---------- 描画の土台
const canvas = $('#gl')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false })
const lowRes = () => clamp(360 / innerHeight, 0.3, 1)   // 廃れた見た目: 荒い画面
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x0c0907)
scene.fog = new THREE.Fog(0x0c0907, 9, 30)
const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 120)
const lk = setupLook(renderer, scene, { env: true, envIntensity: 0.22, exposure: 0.95, sun: 0.75, sunPos: [3, 9, 6], hemi: 0.42, sky: 0xd9d3a8, ground: 0x2a2018, sunColor: 0xdfe8c8, fill: 0.15, fillColor: 0x8aa0a0 })
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
{ const sun = lk.sun; sun.castShadow = true; const sz = isTouch ? 1024 : 2048; sun.shadow.mapSize.set(sz, sz); const c = sun.shadow.camera; c.left = -13; c.right = 13; c.top = 11; c.bottom = -11; c.near = 1; c.far = 45; c.updateProjectionMatrix(); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03 }
const SUN_OFF = new THREE.Vector3(4, 12, 8)
const fx = createFx(scene, camera, renderer)
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0, ...o })
function mesh(geo, mat, x = 0, y = 0, z = 0, parent) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); if (parent) parent.add(m); return m }
function canvasTex(w, h, draw, o = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); draw(x, w, h)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4
  if (o.rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...o.rep) }
  return t
}
const FONT = '"Zen Maru Gothic","Hiragino Maru Gothic ProN","Hiragino Sans",sans-serif'

// ---------- 店（奥に長い通路。左右に座敷）
const world = new THREE.Group(); scene.add(world)
const lanterns = [], plates = [], lights = []
{
  const WL = W1 - W0, WC = (W0 + W1) / 2, WD = WALL_Z * 2
  // 床（板張り）
  const ft = surfaceTex({ w: 512, h: 512, base: '#4e3826', noise: 0.1, grime: 0.3, seed: 5, repeat: [WL / 4, WD / 4], draw: (x, w, h) => { x.strokeStyle = 'rgba(40,22,10,.55)'; x.lineWidth = 3; for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(0, i * h / 4); x.lineTo(w, i * h / 4); x.stroke() } for (let i = 0; i < 4; i++) { const o = (i % 2) * w / 2; x.beginPath(); x.moveTo(o + w / 4, i * h / 4); x.lineTo(o + w / 4, (i + 1) * h / 4); x.stroke() } x.strokeStyle = 'rgba(255,220,170,.06)'; x.lineWidth = 1; for (let i = 0; i < 40; i++) { const y = Math.random() * h; x.beginPath(); x.moveTo(0, y); x.bezierCurveTo(w / 3, y + 4, w * 2 / 3, y - 4, w, y); x.stroke() } } })
  const floor = mesh(new THREE.PlaneGeometry(WL, WD), std(0xffffff, { map: ft, roughness: 0.45 }), WC, 0, 0, world); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true
  const tt = surfaceTex({ w: 256, h: 256, base: '#7d7647', noise: 0.1, grime: 0.28, seed: 9, repeat: [WL / 1.8, 2], draw: (x, w, h) => { x.strokeStyle = 'rgba(80,80,30,.25)'; x.lineWidth = 1; for (let i = 0; i < w; i += 4) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, h); x.stroke() } x.fillStyle = '#2d3a26'; x.fillRect(0, 0, w, 10); x.fillRect(0, h - 10, w, 10) } })
  const wt = surfaceTex({ w: 512, h: 256, base: '#a89c80', noise: 0.08, grime: 0.32, edge: 0.4, repeat: [WL / 6, 1], seed: 3, draw: (x, w, h, rnd) => { for (let i = 0; i < 9; i++) { const cx = rnd() * w, cy = rnd() * h * 0.6, r = 12 + rnd() * 40; const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, 'rgba(70,52,20,.45)'); g.addColorStop(0.7, 'rgba(90,70,30,.25)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(cx - r, cy - r, r * 2, r * 2); x.fillStyle = 'rgba(60,45,20,.35)'; for (let k = 0; k < 3; k++) { const dx = cx + (rnd() - 0.5) * r; x.fillRect(dx, cy, 2 + rnd() * 3, r + rnd() * h * 0.5) } } x.strokeStyle = 'rgba(30,22,14,.5)'; x.lineWidth = 1.5; for (let i = 0; i < 4; i++) { let px = rnd() * w, py = rnd() * h; x.beginPath(); x.moveTo(px, py); for (let k = 0; k < 6; k++) { px += (rnd() - 0.5) * 40; py += rnd() * 30; x.lineTo(px, py) } x.stroke() } } })
  const wood = std(0x4a2e1a, { roughness: 0.55 }), woodD = std(0x2e1c10, { roughness: 0.5 })
  const za0 = 4.2, zaL = W1 - za0, zaC = (za0 + W1) / 2, zaD = WALL_Z - AISLE
  // 品書きの短冊（店名・銘柄は出さない）
  const menus = ['生ビール', 'ハイボール', 'レモンサワー', '枝豆', '唐揚げ', '焼き鳥', 'だし巻き', 'ウーロンハイ', '冷奴', 'もつ煮', 'ポテト', 'お茶漬け', 'たこわさ', '刺身盛り']
  const mt = canvasTex(1024, 256, (x, w, h) => {
    const n = menus.length, sw = w / n
    for (let i = 0; i < n; i++) {
      if (i % 4 === 2) continue; x.fillStyle = i % 5 === 0 ? '#c9b98a' : '#d8cba4'; x.fillRect(i * sw + 4, 0, sw - 8, i % 3 === 1 ? h * 0.72 : h); x.fillStyle = 'rgba(90,70,30,.3)'; x.fillRect(i * sw + 4, h * 0.55, sw - 8, h * 0.45)
      x.fillStyle = '#2a1a10'; x.font = `900 ${sw * 0.6}px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'top'
      const s = menus[i]; for (let k = 0; k < Math.min(s.length, 6); k++) x.fillText(s[k], i * sw + sw / 2, 8 + k * sw * 0.62)
      x.fillStyle = '#b5281c'; x.font = `900 ${sw * 0.32}px ${FONT}`; x.fillText(['380', '420', '400', '300', '480', '150', '420', '400', '300', '450', '350', '500', '380', '880'][i], i * sw + sw / 2, h - sw * 0.45)
    }
  })
  const menuMat = new THREE.MeshStandardMaterial({ map: mt, roughness: 0.9 })
  for (const s of [-1, 1]) {
    const face = s < 0 ? 0 : Math.PI
    // 座敷（畳の段）。通路に向いた面は濃い木
    const za = mesh(new THREE.BoxGeometry(zaL, ZA_Y, zaD), [std(0x5a3a22), std(0x5a3a22), std(0xffffff, { map: tt, roughness: 0.8 }), std(0x5a3a22), std(0x6b4428, { roughness: 0.5 }), std(0x6b4428, { roughness: 0.5 })], zaC, ZA_Y / 2, s * (AISLE + zaD / 2), world)
    za.receiveShadow = true
    mesh(new THREE.BoxGeometry(zaL, 0.08, 0.14), std(0x2a1a10, { roughness: 0.35 }), zaC, ZA_Y + 0.02, s * (AISLE - 0.02), world)
    // 壁（漆喰と腰板）
    mesh(new THREE.PlaneGeometry(WL, 4.4), std(0xffffff, { map: wt }), WC, 2.2, s * WALL_Z, world).rotation.y = face
    mesh(new THREE.BoxGeometry(WL, 1.1, 0.06), wood, WC, 0.9, s * (WALL_Z - 0.04), world)
    mesh(new THREE.BoxGeometry(WL, 0.12, 0.1), woodD, WC, 3.5, s * (WALL_Z - 0.06), world)
    for (let x0 = 6 + (s > 0 ? 6 : 0); x0 < LEN; x0 += 12) { const m = mesh(new THREE.PlaneGeometry(8, 1.7), menuMat, x0 + 3, 2.6, s * (WALL_Z - 0.05), world); m.rotation.y = face; m.rotation.z = (x0 % 7 - 3) * 0.012 }
    // 同じ側の席の間に、柱と低い衝立（客の顔は隠さない高さ）
    for (let x = TX(s < 0 ? 0 : 1) - 3.2; x < LEN + 1; x += 6.4) {
      if (x < za0) continue
      mesh(new THREE.BoxGeometry(0.22, 4.4, 0.22), woodD, x, 2.2, s * (WALL_Z - 0.12), world)
      const sc = mesh(new THREE.BoxGeometry(0.08, 0.55, 1.5), std(0x6b4428, { roughness: 0.5 }), x, ZA_Y + 0.28, s * 4.15, world); sc.castShadow = true
    }
    // 提灯（通路の両脇の上）
    const lanMat = lanterns.mat || (lanterns.mat = new THREE.MeshStandardMaterial({ color: 0xb02a20, emissive: 0xff4a2a, emissiveIntensity: 0.45, roughness: 0.6 }))
    if (!lanMat.map) { const lanTex = canvasTex(256, 128, (x, w, h) => { x.fillStyle = '#d8382a'; x.fillRect(0, 0, w, h); x.strokeStyle = 'rgba(80,10,5,.45)'; x.lineWidth = 3; for (let i = 0; i < h; i += 10) { x.beginPath(); x.moveTo(0, i); x.lineTo(w, i); x.stroke() } x.fillStyle = '#1a0a05'; x.font = `900 70px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('酒', w * 0.25, h / 2); x.fillText('酒', w * 0.75, h / 2) }); lanMat.map = lanTex; lanMat.emissiveMap = lanTex }
    const capMat = std(0x1a1008)
    for (let x0 = 3 + (s > 0 ? 2.5 : 0); x0 < LEN; x0 += 5) {
      const g = new THREE.Group(); g.position.set(x0, 3.45, s * 1.25); world.add(g)
      const k = lanterns.length, mode = k % 3 === 2 ? 'off' : k % 5 === 1 ? 'flick' : 'on'
      const mat = mode === 'on' ? lanMat : mode === 'off' ? (lanterns.off || (lanterns.off = new THREE.MeshStandardMaterial({ color: 0x4a1612, map: lanMat.map, roughness: 0.8 }))) : lanMat.clone()
      const b = mesh(new THREE.SphereGeometry(0.3, 10, 8), mat, 0, 0, 0, g); b.scale.y = 1.35; if (mode === 'flick') g.userData.flick = mat
      mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.08, 16), capMat, 0, 0.41, 0, g); mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.08, 16), capMat, 0, -0.41, 0, g)
      mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.0, 4), capMat, 0, 0.9, 0, g)
      lanterns.push(g)
    }
  }
  // 天井と梁
  const ceil = mesh(new THREE.PlaneGeometry(WL, WD), std(0x2a1a10, { roughness: 0.8 }), WC, 4.4, 0, world); ceil.rotation.x = Math.PI / 2
  for (let x = 0; x < W1; x += 3.2) mesh(new THREE.BoxGeometry(0.2, 0.22, WD), woodD, x, 4.28, 0, world)
  // 突き当たり（奥）と、カウンターの後ろの壁
  mesh(new THREE.PlaneGeometry(WD, 4.4), std(0xffffff, { map: wt }), W1, 2.2, 0, world).rotation.y = -Math.PI / 2
  mesh(new THREE.PlaneGeometry(WD, 4.4), std(0xffffff, { map: wt }), W0, 2.2, 0, world).rotation.y = Math.PI / 2
  // 奥のお手洗いの扉とのれん
  mesh(new THREE.BoxGeometry(0.1, 2.3, 1.4), std(0x3a2414, { roughness: 0.5 }), W1 - 0.05, 1.15, 0, world)
  const wc = canvasTex(256, 128, (x, w, h) => { x.fillStyle = '#1f2f55'; x.fillRect(0, 0, w, h); x.fillStyle = '#f4ecd8'; x.font = `900 64px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('お手洗い', w / 2, h / 2 + 4) })
  mesh(new THREE.PlaneGeometry(1.6, 0.8), new THREE.MeshStandardMaterial({ map: wc, roughness: 0.9 }), W1 - 0.12, 2.75, 0, world).rotation.y = -Math.PI / 2
  // 暖かい点光源
  const tubeOn = new THREE.MeshStandardMaterial({ color: 0xe8f4e0, emissive: 0xd8ffe0, emissiveIntensity: 1.2 })
  for (let x0 = 5, n = 0; x0 < LEN; x0 += 10, n++) {
    const pl = new THREE.PointLight(n % 2 ? 0xffa860 : 0xcfe8c8, 8, 14, 1.6); pl.position.set(x0, 3.6, 0); world.add(pl)
    const tm = n === 1 ? tubeOn.clone() : tubeOn, tube = mesh(new THREE.BoxGeometry(1.4, 0.07, 0.12), tm, x0, 4.18, 0, world)
    mesh(new THREE.BoxGeometry(1.5, 0.05, 0.22), std(0x2a2a26), x0, 4.24, 0, world)
    lights.push({ pl, tm, base: 8, bad: n === 1 || n === 3, ph: n * 1.7 })
  }
  // カウンター（手前の端。通路をふさぐ向き）
  const cg = new THREE.Group(); world.add(cg)
  const ctop = std(0x9a6a3e, { roughness: 0.35 })
  mesh(new THREE.BoxGeometry(1.1, 0.12, 6.4), ctop, -0.45, 1.1, 0, cg)
  mesh(new THREE.BoxGeometry(0.1, 1.06, 6.4), wood, 0.1, 0.53, 0, cg)
  const srv = std(0xc7ccd1, { roughness: 0.25, metalness: 0.8 })
  mesh(new THREE.BoxGeometry(0.6, 0.9, 0.7), srv, -0.7, 1.6, 1.4, cg)
  mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.35, 8), std(0x222222), -0.4, 2.15, 1.25, cg)
  mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.35, 8), std(0x222222), -0.4, 2.15, 1.55, cg)
  mesh(new THREE.BoxGeometry(0.5, 0.08, 4.2), wood, -2.9, 2.7, -0.9, cg); mesh(new THREE.BoxGeometry(0.5, 0.08, 4.2), wood, -2.9, 3.5, -0.9, cg)
  const bc = [0x2f5d3a, 0x6b3a1a, 0x1f3550, 0x8a7a3a, 0x4a1a1a]
  for (let i = 0; i < 18; i++) { const r = 0.09 + (i % 3) * 0.02; mesh(new THREE.CylinderGeometry(r, r, 0.55, 10), std(bc[i % 5], { roughness: 0.2, metalness: 0.1 }), -2.85, 3.05 + Math.floor(i / 9) * 0.8, -2.7 + (i % 9) * 0.45, cg) }
  const nt = canvasTex(512, 256, (x, w, h) => { x.fillStyle = '#1f2f55'; x.fillRect(0, 0, w, h); x.fillStyle = 'rgba(0,0,0,.25)'; for (let i = 1; i < 4; i++) x.fillRect(i * w / 4 - 3, 0, 6, h); x.fillStyle = '#f4ecd8'; x.font = `900 120px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('厨', w * 0.25, h * 0.45); x.fillText('房', w * 0.75, h * 0.45) })
  mesh(new THREE.PlaneGeometry(2.0, 1.2), new THREE.MeshStandardMaterial({ map: nt, side: THREE.DoubleSide, roughness: 0.9 }), W0 + 0.05, 3.0, 2.4, cg).rotation.y = Math.PI / 2
  castShadow(cg)
  // 段差（敷居）と仕切りののれん（通路をまたぐ）
  const nt2 = canvasTex(512, 256, (x, w, h) => { x.fillStyle = '#8c2a1e'; x.fillRect(0, 0, w, h); x.fillStyle = 'rgba(0,0,0,.25)'; for (let i = 1; i < 3; i++) x.fillRect(i * w / 3 - 3, 0, 6, h); x.fillStyle = '#f4ecd8'; x.font = `900 110px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('奥', w / 6, h * 0.45); x.fillText('座', w / 2, h * 0.45); x.fillText('敷', w * 5 / 6, h * 0.45) })
  for (const x0 of THRESH) {
    const s = mesh(new THREE.BoxGeometry(0.34, 0.2, AISLE * 2), std(0x3a2414, { roughness: 0.4 }), x0, 0.1, 0, world); s.castShadow = true; s.receiveShadow = true
    const ng = new THREE.Group(); ng.position.set(x0, 4.25, 0); world.add(ng); ng.userData.flap = 0
    for (let k = 0; k < 3; k++) { const p = mesh(new THREE.PlaneGeometry(0.9, 0.85), new THREE.MeshStandardMaterial({ map: nt2, side: THREE.DoubleSide, roughness: 0.9 }), 0, -0.43, (k - 1) * 0.94, ng); p.rotation.y = Math.PI / 2; const uv = p.geometry.attributes.uv; for (let j = 0; j < uv.count; j++) uv.setX(j, (uv.getX(j) + k) / 3); p.userData.k = k }
    mesh(new THREE.CylinderGeometry(0.03, 0.03, AISLE * 2.2, 6), woodD, 0, 0.02, 0, ng).rotation.x = Math.PI / 2
    lanterns.push(ng); ng.userData.noren = true
  }
  // 低いテーブル（各席）と料理、卓番の札（宙に浮かせて、遠くからでも読める）
  const tbl = std(0x5c3a20, { roughness: 0.35 })
  const plateM = std(0xf2efe6, { roughness: 0.3 }), foodC = [0xc8762a, 0x6aa84f, 0xe8d06a, 0x9a3a2a]
  for (let i = 0; i < NT; i++) {
    const x = TX(i), s = SIDE(i), g = new THREE.Group(); g.position.set(x, ZA_Y, s * ZA_Z); world.add(g)
    mesh(new THREE.BoxGeometry(1.7, 0.09, 1.0), tbl, 0, 0.42, 0, g)
    for (const [a, b] of [[-0.75, -0.42], [0.75, -0.42], [-0.75, 0.42], [0.75, 0.42]]) mesh(new THREE.BoxGeometry(0.08, 0.4, 0.08), tbl, a, 0.2, b, g)
    for (let k = 0; k < 3; k++) { mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.04, 18), plateM, -0.5 + k * 0.5, 0.49, (k % 2) * 0.2 - 0.1, g); mesh(new THREE.SphereGeometry(0.12, 10, 8), std(foodC[(i + k) % 4], { roughness: 0.7 }), -0.5 + k * 0.5, 0.53, (k % 2) * 0.2 - 0.1, g).scale.y = 0.5 }
    for (const [a, b] of [[-1.15, 0], [1.15, 0], [0, s * 0.85]]) mesh(new THREE.BoxGeometry(0.62, 0.07, 0.62), std(0x7a2a3a, { roughness: 0.9 }), a, 0.035, b, g)
    castShadow(g)
    const mk = hot => new THREE.SpriteMaterial({ map: canvasTex(128, 128, (c, w, h) => { c.fillStyle = hot ? '#c8372d' : '#fbf3dc'; c.beginPath(); c.roundRect(6, 6, w - 12, h - 12, 22); c.fill(); c.strokeStyle = '#2a1a10'; c.lineWidth = 8; c.stroke(); c.fillStyle = hot ? '#fff' : '#2a1a10'; c.font = `900 80px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(i + 1), w / 2, h / 2 + 5) }), toneMapped: false })
    const sp = new THREE.Sprite(mk(false)); sp.userData = { cold: sp.material, hot: mk(true), y: 2.5 }; sp.position.set(x, 2.5, s * (ZA_Z + 0.3)); sp.scale.setScalar(0.5); world.add(sp); plates.push(sp)
  }
}

// 止まる場所（光る床）。呼んでいる席・運び先・カウンター。中に入ると緑になる
const zoneTex = (col) => canvasTex(256, 256, (x, w, h) => { x.fillStyle = col + '33'; x.fillRect(0, 0, w, h); x.strokeStyle = col; x.lineWidth = 18; x.setLineDash([34, 20]); x.strokeRect(12, 12, w - 24, h - 24); x.setLineDash([]); x.fillStyle = col; x.beginPath(); x.moveTo(w / 2 - 40, h / 2 - 30); x.lineTo(w / 2 + 40, h / 2 - 30); x.lineTo(w / 2, h / 2 + 34); x.closePath(); x.fill() })
const ZONE = { far: null, in: null, list: [] }
function zoneMesh(i) {
  if (!ZONE.far) { const mk = c => new THREE.MeshBasicMaterial({ map: zoneTex(c), transparent: true, depthWrite: false, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -3 }); ZONE.far = mk('#ffc83d'); ZONE.in = mk('#5dff7a') }
  if (!ZONE.list[i]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(i === NT ? 2.2 : 2.9, AISLE * 1.8), ZONE.far); m.rotation.x = -Math.PI / 2; m.position.set(i === NT ? 1.5 : TX(i), 0.012, 0); m.visible = false; world.add(m); ZONE.list[i] = m }
  return ZONE.list[i]
}
for (let i = 0; i <= NT; i++) zoneMesh(i)

// ---------- 人（Kenney Mini Characters, CC0）
const MODELS = {}
let charsReady = false
const loader = new GLTFLoader()
const CHAR_FILES = ['female-a', 'female-b', 'female-c', 'female-d', 'female-e', 'female-f', 'male-a', 'male-b', 'male-c', 'male-d', 'male-e', 'male-f']
function loadChars() { return Promise.all(CHAR_FILES.map(n => new Promise(res => loader.load(`chars/character-${n}.glb`, g => { MODELS[n] = g; res() }, undefined, () => res())))).then(() => { charsReady = true }) }
const _tex = {}
function angerTex() { return _tex.anger || (_tex.anger = canvasTex(64, 64, (x) => { x.strokeStyle = '#e63946'; x.lineWidth = 7; x.lineCap = 'round'; for (const [a, b, c2, d] of [[14, 22, 26, 26], [22, 14, 26, 26], [50, 22, 38, 26], [42, 14, 38, 26], [14, 42, 26, 38], [22, 50, 26, 38], [50, 42, 38, 38], [42, 50, 38, 38]]) { x.beginPath(); x.moveTo(a, b); x.lineTo(c2, d); x.stroke() } })) }
function makeChar(name, o = {}) {
  const src = MODELS[name]; if (!src) return null
  const root = skClone(src.scene), g = new THREE.Group(); g.add(root)
  root.traverse(m => { if (m.isMesh) { m.castShadow = true; m.material = m.material.clone(); m.material.roughness = 0.75 } })
  const box = new THREE.Box3().setFromObject(root), hgt = box.max.y - box.min.y
  g.scale.setScalar((o.h ?? CH) / hgt)
  const mixer = new THREE.AnimationMixer(root), acts = {}
  for (const c of src.animations) acts[c.name] = mixer.clipAction(c)
  const c = { g, root, mixer, acts, cur: null, head: root.getObjectByName('head'), armL: root.getObjectByName('arm-left'), armR: root.getObjectByName('arm-right'), torso: root.getObjectByName('torso'), name, bub: null }
  if (o.anger !== false) { c.anger = new THREE.Sprite(new THREE.SpriteMaterial({ map: angerTex(), transparent: true, depthTest: false, toneMapped: false })); c.anger.scale.setScalar(0.5); c.anger.visible = false; c.anger.renderOrder = 9; scene.add(c.anger) }
  play(c, o.anim ?? 'idle')
  return c
}
function play(c, name, fade = 0.2, speed = 1, once = false) {
  const a = c.acts[name]; if (!a) return
  a.timeScale = speed
  if (c.cur === name) return
  const prev = c.cur ? c.acts[c.cur] : null
  a.reset(); if (once) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true } else a.setLoop(THREE.LoopRepeat, Infinity)
  a.play(); if (prev) a.crossFadeFrom(prev, fade, false)
  c.cur = name
}
const _hp = new THREE.Vector3(), _q = new THREE.Vector3(), _w = new THREE.Vector3()
function headPos(c, out) { if (c.head) c.head.getWorldPosition(out); else out.copy(c.g.position).setY(CH); return out.add(_q.set(0, 0.62, 0)) }

// ---------- 主人公（一輪車）
const lamp = new THREE.PointLight(0xffe6c0, 7, 10, 1.4); scene.add(lamp)   // 足元の明かり（暗くても障害物が見える）
const P = { g: new THREE.Group(), body: new THREE.Group(), wheel: null, rider: null, tray: new THREE.Group(), cups: [] }
scene.add(P.g); P.g.add(P.body)
{
  const tire = std(0x1a1a1a, { roughness: 0.8 }), rim = std(0xd8dde2, { roughness: 0.25, metalness: 0.8 }), frame = std(0xd23b2a, { roughness: 0.35, metalness: 0.3 })
  P.wheel = new THREE.Group(); P.wheel.position.y = WR; P.g.add(P.wheel)
  const t = mesh(new THREE.TorusGeometry(WR - 0.06, 0.07, 10, 28), tire, 0, 0, 0, P.wheel)
  mesh(new THREE.TorusGeometry(WR - 0.13, 0.025, 6, 24), rim, 0, 0, 0, P.wheel)
  for (let k = 0; k < 8; k++) { const s = mesh(new THREE.CylinderGeometry(0.012, 0.012, (WR - 0.13) * 2, 4), rim, 0, 0, 0, P.wheel); s.rotation.z = k * Math.PI / 8 }
  // 体（倒れる軸は車輪の接地点）
  const post = mesh(new THREE.CylinderGeometry(0.045, 0.045, SEAT - WR, 8), frame, 0, (SEAT + WR) / 2, 0, P.body)
  const fork = mesh(new THREE.BoxGeometry(0.06, 0.2, 0.32), frame, 0, WR + 0.05, 0, P.body)
  const seat = mesh(new THREE.BoxGeometry(0.42, 0.08, 0.2), std(0x222222, { roughness: 0.6 }), 0, SEAT, 0, P.body)
  seat.geometry.translate(0, 0, 0)
  // ペダル
  P.ped = new THREE.Group(); P.ped.position.y = WR; P.body.add(P.ped)
  mesh(new THREE.BoxGeometry(0.03, 0.03, 0.42), rim, 0, 0, 0, P.ped)
  P.tray.position.set(0.1, SEAT + 0.74, -0.58); P.tray.scale.setScalar(1.0)   // 左肩。カメラは右後ろなので通路の先を隠さない
  P.body.add(P.tray)
  const tr = mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.05, 36), std(0x3a2a1e, { roughness: 0.3, metalness: 0.2 }), 0, 0, 0, P.tray); tr.scale.x = 0.75
  mesh(new THREE.TorusGeometry(0.62, 0.025, 6, 36), std(0x2a1d14, { roughness: 0.3 }), 0, 0.03, 0, P.tray).rotation.x = Math.PI / 2
  P.tray.children[1].scale.x = 0.75
  castShadow(P.g)
  P.blob = addBlobShadow(P.g, 1.4, { floorY: 0, opacity: 0.4, parent: scene })
}
function setupRider() {
  const c = makeChar('male-e', { h: CH * 0.92, anger: false, anim: 'holding-both' }); if (!c) return
  c.g.position.y = SEAT - CH * 0.92 * 0.32; P.body.add(c.g); P.rider = c
  // ねじり鉢巻き＋前掛け（頭と腰の骨に付ける）
  if (c.head) {
    const hb = mesh(new THREE.TorusGeometry(0.31, 0.05, 6, 20), std(0xf4f0e6, { roughness: 0.8 }), 0, 0.22, 0)
    hb.rotation.x = Math.PI / 2; const s = 1 / c.g.scale.x; hb.scale.setScalar(s * 0.9); hb.position.multiplyScalar(s); c.head.add(hb)
    const knot = mesh(new THREE.SphereGeometry(0.07, 8, 6), std(0xf4f0e6), 0, 0.22 * s, -0.3 * s * 0.9); knot.scale.setScalar(s); c.head.add(knot)
  }
  if (c.torso) {
    const s = 1 / c.g.scale.x
    const ap = mesh(new THREE.PlaneGeometry(0.42, 0.42), std(0x1f2f55, { roughness: 0.9, side: THREE.DoubleSide }), 0, -0.05 * s, 0.17 * s); ap.scale.setScalar(s); c.torso.add(ap)
  }
}
// グラス
const glassMat = new THREE.MeshStandardMaterial({ color: 0xe8f4ff, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.32, depthWrite: false })
const foamMat = std(0xfffaf0, { roughness: 0.9 })
const liqMats = {}
function liqMat(d) { return liqMats[d.id] || (liqMats[d.id] = new THREE.MeshStandardMaterial({ color: d.liq, roughness: 0.15, transparent: true, opacity: 0.88, emissive: d.liq, emissiveIntensity: 0.12 })) }
function makeCup(id) {
  const d = DK[id], g = new THREE.Group(), mug = d.glass === 'mug'
  const r = mug ? 0.13 : 0.1, h = mug ? 0.34 : 0.4
  const gl = mesh(new THREE.CylinderGeometry(r, r * 0.95, h, 18, 1, true), glassMat, 0, h / 2, 0, g); gl.renderOrder = 3
  mesh(new THREE.CircleGeometry(r * 0.95, 18), glassMat, 0, 0.01, 0, g).rotation.x = -Math.PI / 2
  if (mug) { const hd = mesh(new THREE.TorusGeometry(0.08, 0.022, 6, 12, Math.PI), glassMat, r + 0.01, h / 2, 0, g); hd.rotation.z = -Math.PI / 2 }
  const liq = mesh(new THREE.CylinderGeometry(r * 0.9, r * 0.86, 1, 16), liqMat(d), 0, 0, 0, g)
  liq.geometry.translate(0, 0.5, 0); liq.position.y = 0.02
  let foam = null
  if (d.foam) { foam = mesh(new THREE.CylinderGeometry(r * 0.94, r * 0.9, 0.08, 16), foamMat, 0, 0, 0, g) }
  let slice = null
  if (d.slice) { slice = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.015, 12), std(d.slice, { roughness: 0.5 }), 0, 0, 0, g); slice.rotation.z = 0.5 }
  const cup = { id, g, liq, foam, slice, h, r, fill: 1, k: 0.8 + Math.random() * 0.4 }
  setFill(cup, 1)
  return cup
}
function setFill(c, f) {
  c.fill = clamp(f, 0, 1); const top = 0.02 + (c.h - 0.06) * c.fill
  c.liq.scale.y = Math.max(0.001, top - 0.02); c.liq.visible = c.fill > 0.01
  if (c.foam) { c.foam.visible = c.fill > 0.05; c.foam.position.y = top + 0.035; c.foam.scale.y = 0.4 + 0.6 * c.fill }
  if (c.slice) { c.slice.position.y = top - 0.02; c.slice.visible = c.fill > 0.1 }
}
function layoutTray() {
  const n = S.tray.length, cols = n <= 4 ? n : n <= 8 ? Math.ceil(n / 2) : Math.ceil(n / 3), rows = Math.ceil(n / Math.max(1, cols))
  S.tray.forEach((c, i) => { const cx = i % cols, rz = Math.floor(i / cols); c.g.position.set((rz - (rows - 1) / 2) * 0.27, 0.03, (cx - (cols - 1) / 2) * 0.27); c.col = cols > 1 ? Math.abs(cx - (cols - 1) / 2) / ((cols - 1) / 2) : 0 })
}
function addCup(id) {
  if (S.tray.length >= 12) return false
  const c = makeCup(id); P.tray.add(c.g); S.tray.push(c); layoutTray(); return true
}
function clearTray() { for (const c of S.tray) c.g.removeFromParent(); S.tray = []; layoutTray() }

// ---------- 席の客
function seatPos(i, k) { const x = TX(i), s = SIDE(i), z = s * ZA_Z; return [[x - 1.15, z, Math.PI / 2], [x + 1.15, z, -Math.PI / 2], [x, z + s * 0.85, s < 0 ? 0 : Math.PI]][k] }
function setupTables() {
  const rnd = mulberry(11)
  S.tables = []
  for (let i = 0; i < NT; i++) {
    const t = { i, x: TX(i), st: 'idle', wait: 0, cust: [], callT: 0, order: null, angry: 0, leaveT: 0, standT: 0, stander: -1 }
    const n = 2 + (rnd() < 0.6 ? 1 : 0)
    for (let k = 0; k < n; k++) {
      const name = CHAR_FILES[Math.floor(rnd() * CHAR_FILES.length)]
      const c = makeChar(name === 'male-e' ? 'male-a' : name, { anim: 'sit' }); if (!c) continue
      const [x, z, ry] = seatPos(i, k); c.g.position.set(x, ZA_Y, z); c.g.rotation.y = ry; c.home = [x, z, ry]; c.k = k
      c.mixer.update(rnd() * 2)
      scene.add(c.g); t.cust.push(c)
    }
    S.tables.push(t)
  }
}
// ---------- 店長（カウンターの中）
const BOSS = { c: null }
function setupBoss() { BOSS.c = makeChar('male-d', { anim: 'idle' }); if (!BOSS.c) return; BOSS.c.g.position.set(-1.4, 0, 0.4); BOSS.c.g.rotation.y = Math.PI / 2; scene.add(BOSS.c.g) }

// ---------- 吹き出し（DOM）
const FX = []
function toScreen(p) { _w.copy(p).project(camera); return { x: (_w.x + 1) / 2 * innerWidth, y: (1 - _w.y) / 2 * innerHeight, z: _w.z } }
function ono(text, pos, cls = '', o = {}) {
  const el = document.createElement('div'); el.className = 'ono ' + cls; el.textContent = text
  el.style.fontSize = (o.size ?? 30) + 'px'; $('#fx').appendChild(el)
  FX.push({ el, pos: pos.clone(), t: 0, life: o.life ?? 1.1, rise: o.rise ?? 0.8, kind: 'ono', rot: (Math.random() - 0.5) * 16 })
}
function bubble(c, text, cls = '', life = 1.6, html = false) {
  if (!c) return
  if (c.bub) { c.bub.remove(); const i = FX.findIndex(f => f.el === c.bub); if (i >= 0) FX.splice(i, 1) }
  const el = document.createElement('div'); el.className = 'sb ' + cls; if (html) el.innerHTML = text; else el.textContent = text; $('#fx').appendChild(el)
  c.bub = el; FX.push({ el, c, t: 0, life, kind: 'sb' }); return el
}
function clearFx() { for (const f of FX) f.el.remove(); FX.length = 0; for (const t of S.tables) for (const c of t.cust) c.bub = null; if (BOSS.c) BOSS.c.bub = null; if (P.rider) P.rider.bub = null }
function updateFx(dt) {
  const top = 52, bot = innerHeight - (S.mode === 'play' ? 110 : 12)
  let behindN = 0
  for (let i = FX.length - 1; i >= 0; i--) {
    const f = FX[i]; f.t += dt
    if (f.t >= f.life || (f.c && !f.c.g.parent)) { f.el.remove(); FX.splice(i, 1); if (f.c && f.c.bub === f.el) f.c.bub = null; continue }
    const k = f.t / f.life
    if (f.kind === 'ono') {
      const s = toScreen(_w.copy(f.pos).add(_q.set(0, f.rise * ease(k * 2), 0)))
      if (s.z > 1) { f.el.style.opacity = 0; continue }
      const sc = k < 0.12 ? 0.4 + k / 0.12 * 0.8 : 1.2 - Math.min(0.2, (k - 0.12) * 2)
      const w = f.el.offsetWidth, x = clamp(s.x, w / 2 + 8, innerWidth - w / 2 - 8)
      f.el.style.transform = `translate(${x - w / 2}px,${s.y - 20}px) rotate(${f.rot}deg) scale(${sc})`; f.el.style.opacity = k > 0.75 ? (1 - k) / 0.25 : 1
    } else {
      const s = toScreen(headPos(f.c, _hp)), w = f.el.offsetWidth, h = f.el.offsetHeight
      const back = s.z > 1
      f.el.dataset.off = back ? 'back' : s.x < 0 ? -1 : s.x > innerWidth ? 1 : 0
      let x = clamp(s.x - w / 2, 8, innerWidth - w - 8), y = clamp(s.y - h - 10, top, bot - h)
      if (back) { x = (innerWidth - w) / 2; y = top + 44 + behindN * (h + 6); behindN++ }
      const sc = f.t < 0.12 ? 0.5 + f.t / 0.12 * 0.5 : 1
      const jig = f.el.classList.contains('hot') ? Math.sin(S.time * 60) * 2 : 0
      f.el.style.transform = `translate(${x + jig}px,${y}px) scale(${sc})`; f.el.style.opacity = k > 0.88 ? (1 - k) / 0.12 : 1
    }
  }
}

// ---------- 障害物
// kind: sleep（寝そべり客・ジャンプで越える）/ towel（転がるおしぼり）/ puddle（こぼれたビール・滑る）/ stand（急に立つ客・越えられない）/ step（段差）
const towelMat = std(0xf6f6f0, { roughness: 0.9 }), pudMat = new THREE.MeshStandardMaterial({ color: 0xf2a91a, roughness: 0.05, transparent: true, opacity: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
function addObs(kind, x, o = {}) {
  const ob = { kind, x, w: 0.4, h: 0.3, life: o.life ?? 40, t: 0, v: o.v ?? 0, hit: 0, g: null, c: null }
  if (kind === 'step') { ob.w = 0.17; ob.h = 0.2; ob.life = 1e9 }
  if (kind === 'towel') { ob.w = 0.16; ob.h = 0.24; const g = new THREE.Group(); const m = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.4, 12), towelMat, 0, 0, 0, g); m.rotation.x = Math.PI / 2; m.castShadow = true; g.position.set(x, 0.12, 0.1); scene.add(g); ob.g = g }
  if (kind === 'puddle') { ob.w = o.w ?? 0.7; ob.h = 0; const m = mesh(new THREE.CircleGeometry(1, 20), pudMat, x, 0.006, 0.1); m.rotation.x = -Math.PI / 2; m.scale.set(ob.w, 0.6, 1); scene.add(m); ob.g = m; ob.life = o.life ?? 30 }
  if (kind === 'sleep') {
    ob.w = 0.4; ob.h = 0.45
    const name = pick(['male-a', 'male-b', 'male-c', 'male-f', 'female-c'])
    const c = makeChar(name, { anim: 'die' })
    if (c) {
      play(c, 'die', 0, 1, true); c.mixer.update(3); const fl = R() < 0.5 ? 1 : -1
      c.g.rotation.y = fl > 0 ? 0 : Math.PI; c.g.position.set(x, 0, 0); scene.add(c.g)
      // 体の中心を通路の真ん中・当たり判定の真ん中に合わせる
      const bb = bodyBox(c.g); c.g.position.x += x - (bb.min.x + bb.max.x) / 2; c.g.position.z -= (bb.min.z + bb.max.z) / 2
      ob.c = c; c.zT = 0
    }
  }
  S.obs.push(ob); return ob
}
const _bb = new THREE.Box3(), _bv = new THREE.Vector3()
function bodyBox(root) {
  root.updateMatrixWorld(true); _bb.makeEmpty()
  root.traverse(m => { if (!m.isMesh) return; const pos = m.geometry.attributes.position; for (let i = 0; i < pos.count; i += 3) { _bv.fromBufferAttribute(pos, i); if (m.isSkinnedMesh) m.applyBoneTransform(i, _bv); _bv.applyMatrix4(m.matrixWorld); _bb.expandByPoint(_bv) } })
  return _bb
}
function freeObs(ob) { if (ob.g) ob.g.removeFromParent(); if (ob.c) { ob.c.g.removeFromParent(); if (ob.c.anger) ob.c.anger.removeFromParent(); if (ob.c.bub) ob.c.bub.remove() } }
function clearObs() { for (const ob of S.obs) freeObs(ob); S.obs = []; for (const x of THRESH) addObs('step', x) }

// ---------- しずく
const dropGeo = new THREE.SphereGeometry(0.045, 6, 4)
const dropPool = []
for (let i = 0; i < 70; i++) { const m = new THREE.Mesh(dropGeo, new THREE.MeshBasicMaterial({ color: 0xf2a91a })); m.visible = false; scene.add(m); dropPool.push({ m, v: new THREE.Vector3(), life: 0 }) }
function emitDrops(pos, n, color, vx = 0) {
  let k = 0
  for (const d of dropPool) { if (k >= n) break; if (d.life > 0) continue; k++; d.life = 0.9; d.m.visible = true; d.m.position.copy(pos); d.m.material.color.setHex(color); d.v.set(vx + (Math.random() - 0.5) * 2.4, 1 + Math.random() * 2, (Math.random() - 0.5) * 1.5) }
}
function updateDrops(dt) {
  for (const d of dropPool) {
    if (d.life <= 0) continue; d.life -= dt; d.v.y -= 14 * dt; d.m.position.addScaledVector(d.v, dt)
    if (d.m.position.y < 0.02) { d.m.position.y = 0.02; d.v.set(0, 0, 0); d.life = Math.min(d.life, 0.15) }
    if (d.life <= 0) d.m.visible = false
  }
}

// ---------- 注文
function avail() { const f = S.t / D.SHIFT.sec; const lv = f < 0.3 ? 0 : f < 0.58 ? 1 : 2; return D.DRINKS.filter(d => d.lv <= lv) }
function makeOrder(first) {
  if (first) return [{ id: 'beer', n: 2 }]
  const f = S.t / D.SHIFT.sec, ds = avail()
  const total = clamp(Math.round(1.2 + f * 4.5 + (R() - 0.5) * 2), 1, 6)
  const kinds = clamp(1 + Math.floor(R() * (1 + f * 2)), 1, Math.min(ds.length, total, 3))
  const ids = []; const pool = [...ds]
  // 後半は紛らわしい組み合わせを混ぜる
  if (f > 0.5 && R() < 0.3) { const pair = pick([['oolong', 'oolonghi'], ['lemon', 'lemonhi'], ['lemon', 'grape']]).filter(id => pool.some(d => d.id === id)); for (const id of pair) if (ids.length < kinds) ids.push(id) }
  while (ids.length < kinds) { const d = pick(pool); if (!ids.includes(d.id)) ids.push(d.id) }
  const out = ids.map(id => ({ id, n: 1 })); for (let k = kinds; k < total; k++) out[Math.floor(R() * kinds)].n++
  // 生が一番多いのが居酒屋
  out.sort((a, b) => (b.id === 'beer') - (a.id === 'beer'))
  return out
}
function orderHtml(list) { const T = TT(); return `${T.orderHead}…<br>` + list.map(o => `${S.lang === 'ja' ? DK[o.id].ja : DK[o.id].en} <u>×${o.n}</u>`).join('<br>') }
function orderCount(list) { return list.reduce((a, o) => a + o.n, 0) }

// ---------- 遊びの進行
function difficulty() { return clamp(S.t / D.SHIFT.sec, 0, 1) }
function busy() { return S.tables.filter(t => t.st === 'call' || t.st === 'order').length }
function updateTables(dt) {
  const f = difficulty(), T = TT()
  // 呼ぶ
  S.nextCall -= dt
  if (S.nextCall <= 0 && S.t < D.SHIFT.sec - 8) {
    const idle = S.tables.filter(t => t.st === 'idle' && t.cust.length && Math.abs(t.x - S.x) > 3)
    if (idle.length && busy() < 1 + Math.floor(f * 2.6)) {
      const first = S.served === 0 && !S.orders.length && busy() === 0
      const t = first ? idle.reduce((a, b) => a.x < b.x ? a : b) : pick(idle)
      t.st = 'call'; t.wait = 0; t.callT = 0
    }
    S.nextCall = lerp(9, 3.6, f) * (0.7 + R() * 0.6)
  }
  for (const t of S.tables) {
    if (t.st === 'idle' || t.st === 'gone') continue
    t.wait += dt; t.callT -= dt
    const caller = t.cust[0]
    const lim = t.st === 'call' ? 50 : 80, angryAt = lim * 0.5
    t.angry = t.wait > angryAt ? 1 : 0
    if (t.st === 'call' && t.callT <= 0 && caller) {
      const hot = t.angry
      if (!showing()) bubble(caller, ((t.x - S.x) * S.dir < -1 ? T.behind + ' ' : '') + T.tableN.replace('{N}', t.i + 1) + ' ' + (hot ? pick(T.callAngry) : pick(T.call)), hot ? 'hot' : '', 1.8)
      play(caller, 'interact-right', 0.15)
      Snd.sfx('call', { hot }); t.callT = hot ? 2.2 : 3.2
    }
    if (t.st === 'order' && t.angry && t.callT <= 0 && caller && !showing()) { bubble(caller, T.tableN.replace('{N}', t.i + 1) + ' ' + pick(T.callAngry), 'hot', 1.6); t.callT = 3.5 }
    if (caller && t.callT < 1.2 && caller.cur !== 'sit') play(caller, 'sit', 0.3)
    for (const c of t.cust) if (c.anger) { c.anger.visible = !!t.angry; if (c.anger.visible) { headPos(c, c.anger.position); c.anger.position.x += 0.25; c.anger.scale.setScalar(0.45 + Math.sin(S.time * 10) * 0.06) } }
    if (t.wait > lim) {
      // 帰る
      S.money.left++; bubble(caller, T.leave, 'hot', 2); Snd.sfx('leave')
      S.orders = S.orders.filter(o => o.t !== t)
      t.st = 'gone'; t.leaveT = 0; bossSay(T.bossLeft, 2)
    }
  }
  for (const t of S.tables) {
    const sp = plates[t.i]; if (!sp) continue
    const hot = t.st === 'call' || (t.st === 'order' && t.angry)
    sp.material = hot ? sp.userData.hot : sp.userData.cold
    sp.position.y = sp.userData.y + (hot ? Math.abs(Math.sin(S.time * 6)) * 0.25 : 0)
    sp.scale.setScalar(hot ? 0.78 : t.st === 'order' ? 0.6 : 0.46)
  }
  updateZones()
  // 帰った席はしばらくして新しい客
  for (const t of S.tables) if (t.st === 'gone') { t.leaveT += dt; for (const c of t.cust) c.g.visible = t.leaveT < 1.2 ? Math.sin(t.leaveT * 30) > 0 : false; if (t.leaveT > 14) { t.st = 'idle'; t.wait = 0; for (const c of t.cust) { c.g.visible = true; if (c.anger) c.anger.visible = false } } }
}
function updateZones() {
  const free = S.orders.length < MAXO, play = S.mode === 'play'
  for (const t of S.tables) {
    const m = zoneMesh(t.i), on = !!(play && ((free && t.st === 'call') || (orderOf(t) && S.tray.length > 0)))   // visible は true/false 以外だと描かれてしまう
    m.visible = on; if (!on) continue
    const inside = Math.abs(t.x - S.x) < 1.45; m.material = inside ? ZONE.in : ZONE.far
    m.scale.setScalar(inside ? 1 : 1 + Math.sin(S.time * 6) * 0.04)
  }
  const c = zoneMesh(NT), on = play && S.orders.length > 0 && !S.tray.length && !showing()
  c.visible = !!on; if (on) { const inside = S.x < COUNTER_X + 0.6; c.material = inside ? ZONE.in : ZONE.far; c.scale.setScalar(inside ? 1 : 1 + Math.sin(S.time * 6) * 0.04) }
}
function nearTable() { let best = null; for (const t of S.tables) { const d = Math.abs(t.x - S.x); if (d < 1.45 && (!best || d < Math.abs(best.x - S.x))) best = t } return best }
function stopped() { return Math.abs(S.v) < 1.6 && S.y <= 0.001 && S.fallT <= 0 }
// 席での受け渡しは「ちゃんと止まった」時だけ（2026-11-03 本人「通り過ぎる時に勝手に奪われる・そこに運びたかったわけじゃないのにキレられる」）
function settled() { return Math.abs(S.v) < 0.7 && S.y <= 0.001 && S.fallT <= 0 }
const DWELL = 0.35
// 注文は同時に3席まで（本人: 3席まで同時に注文聞けるように）
const MAXO = 3
const orderOf = t => S.orders.find(o => o.t === t) || null
const showing = () => S.orders.find(o => o.showT > 0) || null
function needCount(orders) { const n = {}; for (const o of orders) for (const it of o.list) n[it.id] = (n[it.id] || 0) + it.n; return n }
function updateService(dt) {
  const T = TT()
  for (const o of S.orders) { o.showT -= dt; o.noT = (o.noT || 0) - dt; if (Math.abs(o.t.x - S.x) > 3) o.away = 1 }
  const t0 = nearTable()
  if (settled() && t0) { if (S.dwellT !== t0) { S.dwellT = t0; S.dwell = 0 } S.dwell = (S.dwell || 0) + dt } else { S.dwell = 0; S.dwellT = null }
  if (!stopped()) return
  const t = nearTable()
  if (!t) return
  const o = orderOf(t)
  if (t.st === 'call' && S.orders.length < MAXO && !showing()) {
    // 注文を聞く（一瞬で消える）
    const list = makeOrder(S.served === 0 && S.tut >= 0 && !S.orders.length)
    const n = orderCount(list), show = 2.4 + n * 0.35
    S.orders.push({ t, list, showT: show, asked: 1 }); t.st = 'order'; t.wait = 0; t.callT = show + 4
    bubble(t.cust[0], orderHtml(list), 'order', show, true); play(t.cust[0], 'emote-yes', 0.15)
    Snd.sfx('order'); bubble(P.rider, T.yorokonde, 'warm', 1.0)
  } else if (t.st === 'order' && o && S.tray.length && S.dwell < DWELL) {
    // 運んでいる時は、ちゃんと止まるまで何もしない（通り過ぎで渡したり怒られたりしない）
  } else if (t.st === 'order' && o) {
    const want = needCount([o]), mine = S.tray.some(c => want[c.id])
    const have = {}; for (const c of S.tray) have[c.id] = (have[c.id] || 0) + 1
    const complete = Object.keys(want).every(id => (have[id] || 0) >= want[id])
    // そろっている時だけ、この席の分だけ降ろす。足りない・よその分だけの時は降ろさず一言（怒らない・減らさない）
    if (S.tray.length && complete) serve(t, o)
    else if (S.tray.length && mine) { if (o.noT <= 0) { o.noT = 3; bubble(t.cust[0], T.notYet, 'warm', 1.4) } }
    else if (S.tray.length) { if (o.noT <= 0) { o.noT = 3; bubble(t.cust[0], T.notOurs, 'warm', 1.4) } }
    else if (o.away && o.showT < 0 && !showing()) {
      o.away = 0
      // もう一回聞く（怒られる）
      o.asked++; const n = orderCount(o.list), show = 1.8 + n * 0.3; o.showT = show
      bubble(t.cust[0], `<b>${T.reAsk}</b><br>` + orderHtml(o.list).split('<br>').slice(1).join('<br>'), 'order', show, true); t.wait += 6; t.callT = show + 3
      Snd.sfx('wrong')
    }
  }
}
// その席が頼んだ物だけトレーから降ろす。足りない分・誰も頼んでいない余りは注文間違い
function serve(t, o) {
  const T = TT(), want = needCount([o])
  let ok = 0, spill = 0
  const ids = []
  for (const id of Object.keys(want)) {
    const cups = S.tray.filter(c => c.id === id).sort((a, b) => b.fill - a.fill).slice(0, want[id])
    for (const c of cups) { ok++; spill += 1 - c.fill; ids.push(c.id); c.g.removeFromParent(); S.tray.splice(S.tray.indexOf(c), 1) }
  }
  const missing = orderCount(o.list) - ok
  S.orders = S.orders.filter(x => x !== o)
  // 誰も頼んでいない余りは、注文が全部片付いた時だけ注文間違いにする（まだ他の席の注文が残っていれば、持ったままでよい）
  const need = needCount(S.orders), extra = []
  if (!S.orders.length) for (const c of [...S.tray]) { if (need[c.id] > 0) need[c.id]--; else extra.push(c) }
  for (const c of extra) { spill += 1 - c.fill; c.g.removeFromParent(); S.tray.splice(S.tray.indexOf(c), 1) }
  layoutTray()
  const wrong = missing + extra.length
  S.money.cups += ok; S.money.wrong += wrong; S.money.spill += spill
  const pos = P.tray.getWorldPosition(new THREE.Vector3())
  const caller = t.cust[0]
  if (wrong) { bubble(caller, extra.length ? T.wrong : T.short, 'hot', 2); Snd.sfx('wrong'); play(caller, 'emote-no', 0.15); setTimeout(() => bossSay(T.bossWrong, 1.6), 600) }
  else if (spill > 0.6) { bubble(caller, T.spilled, 'warm', 1.8); Snd.sfx('clink') }
  else { bubble(caller, T.kanpai, '', 1.8); for (const c of t.cust) play(c, 'emote-yes', 0.15); ono('¥' + (ok * D.YEN.perCup), pos, 'yel', { size: 34 }); startToast(t, ids, ok) }
  t.st = 'idle'; t.wait = 0; S.served++
  if (S.tut >= 0 && !S.orders.length) { S.tut = -1; store.set('tut', '1') }
}
// 乾杯: 持って行ったグラスを客が持ち上げて当てる→泡が飛ぶ→飲む。杯数が多いほど派手。運んだ分しか出さない
const TOAST = { lift: 0.55, drink: 0.85, end: 1.8 }
function startToast(t, ids, ok) {
  endToast(t)
  const cx = t.x, cz = SIDE(t.i) * ZA_Z, top = ZA_Y + 0.92, big = clamp(ok / 6, 0, 1)
  const cups = ids.slice(0, 6).map((id, i) => {
    const c = t.cust[i] || null, cup = makeCup(id); cup.g.scale.setScalar(1.3); scene.add(cup.g)
    const a = i / Math.max(1, Math.min(ids.length, 6)) * Math.PI * 2, dx = c ? c.home[0] - cx : Math.cos(a) * 0.5, dz = c ? c.home[1] - cz : Math.sin(a) * 0.5, n = Math.hypot(dx, dz) || 1
    const ux = dx / n, uz = dz / n
    cup.from = new THREE.Vector3(cx + ux * 0.62, ZA_Y + 0.45, cz + uz * 0.62)
    cup.hit = new THREE.Vector3(cx + ux * 0.16, top, cz + uz * 0.16)
    cup.mouth = c ? new THREE.Vector3(c.home[0] - ux * 0.16, ZA_Y + 0.95, c.home[1] - uz * 0.16) : cup.from
    cup.g.position.copy(cup.from); cup.holder = c; cup.ux = ux
    return cup
  })
  t.toast = { t: 0, cups, big, ok, center: new THREE.Vector3(cx, top + 0.22, cz), rung: false }
}
function endToast(t) {
  if (!t.toast) return
  for (const cup of t.toast.cups) { cup.g.removeFromParent(); if (cup.holder) cup.holder.toastK = 0 }
  t.toast = null
}
function updateToasts(dt) {
  for (const t of S.tables) {
    const q = t.toast; if (!q) continue
    q.t += dt
    if (!q.rung && q.t >= TOAST.lift) {
      q.rung = true; Snd.sfx('kanpai')
      const n = 10 + q.ok * 3, col = (DK[q.cups[0].id] || {}).liq ?? 0xf2a91a
      fx.burst(q.center, { count: n * 2, color: 0xfff6d8, speed: 1.4 + q.big * 1.4, life: 0.55, size: 0.09 + q.big * 0.05 })
      emitDrops(q.center, Math.min(24, n), 0xfff8e4, 0); emitDrops(q.center, Math.min(16, 4 + q.ok * 2), col, (S.x - t.x) * 0.5)
      if (q.big > 0.5) fx.shake(0.012, 0.22)
      for (const cup of q.cups) { setFill(cup, cup.fill - 0.14 - q.big * 0.12); if (cup.foam) cup.foam.scale.y = 0.2 }
      if (q.ok >= 6) { photoMoment(2 + q.ok * 0.1); S.capTarget = q.center.clone() }
    }
    for (const cup of q.cups) {
      if (q.t < TOAST.lift) { cup.g.position.lerpVectors(cup.from, cup.hit, ease(q.t / TOAST.lift)); cup.g.rotation.z = -cup.ux * 0.32 * ease(q.t / TOAST.lift) }
      else if (q.t < TOAST.drink) { const k = (q.t - TOAST.lift) / (TOAST.drink - TOAST.lift); cup.g.position.lerpVectors(cup.hit, cup.mouth, ease(k) * 0.35); cup.g.position.y += Math.sin(k * Math.PI) * 0.09 }
      else { const k = clamp((q.t - TOAST.drink) / (TOAST.end - TOAST.drink), 0, 1); cup.g.position.lerpVectors(cup.hit, cup.mouth, 0.35 + ease(k) * 0.65); cup.g.rotation.z = cup.ux * ease(k) * 1.15; setFill(cup, Math.min(cup.fill, 0.72 * (1 - k))) }
      if (cup.holder) cup.holder.toastK = q.t < TOAST.lift ? ease(q.t / TOAST.lift) : q.t > TOAST.end - 0.15 ? (TOAST.end - q.t) / 0.15 : 1
    }
    if (q.t >= TOAST.end) endToast(t)
  }
}
function bossSay(text, life = 1.6) { if (BOSS.c) { bubble(BOSS.c, text, 'boss', life); Snd.sfx('boss') } }

// カウンター
function atCounter() { return S.x < COUNTER_X + 0.6 && stopped() }
function buildCounterUI() {
  const box = $('#drinks'), T = TT(), ds = avail()
  const key = S.lang + ds.length
  if (box.dataset.key !== key) {
    box.dataset.key = key
    box.innerHTML = ds.map((d, i) => `<button class="dk" type="button" data-id="${d.id}">${glassSvg(d)}<span>${S.lang === 'ja' ? d.ja : d.en}</span><i hidden></i></button>`).join('') + `<button class="dk clr" type="button" data-id="clear"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg><span>${T.clear}</span></button>`
  }
  const cnt = {}; for (const c of S.tray) cnt[c.id] = (cnt[c.id] || 0) + 1
  for (const b of box.querySelectorAll('.dk[data-id]')) { const i = b.querySelector('i'); if (!i) continue; const n = cnt[b.dataset.id] || 0; i.hidden = !n; i.textContent = n }
  $('#trayN').textContent = S.tray.length ? T.tray.replace('{N}', S.tray.length) : ''
}
function glassSvg(d) {
  const col = '#' + d.liq.toString(16).padStart(6, '0')
  if (d.glass === 'mug') return `<svg viewBox="0 0 32 32"><rect x="6" y="9" width="15" height="19" rx="2" fill="${col}" stroke="#1d1a16" stroke-width="2"/><path d="M6 11c0-5 15-5 15 0" fill="#fff" stroke="#1d1a16" stroke-width="2"/><path d="M21 13h3a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3h-3" fill="none" stroke="#1d1a16" stroke-width="2"/></svg>`
  return `<svg viewBox="0 0 32 32"><path d="M9 5h14l-1.5 23h-11z" fill="${col}" stroke="#1d1a16" stroke-width="2"/><path d="M9.3 9h13.4" stroke="rgba(255,255,255,.6)" stroke-width="2"/>${d.slice ? `<circle cx="20" cy="7" r="4" fill="#${d.slice.toString(16).padStart(6, '0')}" stroke="#1d1a16" stroke-width="1.5"/>` : ''}${d.bub ? '<circle cx="14" cy="20" r="1.2" fill="#fff"/><circle cx="17" cy="15" r="1" fill="#fff"/>' : ''}</svg>`
}
$('#drinks').addEventListener('click', e => {
  const b = e.target.closest('.dk'); if (!b || S.mode !== 'play') return
  Snd.init()
  if (b.dataset.id === 'clear') { clearTray(); Snd.sfx('tap') }
  else if (addCup(b.dataset.id)) { Snd.sfx('pour'); setTimeout(() => Snd.sfx('clink'), 120); const c = S.tray[S.tray.length - 1]; fx.squash(c.g, 0.25, 0.3) }
  buildCounterUI()
})

// ---------- 一輪車の動き
let noisePh = [0, 0, 0]
function noiseF(t) { return Math.sin(2.1 * t + noisePh[0]) + 0.6 * Math.sin(4.7 * t + noisePh[1]) + 0.35 * Math.sin(8.3 * t + noisePh[2]) }
function kick(k, why) { S.om += k; S.lastKick = why }
function updateRider(dt) {
  const T = TT()
  if (S.fallT > 0) {
    S.fallT -= dt; S.v *= 0.9
    if (S.fallT <= 0) { S.th = 0; S.om = 0; P.body.rotation.z = 0; if (P.rider) play(P.rider, 'holding-both', 0.2) }
    else { const k = 1 - S.fallT / 1.8; S.th = lerp(S.th, S.fallDir * 1.45, 0.2) }
    P.body.rotation.z = -S.th
    return
  }
  const pedal = (S.inF || S.keyF) && !S.turnQ ? 1 : 0, brake = (S.inB || S.keyB || S.turnQ) ? 1 : 0
  const vr = S.v * S.dir
  let target = 0
  if (brake) target = vr > 0.05 ? -BRAKE : S.turnQ ? (vr < -0.02 ? BRAKE : 0) : -ACC * 0.5  // うしろ: 止まってから押し続けるとゆっくり下がる
  else if (pedal) target = vr < 0 ? BRAKE : ACC
  else {
    // 止まりたい席（呼んでいる席・運び先）の前で指を離すと、そこでピタッと止まる
    const nt = nearTable(), want = nt && ((nt.st === 'call' && S.orders.length < MAXO) || orderOf(nt)) && Math.abs(nt.x - S.x) < 1.2
    const drag = want ? 11 : DRAG
    target = S.y > 0.001 ? 0 : -Math.sign(vr) * Math.min(Math.abs(vr) / dt, drag)  // 空中では減速しない
  }
  S.acc = lerp(S.acc, target, clamp(dt * 9, 0, 1))
  let nvr = vr + S.acc * dt
  if (brake && vr > 0 && nvr < 0) { nvr = 0; S.acc = 0 }
  nvr = clamp(nvr, -1.8, VMAX)
  if (!pedal && !brake && Math.abs(nvr) < 0.05) nvr = 0
  S.v = nvr * S.dir
  // Uターン（速いときはまずブレーキ）
  if (S.turnQ && Math.abs(S.v) < 0.7 && S.y <= 0.001) { S.dir = -S.dir; S.v = 0; S.acc = 0; S.turnQ = 0; S.turns++; Snd.sfx('squeak') }
  // こぎっぱなしだと後ろへ傾いていく。離すと戻る
  if (pedal && S.y <= 0.001) S.heat += dt; else S.heat = Math.max(0, S.heat - dt * 1.7)
  let nx = S.x + S.v * dt
  // 跳ぶ
  if (S.jumpQ > 0) { S.jumpQ -= dt; if (S.y <= 0.001) { S.vy = 7.5; S.jumpQ = 0; Snd.sfx('jump'); if (P.rider) bubble(P.rider, T.jumpS, '', 0.6) } }
  if (S.y > 0 || S.vy > 0) {
    S.vy -= 20 * dt; S.y += S.vy * dt
    if (S.y <= 0) { const imp = -S.vy; S.y = 0; S.vy = 0; Snd.sfx('land'); kick((R() - 0.4) * 0.9 * imp / 6 * Math.sign(S.v * S.dir || 1), 'land'); splashAll(0.015 + 0.006 * S.tray.length, 0.6); fx.squash(P.body, 0.12, 0.3) }
  }
  // ぶつかる
  const pw = 0.22
  let slip = 0
  for (const ob of S.obs) {
    const lo = ob.x - ob.w - pw, hi = ob.x + ob.w + pw
    if (ob.kind === 'puddle') { if (nx > lo + pw && nx < hi - pw && S.y <= 0.01) slip = 1; continue }
    if (ob.kind === 'stand' && ob.up < 0.5) continue
    const inNow = nx > lo && nx < hi, wasIn = S.x > lo && S.x < hi
    if (!inNow || S.y > ob.h) { if (!inNow) ob.hit = 0; continue }
    if (ob.hit) continue
    ob.hit = 1
    const sv = Math.sign(S.v || S.dir), fw = Math.sign(S.v * S.dir || 1), spd = Math.abs(S.v) / VMAX
    if (ob.kind === 'stand') { nx = S.x; S.v = -sv * 1.4; kick(fw * (0.8 + 1.6 * spd), 'stand'); Snd.sfx('bump'); bubble(ob.c, T.bump, 'warm', 0.9); splashAll(0.1 + 0.25 * spd, 1) }
    else if (ob.kind === 'step') { S.v *= 0.75; kick(fw * (0.5 + 1.5 * spd), 'step'); Snd.sfx('bump'); splashAll(0.06 + 0.15 * spd, 0.8) }
    else if (ob.kind === 'sleep') { S.v *= 0.3; kick(fw * (0.9 + 1.9 * spd), 'sleep'); Snd.sfx('bump'); if (ob.c) bubble(ob.c, T.bump, 'warm', 0.9); splashAll(0.12 + 0.2 * spd, 1) }
    else if (ob.kind === 'towel') { S.v *= 0.6; kick(fw * (0.7 + 1.5 * spd), 'towel'); Snd.sfx('bump'); splashAll(0.08 + 0.15 * spd, 0.8); ob.v *= -0.6 }
  }
  nx = clamp(nx, 0.9, LEN - 0.5); if (nx === 0.9 || nx === LEN - 0.5) S.v = 0
  const dx = nx - S.x; S.x = nx
  S.wheelA -= dx / WR
  // ふらつき（傾き θ はバネで戻るが、速さ・杯数・加速・水たまりで揺れる）
  const n = S.tray.length, spd = Math.abs(S.v) / VMAX
  const sig = (0.2 + 0.9 * Math.pow(spd, 1.5)) * (1 + 0.05 * n) * (slip ? 2.2 : 1)
  if (slip && Math.abs(S.v) > 0.5 && R() < dt * 3) { kick((R() - 0.5) * 1.4, 'slip'); if (R() < 0.3) Snd.sfx('squeak') }
  S.lastKick = Math.abs(S.om) < 0.5 ? null : S.lastKick
  const lean = 0.36 * Math.pow(S.heat, 1.3)   // こぎっぱなしで約7秒で後ろに転ぶ
  const F = -0.06 * S.acc - lean + sig * noiseF(S.time * (1 + spd * 0.6)) * 0.9
  const al = -10 * S.th - 2.6 * S.om + F
  S.om += al * dt; S.th += S.om * dt
  if (Math.abs(S.th) > 0.62 && S.y <= 0.001) fall(Math.sign(S.th) * S.dir, Math.sign(S.th))
  P.body.rotation.z = -S.th
  // 後ろに傾き始めたら本人が声を出す（見て分かる合図）
  S.tiltT = (S.tiltT || 0) - dt
  if (S.th < -0.17 && S.tiltT <= 0 && P.rider) { S.tiltT = 2.2; bubble(P.rider, pick(T.tilt), 'warm', 1.1); Snd.sfx('squeak') }
  S.roll = Math.sin(S.time * 3.1) * 0.025 * (1 + spd * 2) + Math.sin(S.time * 5.3) * 0.01
  // こぼれる
  const thr = clamp(0.2 - 0.008 * n, 0.09, 0.2)
  const over = Math.max(0, Math.abs(S.th) - thr), wob = Math.max(0, Math.abs(S.om) - 1.1)
  if (n && (over > 0 || wob > 0)) {
    let lost = 0
    for (const c of S.tray) { const d = (over * 2.4 + wob * 0.05) * c.k * (1 + c.col * 0.4) * dt; if (c.fill > 0 && d > 0) { setFill(c, c.fill - d); lost += d } }
    S.spillAcc = (S.spillAcc || 0) + lost
    S.spillBy[slip ? 'slip' : spd > 0.6 ? 'fast' : 'slowtilt'] = (S.spillBy[slip ? 'slip' : spd > 0.6 ? 'fast' : 'slowtilt'] || 0) + lost
    if (S.spillAcc > 0.06) { const c = pick(S.tray); emitDrops(c.g.getWorldPosition(new THREE.Vector3()), 3 + Math.floor(S.spillAcc * 20), DK[c.id].liq, Math.sign(S.th) * S.dir * 2); Snd.sfx('splash', { v: Math.min(1, S.spillAcc * 4) }); S.spillAcc = 0; maybePuddle() }
  }
}
function splashAll(amt, chance) {
  if (!S.tray.length) return
  let lost = 0
  for (const c of S.tray) if (R() < chance) { const d = amt * c.k; setFill(c, c.fill - d); lost += d }
  S.spillBy['hit:' + (S.lastKick || 'x')] = (S.spillBy['hit:' + (S.lastKick || 'x')] || 0) + lost
  if (lost > 0.05) { const p = P.tray.getWorldPosition(new THREE.Vector3()); emitDrops(p, 6 + Math.floor(lost * 12), 0xf2a91a, S.dir * 1.5); Snd.sfx('splash', { v: Math.min(1, lost) }); if (lost > 0.4) ono(TT().spill, p, 'yel', { size: 26 }); maybePuddle(); if (lost > 0.5) photoMoment(lost) }
}
function maybePuddle() { if (S.y > 0.01) return; if (S.obs.some(o => o.kind === 'puddle' && Math.abs(o.x - S.x) < 1.2)) return; if (S.x < COUNTER_X + 1) return; addObs('puddle', S.x - S.dir * 0.3, { w: 0.45 + R() * 0.3, life: 22 }) }
function fall(dir, local = 1) {
  const T = TT()
  S.fallT = 1.8; S.fallDir = local; S.falls++; S.heat = 0; S.inF = 0; S.turnQ = 0; (S.fallWhy = S.fallWhy || []).push(S.lastKick || 'tilt')
  const n = S.tray.length
  S.money.broken += n
  const p = P.tray.getWorldPosition(new THREE.Vector3())
  // グラスが飛ぶ
  for (const c of S.tray) { const w = c.g.getWorldPosition(new THREE.Vector3()); c.g.removeFromParent(); scene.add(c.g); c.g.position.copy(w); c.fly = { v: new THREE.Vector3(dir * (2 + R() * 3), 3 + R() * 3, (R() - 0.5) * 2), r: new THREE.Vector3(R() * 8, R() * 8, R() * 8), t: 0 }; flying.push(c) }
  S.tray = []
  emitDrops(p, 30, 0xf2a91a, dir * 3)
  if (n) Snd.sfx('crash'); else Snd.sfx('bump')
  fx.moment(p, { burst: { count: 30, color: 0xfff0b0, speed: 3 }, shake: [0.05, 0.4], zoom: [0.1, 0.5], hitstop: 120 })
  ono(T.fall, p, 'red', { size: 46, life: 1.4 })
  if (P.rider) play(P.rider, 'die', 0.1, 1.4, true)
  setTimeout(() => bossSay(pick(T.bossFall), 1.8), 500)
  if (S.x > COUNTER_X + 1) addObs('puddle', S.x + dir * 0.8, { w: 1.0, life: 30 })
  S.capAt = 0.35; S.capScore = 5 + n
}
const flying = []
function updateFlying(dt) {
  for (let i = flying.length - 1; i >= 0; i--) {
    const c = flying[i], f = c.fly; f.t += dt
    f.v.y -= 14 * dt; c.g.position.addScaledVector(f.v, dt); c.g.rotation.x += f.r.x * dt; c.g.rotation.z += f.r.z * dt
    if (c.g.position.y < 0.05) { c.g.position.y = 0.05; f.v.multiplyScalar(0.3); f.v.y = Math.abs(f.v.y) * 0.3; if (!f.broke) { f.broke = 1; emitDrops(c.g.position, 4, 0xdff3ff, 0) } }
    if (f.t > 2.2) { c.g.removeFromParent(); flying.splice(i, 1) }
  }
}
// 障害物の出現と動き
function updateObs(dt) {
  const f = difficulty(), T = TT()
  S.obsT = (S.obsT ?? 6) - dt
  if (S.obsT <= 0) {
    S.obsT = lerp(9, 4, f) * (0.7 + R() * 0.6)
    const ahead = S.x + S.dir * (7 + R() * 6)
    const x = clamp(ahead, 6, LEN - 2)
    const near = S.obs.some(o => Math.abs(o.x - x) < 2.5 && o.kind !== 'puddle')
    if (!near && S.tut < 0 || (!near && S.tut >= 0 && S.tray.length)) {
      const r = R()
      if (r < 0.45 && S.obs.filter(o => o.kind === 'sleep').length < 3) { const o = addObs('sleep', x, { life: 26 }); if (o.c) bubble(o.c, T.drunkSleep, '', 1.5) }
      else if (r < 0.75) addObs('towel', clamp(S.x + S.dir * 9, 4, LEN - 1), { v: -S.dir * (2.2 + f * 1.5), life: 8 })
      else { const t = S.tables.find(t => Math.abs(t.x - x) < 4.5 && t.st === 'idle' && t.cust.length > 1); if (t) standUp(t) }
    }
  }
  for (let i = S.obs.length - 1; i >= 0; i--) {
    const ob = S.obs[i]; ob.t += dt
    if (ob.kind === 'towel') { ob.x += ob.v * dt; ob.g.position.x = ob.x; ob.g.rotation.z -= ob.v * dt / 0.12 }
    if (ob.kind === 'puddle') { const k = ob.t < 0.4 ? ob.t / 0.4 : ob.life - ob.t < 2 ? (ob.life - ob.t) / 2 : 1; ob.g.scale.set(ob.w * k, 0.6 * k, 1) }
    if (ob.kind === 'sleep' && ob.c) { ob.c.mixer.update(0); if (ob.t > ob.life - 1) ob.c.g.visible = Math.sin(ob.t * 30) > 0 }
    if (ob.kind === 'stand') updateStander(ob, dt)
    if (ob.t > ob.life || (ob.kind === 'towel' && (ob.x < 0 || ob.x > LEN))) { freeObs(ob); S.obs.splice(i, 1) }
  }
}
function setFlush(c, k) { if (c.flush === k) return; c.flush = k; c.g.traverse(m => { if (m.isMesh && m.material.emissive) { m.material.emissive.setHex(0xa02010); m.material.emissiveIntensity = 0.45 * k } }) }
function standUp(t) {
  const c = t.cust[1]; if (!c || t.standing || t.toast) return
  t.standing = 1
  const ob = { kind: 'stand', x: c.home[0] + (c.home[0] > t.x ? 0.4 : -0.4), w: 0.42, h: 3, life: 4.2, t: 0, hit: 0, c, up: 0, tab: t }
  S.obs.push(ob)
  bubble(c, pick([TT().drunkUp, TT().drunkUp2, TT().drunkUp3]), 'warm', 2.5)
}
function updateStander(ob, dt) {
  const c = ob.c, [hx, hz, hr] = c.home, k = ob.t < 0.5 ? ob.t / 0.5 : ob.t > ob.life - 0.6 ? (ob.life - ob.t) / 0.6 : 1
  ob.up = k
  c.g.position.set(lerp(hx, ob.x, ease(k)), lerp(ZA_Y, 0, ease(k)), lerp(hz, 0, ease(k)))
  c.g.rotation.y = lerp(hr, S.dir > 0 ? -Math.PI / 2 : Math.PI / 2, ease(k))
  if (k > 0.2) play(c, 'idle', 0.2); else play(c, 'sit', 0.2)
  c.armOpen = k
  // 酔っ払い: 通路いっぱいに腕を広げて、ふらふら揺れる。顔が赤い
  c.g.rotation.z = Math.sin(ob.t * 3.1) * 0.13 * k; c.g.rotation.x = Math.sin(ob.t * 2.3) * 0.05 * k
  setFlush(c, k)
  if (ob.t > ob.life - 0.01) { c.g.position.set(hx, ZA_Y, hz); c.g.rotation.set(0, hr, 0); c.armOpen = 0; setFlush(c, 0); play(c, 'sit', 0.1); ob.tab.standing = 0 }
}
// 写真（明細に貼る一番の場面）
function photoMoment(score) { if (score > S.photoScore) { S.capAt = 0.05; S.capScore = score } }
const photoC = document.createElement('canvas'); photoC.width = photoC.height = 300
function capturePhoto() {
  render()
  const src = renderer.domElement, W = src.width, H = src.height, sx = W / innerWidth
  const p = toScreen(S.capTarget || _w.set(S.x, 1.5, 0)), s = Math.min(W, H) * 0.62; S.capTarget = null
  const cx = clamp(p.x * sx, s / 2, W - s / 2), cy = clamp(p.y * sx, s / 2, H - s / 2)
  try { photoC.getContext('2d').drawImage(src, cx - s / 2, cy - s / 2, s, s, 0, 0, 300, 300); S.photo = photoC } catch (e) {}
}

function updateGame(dt) {
  if (S.mode !== 'play') return
  S.t += dt
  updateRider(dt); updateObs(dt); updateTables(dt); updateService(dt); updateFlying(dt); updateDrops(dt); updateToasts(dt)
  if (S.capAt !== undefined && S.capAt !== null) { S.capAt -= dt; if (S.capAt <= 0) { S.capAt = null; S.photoScore = S.capScore; S.doCap = true } }
  Snd.busy = clamp(busy() / 4, 0, 1)
  // 店長の声
  S.bossT -= dt
  if (S.bossT <= 0) { S.bossT = 9 + R() * 6; if (busy() >= 2) bossSay(pick(TT().bossBusy)) }
  // カウンターの画面
  const ac = atCounter() && (S.orders.length || S.tray.length)
  if (ac !== !$('#counter').hidden) { $('#counter').hidden = !ac; if (ac) buildCounterUI() }
  if (S.t >= D.SHIFT.sec && !S.ended) endShift()
}
function endShift() {
  S.ended = true; S.mode = 'end'; S.endT = 0; Snd.sfx('end'); Snd.setTrack('end')
  bossSay(TT().bossEnd, 3); $('#counter').hidden = true; $('#hint').hidden = true; $('#finger').hidden = true
  for (const id of ['#ctlL', '#ctlR', '#map']) $(id).style.visibility = 'hidden'
  if (!S.photo) S.doCap = true
}
function updateEnd(dt) { S.endT += dt; S.v *= 0.9; S.acc = 0; updateDrops(dt); updateFlying(dt); if (S.endT > 2.2) toResult() }

// ---------- チュートリアル（最初の1回だけ）
function updateTutorial() {
  const h = $('#hint'), fg = $('#finger')
  if (S.tut < 0 || S.mode !== 'play') { h.hidden = true; fg.hidden = true; return }
  const T = TT(); let txt = '', el = null
  const calling = S.tables.find(t => t.st === 'call')
  const facing = x => (x - S.x) * S.dir > 0
  const pedalOn = S.inF || S.keyF
  const lean = S.th < -0.12 && pedalOn
  const turn = () => { txt = isTouch ? T.tutTurn : T.tutTurnPC; el = '#bTurn' }
  if (lean) { txt = T.tutLean; el = '#bFwd' }
  else if (!S.order && calling) { const near = Math.abs(calling.x - S.x) < 1.45; if (near) { txt = T.tutStop; el = Math.abs(S.v) > 1.2 ? '#bBack' : null } else if (!facing(calling.x)) turn(); else { txt = isTouch ? T.tutGo : T.tutGoPC; el = pedalOn ? null : '#bFwd' } }
  else if (S.order && S.order.showT > 0) txt = T.tutMem
  else if (S.order && !S.tray.length && !atCounter()) { if (facing(COUNTER_X + 3)) { txt = T.tutBack; el = pedalOn ? null : '#bFwd' } else turn() }
  else if (S.order && atCounter()) txt = T.tutPick
  else if (S.order && S.tray.length) { if (!facing(S.order.t.x)) turn(); else { txt = T.tutCarry; el = S.obs.some(o => o.kind === 'sleep' && (o.x - S.x) * S.dir > 0 && (o.x - S.x) * S.dir < 5) ? '#bJump' : pedalOn ? null : '#bFwd' } }
  h.hidden = !txt; if (txt && h.textContent !== txt) h.textContent = txt
  if (el && isTouch) { const r = $(el).getBoundingClientRect(); fg.hidden = false; fg.style.transform = `translate(${r.left + r.width / 2 - 14}px,${r.top - 40}px)` } else fg.hidden = true
}

// ---------- 場面
function updateScene(dt) {
  S.time += dt
  P.g.position.set(S.x, S.y, 0)
  P.wheel.rotation.z = S.wheelA; P.ped.rotation.z = S.wheelA
  S.face = lerp(S.face, S.dir > 0 ? Math.PI / 2 : -Math.PI / 2, clamp(dt * 10, 0, 1))
  P.body.rotation.y = S.face - Math.PI / 2; P.body.rotation.x = S.roll
  if (P.rider) {
    P.rider.g.rotation.y = Math.PI / 2
    P.rider.mixer.update(dt)
    // 手はトレーを支える位置に（腕を前へ）
  }
  // トレーの位置（体の前・頭の上）と揺れ
  P.tray.position.set(0.1, SEAT + 0.74 + Math.sin(S.time * 7) * 0.01 * Math.abs(S.v), -0.58)
  P.tray.rotation.set(S.roll * 0.6, 0, -S.th * 0.4 + S.om * 0.03)
  for (const c of S.tray) { if (c.foam) c.foam.position.x = Math.sin(S.time * 9 + c.k * 5) * 0.004 * (1 + Math.abs(S.om)) }
  // 客
  for (const t of S.tables) for (const c of t.cust) {
    if (Math.abs(c.g.position.x - S.x) > 24) continue
    c.mixer.update(dt)
    if (c.armOpen > 0 && c.armL) { const w = Math.sin(S.time * 5 + c.k) * 0.18, a = c.armOpen; c.armL.rotation.set(-1.25 * a, 0, (0.75 + w) * a); c.armR.rotation.set(-1.25 * a, 0, (-0.75 + w) * a) }
    else if (c.toastK > 0 && c.armR) { c.armR.rotation.x = -2.1 * c.toastK }
  }
  if (BOSS.c) { BOSS.c.mixer.update(dt); BOSS.c.g.rotation.y = lerp(BOSS.c.g.rotation.y, Math.atan2(S.x - BOSS.c.g.position.x, -BOSS.c.g.position.z), 0.05) }
  // のれん・提灯
  for (const g of lanterns) {
    if (g.userData.noren) { const near = Math.abs(S.x - g.position.x) < 0.6 && Math.abs(S.v) > 0.5; if (near) g.userData.flap = Math.max(g.userData.flap, Math.abs(S.v) / VMAX); g.userData.flap *= 0.97; g.children.forEach((p, i) => { if (p.userData.k !== undefined) p.rotation.x = Math.sin(S.time * 8 + i) * g.userData.flap * 0.6 }) }
    else { g.rotation.z = Math.sin(S.time * 1.3 + g.position.x) * 0.04; if (g.userData.flick) g.userData.flick.emissiveIntensity = (Math.sin(S.time * 23 + g.position.x) > 0.6 || Math.sin(S.time * 1.7) > 0.3) ? 0.45 : 0.03 }
  }
  for (const L of lights) {
    const t = S.time + L.ph, buzz = L.bad ? (Math.sin(t * 31) > 0.2 && Math.sin(t * 2.3) > -0.5 ? 1 : 0.08) : (Math.sin(t * 47) > 0.97 ? 0.4 : 1)
    L.pl.intensity = L.base * buzz; if (L.bad) L.tm.emissiveIntensity = 1.2 * buzz
  }
  lamp.position.set(S.x + S.dir * 3, 1.5, 0)
  frameCamera(dt)
  // 太陽（影）を主人公に合わせて動かす
  lk.sun.target.position.set(S.x + S.dir * 5, 0, 0); lk.sun.position.copy(lk.sun.target.position).add(SUN_OFF); lk.sun.target.updateMatrixWorld()
}
const _cp = new THREE.Vector3(), _cl = new THREE.Vector3(), camP = new THREE.Vector3(), camL = new THREE.Vector3()
let camFace = Math.PI / 2, peek = 0, camInit = false
let camToast = 0; const camToastAt = new THREE.Vector3()
function frameCamera(dt = 1) {
  const a = innerWidth / innerHeight, portrait = a < 1
  camera.aspect = a
  camera.fov = portrait ? 64 : a > 1.9 ? 46 : 52
  const snap = dt >= 1 || !camInit; camInit = true
  if (S.mode === 'title') {
    // 正面の斜め前から主人公と店長
    _cp.set(S.x + (portrait ? 4.4 : 3.6), 1.75, portrait ? 1.3 : 1.9); _cl.set(S.x - 0.8, portrait ? 1.55 : 1.3, -0.1)
    camFace = S.face
  } else {
    let d = S.face - camFace; d = Math.atan2(Math.sin(d), Math.cos(d))
    camFace = snap ? S.face : camFace + d * clamp(dt * 4.5, 0, 1)
    const fx_ = Math.sin(camFace), fz_ = Math.cos(camFace), rx = -fz_, rz = fx_
    const dist = portrait ? 3.5 : 3.9, h = portrait ? 3.0 : 2.85, side = portrait ? 0.85 : 1.0
    const nt = S.mode === 'play' && stopped() ? nearTable() : null
    const t = S.mode === 'play' ? (showing() ? showing().t : nt && ((nt.st === 'call' && S.orders.length < MAXO) || orderOf(nt)) ? nt : null) : null   // 用のある席だけ覗く
    const toasting = nt && nt.toast && nt.toast.t < TOAST.end - 0.25
    const want = toasting ? SIDE(nt.i) * rz : t ? SIDE(t.i) * rz : 0
    peek = snap ? want : lerp(peek, want, clamp(dt * 3, 0, 1))
    // 乾杯の間だけ席のほうへ顔を向ける（動き出したらすぐ戻る）
    camToast = snap ? 0 : lerp(camToast, toasting ? 1 : 0, clamp(dt * (toasting ? 5 : 8), 0, 1))
    if (toasting) camToastAt.copy(nt.toast.center)
    const sd = side - peek * 0.35, ahead = 4.6 - Math.abs(peek) * 1.6, lk = portrait ? 1.1 : 1.6
    _cp.set(S.x - fx_ * dist + rx * sd, h, -fz_ * dist + rz * sd)
    _cl.set(S.x + fx_ * ahead + rx * peek * lk, 0.75 + Math.abs(peek) * 0.25, fz_ * ahead + rz * peek * lk)
    if (camToast > 0.001) _cl.lerp(camToastAt, camToast)
  }
  _cp.x = clamp(_cp.x, W0 + 0.4, W1 - 0.4); _cp.z = clamp(_cp.z, -WALL_Z + 0.5, WALL_Z - 0.5)
  if (snap) { camP.copy(_cp); camL.copy(_cl) } else { const k = clamp(dt * 6, 0, 1); camP.lerp(_cp, k); camL.lerp(_cl, k) }
  camera.position.copy(camP); camera.lookAt(camL)
  camera.updateProjectionMatrix()
}

// ---------- 画面の切り替え
const views = ['vTitle', 'vHow', 'vPlay', 'vResult']
function show(id) { for (const v of views) $('#' + v).hidden = v !== id; $('#moreBox').hidden = true }
function applyLang() {
  const T = TT()
  document.documentElement.lang = S.lang
  for (const el of document.querySelectorAll('[data-t]')) el.innerHTML = T[el.dataset.t]
  $('#langTxt').textContent = S.lang === 'ja' ? 'EN' : 'JA'
  $('#bMoreX').setAttribute('aria-label', T.close)
  $('#drinks').dataset.key = ''
  $('#map').innerHTML = ''
  if (S.mode === 'result') drawSlip(S.stamped ? 1 : 0)
  if (!$('#moreBox').hidden) fillMore()
}
function resetRun(seed) {
  S.rand = seed ? mulberry(seed) : Math.random
  noisePh = [R() * 6, R() * 6, R() * 6]
  clearFx(); clearTray(); clearObs()
  for (const c of flying) c.g.removeFromParent(); flying.length = 0
  for (const t of S.tables) { endToast(t); t.st = 'idle'; t.wait = 0; t.standing = 0; for (const c of t.cust) { c.g.visible = true; c.armOpen = 0; setFlush(c, 0); const [x, z, r] = c.home; c.g.position.set(x, ZA_Y, z); c.g.rotation.set(0, r, 0); play(c, 'sit', 0); if (c.anger) c.anger.visible = false } }
  Object.assign(S, { t: 0, x: 1.2, v: 0, acc: 0, y: 0, vy: 0, dir: 1, th: 0, om: 0, fallT: 0, falls: 0, order: null, served: 0, nextCall: 1.2, money: { cups: 0, wrong: 0, spill: 0, broken: 0, left: 0 }, photo: null, photoScore: 0, capAt: null, fallWhy: [], lastKick: null, spillBy: {}, bossT: 6, ended: false, obsT: 8, result: null, jumpQ: 0, spillAcc: 0, heat: 0, turnQ: 0, turns: 0, inF: 0, inB: 0, keyF: 0, keyB: 0, face: Math.PI / 2, roll: 0, tiltT: 0 })
  camInit = false
  if (P.rider) { play(P.rider, 'holding-both', 0); P.body.rotation.z = 0 }
  for (const id of ['#ctlL', '#ctlR', '#map']) $(id).style.visibility = ''
}
function startRun(seed) {
  Snd.init(); Snd.sfx('tap')
  resetRun(seed)
  S.mode = 'play'; show('vPlay'); $('#counter').hidden = true; Snd.setTrack('play')
  setTimeout(() => { if (S.mode === 'play') bossSay(TT().bossStart, 2.2) }, 400)
}
function toTitle() { Snd.sfx('tap'); resetRun(); S.mode = 'title'; show('vTitle'); Snd.setTrack('title') }
// 通路の見取り図（呼んでいる席と自分の位置）
const MAP = { W: 200, H: 34, x: x => 12 + (x / LEN) * 182 }
function buildMap() {
  const m = $('#map'), T = TT()
  m.innerHTML = `<svg viewBox="0 0 ${MAP.W} ${MAP.H}"><rect x="1" y="1" width="${MAP.W - 2}" height="${MAP.H - 2}" rx="8" class="mBg"/><rect x="${MAP.x(-1.2)}" y="5" width="5" height="${MAP.H - 10}" rx="2" class="mCt"/>` +
    S.tables.map(t => `<g class="mT" id="mt${t.i}" transform="translate(${MAP.x(t.x)},${SIDE(t.i) < 0 ? 9 : MAP.H - 9})"><circle r="6.5"/><text y="3.3">${t.i + 1}</text></g>`).join('') +
    `<path id="mMe" class="mMe" d="M-5 -4L5 0L-5 4z"/></svg>`
}
function updateMap() {
  const m = $('#map'); if (!m.firstChild) buildMap()
  for (const t of S.tables) { const g = $('#mt' + t.i); if (g) g.setAttribute('class', 'mT ' + (t.st === 'call' ? 'call' : t.st === 'order' ? (orderOf(t) && orderOf(t).t === t ? 'mine' : 'call') : t.st)) }
  const me = $('#mMe'); if (me) me.setAttribute('transform', `translate(${MAP.x(S.x)},${MAP.H / 2}) scale(${S.dir})`)
}
function updateHud() {
  $('#bFwd').classList.toggle('on', !!(S.inF || S.keyF)); $('#bFwd').classList.toggle('hot', S.th < -0.15)
  $('#bBack').classList.toggle('on', !!(S.inB || S.keyB)); $('#bTurn').classList.toggle('on', !!S.turnQ)
  updateMap()
  const sh = D.SHIFT, m = sh.h0 * 60 + (sh.h1 - sh.h0) * 60 * clamp(S.t / sh.sec, 0, 1)
  const s = `${Math.floor(m / 60)}:${String(Math.floor(m % 60 / 5) * 5).padStart(2, '0')}`
  const el = $('#hClock'); if (el.textContent !== s) el.textContent = s
}
// ---------- 結果（給料明細）
function calcResult() {
  const T = TT(), Y = D.YEN, m = S.money
  const spillCups = Math.round(m.spill * 2) / 2
  const slip = {
    lang: S.lang, no: 1, job: T.job, date: (d => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`)(new Date()), wage: D.SHIFT.wage, hours: D.SHIFT.hours,
    pay: [{ label: T.perCup, note: T.perCupN.replace('{N}', m.cups), yen: m.cups * Y.perCup }],
    ded: [
      { label: T.dWrong, note: T.dWrongN.replace('{N}', m.wrong), yen: m.wrong * Y.wrong },
      { label: T.dSpill, note: T.dSpillN.replace('{N}', spillCups), yen: Math.round(spillCups * Y.spillPerCup) },
      { label: T.dBroken, note: T.dBrokenN.replace('{N}', m.broken), yen: m.broken * Y.broken },
      { label: T.dFall, note: T.dFallN.replace('{N}', S.falls), yen: S.falls * Y.fall },
      { label: T.dLeft, note: T.dLeftN.replace('{N}', m.left), yen: m.left * Y.left },
    ],
    boss: T.bossName, footer: T.footer,
  }
  const net = totals(slip).net
  const rank = m.cups === 0 ? D.RANKS[0] : [...D.RANKS].reverse().find(r => net >= r.min)
  slip.comment = rank.cmt[S.lang]; slip.stamp = rank.st[S.lang]
  return { slip, net, rank, served: S.served, falls: S.falls, raw: { ...m } }
}
const slipTheme = { main: '#9d2b25', dark: '#3b1411', accent: '#e9b44c', bg: '#2a1a14' }
function drawSlip(k = 1) {
  const r = S.result; if (!r) return
  const fresh = calcResult(); r.slip = { ...fresh.slip, comment: r.rank.cmt[S.lang], stamp: r.rank.st[S.lang] }
  drawPayslip($('#slip'), { ...r.slip, photo: S.photo, stampK: k }, slipTheme)
}
async function toResult() {
  S.mode = 'resultWait'; S.result = calcResult(); S.resT = 0; S.stamped = false
  for (const id of ['#rBtns1', '#rBtns2', '#bMore']) $(id).classList.remove('on')
  try { await document.fonts.ready } catch (e) {}
  S.mode = 'result'; drawSlip(0); show('vResult'); clearFx(); fitSlip()
}
function fitSlip() {
  const c = $('#slip'); if ($('#vResult').hidden) return
  c.style.width = c.style.height = '0px'
  const box = c.parentElement.getBoundingClientRect(), side = $('.resSide').getBoundingClientRect()
  const row = getComputedStyle(c.parentElement).flexDirection === 'row'
  const aw = row ? box.width - side.width - 14 : box.width, ah = row ? box.height : box.height - side.height - 8
  const k = Math.max(0.05, Math.min(aw / 1080, ah / 1350))
  c.style.width = Math.floor(1080 * k) + 'px'; c.style.height = Math.floor(1350 * k) + 'px'
}
function updateReveal(dt) {
  if (S.mode !== 'result') return
  S.resT += dt
  if (S.resT > 0.6 && S.resT < 1.0) drawSlip(clamp((S.resT - 0.6) / 0.35, 0, 1))
  if (S.resT >= 1.0 && !S.stamped) { S.stamped = true; drawSlip(1); Snd.sfx('stamp') }
  if (S.resT > 1.3) for (const id of ['#rBtns1', '#rBtns2', '#bMore']) $(id).classList.add('on')
}
function finishReveal() { if (S.mode === 'result' && S.resT < 1.3) { S.resT = 1.29; updateReveal(0.02) } }
async function saveCard() {
  Snd.sfx('tap'); finishReveal()
  try { await document.fonts.ready } catch (e) {}
  const a = document.createElement('a'); a.href = $('#slip').toDataURL('image/png'); a.download = `job-izakaya-${S.result.net}.png`; document.body.appendChild(a); a.click(); a.remove()
}
function shareText() { const r = S.result, T = TT(); return T.share.replace('{Y}', (r.net < 0 ? '-' : '') + Math.abs(r.net).toLocaleString('en-US')).replace('{C}', S.lang === 'ja' ? `店長「${r.rank.cmt.ja}」` : `Manager: "${r.rank.cmt.en}"`) }
function xPost() { const text = shareText(); return { text, url: D.PUBLIC_URL, href: `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(D.PUBLIC_URL)}` } }
function openX() { if (!S.result) return; Snd.sfx('tap'); window.open(xPost().href, '_blank', 'noopener') }
// ほかのバカゲー
const esc = x => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
function fillMore() { const L = S.lang; $('#moreL').innerHTML = D.others.map(g => `<a href="${esc(g.url)}" target="_blank" rel="noopener"><img src="${esc(g.url)}og.png" alt="" width="1200" height="630" decoding="async" onerror="this.style.visibility='hidden'"><b>${esc(g[L])}</b><span>${esc(L === 'ja' ? g.dj : g.de)}</span></a>`).join('') }
function openMore() { Snd.init(); Snd.sfx('tap'); fillMore(); $('#moreBox').hidden = false }
function closeMore() { if ($('#moreBox').hidden) return; $('#moreBox').hidden = true; Snd.sfx('tap') }

// ---------- 入力
function holdBtn(id, key) {
  const b = $(id)
  const on = e => { e.preventDefault(); Snd.init(); S[key] = 1; b.classList.add('on'); try { b.setPointerCapture(e.pointerId) } catch (er) {} }
  const off = () => { S[key] = 0; b.classList.remove('on') }
  b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off)
}
// こぐ・ブレーキは押している間だけ（本人: 勝手にこぎ続けるのはだるい）
holdBtn('#bFwd', 'inF'); holdBtn('#bBack', 'inB')
$('#bFwd').addEventListener('pointerdown', () => { S.turnQ = 0 })
$('#bTurn').addEventListener('pointerdown', e => { e.preventDefault(); Snd.init(); if (S.mode === 'play' && S.fallT <= 0) { S.turnQ = 1; S.inF = 0 } })
$('#bJump').addEventListener('pointerdown', e => { e.preventDefault(); Snd.init(); if (S.mode === 'play' && S.fallT <= 0) S.jumpQ = 0.15 })
addEventListener('keydown', e => {
  if (S.mode !== 'play') { if ((e.key === 'Enter' || e.key === ' ') && S.mode === 'title' && document.activeElement === document.body) { e.preventDefault(); startRun() } return }
  const k = e.key
  if (k === 'ArrowUp' || k === 'w' || k === 'W') { S.keyF = 1; e.preventDefault() }
  else if (k === 'ArrowDown' || k === 's' || k === 'S') { S.keyB = 1; S.inF = 0; e.preventDefault() }
  else if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'a' || k === 'A' || k === 'd' || k === 'D') { if (!e.repeat && S.fallT <= 0) { S.turnQ = 1; S.inF = 0 } e.preventDefault() }
  else if (k === ' ') { if (S.fallT <= 0) S.jumpQ = 0.15; e.preventDefault() }
  else if (/^[1-9]$/.test(k) && !$('#counter').hidden) { const b = $('#drinks').querySelectorAll('.dk')[+k - 1]; if (b) b.click() }
  else if ((k === 'Backspace' || k === '0') && !$('#counter').hidden) { clearTray(); buildCounterUI() }
})
addEventListener('keyup', e => { const k = e.key; if (k === 'ArrowUp' || k === 'w' || k === 'W') S.keyF = 0; if (k === 'ArrowDown' || k === 's' || k === 'S') S.keyB = 0 })
addEventListener('blur', () => { S.keyF = S.keyB = S.inF = S.inB = 0 })

// ---------- ループ（固定60Hz）
function render() { look.update(); fx.applyCamera(); renderer.render(scene, camera) }
let acc = 0, lastT = performance.now()
function step() {
  const vdt = fx.update(STEP)
  if (vdt > 0) { updateGame(STEP); if (S.mode === 'end') updateEnd(STEP) }
  else if (S.mode !== 'play') { updateGame(STEP); if (S.mode === 'end') updateEnd(STEP) }
  if (S.mode === 'title') titleIdle(STEP)
  updateScene(STEP); updateFx(STEP); updateReveal(STEP); updateTutorial()
  if (S.doCap) { S.doCap = false; capturePhoto() }
}
function titleIdle(dt) { S.tt = (S.tt || 0) + dt; S.th = Math.sin(S.tt * 2.2) * 0.08; S.om = 0; P.body.rotation.z = -S.th; S.x = 1.6 + Math.sin(S.tt * 0.5) * 0.5; S.v = Math.cos(S.tt * 0.5) * 0.25; S.wheelA = -S.x / WR; S.dir = 1; S.roll = Math.sin(S.tt * 3.1) * 0.03 }
function loop() {
  requestAnimationFrame(loop)
  const now = performance.now(); let dt = (now - lastT) / 1000; lastT = now
  if (S.dbgPause) { Snd.tick(); render(); return }
  acc += Math.min(dt, 0.25)
  let n = 0; while (acc >= STEP && n < 8) { step(); acc -= STEP; n++ }
  if (n === 8) acc = 0
  if (S.mode === 'play') updateHud()
  Snd.tick(); render()
}
function syncMute() { $('#icOn').hidden = Snd.muted; $('#icOff').hidden = !Snd.muted }
function resize() { renderer.setPixelRatio(lowRes()); renderer.setSize(innerWidth, innerHeight, false); frameCamera(); fitSlip() }

// ---------- 起動
clearObs(); applyLang(); syncMute(); resize()
addEventListener('resize', resize)
$('#bStart').onclick = () => startRun()
$('#bHow').onclick = () => { Snd.init(); Snd.sfx('tap'); show('vHow') }
$('#bHowBack').onclick = () => { Snd.sfx('tap'); show('vTitle') }
$('#bAgain').onclick = () => startRun()
$('#bTitle').onclick = () => toTitle()
$('#bSave').onclick = saveCard
$('#bX').onclick = openX
$('#bMore').onclick = openMore; $('#bMoreT').onclick = openMore; $('#bMoreX').onclick = closeMore
$('#moreBox').addEventListener('click', e => { if (e.target === e.currentTarget) closeMore() })
addEventListener('keydown', e => { if (e.key === 'Escape') closeMore() })
$('#vResult').addEventListener('pointerdown', e => { if (!e.target.closest('button')) finishReveal() })
$('#bLang').onclick = () => { Snd.init(); S.lang = S.lang === 'ja' ? 'en' : 'ja'; store.set('lang', S.lang); applyLang(); Snd.sfx('tap') }
$('#bMute').onclick = () => { Snd.init(); Snd.setMute(!Snd.muted); syncMute() }
document.addEventListener('visibilitychange', () => { S.keyF = S.keyB = S.inF = S.inB = 0 })
show('vTitle'); Snd.setTrack('title')
requestAnimationFrame(loop)
loadChars().then(() => { $('#loading').hidden = true; setupRider(); setupTables(); setupBoss() })

// ---------- 検証用の窓口
window.IZ = {
  S, Snd, D, camera, toScreen, xPost, calcResult, P, ZONE,
  get charsReady() { return charsReady && !!P.rider },
  dbg: {
    pause(b = true) { S.dbgPause = b },
    step(n = 1) { for (let i = 0; i < n; i++) step(); if (S.mode === 'play') updateHud(); render() },
    tick(n = 1) { for (let i = 0; i < n; i++) step() },
    start(seed) { S.dbgPause = false; startRun(seed) },
    set(o) { Object.assign(S, o); if ('x' in o || 'dir' in o) { camInit = false; if ('dir' in o) S.face = S.dir > 0 ? Math.PI / 2 : -Math.PI / 2 } },
    call(i) { const t = S.tables[i]; t.st = 'call'; t.wait = 0; t.callT = 0; return t.x },
    order(i, list, add) { const t = S.tables[i]; const o = { t, list, showT: 0, asked: 1 }; if (add) { S.orders = S.orders.filter(x => x.t !== t); S.orders.push(o) } else S.orders = [o]; t.st = 'order'; t.wait = 0 },
    tray(ids) { clearTray(); for (const id of ids) addCup(id) },
    obs(kind, x, o) { addObs(kind, x, o); return S.obs.length },
    clearObs() { clearObs() },
    stand(i) { standUp(S.tables[i]) },
    toastInfo() { const t = S.tables.find(t => t.toast); return t ? { i: t.i, t: t.toast.t, n: t.toast.cups.length, rung: t.toast.rung, fill: t.toast.cups.map(c => +c.fill.toFixed(2)) } : null },
    drunk() { const ob = S.obs.find(o => o.kind === 'stand'); return ob ? { open: +ob.c.armOpen.toFixed(2), z: +ob.c.g.rotation.z.toFixed(3), flush: ob.c.flush, armL: ob.c.armL.rotation.toArray().slice(0, 3), armR: ob.c.armR.rotation.toArray().slice(0, 3) } : null },
    toast(i, ids) { const t = S.tables[i]; startToast(t, ids, ids.length); return !!t.toast },
    fall() { fall(1) },
    body(i) { const ob = S.obs[i]; const b = bodyBox(ob.c.g); return { x: ob.x, w: ob.w, h: ob.h, bx: [b.min.x, b.max.x], by: b.max.y, bz: [b.min.z, b.max.z] } },
    camera() { return { p: camera.position.toArray(), face: S.face, dir: S.dir } },
    end() { S.t = D.SHIFT.sec },
    toResult() { toResult() },
    reveal() { finishReveal() },
    noCalls(b = true) { S.nextCall = b ? 1e9 : 1 },
    noObs(b = true) { S.obsT = b ? 1e9 : 3 },
    say(text) { bossSay(text, 99) },
    render() { render() },
    snap() { frameCamera(1); updateScene(0); frameCamera(1) },
  },
  state() {
    return {
      mode: S.mode, t: +S.t.toFixed(2), x: +S.x.toFixed(2), v: +S.v.toFixed(2), y: +S.y.toFixed(2), th: +S.th.toFixed(3), fallT: +S.fallT.toFixed(2), heat: +S.heat.toFixed(2), dir: S.dir, turns: S.turns, falls: S.falls, served: S.served,
      tray: S.tray.map(c => ({ id: c.id, fill: +c.fill.toFixed(2) })), order: S.order ? { table: S.order.t.i, list: S.order.list, showT: +S.order.showT.toFixed(2) } : null, orders: S.orders.map(o => ({ table: o.t.i, list: o.list })),
      fallWhy: S.fallWhy, spillBy: S.spillBy, tables: S.tables.map(t => t.st), money: { ...S.money }, obs: S.obs.map(o => ({ k: o.kind, x: +o.x.toFixed(1) })), counter: !$('#counter').hidden, result: S.result ? { net: S.result.net, stamp: S.result.rank.st.ja } : null,
    }
  },
}
window.__izReady = true
