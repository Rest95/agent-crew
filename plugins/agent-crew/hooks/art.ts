// Drawing: sprites, SVG rows, terminal glyphs and number formatting. Pure: no engine calls,
// so the preview script draws with the same code the panel does.
import type { Plan, PlanTask, Role, Run, Status } from '../types'
import { contextLevel, currentTask } from './model'

export const ACCENT = '#8f8cf4'
export const DONE_COLOR = '#5fbf8f'
export const OTHER_COLOR = '#888780'
const CLAY = '#D97757'
const INK = '#1F1E1D'
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif"

/** Each role's costume, colour and word, as the spec fixes them. */
export const ROLE_STYLE: Record<Role, { costume: string; color: string; word: string }> = {
  implement: { costume: 'careful', color: '#378ADD', word: 'implementing' },
  fix: { costume: 'careful', color: '#D85A30', word: 'fixing' },
  review: { costume: 'heavy', color: '#BA7517', word: 'reviewing' },
  rereview: { costume: 'heavy', color: '#D85A30', word: 're-reviewing' },
  final: { costume: 'fable', color: '#7F77DD', word: 'final review' },
  other: { costume: 'other', color: OTHER_COLOR, word: '' },
}

export const costumeOf = (run: Run): string => (run.role === 'other' ? (run.type === 'Explore' ? 'explore' : 'other') : ROLE_STYLE[run.role].costume)
// Agents outside a plan's roles: a colour by type, none of them a role's.
export const TYPE_PALETTE: readonly string[] = ['#1D9E75', '#C2557A', '#2E9DB3', '#9A62C9', '#7E9A2E']
const TYPE_COLOR: Record<string, string> = { Explore: '#1D9E75', 'general-purpose': '#C2557A', Plan: '#2E9DB3' }
const typeColor = (type: string): string => {
  const known = TYPE_COLOR[type]
  if (known) return known
  let hash = 0
  for (const ch of type) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return TYPE_PALETTE[hash % TYPE_PALETTE.length] ?? OTHER_COLOR
}

export const colorOf = (run: Run): string => (run.role === 'other' ? typeColor(run.type) : ROLE_STYLE[run.role].color)

// ---------------------------------------------------------------------------
// Words and numbers

export const xml = (s: string): string => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿가-힣豈-﫿！-｠]/u
// Rough advance of system UI text, in em: enough to keep text inside its slot.
const charEm = (ch: string): number => (WIDE.test(ch) ? 1 : /[\s.,:;'|!il1()[\]]/.test(ch) ? 0.3 : /[A-Zmw@%]/.test(ch) ? 0.72 : 0.56)
export const textWidth = (s: string, size: number): number => [...s].reduce((w, ch) => w + charEm(ch) * size, 0)

/** Cuts `s` to `maxW` pixels, with an ellipsis when it had to. */
export const fitText = (s: string, size: number, maxW: number): string => {
  if (textWidth(s, size) <= maxW) return s
  let out = ''
  for (const ch of s) {
    if (textWidth(out + ch + '…', size) > maxW) break
    out += ch
  }
  return out + '…'
}

export const fmtCost = (usd: number): string => `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)}`
export const fmtTokens = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`)
export const fmtTime = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
export const modelName = (id: string): string => {
  const m = /(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(id)
  const [, family = '', major = '', minor] = m ?? []
  if (!family) return id.replace(/^claude-/, '').replace(/\[.*\]$/, '') || '—'
  return `${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()} ${major}${minor ? '.' + minor : ''}`
}

export const elapsed = (run: Run, now: number): number => (run.endedAt ?? Math.max(now, run.startedAt)) - run.startedAt
export const ctxPercent = (run: Run): number => (run.contextMax ? Math.min(100, Math.round((run.contextTokens / run.contextMax) * 100)) : 0)
/** The run's own progress when it reports steps; a finished run is full; else null (context shows, grey). */
export const progressOf = (run: Run): number | null =>
  run.status === 'done' ? 1 : run.stepTotal ? Math.min(1, (run.stepDone ?? 0) / run.stepTotal) : null

export function runTitle(run: Run, plan: Plan | null): string {
  if (run.role === 'final') return 'Whole branch'
  const task = run.task !== null ? plan?.tasks.find(t => t.n === run.task) : undefined
  if (task) return `Task ${task.n} · ${task.title}`
  return run.label || run.type
}

export function runRole(run: Run): string {
  const word = run.role === 'other' ? run.type : ROLE_STYLE[run.role].word
  return run.round > 0 && (run.role === 'fix' || run.role === 'rereview') ? `${word} · round ${run.round}` : word
}

export const runModel = (run: Run): string => (run.effort ? `${modelName(run.model)} · ${run.effort}` : modelName(run.model))

export const stepsText = (run: Run): string => (run.stepTotal ? `${run.stepDone ?? 0}/${run.stepTotal}${run.stepNote ? ' · ' + run.stepNote : ''}` : '')

// ---------------------------------------------------------------------------
// Terminal

export const bar = (percent: number, cells: number): string => {
  const filled = Math.max(0, Math.min(cells, Math.round((cells * percent) / 100)))
  return '█'.repeat(filled) + '░'.repeat(cells - filled)
}

export const GLYPH: Record<Status | 'waiting', string> = { running: '●', done: '✓', failed: '✗', waiting: '◷' }

// ---------------------------------------------------------------------------
// Sprites: a 24×18 crab on a 30×28 grid, one costume per role. Adapted from
// savvy-progress in claude-kit (MIT, © 2026 johnnyvizz).

type Fill = (x: number, y: number, w: number, h: number, c: string, cls?: string) => void

const stamp = (f: Fill, x: number, y: number, rows: string[], map: Record<string, string>, cls?: string): void =>
  rows.forEach((row, dy) => [...row].forEach((ch, dx) => map[ch] && f(x + dx, y + dy, 1, 1, map[ch] ?? '', cls)))

// `armCls` lets a raised claw travel with the prop it holds.
const crabBody = (f: Fill, armFront = 0, armCls?: string): void => {
  f(7, 10, 16, 12, CLAY)
  f(3, 14, 4, 4, CLAY)
  f(23, 14 + armFront, 4, 4, CLAY, armCls)
  f(9, 12, 2, 2, INK)
  f(19, 12, 2, 2, INK)
  f(7, 22, 2, 4, CLAY, 'la')
  f(17, 22, 2, 4, CLAY, 'la')
  f(11, 22, 2, 4, CLAY, 'lb')
  f(21, 22, 2, 4, CLAY, 'lb')
}

// Run by the compositor: periods divide one second, so a once-a-second redraw restarts them in phase.
export const CRAB_CSS = `<style>
.run .la{animation:st .5s steps(1) infinite}.run .lb{animation:st .5s steps(1) infinite -.25s}
.run .bd{animation:bob .5s steps(1) infinite -.125s}
.run g{transform-box:fill-box}
@keyframes st{50%{transform:translateY(-1px)}}@keyframes bob{50%{transform:translateY(1px)}}
.c-fable.run{animation:float 1s ease-in-out infinite}
.c-fable.run .la,.c-fable.run .lb,.c-fable.run .bd{animation:none}
.c-fable.run .ant{animation:blink 1s steps(1) infinite}
.c-fable.run .star{animation:blink .5s steps(1) infinite -.25s}
@keyframes float{50%{transform:translateY(-2px)}}@keyframes blink{50%{opacity:.15}}
.c-heavy.run .it{animation:scan 1s steps(1) infinite}
.c-heavy.run .gl{animation:blink 1s steps(1) infinite -.5s}
@keyframes scan{25%{transform:translate(-1px,1px)}50%{transform:translate(-2px,2px)}75%{transform:translate(-1px,1px)}}
.c-careful.run .it{transform-origin:100% 100%;animation:twist .5s ease-in-out infinite}
@keyframes twist{50%{transform:rotate(-35deg)}}
.c-explore.run .it{transform-origin:50% 100%;animation:fence .5s ease-in-out infinite}
@keyframes fence{50%{transform:rotate(25deg)}}
@media (prefers-reduced-motion: reduce){.run,.run g{animation:none!important}}
</style>`

const COSTUMES: Record<string, (f: Fill, t: string) => void> = {
  // Astronaut in a glass dome: floats instead of walking; the antenna and the star blink.
  fable: (f, t) => {
    crabBody(f)
    f(6, 7, 18, 1, '#E6E8EE'); f(5, 8, 1, 14, '#E6E8EE'); f(24, 8, 1, 14, '#E6E8EE'); f(6, 22, 18, 1, '#C9CCD2')
    f(6, 8, 18, 14, 'rgba(169,214,245,.32)'); f(8, 9, 2, 1, '#fff'); f(8, 10, 1, 2, '#fff')
    f(14, 4, 2, 3, '#C9CCD2'); f(14, 2, 2, 2, t, 'ant'); f(13, 18, 4, 2, t)
    f(27, 3, 1, 3, '#F5C542', 'star'); f(26, 4, 3, 1, '#F5C542', 'star')
  },
  // Detective in a deerstalker: the magnifier sweeps and glints.
  heavy: (f, t) => {
    crabBody(f, -4, 'it')
    stamp(f, 6, 3, ['......bbbbbb......', '....bbcbbcbbbb....', '...bbbbbbbbbbbb...', '..bcbbcbbcbbcbbb..', '.bbbbbbbbbbbbbbbb.', 'dddddddddddddddddd'], { b: '#7A4A26', c: '#A0703F', d: '#5A3519' })
    f(6, 9, 18, 1, t)
    stamp(f, 23, 1, ['.kkk.', 'k...k', 'k...k', 'k...k', '.kkk.'], { k: '#3A3A3C' }, 'it')
    f(24, 2, 3, 3, 'rgba(169,214,245,.7)', 'it'); f(25, 6, 1, 4, '#7A4A26', 'it'); f(24, 2, 1, 1, '#fff', 'gl')
  },
  // Engineer in a hard hat: the wrench turns a bolt.
  careful: (f, t) => {
    crabBody(f)
    stamp(f, 6, 4, ['.....yyyyyyyy.....', '...yyyyyhhyyyyy...', '..yyyyyyhhyyyyyy..', '..yyyyyyhhyyyyyy..', '.yyyyyyyhhyyyyyyy.', 'dddddddddddddddddd'], { y: '#F5C542', h: '#FBE08A', d: '#C99A1E' })
    f(13, 5, 4, 2, t)
    stamp(f, 0, 10, ['.s.s', 'sss.', '.s..', '.s..'], { s: '#8E929A' }, 'it')
  },
  // Pirate scouting the code: the cutlass fences.
  explore: f => {
    crabBody(f)
    stamp(f, 5, 3, ['.kk..............kk.', '.kkk....kkkk....kkk.', '..kkkkkkkwwkkkkkkk..', '..kkkkkkkkkkkkkkkk..', '.gggggggggggggggggg.'], { k: '#55514C', w: '#F8F6F1', g: '#F5C542' })
    f(7, 11, 11, 1, INK); f(18, 11, 4, 3, INK)
    f(27, 6, 1, 9, '#C9CCD2', 'it'); f(26, 15, 3, 1, '#7A4A26', 'it')
  },
  other: f => crabBody(f),
}

/** One crab at (x, y): the body and props bob together, the legs step on their own. */
export function crab(x: number, y: number, costume: string, opts: { dim?: boolean; walking?: boolean; scale?: number; accent?: string } = {}): string {
  const scale = opts.scale ?? 1.1
  const groups = new Map<string, string[]>([['bd', []]])
  const f: Fill = (cx, cy, w, h, c, cls = 'bd') => {
    if (!groups.has(cls)) groups.set(cls, [])
    groups.get(cls)?.push(`<rect x="${cx}" y="${cy}" width="${w}" height="${h}" fill="${c}"/>`)
  }
  ;(COSTUMES[costume] ?? COSTUMES.other ?? (() => undefined))(f, opts.accent ?? OTHER_COLOR)
  const group = (cls: string) => `<g class="${cls}">${(groups.get(cls) ?? []).join('')}</g>`
  const props = [...groups.keys()].filter(k => k !== 'bd' && k !== 'la' && k !== 'lb')
  const body = `<g class="bd">${(groups.get('bd') ?? []).join('')}${props.map(group).join('')}</g>`
  return `<g transform="translate(${x},${y}) scale(${scale})" opacity="${opts.dim ? 0.45 : 1}" shape-rendering="crispEdges"><g class="c-${costume}${opts.walking ? ' run' : ''}">${body}${group('la')}${group('lb')}</g></g>`
}

const runCrab = (x: number, y: number, run: Run, scale?: number): string =>
  crab(x, y, costumeOf(run), { walking: run.status === 'running', scale, accent: colorOf(run) })

// ---------------------------------------------------------------------------
// SVG rows (desktop). Each row is one drawing; themes follow prefers-color-scheme.

const PANE_CSS = `<style>
.t{fill:#1f1f1f}.s{fill:#6b6b68}.m{fill:#9a9a96}.k{fill:#ecebe8}.ln{stroke:#e4e4e1}.tile{fill:#f4f3f0}.tk{fill:#b4b4b0}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.s{fill:#a8a8a4}.m{fill:#7d7d79}.k{fill:#2c2c2b}.ln{stroke:#333331}.tile{fill:#262625}.tk{fill:#5a5a5a}}
.live{animation:p 1.6s ease-in-out infinite}@keyframes p{50%{opacity:.3}}
@media (prefers-reduced-motion: reduce){.live{animation:none}}
</style>`

const svg = (w: number, h: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${PANE_CSS}${CRAB_CSS}${body}</svg>`

export function statusMark(x: number, y: number, status: Status | 'waiting', color: string): string {
  if (status === 'running') return `<circle class="live" cx="${x}" cy="${y}" r="3.5" fill="${color}"/>`
  if (status === 'done') return `<path d="M${x - 5} ${y}l3.5 3.5 6.5-7" fill="none" stroke="#3B9C5F" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
  if (status === 'failed') return `<path d="M${x - 4} ${y - 4}l8 8M${x + 4} ${y - 4}l-8 8" stroke="#D0453F" stroke-width="1.8" stroke-linecap="round"/>`
  return `<circle cx="${x}" cy="${y}" r="5" fill="none" stroke="${color}" stroke-width="1.4"/><path d="M${x} ${y - 2.5}v2.8l1.8 1.2" fill="none" stroke="${color}" stroke-width="1.4" stroke-linecap="round"/>`
}

// Fixed noise, so the dither does not shimmer between redraws.
const noise = (x: number, y: number): number => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return s - Math.floor(s)
}

export const BAR_HEIGHT = 22

/** The plan's progress: title, a dithered bar with its pill, percent, and a crab that walks while agents work. */
export function planBarSvg(title: string, phase: { done: number; total: number; label: string; isFinished: boolean }, running: number, width: number): string {
  const H = BAR_HEIGHT
  const BH = 16
  const CELL = 3
  const crabW = 26
  const shown = fitText(title, 13, Math.max(60, width * 0.4))
  const barX = Math.round(16 + textWidth(shown, 13) + 12)
  const barW = Math.max(60, width - barX - 46 - crabW)
  const ratio = phase.isFinished ? 1 : phase.total ? phase.done / phase.total : 0
  const color = phase.isFinished ? DONE_COLOR : ACCENT
  const fillW = Math.round(barW * ratio)
  const runW = phase.total ? Math.round((barW * Math.min(phase.total, phase.done + running)) / phase.total) : 0
  const cols = Math.floor(fillW / CELL)
  const rows = Math.floor(BH / CELL)
  const dots: string[] = []
  for (let c = 0; c < cols; c++) {
    const density = 0.35 + 0.6 * Math.pow(c / Math.max(1, cols), 1.2)
    for (let r = 0; r < rows; r++) if (noise(c, r) < density) dots.push(`<rect class="t${Math.floor(noise(r, c) * 4)}" x="${c * CELL + 1}" y="${r * CELL + 1}" width="2" height="2"/>`)
  }
  // Tasks in progress: a faint second layer.
  const faint: string[] = []
  for (let c = cols; c < Math.floor(runW / CELL); c++) {
    for (let r = 0; r < rows; r++) if (noise(c + 7, r + 3) < 0.2) faint.push(`<rect x="${c * CELL + 1}" y="${r * CELL + 1}" width="1.7" height="1.7"/>`)
  }
  const ticks: string[] = []
  for (let i = 1; i < phase.total; i++) {
    const x = Math.round((barW * i) / phase.total)
    if (x > fillW + 4) ticks.push(`<rect x="${x}" y="${BH / 2 - 4}" width="1.5" height="8" rx="0.75"/>`)
  }
  const pillW = Math.round(18 + phase.label.length * 6.6)
  const pillX = Math.max(0, Math.min(barW - pillW, fillW - pillW))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}">${PANE_CSS}
<style>.t0,.t1,.t2,.t3{animation:tw 2.2s ease-in-out infinite}.t1{animation-duration:2.8s;animation-delay:-.7s}.t2{animation-duration:1.9s;animation-delay:-1.3s}.t3{animation-duration:3.3s;animation-delay:-.4s}
@keyframes tw{0%,100%{opacity:1}50%{opacity:${phase.isFinished ? 0.8 : 0.3}}}@media (prefers-reduced-motion: reduce){.t0,.t1,.t2,.t3{animation:none}}</style>
<defs><clipPath id="c"><rect width="${barW}" height="${BH}" rx="${BH / 2}"/></clipPath></defs>
<circle cx="5" cy="${H / 2}" r="4" fill="${color}"/>
<text class="t" x="16" y="${H / 2 + 4.5}" font-family="${FONT}" font-size="13" font-weight="500">${xml(shown)}</text>
<g transform="translate(${barX},${(H - BH) / 2})">
<rect class="k" width="${barW}" height="${BH}" rx="${BH / 2}"/>
<g clip-path="url(#c)"><g fill="${color}">${dots.join('')}</g><g fill="${color}" opacity="0.45">${faint.join('')}</g><g class="tk">${ticks.join('')}</g></g>
<rect x="${pillX}" width="${pillW}" height="${BH}" rx="${BH / 2}" fill="${color}"/>
<text x="${pillX + pillW / 2}" y="${BH / 2 + 4}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="600" fill="#ffffff">${xml(phase.label)}</text>
</g>
<text class="m" x="${width - crabW - 6}" y="${H / 2 + 4.5}" text-anchor="end" font-family="${FONT}" font-size="12.5" font-variant-numeric="tabular-nums">${Math.round(ratio * 100)}%</text>
${CRAB_CSS}${crab(width - crabW + 1, 0, 'other', { walking: running > 0, scale: 0.8 })}
</svg>`
}

export const TOTALS_HEIGHT = 44

export function totalsSvg(width: number, cost: number, tokens: number, ms: number): string {
  const gap = 6
  const tw = (width - gap * 2) / 3
  const tile = (i: number, k: string, v: string) => `<rect class="tile" x="${i * (tw + gap)}" y="0" width="${tw}" height="40" rx="8"/>
<text class="s" x="${i * (tw + gap) + 9}" y="16" font-family="${FONT}" font-size="11">${k}</text>
<text class="t" x="${i * (tw + gap) + 9}" y="33" font-family="${FONT}" font-size="15" font-weight="600" font-variant-numeric="tabular-nums">${v}</text>`
  return svg(width, TOTALS_HEIGHT, `${tile(0, 'Cost', '≈' + fmtCost(cost))}${tile(1, 'Tokens', fmtTokens(tokens))}${tile(2, 'Time', fmtTime(ms))}`)
}

export const AGENT_ROW_HEIGHT = 66

/** One agent: crab, title, role in its colour, model, steps, stats and a progress line. */
export function agentRowSvg(width: number, run: Run, plan: Plan | null, now: number): string {
  const color = colorOf(run)
  const barW = width - 64
  const ctx = ctxPercent(run)
  const progress = progressOf(run)
  const meta = '· ' + runModel(run) + (run.findings && run.status !== 'running' ? `  ·  ${run.findings} findings` : '')
  const stats = `ctx ${ctx}% · ${fmtTokens(run.contextTokens)}  ≈${fmtCost(run.costUsd)}  ${fmtTime(elapsed(run, now))}`
  const steps = stepsText(run)
  const stepsW = Math.max(0, barW - textWidth(stats, 11) - 12)
  const fillW = Math.round(barW * (progress ?? ctx / 100))
  return svg(width, AGENT_ROW_HEIGHT, `${runCrab(0, 14, run)}
<text class="t" x="42" y="18" font-family="${FONT}" font-size="13" font-weight="600">${xml(fitText(runTitle(run, plan), 13, barW))}</text>
<text x="42" y="34" font-family="${FONT}" font-size="11"><tspan fill="${color}" font-weight="600">${xml(runRole(run))}</tspan><tspan class="s"> ${xml(meta)}</tspan></text>
${steps && stepsW > 30 ? `<text class="t" x="42" y="49" font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${xml(fitText(steps, 11, stepsW))}</text>` : ''}
<text class="s" x="${42 + barW}" y="49" text-anchor="end" font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${stats}</text>
<rect class="k" x="42" y="55" width="${barW}" height="4" rx="2"/><rect${progress === null ? ' class="m"' : ''} x="42" y="55" width="${fillW}" height="4" rx="2"${progress === null ? '' : ` fill="${color}"`}/>
${statusMark(width - 8, 16, run.status, color)}
<line class="ln" x1="0" y1="65.5" x2="${width}" y2="65.5"/>`)
}

export const TASK_ROW_HEIGHT = 30

/** One plan task: its mark, its name, and a small crab for each agent that worked on it. */
// A task rarely has more agents than this; past it, the newest show and a count stands for the rest.
const MAX_TASK_CRABS = 8

export function taskRowSvg(width: number, task: PlanTask, state: 'done' | 'current' | 'waiting', runs: readonly Run[], now: number): string {
  const shown = runs.slice(-MAX_TASK_CRABS)
  const more = runs.length - shown.length
  const moreW = more ? 26 : 0
  const crabs = shown.map((run, k) => runCrab(width - 22 * (shown.length - k), 6, run, 0.62)).join('')
  const count = more ? `<text class="s" x="${width - 22 * shown.length - 4}" y="19" text-anchor="end" font-family="${FONT}" font-size="11">+${more}</text>` : ''
  const textW = Math.max(40, width - 26 - shown.length * 22 - moreW - 8)
  const mark = state === 'done' ? 'done' : state === 'current' ? 'running' : 'waiting'
  return svg(width, TASK_ROW_HEIGHT, `${statusMark(8, 15, mark, mark === 'waiting' ? ACCENT : ROLE_STYLE.implement.color)}
<text class="t" x="24" y="19" font-family="${FONT}" font-size="12.5"${state === 'current' ? ' font-weight="600"' : ''}>${xml(fitText(`${task.n}. ${task.title}`, 12.5, textW))}</text>
${count}${crabs}<line class="ln" x1="0" y1="29.5" x2="${width}" y2="29.5"/>`)
}

// ---------------------------------------------------------------------------
// The desktop pane's layout, shared by the panel and the preview so the two never drift.

export type PaneItem =
  | { kind: 'svg'; key: string; svg: string; height: number; alt: string; agentId?: string }
  | { kind: 'rule' }
  | { kind: 'group'; key: string; open: boolean; count: number; label: string }
  | { kind: 'path'; text: string }
  | { kind: 'section'; text: string }
  | { kind: 'inline'; text: string }
  | { kind: 'finished'; open: boolean; count: number }
  | { kind: 'empty' }

export type PaneOptions = {
  finishedOpen: boolean
  /** The groups the person opened or closed; the rest follow isGroupOpen's default. */
  open?: Readonly<Record<string, boolean>>
  /** The plan's progress, when a plan is set (model.ts's planPhase). */
  phase?: { done: number; total: number; label: string; isFinished: boolean }
}

// ---------------------------------------------------------------------------
// The plan view, grouped by task: each task holds its agents; the final review and the
// agents outside the plan have groups of their own.

export type Group = { key: string; kind: 'task' | 'final' | 'other'; n: number | null; name: string; state: 'done' | 'current' | 'waiting' | null; runs: Run[] }

export function planGroups(plan: Plan, runs: readonly Run[]): Group[] {
  const current = currentTask(plan, runs)
  const running = runs.filter(r => r.status === 'running')
  const groups: Group[] = plan.tasks.map(t => ({
    key: `t${t.n}`,
    kind: 'task',
    n: t.n,
    name: `${t.n}. ${t.title}`,
    state: plan.complete.includes(t.n) ? 'done' : t.n === current || running.some(r => r.task === t.n) ? 'current' : 'waiting',
    runs: runs.filter(r => r.task === t.n),
  }))
  const final = runs.filter(r => r.role === 'final')
  if (final.length) groups.push({ key: 'final', kind: 'final', n: null, name: 'Whole branch', state: null, runs: final })
  const other = runs.filter(r => r.role === 'other')
  if (other.length) groups.push({ key: 'other', kind: 'other', n: null, name: 'Other agents', state: null, runs: other })
  return groups
}

/** A group is open when the person opened it; until then, the current task and a running final review are. */
export const isGroupOpen = (g: Group, open: Readonly<Record<string, boolean>> = {}): boolean =>
  open[g.key] ?? (g.state === 'current' || (g.kind === 'final' && g.runs.some(r => r.status === 'running')))

export const groupCount = (g: Group): string => `${g.runs.length} agent${g.runs.length === 1 ? '' : 's'}`

export function desktopPaneItems(width: number, plan: Plan | null, runs: readonly Run[], now: number, opts: PaneOptions): PaneItem[] {
  const running = runs.filter(r => r.status === 'running')
  const finished = runs.filter(r => r.status !== 'running').reverse()
  const cost = runs.reduce((n, r) => n + r.costUsd, 0)
  const tokens = runs.reduce((n, r) => n + r.tokens, 0)
  const span = runs.length ? Math.max(...runs.map(r => r.endedAt ?? now)) - Math.min(...runs.map(r => r.startedAt)) : 0
  const inlineTask =
    plan?.inline && plan.current !== null && running.length === 0 && !plan.complete.includes(plan.current) && !opts.phase?.isFinished
      ? plan.tasks.find(t => t.n === plan.current)
      : undefined
  const agent = (r: Run): PaneItem => ({ kind: 'svg', key: r.id, svg: agentRowSvg(width, r, plan, now), height: AGENT_ROW_HEIGHT, alt: `${runTitle(r, plan)}: ${runRole(r)}`, ...(r.agentId ? { agentId: r.agentId } : {}) })
  const items: PaneItem[] = []
  if (plan) {
    const phase = opts.phase ?? { done: plan.complete.length, total: plan.tasks.length, label: `Tasks ${plan.complete.length}/${plan.tasks.length}`, isFinished: false }
    items.push({ kind: 'svg', key: 'bar', svg: planBarSvg(plan.title, phase, running.length, width), height: BAR_HEIGHT, alt: `${plan.title}: ${phase.label}` })
    items.push({ kind: 'path', text: plan.path })
  }
  items.push({ kind: 'svg', key: 'totals', svg: totalsSvg(width, cost, tokens, span), height: TOTALS_HEIGHT, alt: `≈${fmtCost(cost)}, ${fmtTokens(tokens)} tokens, ${fmtTime(span)}` })
  if (plan) {
    // Grouped by task, under a line: a task row, its toggle, and its agents when open.
    items.push({ kind: 'rule' })
    for (const g of planGroups(plan, runs)) {
      const isOpen = isGroupOpen(g, opts.open)
      if (g.kind === 'other') items.push({ kind: 'rule' })
      if (g.kind === 'task' && g.n !== null) {
        const task = plan.tasks.find(t => t.n === g.n)
        if (task) items.push({ kind: 'svg', key: `task-${g.n}`, svg: taskRowSvg(width, task, g.state ?? 'waiting', g.runs, now), height: TASK_ROW_HEIGHT, alt: g.name })
        if (g.runs.length) items.push({ kind: 'group', key: g.key, open: isOpen, count: g.runs.length, label: `${isOpen ? '▾' : '▸'} ${groupCount(g)}` })
      } else {
        items.push({ kind: 'group', key: g.key, open: isOpen, count: g.runs.length, label: `${isOpen ? '▾' : '▸'} ${g.name} · ${g.runs.length}` })
      }
      if (isOpen) items.push(...g.runs.map(agent))
      if (isOpen && inlineTask && g.n === inlineTask.n) items.push({ kind: 'inline', text: `Main session · Task ${inlineTask.n} · ${inlineTask.title}` })
    }
    return items
  }
  // No plan: the plain list of agents.
  if (runs.length === 0) items.push({ kind: 'empty' })
  if (running.length > 0) items.push({ kind: 'section', text: `Running · ${running.length}` })
  items.push(...running.map(agent))
  if (finished.length > 0) items.push({ kind: 'finished', open: opts.finishedOpen, count: finished.length })
  if (opts.finishedOpen) items.push(...finished.map(agent))
  return items
}

// ---------------------------------------------------------------------------
// The row above the prompt: small ring icons, drawn as session-band drew them.

export const CACHE_COLOR = '#4fb3a9'
export const WARN_COLOR = '#e2a94e'
export const ALERT_COLOR = '#e0846b'
export const OK_COLOR = '#4caf6e'
export const CONTEXT_COLOR = '#5fa8d3'
const RING_MUTED = '#8a8f8c'

const ring = (color: string, glyph: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="10" fill="none" stroke="${color}" stroke-width="2"/>${glyph}</svg>`

export const levelColor = (level: 'ok' | 'warn' | 'alert'): string => (level === 'alert' ? ALERT_COLOR : level === 'warn' ? WARN_COLOR : OK_COLOR)

export const branchIconSvg = (): string =>
  ring(RING_MUTED, `<g fill="none" stroke="${RING_MUTED}" stroke-width="1.6" stroke-linecap="round"><circle cx="9" cy="7.5" r="1.6"/><circle cx="9" cy="16.5" r="1.6"/><circle cx="15" cy="9.5" r="1.6"/><path d="M9 9.1v5.8M15 11.1c0 2.4-6 1.6-6 3.8"/></g>`)

/** A ring that fills with the context, around a page of lines. */
export function contextRingSvg(percent: number): string {
  const c = 2 * Math.PI * 10
  const filled = (Math.min(100, Math.max(0, percent)) / 100) * c
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="10" fill="none" stroke="${RING_MUTED}" stroke-opacity="0.35" stroke-width="2"/><circle cx="12" cy="12" r="10" fill="none" stroke="${CONTEXT_COLOR}" stroke-width="2" stroke-linecap="round" stroke-dasharray="${filled.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 12 12)"/><g stroke="${CONTEXT_COLOR}" stroke-width="1.6" stroke-linecap="round"><path d="M8.5 9h7M8.5 12h7M8.5 15h4.5"/></g></svg>`
}

export function contextBarSvg(percent: number): string {
  const w = Math.round((Math.min(100, Math.max(0, percent)) / 100) * 80)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 6" width="80" height="6"><rect width="80" height="6" rx="3" fill="${RING_MUTED}" fill-opacity="0.3"/><rect width="${w}" height="6" rx="3" fill="${levelColor(contextLevel(percent))}"/></svg>`
}

/** An hourglass: the prompt cache running out. */
export const hourglassSvg = (color: string): string =>
  ring(color, `<g fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="M8.5 6.5h7M8.5 17.5h7"/><path d="M9.5 6.5c0 3 5 3.5 5 5.5s-5 2.5-5 5.5M14.5 6.5c0 3-5 3.5-5 5.5s5 2.5 5 5.5"/></g>`)
