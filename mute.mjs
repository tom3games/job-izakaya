// テスト中は音を出さない（本人「プレイしてテストするときに音を出さないで」2026-10-31）
// 使い方: const b = await chromium.launch(MUTE_LAUNCH); await muteContext(ctx)
export const MUTE_LAUNCH = { args: ['--mute-audio'] }
export async function muteContext(ctx) {
  await ctx.addInitScript(() => {
    for (const k of ['AudioContext', 'webkitAudioContext']) {
      const C = window[k]; if (!C) continue
      C.prototype.resume = function () { window.__soundCalls = (window.__soundCalls || 0) + 1; return Promise.resolve() }
      const orig = C.prototype.createGain
      if (orig) C.prototype.createGain = function () { window.__soundCalls = (window.__soundCalls || 0) + 1; return orig.apply(this, arguments) }
    }
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function () { this.muted = true; this.volume = 0; return play.apply(this, arguments) }
  })
}
