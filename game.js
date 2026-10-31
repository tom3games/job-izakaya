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
const NT = 10, TX = i => 9 + i * 8.6, LEN = TX(NT - 1) + 4.5
const ZA_Y = 0.36, ZA_Z = -2.75
const CH = 1.5                     // 人の背丈
const WR = 0.42, SEAT = 1.25       // 一輪車の車輪の半径・サドルの高さ
const VMAX = 6.4, ACC = 6.5, BRAKE = 8.5, DRAG = 4
const THRESH = [31, 57]            // 段差（敷居）の位置
const COUNTER_X = 2.0

// ---------- 状態
const S = {
  lang: store.get('lang') || ((navigator.language || 'ja').toLowerCase().startsWith('ja') ? 'ja' : 'en'),
  mode: 'title', time: 0, rand: Math.random, dbgPause: false,
  t: 0, x: 1.2, v: 0, acc: 0, y: 0, vy: 0, dir: 1, face: Math.PI / 2, th: 0, om: 0, wheelA: 0,
  inF: 0, inB: 0, keyF: 0, keyB: 0, jumpQ: 0, fallT: 0, falls: 0,
  tray: [], order: null, tables: [], obs: [], drops: [], puddles: [],
  money: { cups: 0, wrong: 0, spill: 0, broken: 0, left: 0 },
  nextCall: 2, tut: store.get('tut') === '1' ? -1 : 0, served: 0, resT: 0, result: null, photo: null, photoScore: 0,
  bossT: 0, ended: false, lastSay: 0,
}
const TT = () => D.T[S.lang]
const R = () => S.rand()
const pick = a => a[Math.floor(R() * a.length) % a.length]

// ---------- 音（WebAudio だけ）
const Snd = {
  ctx: null, muted: store.get('mute') === '1', next: 0, step: 0, track: null, want: null, switchAt: 0, played: {}, busy: 0,
  TEMPO: { title: 112, play: 128, end: 96 },
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return
    try {
      const c = this.ctx = new AC()
      this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.8; this.master.connect(c.destination)
      this.bgm = c.createGain(); this.bgm.gain.value = 0.0001; this.bgm.connect(this.master)
      const len = c.sampleRate * 2; this.noiseBuf = c.createBuffer(1, len, c.sampleRate)
      const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
      if (this.want) { const w = this.want; this.want = null; this.setTrack(w) }
    } catch (e) { this.ctx = null }
  },
  setMute(m) { this.muted = m; store.set('mute', m ? '1' : '0'); if (this.master) this.master.gain.value = m ? 0 : 0.8 },
  mtof: m => 440 * Math.pow(2, (m - 69) / 12),
  mark(n) { this.played[n] = (this.played[n] || 0) + 1 },
  tone(f, t0, dur, type = 'square', vol = 0.2, dest, f2) {
    if (!this.ctx) return; const c = this.ctx, o = c.createOscillator(), g = c.createGain()
    o.type = type; o.frequency.setValueAtTime(f, t0); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur)
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    o.connect(g); g.connect(dest || this.master); o.start(t0); o.stop(t0 + dur + 0.02)
  },
  noise(t0, dur, vol, freq, type = 'highpass', dest, q) {
    if (!this.ctx) return; const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain()
    s.buffer = this.noiseBuf; f.type = type; f.frequency.value = freq; if (q) f.Q.value = q
    g.gain.setValueAtTime(Math.max(0.0002, vol), t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    s.connect(f); f.connect(g); g.connect(dest || this.master); s.start(t0, Math.random()); s.stop(t0 + dur + 0.02)
  },
  voice(f, t0, dur, vol, formant = 900, f2) {
    if (!this.ctx) return; const c = this.ctx, o = c.createOscillator(), bp = c.createBiquadFilter(), g = c.createGain()
    o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t0); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur)
    bp.type = 'bandpass'; bp.frequency.value = formant; bp.Q.value = 3
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02); g.gain.setValueAtTime(vol, t0 + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    o.connect(bp); bp.connect(g); g.connect(this.master); o.start(t0); o.stop(t0 + dur + 0.02)
  },
  setTrack(name) {
    if (this.want === name) return
    this.want = name; if (!this.ctx) return
    const now = this.ctx.currentTime, g = this.bgm.gain
    g.cancelScheduledValues(now); g.setValueAtTime(Math.max(0.0001, g.value), now); g.linearRampToValueAtTime(0.0001, now + 0.25)
    this.switchAt = now + 0.27
  },
  tick() {
    if (!this.ctx) return; const c = this.ctx
    if (this.switchAt && c.currentTime >= this.switchAt) {
      this.track = this.want; this.step = 0; this.next = c.currentTime + 0.05; this.switchAt = 0
      const g = this.bgm.gain; g.cancelScheduledValues(c.currentTime); g.setValueAtTime(0.0001, c.currentTime); g.linearRampToValueAtTime(0.32, c.currentTime + 0.35)
      if (this.track) this.mark('bgm:' + this.track)
    }
    if (!this.track || this.switchAt) return
    const spb = 60 / (this.TEMPO[this.track] * (this.track === 'play' ? 1 + this.busy * 0.18 : 1)) / 4
    if (this.next < c.currentTime) this.next = c.currentTime + 0.05
    while (this.next < c.currentTime + 0.25) { this['p_' + this.track](this.step, this.next); this.next += spb; this.step++ }
  },
  pluck(n, t, dur = 0.25, vol = 0.08) { this.tone(this.mtof(n), t, dur, 'triangle', vol, this.bgm); this.tone(this.mtof(n) * 2.01, t, dur * 0.4, 'square', vol * 0.18, this.bgm) },
  taiko(t, v = 0.3) { this.tone(110, t, 0.22, 'sine', v, this.bgm, 55); this.noise(t, 0.05, v * 0.25, 500, 'lowpass', this.bgm) },
  clap(t, v = 0.06) { this.noise(t, 0.06, v, 1800, 'bandpass', this.bgm, 1.4) },
  // 都節（ミ ファ ラ シ ド）っぽい祭り囃子
  p_title(i, t) {
    const s = i % 16, bar = Math.floor(i / 16) % 4
    if (s === 0 || s === 10) this.taiko(t, 0.26); if (s === 4 || s === 12) this.clap(t)
    const m = [[64, -1, 65, -1, 69, -1, 71, -1, 72, -1, 71, -1, 69, -1, -1, -1], [69, -1, 71, -1, 72, -1, 76, -1, 74, -1, 72, -1, 71, -1, -1, -1],
      [72, -1, 71, -1, 69, -1, 65, -1, 64, -1, 65, -1, 69, -1, -1, -1], [71, -1, 69, -1, 65, -1, 64, -1, 64, -1, -1, -1, -1, -1, -1, -1]][bar]
    if (m[s] > 0) this.pluck(m[s], t, 0.3, 0.08)
    if (s % 8 === 0) this.pluck([40, 45, 41, 40][bar], t, 0.5, 0.12)
  },
  p_play(i, t) {
    const s = i % 16, bar = Math.floor(i / 16) % 4, b = this.busy
    if (s === 0 || s === 6 || s === 10) this.taiko(t, 0.24 + b * 0.08); if (s === 4 || s === 12) this.clap(t, 0.05 + b * 0.04)
    if (b > 0.5 && s % 2 === 1) this.noise(t, 0.02, 0.025, 7000, 'highpass', this.bgm)
    const m = [[64, -1, 69, 71, 72, -1, 71, 69, 71, -1, 69, -1, 65, -1, 64, -1], [69, -1, 72, 76, 74, -1, 72, 71, 72, -1, 71, -1, 69, -1, -1, -1],
      [76, -1, 74, 72, 71, -1, 69, -1, 71, -1, 72, 71, 69, -1, 65, -1], [64, -1, 65, 69, 71, -1, 69, 65, 64, -1, -1, -1, 64, -1, -1, -1]][bar]
    if (m[s] > 0) this.pluck(m[s], t, 0.2, 0.07)
    if (s % 4 === 0) this.pluck([40, 45, 47, 40][bar] + (s === 8 ? 7 : 0), t, 0.3, 0.1)
  },
  p_end(i, t) {
    const s = i % 16
    if (s === 0) this.taiko(t, 0.2)
    const m = [76, -1, -1, 74, -1, -1, 72, -1, 71, -1, -1, -1, 69, -1, -1, -1]
    if (m[s] > 0 && Math.floor(i / 16) % 2 === 0) this.pluck(m[s], t, 0.6, 0.07)
  },
  sfx(n, o = {}) {
    if (!this.ctx) return; this.mark(n)
    const t = this.ctx.currentTime + 0.01
    switch (n) {
      case 'tap': this.tone(900, t, 0.05, 'square', 0.07); break
      case 'clink': this.tone(2600 + Math.random() * 400, t, 0.18, 'sine', 0.12); this.tone(3900, t, 0.1, 'sine', 0.05); break
      case 'pour': this.noise(t, 0.35, 0.12, 1500, 'bandpass', null, 2); this.tone(300, t, 0.3, 'sine', 0.04, null, 600); break
      case 'splash': for (let k = 0; k < 3; k++) this.noise(t + k * 0.05, 0.12, 0.14 * (o.v ?? 1), 900 + k * 500, 'bandpass', null, 4); break
      case 'crash': for (let k = 0; k < 6; k++) { this.noise(t + k * 0.04, 0.18, 0.3, 3000 + k * 600, 'highpass'); this.tone(2200 + k * 500, t + k * 0.04, 0.2, 'sine', 0.06) } this.noise(t, 0.4, 0.4, 300, 'lowpass'); break
      case 'jump': this.tone(300, t, 0.2, 'square', 0.07, null, 700); break
      case 'land': this.noise(t, 0.1, 0.2, 400, 'lowpass'); this.tone(90, t, 0.1, 'sine', 0.2, null, 50); break
      case 'bump': this.noise(t, 0.08, 0.25, 600, 'lowpass'); this.tone(160, t, 0.12, 'square', 0.08, null, 90); break
      case 'call': { const p = o.hot ? 1.25 : 1; this.voice(330 * p, t, 0.12, 0.09, 1300); this.voice(300 * p, t + 0.13, 0.12, 0.09, 1100); this.voice(360 * p, t + 0.26, 0.3, 0.1, 1200, 280 * p); break }
      case 'order': this.tone(1320, t, 0.08, 'square', 0.06); this.tone(1760, t + 0.09, 0.12, 'square', 0.06); break
      case 'ok': this.tone(784, t, 0.1, 'triangle', 0.15); this.tone(1046, t + 0.1, 0.1, 'triangle', 0.15); this.tone(1318, t + 0.2, 0.25, 'triangle', 0.15); break
      case 'kanpai': for (let k = 0; k < 4; k++) this.tone(2500 + k * 300, t + k * 0.05, 0.25, 'sine', 0.08); break
      case 'wrong': this.tone(220, t, 0.3, 'sawtooth', 0.1); this.tone(207, t + 0.3, 0.4, 'sawtooth', 0.1); break
      case 'boss': this.voice(120, t, 0.35, 0.16, 650, 95); break
      case 'yorokonde': this.voice(260, t, 0.12, 0.12, 1000); this.voice(330, t + 0.13, 0.25, 0.12, 1100, 300); break
      case 'leave': this.voice(200, t, 0.5, 0.12, 700, 120); break
      case 'end': this.tone(523, t, 0.15, 'square', 0.1); this.tone(659, t + 0.15, 0.15, 'square', 0.1); this.tone(784, t + 0.3, 0.4, 'square', 0.1); break
      case 'stamp': this.noise(t, 0.15, 0.5, 300, 'lowpass'); this.tone(80, t, 0.2, 'sine', 0.4); break
      case 'squeak': this.tone(1200 + Math.random() * 300, t, 0.07, 'sine', 0.03, null, 900); break
    }
  },
}

// ---------- 描画の土台
const canvas = $('#gl')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.6 : 2))
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x2a1a14)
scene.fog = new THREE.Fog(0x2a1a14, 26, 60)
const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 120)
const lk = setupLook(renderer, scene, { env: true, envIntensity: 0.45, exposure: 1.08, sun: 1.6, sunPos: [3, 9, 6], hemi: 0.75, sky: 0xffe2b8, ground: 0x4a3024, sunColor: 0xffe0b0 })
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
{ const sun = lk.sun; sun.castShadow = true; const sz = isTouch ? 1024 : 2048; sun.shadow.mapSize.set(sz, sz); const c = sun.shadow.camera; c.left = -9; c.right = 9; c.top = 7; c.bottom = -7; c.near = 1; c.far = 40; c.updateProjectionMatrix(); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03 }
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

// ---------- 店（横に長い）
const world = new THREE.Group(); scene.add(world)
const lanterns = []
{
  const W0 = -7, W1 = LEN + 3, WL = W1 - W0, WC = (W0 + W1) / 2
  // 床（板張り）
  const ft = surfaceTex({ w: 512, h: 512, base: '#7a5236', noise: 0.05, grime: 0.08, repeat: [WL / 4, 2], draw: (x, w, h) => { x.strokeStyle = 'rgba(40,22,10,.55)'; x.lineWidth = 3; for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(0, i * h / 4); x.lineTo(w, i * h / 4); x.stroke() } for (let i = 0; i < 4; i++) { const o = (i % 2) * w / 2; x.beginPath(); x.moveTo(o + w / 4, i * h / 4); x.lineTo(o + w / 4, (i + 1) * h / 4); x.stroke() } x.strokeStyle = 'rgba(255,220,170,.06)'; x.lineWidth = 1; for (let i = 0; i < 40; i++) { const y = Math.random() * h; x.beginPath(); x.moveTo(0, y); x.bezierCurveTo(w / 3, y + 4, w * 2 / 3, y - 4, w, y); x.stroke() } } })
  const floor = mesh(new THREE.PlaneGeometry(WL, 9), std(0xffffff, { map: ft, roughness: 0.45 }), WC, 0, 0.5, world); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true
  // 座敷（畳の段）
  const tt = surfaceTex({ w: 256, h: 256, base: '#b8b06a', noise: 0.05, grime: 0.06, repeat: [WL / 1.8, 2], draw: (x, w, h) => { x.strokeStyle = 'rgba(80,80,30,.25)'; x.lineWidth = 1; for (let i = 0; i < w; i += 4) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, h); x.stroke() } x.fillStyle = '#2d3a26'; x.fillRect(0, 0, w, 10); x.fillRect(0, h - 10, w, 10) } })
  const za0 = 4.2
  const za = mesh(new THREE.BoxGeometry(LEN - za0 + 3, ZA_Y, 3.6), [std(0x5a3a22), std(0x5a3a22), std(0xffffff, { map: tt, roughness: 0.8 }), std(0x5a3a22), std(0x6b4428, { roughness: 0.5 }), std(0x5a3a22)], (za0 + LEN + 3) / 2, ZA_Y / 2, -3.2, world)
  za.receiveShadow = true; za.castShadow = false
  // 框（座敷の縁の黒い木）
  mesh(new THREE.BoxGeometry(LEN - za0 + 3, 0.08, 0.14), std(0x2a1a10, { roughness: 0.35 }), (za0 + LEN + 3) / 2, ZA_Y + 0.02, -1.42, world)
  // 奥の壁（板と漆喰）
  const wt = surfaceTex({ w: 512, h: 256, base: '#e9dcc0', noise: 0.03, grime: 0.12, repeat: [WL / 6, 1] })
  mesh(new THREE.PlaneGeometry(WL, 7), std(0xffffff, { map: wt }), WC, 3.5, -5.0, world)
  const wood = std(0x4a2e1a, { roughness: 0.55 }), woodD = std(0x2e1c10, { roughness: 0.5 })
  mesh(new THREE.BoxGeometry(WL, 1.1, 0.06), wood, WC, 0.9, -4.96, world)
  mesh(new THREE.BoxGeometry(WL, 0.12, 0.1), woodD, WC, 3.9, -4.94, world)
  // 柱と衝立（席ごとの仕切り）
  for (let i = 0; i <= NT; i++) {
    const x = TX(i) - 4.3
    if (x < za0) continue
    mesh(new THREE.BoxGeometry(0.22, 7, 0.22), woodD, x, 3.5, -4.85, world)
    const sc = mesh(new THREE.BoxGeometry(0.08, 1.0, 2.6), std(0x6b4428, { roughness: 0.5 }), x, ZA_Y + 0.5, -3.2, world); sc.castShadow = true
  }
  // 品書きの短冊（店名・銘柄は出さない）
  const menus = ['生ビール', 'ハイボール', 'レモンサワー', '枝豆', '唐揚げ', '焼き鳥', 'だし巻き', 'ウーロンハイ', '冷奴', 'もつ煮', 'ポテト', 'お茶漬け', 'たこわさ', '刺身盛り']
  const mt = canvasTex(1024, 256, (x, w, h) => {
    const n = menus.length, sw = w / n
    for (let i = 0; i < n; i++) {
      x.fillStyle = i % 5 === 0 ? '#f6e7b0' : '#fbf3dc'; x.fillRect(i * sw + 4, 0, sw - 8, h)
      x.fillStyle = '#2a1a10'; x.font = `900 ${sw * 0.6}px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'top'
      const s = menus[i]; for (let k = 0; k < Math.min(s.length, 6); k++) x.fillText(s[k], i * sw + sw / 2, 8 + k * sw * 0.62)
      x.fillStyle = '#b5281c'; x.font = `900 ${sw * 0.32}px ${FONT}`; x.fillText(['380', '420', '400', '300', '480', '150', '420', '400', '300', '450', '350', '500', '380', '880'][i], i * sw + sw / 2, h - sw * 0.45)
    }
  }, { rep: [1, 1] })
  mt.wrapS = THREE.RepeatWrapping; mt.repeat.set(1, 1)
  for (let x0 = 6; x0 < LEN; x0 += 14) { const p = mesh(new THREE.PlaneGeometry(8, 2), new THREE.MeshStandardMaterial({ map: mt, roughness: 0.9 }), x0 + 3, 2.6, -4.9, world) }
  // 提灯（手前の通路の上。奥行きの手前側）
  const lanMat = new THREE.MeshStandardMaterial({ color: 0xd8382a, emissive: 0xff4a2a, emissiveIntensity: 0.55, roughness: 0.6 })
  const capMat = std(0x1a1008)
  const lanTex = canvasTex(256, 128, (x, w, h) => { x.fillStyle = '#d8382a'; x.fillRect(0, 0, w, h); x.strokeStyle = 'rgba(80,10,5,.45)'; x.lineWidth = 3; for (let i = 0; i < h; i += 10) { x.beginPath(); x.moveTo(0, i); x.lineTo(w, i); x.stroke() } x.fillStyle = '#1a0a05'; x.font = `900 70px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('酒', w * 0.25, h / 2); x.fillText('酒', w * 0.75, h / 2) })
  lanMat.map = lanTex; lanMat.emissiveMap = lanTex
  for (let x0 = 3; x0 < LEN; x0 += 6.5) {
    const g = new THREE.Group(); g.position.set(x0, 3.55, -0.6); world.add(g)
    const b = mesh(new THREE.SphereGeometry(0.34, 20, 14), lanMat, 0, 0, 0, g); b.scale.y = 1.35
    mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 16), capMat, 0, 0.46, 0, g); mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 16), capMat, 0, -0.46, 0, g)
    mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.4, 4), capMat, 0, 1.2, 0, g)
    lanterns.push(g)
  }
  // 暖かい点光源（少しだけ）
  for (let x0 = 10; x0 < LEN; x0 += 26) { const pl = new THREE.PointLight(0xffa860, 7, 14, 1.6); pl.position.set(x0, 3.2, -1); world.add(pl) }
  // カウンター（左端）
  const cg = new THREE.Group(); world.add(cg)
  const ctop = std(0x9a6a3e, { roughness: 0.35 })
  mesh(new THREE.BoxGeometry(5.6, 0.12, 1.3), ctop, -2.6, 1.1, -2.2, cg)
  mesh(new THREE.BoxGeometry(5.6, 1.06, 0.1), wood, -2.6, 0.53, -1.6, cg)
  mesh(new THREE.BoxGeometry(0.1, 1.06, 1.3), wood, 0.2, 0.53, -2.2, cg)
  // ビールサーバー（無地）
  const srv = std(0xc7ccd1, { roughness: 0.25, metalness: 0.8 })
  mesh(new THREE.BoxGeometry(0.7, 0.9, 0.6), srv, -0.7, 1.6, -2.4, cg)
  mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.35, 8), std(0x222222), -0.85, 2.15, -2.15, cg)
  mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.35, 8), std(0x222222), -0.55, 2.15, -2.15, cg)
  // 酒の棚（ラベル無しの瓶）
  mesh(new THREE.BoxGeometry(5.6, 0.08, 0.5), wood, -2.6, 2.7, -4.7, cg); mesh(new THREE.BoxGeometry(5.6, 0.08, 0.5), wood, -2.6, 3.5, -4.7, cg)
  const bc = [0x2f5d3a, 0x6b3a1a, 0x1f3550, 0x8a7a3a, 0x4a1a1a]
  for (let i = 0; i < 18; i++) { const r = 0.09 + (i % 3) * 0.02; const b = mesh(new THREE.CylinderGeometry(r, r, 0.55, 10), std(bc[i % 5], { roughness: 0.2, metalness: 0.1 }), -5.1 + (i % 9) * 0.6, 3.05 + Math.floor(i / 9) * 0.8, -4.65, cg) }
  // 厨房ののれん
  const nt = canvasTex(512, 256, (x, w, h) => { x.fillStyle = '#1f2f55'; x.fillRect(0, 0, w, h); x.fillStyle = 'rgba(0,0,0,.25)'; for (let i = 1; i < 4; i++) x.fillRect(i * w / 4 - 3, 0, 6, h); x.fillStyle = '#f4ecd8'; x.font = `900 120px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('厨', w * 0.25, h * 0.45); x.fillText('房', w * 0.75, h * 0.45) })
  const noren = mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshStandardMaterial({ map: nt, side: THREE.DoubleSide, roughness: 0.9 }), -4.6, 3.1, -4.97, cg)
  castShadow(cg)
  // 段差（敷居）と仕切りののれん
  const nt2 = canvasTex(512, 256, (x, w, h) => { x.fillStyle = '#8c2a1e'; x.fillRect(0, 0, w, h); x.fillStyle = 'rgba(0,0,0,.25)'; for (let i = 1; i < 3; i++) x.fillRect(i * w / 3 - 3, 0, 6, h); x.fillStyle = '#f4ecd8'; x.font = `900 110px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('奥', w / 6, h * 0.45); x.fillText('座', w / 2, h * 0.45); x.fillText('敷', w * 5 / 6, h * 0.45) })
  for (const x0 of THRESH) {
    const s = mesh(new THREE.BoxGeometry(0.34, 0.2, 2.0), std(0x3a2414, { roughness: 0.4 }), x0, 0.1, 0, world); s.castShadow = true; s.receiveShadow = true
    // のれん（3枚。通ると揺れる）
    const ng = new THREE.Group(); ng.position.set(x0, 3.75, 0); world.add(ng); ng.userData.flap = 0
    for (let k = 0; k < 3; k++) { const p = mesh(new THREE.PlaneGeometry(0.62, 1.0), new THREE.MeshStandardMaterial({ map: nt2, side: THREE.DoubleSide, roughness: 0.9 }), 0, -0.5, (k - 1) * 0.66, ng); p.rotation.y = Math.PI / 2; p.geometry.translate(0, 0, 0); const uv = p.geometry.attributes.uv; for (let j = 0; j < uv.count; j++) uv.setX(j, (uv.getX(j) + k) / 3); p.userData.k = k }
    mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 6), woodD, 0, 0.02, 0, ng).rotation.x = Math.PI / 2
    lanterns.push(ng); ng.userData.noren = true
  }
  // 低いテーブル（各席）と料理
  const tbl = std(0x5c3a20, { roughness: 0.35 })
  const plateM = std(0xf2efe6, { roughness: 0.3 }), foodC = [0xc8762a, 0x6aa84f, 0xe8d06a, 0x9a3a2a]
  for (let i = 0; i < NT; i++) {
    const x = TX(i), g = new THREE.Group(); g.position.set(x, ZA_Y, ZA_Z); world.add(g)
    mesh(new THREE.BoxGeometry(1.7, 0.09, 1.0), tbl, 0, 0.42, 0, g)
    for (const [a, b] of [[-0.75, -0.42], [0.75, -0.42], [-0.75, 0.42], [0.75, 0.42]]) mesh(new THREE.BoxGeometry(0.08, 0.4, 0.08), tbl, a, 0.2, b, g)
    for (let k = 0; k < 3; k++) { mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.04, 18), plateM, -0.5 + k * 0.5, 0.49, (k % 2) * 0.2 - 0.1, g); mesh(new THREE.SphereGeometry(0.12, 10, 8), std(foodC[(i + k) % 4], { roughness: 0.7 }), -0.5 + k * 0.5, 0.53, (k % 2) * 0.2 - 0.1, g).scale.y = 0.5 }
    // 座布団
    for (const [a, b] of [[-1.15, 0], [1.15, 0], [0, -0.85]]) mesh(new THREE.BoxGeometry(0.62, 0.07, 0.62), std(0x7a2a3a, { roughness: 0.9 }), a, 0.035, b, g)
    // 卓番の札
    const nt3 = canvasTex(128, 128, (c, w, h) => { c.fillStyle = '#fbf3dc'; c.fillRect(0, 0, w, h); c.strokeStyle = '#2a1a10'; c.lineWidth = 8; c.strokeRect(4, 4, w - 8, h - 8); c.fillStyle = '#2a1a10'; c.font = `900 84px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(i + 1), w / 2, h / 2 + 4) })
    mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshStandardMaterial({ map: nt3, roughness: 0.9 }), 0, 2.2, -2.2, g)
    castShadow(g)
  }
}

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
  P.tray.position.set(0.5, SEAT + 0.62, 0.05); P.tray.scale.setScalar(1.25)
  P.body.add(P.tray)
  const tr = mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.05, 36), std(0x3a2a1e, { roughness: 0.3, metalness: 0.2 }), 0, 0, 0, P.tray); tr.scale.z = 0.75
  mesh(new THREE.TorusGeometry(0.62, 0.025, 6, 36), std(0x2a1d14, { roughness: 0.3 }), 0, 0.03, 0, P.tray).rotation.x = Math.PI / 2
  P.tray.children[1].scale.y = 0.75
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
  S.tray.forEach((c, i) => { const cx = i % cols, rz = Math.floor(i / cols); c.g.position.set((cx - (cols - 1) / 2) * 0.27, 0.03, (rz - (rows - 1) / 2) * 0.27); c.col = cols > 1 ? Math.abs(cx - (cols - 1) / 2) / ((cols - 1) / 2) : 0 })
}
function addCup(id) {
  if (S.tray.length >= 12) return false
  const c = makeCup(id); P.tray.add(c.g); S.tray.push(c); layoutTray(); return true
}
function clearTray() { for (const c of S.tray) c.g.removeFromParent(); S.tray = []; layoutTray() }

// ---------- 席の客
function seatPos(i, k) { const x = TX(i); return [[x - 1.15, ZA_Z, Math.PI / 2], [x + 1.15, ZA_Z, -Math.PI / 2], [x, ZA_Z - 0.85, 0]][k] }
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
function setupBoss() { BOSS.c = makeChar('male-d', { anim: 'idle' }); if (!BOSS.c) return; BOSS.c.g.position.set(-2.2, 0, -3.1); BOSS.c.g.rotation.y = 0.5; scene.add(BOSS.c.g) }

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
  for (let i = FX.length - 1; i >= 0; i--) {
    const f = FX[i]; f.t += dt
    if (f.t >= f.life || (f.c && !f.c.g.parent)) { f.el.remove(); FX.splice(i, 1); if (f.c && f.c.bub === f.el) f.c.bub = null; continue }
    const k = f.t / f.life
    if (f.kind === 'ono') {
      const s = toScreen(_w.copy(f.pos).add(_q.set(0, f.rise * ease(k * 2), 0)))
      const sc = k < 0.12 ? 0.4 + k / 0.12 * 0.8 : 1.2 - Math.min(0.2, (k - 0.12) * 2)
      const w = f.el.offsetWidth, x = clamp(s.x, w / 2 + 8, innerWidth - w / 2 - 8)
      f.el.style.transform = `translate(${x - w / 2}px,${s.y - 20}px) rotate(${f.rot}deg) scale(${sc})`; f.el.style.opacity = k > 0.75 ? (1 - k) / 0.25 : 1
    } else {
      const s = toScreen(headPos(f.c, _hp)), w = f.el.offsetWidth, h = f.el.offsetHeight
      const off = s.x < 0 ? -1 : s.x > innerWidth ? 1 : 0
      f.el.dataset.off = off
      const x = clamp(s.x - w / 2, 8, innerWidth - w - 8), y = clamp(s.y - h - 10, top, bot - h)
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
    ob.w = 0.5; ob.h = 0.42
    const name = pick(['male-a', 'male-b', 'male-c', 'male-f', 'female-c'])
    const c = makeChar(name, { anim: 'die' }); if (c) { play(c, 'die', 0, 1, true); c.mixer.update(3); c.g.position.set(x, 0, 0.05); c.g.rotation.y = R() < 0.5 ? Math.PI / 2 : -Math.PI / 2; scene.add(c.g); ob.c = c; c.zT = 0 }
  }
  S.obs.push(ob); return ob
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
  const total = clamp(Math.round(1.5 + f * 8 + (R() - 0.5) * 3), 1, 11)
  const kinds = clamp(1 + Math.floor(R() * (1.5 + f * 3)), 1, Math.min(ds.length, total, 4))
  const ids = []; const pool = [...ds]
  // 後半は紛らわしい組み合わせを混ぜる
  if (f > 0.3 && R() < 0.5) { const pair = pick([['oolong', 'oolonghi'], ['lemon', 'lemonhi'], ['lemon', 'grape']]).filter(id => pool.some(d => d.id === id)); for (const id of pair) if (ids.length < kinds) ids.push(id) }
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
      const first = S.served === 0 && !S.order && busy() === 0
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
      if (!(S.order && S.order.t === t && S.order.showT > 0)) bubble(caller, (Math.abs(t.x - S.x) > 6 ? (t.x > S.x ? '▶ ' : '◀ ') : '') + T.tableN.replace('{N}', t.i + 1) + ' ' + (hot ? pick(T.callAngry) : pick(T.call)), hot ? 'hot' : '', 1.8)
      play(caller, 'interact-right', 0.15)
      Snd.sfx('call', { hot }); t.callT = hot ? 2.2 : 3.2
    }
    if (t.st === 'order' && t.angry && t.callT <= 0 && caller && !(S.order && S.order.showT > 0)) { bubble(caller, T.tableN.replace('{N}', t.i + 1) + ' ' + pick(T.callAngry), 'hot', 1.6); t.callT = 3.5 }
    if (caller && t.callT < 1.2 && caller.cur !== 'sit') play(caller, 'sit', 0.3)
    for (const c of t.cust) if (c.anger) { c.anger.visible = !!t.angry; if (c.anger.visible) { headPos(c, c.anger.position); c.anger.position.x += 0.25; c.anger.scale.setScalar(0.45 + Math.sin(S.time * 10) * 0.06) } }
    if (t.wait > lim) {
      // 帰る
      S.money.left++; bubble(caller, T.leave, 'hot', 2); Snd.sfx('leave')
      if (S.order && S.order.t === t) { S.order = null }
      t.st = 'gone'; t.leaveT = 0; bossSay(T.bossLeft, 2)
    }
  }
  // 帰った席はしばらくして新しい客
  for (const t of S.tables) if (t.st === 'gone') { t.leaveT += dt; for (const c of t.cust) c.g.visible = t.leaveT < 1.2 ? Math.sin(t.leaveT * 30) > 0 : false; if (t.leaveT > 14) { t.st = 'idle'; t.wait = 0; for (const c of t.cust) { c.g.visible = true; if (c.anger) c.anger.visible = false } } }
}
function nearTable() { let best = null; for (const t of S.tables) { const d = Math.abs(t.x - S.x); if (d < 1.7 && (!best || d < Math.abs(best.x - S.x))) best = t } return best }
function stopped() { return Math.abs(S.v) < 1.6 && S.y <= 0.001 && S.fallT <= 0 }
function updateService(dt) {
  const T = TT()
  if (S.order) { S.order.showT -= dt; if (Math.abs(S.order.t.x - S.x) > 3) S.order.away = 1 }
  if (!stopped()) return
  const t = nearTable()
  if (t) {
    if (t.st === 'call' && !S.order && !S.tray.length) {
      // 注文を聞く（一瞬で消える）
      const list = makeOrder(S.served === 0 && S.tut >= 0)
      const n = orderCount(list), show = 1.6 + n * 0.28
      S.order = { t, list, showT: show, asked: 1 }; t.st = 'order'; t.wait = 0; t.callT = show + 4
      bubble(t.cust[0], orderHtml(list), 'order', show, true); play(t.cust[0], 'emote-yes', 0.15)
      Snd.sfx('order'); bubble(P.rider, T.yorokonde, 'warm', 1.0)
    } else if (t.st === 'order' && S.order && S.order.t === t) {
      if (S.tray.length) serve(t)
      else if (S.order.away && S.order.showT < 0) {
        S.order.away = 0
        // もう一回聞く（怒られる）
        S.order.asked++; const n = orderCount(S.order.list), show = 1.2 + n * 0.2; S.order.showT = show
        bubble(t.cust[0], `<b>${T.reAsk}</b><br>` + orderHtml(S.order.list).split('<br>').slice(1).join('<br>'), 'order', show, true); t.wait += 6; t.callT = show + 3
        Snd.sfx('wrong')
      }
    }
  }
}
function serve(t) {
  const T = TT(), want = {}, got = {}
  for (const o of S.order.list) want[o.id] = o.n
  let spill = 0
  for (const c of S.tray) { got[c.id] = (got[c.id] || 0) + 1; spill += 1 - c.fill }
  let ok = 0, wrong = 0
  for (const id of new Set([...Object.keys(want), ...Object.keys(got)])) { const a = want[id] || 0, b = got[id] || 0; ok += Math.min(a, b); wrong += Math.abs(a - b) }
  S.money.cups += ok; S.money.wrong += wrong; S.money.spill += spill
  const pos = P.tray.getWorldPosition(new THREE.Vector3())
  const caller = t.cust[0]
  if (wrong) { bubble(caller, orderCount(S.order.list) > S.tray.length && !Object.keys(got).some(id => !want[id]) ? T.short : T.wrong, 'hot', 2); Snd.sfx('wrong'); play(caller, 'emote-no', 0.15); setTimeout(() => bossSay(T.bossWrong, 1.6), 600) }
  else if (spill > 0.6) { bubble(caller, T.spilled, 'warm', 1.8); Snd.sfx('clink') }
  else { bubble(caller, T.kanpai, '', 1.8); Snd.sfx('kanpai'); for (const c of t.cust) play(c, 'emote-yes', 0.15); ono('¥' + (ok * D.YEN.perCup), pos, 'yel', { size: 34 }) }
  if (!wrong && S.tray.length >= 6) photoMoment(2 + S.tray.length * 0.1)
  // グラスを席へ（見た目だけ）
  clearTray()
  t.st = 'idle'; t.wait = 0; S.order = null; S.served++
  if (S.tut >= 0) { S.tut = -1; store.set('tut', '1') }
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
  const fwd = (S.inF || S.keyF) ? 1 : 0, back = (S.inB || S.keyB) ? 1 : 0
  const u = fwd - back
  let target = 0
  if (u > 0) target = S.v < 0 ? BRAKE : ACC
  else if (u < 0) target = S.v > 0 ? -BRAKE : -ACC
  else target = -Math.sign(S.v) * Math.min(Math.abs(S.v) / dt, DRAG)
  S.acc = lerp(S.acc, target, clamp(dt * 9, 0, 1))
  S.v = clamp(S.v + S.acc * dt, -VMAX * 0.7, VMAX)
  if (u === 0 && Math.abs(S.v) < 0.05) S.v = 0
  let nx = S.x + S.v * dt
  // 跳ぶ
  if (S.jumpQ > 0) { S.jumpQ -= dt; if (S.y <= 0.001) { S.vy = 7; S.jumpQ = 0; Snd.sfx('jump'); if (P.rider) bubble(P.rider, T.jumpS, '', 0.6) } }
  if (S.y > 0 || S.vy > 0) {
    S.vy -= 20 * dt; S.y += S.vy * dt
    if (S.y <= 0) { const imp = -S.vy; S.y = 0; S.vy = 0; Snd.sfx('land'); kick((R() - 0.4) * 0.9 * imp / 6 * Math.sign(S.v || 1), 'land'); splashAll(0.015 + 0.006 * S.tray.length, 0.6); fx.squash(P.body, 0.12, 0.3) }
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
    const sv = Math.sign(S.v || S.dir), spd = Math.abs(S.v) / VMAX
    if (ob.kind === 'stand') { nx = S.x; S.v = -sv * 1.4; kick(sv * (0.8 + 1.6 * spd), 'stand'); Snd.sfx('bump'); bubble(ob.c, T.bump, 'warm', 0.9); splashAll(0.1 + 0.25 * spd, 1) }
    else if (ob.kind === 'step') { S.v *= 0.75; kick(sv * (0.5 + 1.5 * spd), 'step'); Snd.sfx('bump'); splashAll(0.06 + 0.15 * spd, 0.8) }
    else if (ob.kind === 'sleep') { S.v *= 0.3; kick(sv * (0.9 + 1.9 * spd), 'sleep'); Snd.sfx('bump'); if (ob.c) bubble(ob.c, T.bump, 'warm', 0.9); splashAll(0.12 + 0.2 * spd, 1) }
    else if (ob.kind === 'towel') { S.v *= 0.6; kick(sv * (0.7 + 1.5 * spd), 'towel'); Snd.sfx('bump'); splashAll(0.08 + 0.15 * spd, 0.8); ob.v *= -0.6 }
  }
  nx = clamp(nx, 0.9, LEN - 0.5); if (nx === 0.9 || nx === LEN - 0.5) S.v = 0
  const dx = nx - S.x; S.x = nx
  S.wheelA -= dx / WR
  if (Math.abs(S.v) > 0.3) S.dir = Math.sign(S.v)
  // ふらつき（傾き θ はバネで戻るが、速さ・杯数・加速・水たまりで揺れる）
  const n = S.tray.length, spd = Math.abs(S.v) / VMAX
  const sig = (0.25 + 1.25 * Math.pow(spd, 1.5)) * (1 + 0.05 * n) * (slip ? 2.2 : 1)
  if (slip && Math.abs(S.v) > 0.5 && R() < dt * 3) { kick((R() - 0.5) * 1.4, 'slip'); if (R() < 0.3) Snd.sfx('squeak') }
  S.lastKick = Math.abs(S.om) < 0.5 ? null : S.lastKick
  const F = -0.06 * S.acc + sig * noiseF(S.time * (1 + spd * 0.6)) * 0.9
  const al = -10 * S.th - 2.6 * S.om + F
  S.om += al * dt; S.th += S.om * dt
  if (Math.abs(S.th) > 0.62 && S.y <= 0.001) fall(Math.sign(S.th))
  P.body.rotation.z = -S.th
  // こぼれる
  const thr = clamp(0.2 - 0.008 * n, 0.09, 0.2)
  const over = Math.max(0, Math.abs(S.th) - thr), wob = Math.max(0, Math.abs(S.om) - 1.1)
  if (n && (over > 0 || wob > 0)) {
    let lost = 0
    for (const c of S.tray) { const d = (over * 2.4 + wob * 0.05) * c.k * (1 + c.col * 0.4) * dt; if (c.fill > 0 && d > 0) { setFill(c, c.fill - d); lost += d } }
    S.spillAcc = (S.spillAcc || 0) + lost
    S.spillBy[slip ? 'slip' : spd > 0.6 ? 'fast' : 'slowtilt'] = (S.spillBy[slip ? 'slip' : spd > 0.6 ? 'fast' : 'slowtilt'] || 0) + lost
    if (S.spillAcc > 0.06) { const c = pick(S.tray); emitDrops(c.g.getWorldPosition(new THREE.Vector3()), 3 + Math.floor(S.spillAcc * 20), DK[c.id].liq, Math.sign(S.th) * 2); Snd.sfx('splash', { v: Math.min(1, S.spillAcc * 4) }); S.spillAcc = 0; maybePuddle() }
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
function fall(dir) {
  const T = TT()
  S.fallT = 1.8; S.fallDir = dir; S.falls++; (S.fallWhy = S.fallWhy || []).push(S.lastKick || 'tilt')
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
    if (ob.kind === 'sleep' && ob.c) { ob.c.mixer.update(0); ob.c.g.position.y = 0; if (ob.t > ob.life - 1) ob.c.g.visible = Math.sin(ob.t * 30) > 0 }
    if (ob.kind === 'stand') updateStander(ob, dt)
    if (ob.t > ob.life || (ob.kind === 'towel' && (ob.x < 0 || ob.x > LEN))) { freeObs(ob); S.obs.splice(i, 1) }
  }
}
function standUp(t) {
  const c = t.cust[1]; if (!c || t.standing) return
  t.standing = 1
  const ob = { kind: 'stand', x: c.home[0] + (c.home[0] > t.x ? 0.4 : -0.4), w: 0.42, h: 3, life: 4.2, t: 0, hit: 0, c, up: 0, tab: t }
  S.obs.push(ob)
  bubble(c, pick([TT().drunkUp, TT().drunkUp2]), 'warm', 2.5)
}
function updateStander(ob, dt) {
  const c = ob.c, [hx, hz, hr] = c.home, k = ob.t < 0.5 ? ob.t / 0.5 : ob.t > ob.life - 0.6 ? (ob.life - ob.t) / 0.6 : 1
  ob.up = k
  c.g.position.set(lerp(hx, ob.x, ease(k)), lerp(ZA_Y, 0, ease(k)), lerp(hz, 0.15, ease(k)))
  c.g.rotation.y = lerp(hr, 0, ease(k))
  if (k > 0.2) play(c, 'idle', 0.2); else play(c, 'sit', 0.2)
  c.armOpen = k
  if (ob.t > ob.life - 0.01) { c.g.position.set(hx, ZA_Y, hz); c.g.rotation.y = hr; c.armOpen = 0; play(c, 'sit', 0.1); ob.tab.standing = 0 }
}
// 写真（明細に貼る一番の場面）
function photoMoment(score) { if (score > S.photoScore) { S.capAt = 0.05; S.capScore = score } }
const photoC = document.createElement('canvas'); photoC.width = photoC.height = 300
function capturePhoto() {
  render()
  const src = renderer.domElement, W = src.width, H = src.height, sx = W / innerWidth
  const p = toScreen(_w.set(S.x, 1.5, 0)), s = Math.min(W, H) * 0.62
  const cx = clamp(p.x * sx, s / 2, W - s / 2), cy = clamp(p.y * sx, s / 2, H - s / 2)
  try { photoC.getContext('2d').drawImage(src, cx - s / 2, cy - s / 2, s, s, 0, 0, 300, 300); S.photo = photoC } catch (e) {}
}

function updateGame(dt) {
  if (S.mode !== 'play') return
  S.t += dt
  updateRider(dt); updateObs(dt); updateTables(dt); updateService(dt); updateFlying(dt); updateDrops(dt)
  if (S.capAt !== undefined && S.capAt !== null) { S.capAt -= dt; if (S.capAt <= 0) { S.capAt = null; S.photoScore = S.capScore; S.doCap = true } }
  Snd.busy = clamp(busy() / 4, 0, 1)
  // 店長の声
  S.bossT -= dt
  if (S.bossT <= 0) { S.bossT = 9 + R() * 6; if (busy() >= 2) bossSay(pick(TT().bossBusy)) }
  // カウンターの画面
  const ac = atCounter() && (S.order || S.tray.length)
  if (ac !== !$('#counter').hidden) { $('#counter').hidden = !ac; if (ac) buildCounterUI() }
  if (S.t >= D.SHIFT.sec && !S.ended) endShift()
}
function endShift() {
  S.ended = true; S.mode = 'end'; S.endT = 0; Snd.sfx('end'); Snd.setTrack('end')
  bossSay(TT().bossEnd, 3); $('#counter').hidden = true; $('#hint').hidden = true; $('#finger').hidden = true
  for (const id of ['#ctlL', '#ctlR']) $(id).style.visibility = 'hidden'
  if (!S.photo) S.doCap = true
}
function updateEnd(dt) { S.endT += dt; S.v *= 0.9; S.acc = 0; updateDrops(dt); updateFlying(dt); if (S.endT > 2.2) toResult() }

// ---------- チュートリアル（最初の1回だけ）
function updateTutorial() {
  const h = $('#hint'), fg = $('#finger')
  if (S.tut < 0 || S.mode !== 'play') { h.hidden = true; fg.hidden = true; return }
  const T = TT(); let txt = '', el = null
  const calling = S.tables.find(t => t.st === 'call')
  if (!S.order && calling) { const near = Math.abs(calling.x - S.x) < 1.7; txt = near ? T.tutStop : (isTouch ? T.tutGo : T.tutGoPC); el = near ? null : (calling.x > S.x ? '#bFwd' : '#bBack') }
  else if (S.order && S.order.showT > 0) txt = T.tutMem
  else if (S.order && !S.tray.length && !atCounter()) { txt = T.tutBack; el = '#bBack' }
  else if (S.order && atCounter()) txt = T.tutPick
  else if (S.order && S.tray.length) { txt = T.tutCarry; el = S.obs.some(o => o.kind === 'sleep' && Math.abs(o.x - S.x) < 5) ? '#bJump' : '#bFwd' }
  h.hidden = !txt; if (txt && h.textContent !== txt) h.textContent = txt
  if (el && isTouch) { const r = $(el).getBoundingClientRect(); fg.hidden = false; fg.style.transform = `translate(${r.left + r.width / 2 - 14}px,${r.top - 40}px)` } else fg.hidden = true
}

// ---------- 場面
function updateScene(dt) {
  S.time += dt
  P.g.position.set(S.x, S.y, 0)
  P.wheel.rotation.z = S.wheelA; P.ped.rotation.z = S.wheelA
  S.face = lerp(S.face, S.dir > 0 ? Math.PI / 2 : -Math.PI / 2, clamp(dt * 10, 0, 1))
  P.body.rotation.y = S.face - Math.PI / 2
  if (P.rider) {
    P.rider.g.rotation.y = Math.PI / 2
    P.rider.mixer.update(dt)
    // 手はトレーを支える位置に（腕を前へ）
  }
  // トレーの位置（体の前・頭の上）と揺れ
  P.tray.position.set(0.5, SEAT + 0.62 + Math.sin(S.time * 7) * 0.01 * Math.abs(S.v), 0.05)
  P.tray.rotation.set(0, 0, -S.th * 0.4 + S.om * 0.03)
  for (const c of S.tray) { if (c.foam) c.foam.position.x = Math.sin(S.time * 9 + c.k * 5) * 0.004 * (1 + Math.abs(S.om)) }
  // 客
  for (const t of S.tables) for (const c of t.cust) {
    if (Math.abs(c.g.position.x - camera.position.x) > 16) continue
    c.mixer.update(dt)
    if (c.armOpen > 0 && c.armL) { c.armL.rotation.z = -1.3 * c.armOpen; c.armR.rotation.z = 1.3 * c.armOpen }
  }
  if (BOSS.c) { BOSS.c.mixer.update(dt); BOSS.c.g.rotation.y = lerp(BOSS.c.g.rotation.y, Math.atan2(S.x - BOSS.c.g.position.x, 3), 0.05) }
  // のれん・提灯
  for (const g of lanterns) {
    if (g.userData.noren) { const near = Math.abs(S.x - g.position.x) < 0.6 && Math.abs(S.v) > 0.5; if (near) g.userData.flap = Math.max(g.userData.flap, Math.abs(S.v) / VMAX); g.userData.flap *= 0.97; g.children.forEach((p, i) => { if (p.userData.k !== undefined) p.rotation.x = Math.sin(S.time * 8 + i) * g.userData.flap * 0.6 }) }
    else g.rotation.z = Math.sin(S.time * 1.3 + g.position.x) * 0.04
  }
  frameCamera(dt)
  // 太陽（影）を主人公に合わせて動かす
  lk.sun.target.position.set(camX, 0, -1); lk.sun.position.copy(lk.sun.target.position).add(SUN_OFF); lk.sun.target.updateMatrixWorld()
}
let camX = 1.2, camLead = 0
function frameCamera(dt = 1) {
  const a = innerWidth / innerHeight
  camera.aspect = a
  const portrait = a < 1
  camera.fov = portrait ? 40 : 32
  const tv = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
  const halfW = S.camHalfW || (portrait ? 3.4 : clamp(a * 4.2, 6.5, 10))
  let d = halfW / (tv * a)
  if (portrait) d = Math.min(d, 26)
  const lead = S.mode === 'play' || S.mode === 'end' ? S.dir * halfW * 0.38 : 0
  camLead = lerp(camLead, lead, clamp(dt * 1.6, 0, 1))
  const want = clamp(S.x + camLead, S.mode === 'title' ? -1.2 : -halfW * 0.25, LEN - halfW * 0.6)
  camX = dt >= 1 ? want : lerp(camX, want, clamp(dt * 5, 0, 1))
  const el = portrait ? 0.48 : 0.3
  camera.position.set(camX, 1.6 + d * el, d * Math.sqrt(1 - el * el))
  camera.lookAt(camX, portrait ? 1.5 : 1.3, -1.0)
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
  if (S.mode === 'result') drawSlip(S.stamped ? 1 : 0)
  if (!$('#moreBox').hidden) fillMore()
}
function resetRun(seed) {
  S.rand = seed ? mulberry(seed) : Math.random
  noisePh = [R() * 6, R() * 6, R() * 6]
  clearFx(); clearTray(); clearObs()
  for (const c of flying) c.g.removeFromParent(); flying.length = 0
  for (const t of S.tables) { t.st = 'idle'; t.wait = 0; t.standing = 0; for (const c of t.cust) { c.g.visible = true; c.armOpen = 0; const [x, z, r] = c.home; c.g.position.set(x, ZA_Y, z); c.g.rotation.y = r; play(c, 'sit', 0); if (c.anger) c.anger.visible = false } }
  Object.assign(S, { t: 0, x: 1.2, v: 0, acc: 0, y: 0, vy: 0, dir: 1, th: 0, om: 0, fallT: 0, falls: 0, order: null, served: 0, nextCall: 1.2, money: { cups: 0, wrong: 0, spill: 0, broken: 0, left: 0 }, photo: null, photoScore: 0, capAt: null, fallWhy: [], lastKick: null, spillBy: {}, bossT: 6, ended: false, obsT: 8, result: null, jumpQ: 0, spillAcc: 0 })
  if (P.rider) { play(P.rider, 'holding-both', 0); P.body.rotation.z = 0 }
  for (const id of ['#ctlL', '#ctlR']) $(id).style.visibility = ''
}
function startRun(seed) {
  Snd.init(); Snd.sfx('tap')
  resetRun(seed)
  S.mode = 'play'; show('vPlay'); $('#counter').hidden = true; Snd.setTrack('play')
  setTimeout(() => { if (S.mode === 'play') bossSay(TT().bossStart, 2.2) }, 400)
}
function toTitle() { Snd.sfx('tap'); resetRun(); S.mode = 'title'; show('vTitle'); Snd.setTrack('title') }
function updateHud() {
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
  const rank = [...D.RANKS].reverse().find(r => net >= r.min)
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
holdBtn('#bFwd', 'inF'); holdBtn('#bBack', 'inB')
$('#bJump').addEventListener('pointerdown', e => { e.preventDefault(); Snd.init(); if (S.mode === 'play' && S.fallT <= 0) S.jumpQ = 0.15 })
addEventListener('keydown', e => {
  if (S.mode !== 'play') { if ((e.key === 'Enter' || e.key === ' ') && S.mode === 'title' && document.activeElement === document.body) { e.preventDefault(); startRun() } return }
  const k = e.key
  if (k === 'ArrowRight' || k === 'd' || k === 'D') { S.keyF = 1; e.preventDefault() }
  else if (k === 'ArrowLeft' || k === 'a' || k === 'A') { S.keyB = 1; e.preventDefault() }
  else if (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W') { if (S.fallT <= 0) S.jumpQ = 0.15; e.preventDefault() }
  else if (/^[1-9]$/.test(k) && !$('#counter').hidden) { const b = $('#drinks').querySelectorAll('.dk')[+k - 1]; if (b) b.click() }
  else if ((k === 'Backspace' || k === '0') && !$('#counter').hidden) { clearTray(); buildCounterUI() }
})
addEventListener('keyup', e => { const k = e.key; if (k === 'ArrowRight' || k === 'd' || k === 'D') S.keyF = 0; if (k === 'ArrowLeft' || k === 'a' || k === 'A') S.keyB = 0 })
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
function titleIdle(dt) { S.tt = (S.tt || 0) + dt; S.th = Math.sin(S.tt * 2.2) * 0.08; S.om = 0; P.body.rotation.z = -S.th; S.x = 1.6 + Math.sin(S.tt * 0.5) * 0.5; S.v = Math.cos(S.tt * 0.5) * 0.25; S.wheelA = -S.x / WR; S.dir = 1 }
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
function resize() { renderer.setSize(innerWidth, innerHeight, false); frameCamera(); fitSlip() }

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
document.addEventListener('visibilitychange', () => { if (Snd.ctx) { if (document.hidden) Snd.ctx.suspend(); else Snd.ctx.resume() } S.keyF = S.keyB = S.inF = S.inB = 0 })
show('vTitle'); Snd.setTrack('title')
requestAnimationFrame(loop)
loadChars().then(() => { $('#loading').hidden = true; setupRider(); setupTables(); setupBoss() })

// ---------- 検証用の窓口
window.IZ = {
  S, Snd, D, camera, toScreen, xPost, calcResult, P,
  get charsReady() { return charsReady && !!P.rider },
  dbg: {
    pause(b = true) { S.dbgPause = b },
    step(n = 1) { for (let i = 0; i < n; i++) step(); render() },
    tick(n = 1) { for (let i = 0; i < n; i++) step() },
    start(seed) { S.dbgPause = false; startRun(seed) },
    set(o) { Object.assign(S, o) },
    call(i) { const t = S.tables[i]; t.st = 'call'; t.wait = 0; t.callT = 0; return t.x },
    order(i, list) { const t = S.tables[i]; S.order = { t, list, showT: 0, asked: 1 }; t.st = 'order'; t.wait = 0 },
    tray(ids) { clearTray(); for (const id of ids) addCup(id) },
    obs(kind, x, o) { addObs(kind, x, o); return S.obs.length },
    clearObs() { clearObs() },
    stand(i) { standUp(S.tables[i]) },
    fall() { fall(1) },
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
      mode: S.mode, t: +S.t.toFixed(2), x: +S.x.toFixed(2), v: +S.v.toFixed(2), y: +S.y.toFixed(2), th: +S.th.toFixed(3), fallT: +S.fallT.toFixed(2), falls: S.falls, served: S.served,
      tray: S.tray.map(c => ({ id: c.id, fill: +c.fill.toFixed(2) })), order: S.order ? { table: S.order.t.i, list: S.order.list, showT: +S.order.showT.toFixed(2) } : null,
      fallWhy: S.fallWhy, spillBy: S.spillBy, tables: S.tables.map(t => t.st), money: { ...S.money }, obs: S.obs.map(o => ({ k: o.kind, x: +o.x.toFixed(1) })), counter: !$('#counter').hidden, result: S.result ? { net: S.result.net, stamp: S.result.rank.st.ja } : null,
    }
  },
}
window.__izReady = true
