// 보드 정의: 가로 8칸 × 세로 10칸, 테두리 32칸 + 다리 7칸
// 출발(0) = 왼쪽 아래, 반시계 방향(아래변 → 오른쪽변 → 위변 → 왼쫀변)

export const COLS = 8
export const ROWS = 10
export const MAIN_COUNT = 32
export const BRIDGE_COUNT = 6
export const BRIDGE_ENTRANCE = 14 // 이 칸에 정확히 멈추면 다음 턴에 다리로 진입
export const BRIDGE_EXIT = 29 // 다리 마지막 칸 다음에 도착하는 칸

// type: normal | nop(놉카드 지급) | move(delta) | goStart(출발로) | rest(휴식) | home(출발) | travel(세계여행: 원하는 칸으로)
// locked: true 인 칸은 방장도 편집 불가
export const DEFAULT_CELLS = [
  { id: 0, emoji: '🚩', text: '출발', type: 'home', locked: true },
  { id: 1, emoji: '📝', text: '훈민정음 게임' },
  { id: 2, emoji: '👀', text: '눈치게임' },
  { id: 3, emoji: '🤖', text: 'AI 지목 마셔!', type: 'aiPick' },
  { id: 4, emoji: '🍻', text: '다같이 마셔!' },
  { id: 5, emoji: '⏩', text: '앞으로 2칸', type: 'move', delta: 2 },
  { id: 6, emoji: '☕', text: '휴식', type: 'rest' },
  { id: 7, emoji: '↩️', text: '출발로 다시 이동', type: 'goStart' },
  { id: 8, emoji: '👉', text: '너! 마셔! (지목)' },
  { id: 9, emoji: '🎫', text: '놉카드 +1', type: 'nop' },
  { id: 10, emoji: '🍾', text: '소주병 돌리기' },
  { id: 11, emoji: '🍶', text: '박상혁만 마셔!' },
  { id: 12, emoji: '⚙️', text: '10분 영어금지 (Option)', type: 'option', minutes: 10 },
  { id: 13, emoji: '🤥', text: '라이어 게임' },
  { id: 14, emoji: '🔓', text: '옵션 해제', type: 'release' },
  { id: 15, emoji: '🎫', text: '놉카드 +1', type: 'nop' },
  { id: 16, emoji: '0️⃣', text: '제로 게임' },
  { id: 17, emoji: '🙅', text: '나 빼고 마셔!' },
  { id: 18, emoji: '🐰', text: '바니바니 게임' },
  { id: 19, emoji: '🥂', text: '의리주 마셔! (글라스에)' },
  { id: 20, emoji: '⏪', text: '뒤로 2칸', type: 'move', delta: -2 },
  { id: 21, emoji: '🍶', text: '00년생 마셔!' },
  { id: 22, emoji: '🍶', text: '99년생 마셔!' },
  { id: 23, emoji: '🥃', text: '혼술 마셔!' },
  { id: 24, emoji: '⏪', text: '뒤로 1칸', type: 'move', delta: -1 },
  { id: 25, emoji: '✈️', text: '세계여행', type: 'travel', locked: true },
  { id: 26, emoji: '🎫', text: '놉카드 +1', type: 'nop' },
  { id: 27, emoji: '😈', text: '놉카드 내놔!', type: 'steal' },
  { id: 28, emoji: '🍶', text: '박상혁빼고\n다 마셔!' },
  { id: 29, emoji: '⚙️', text: '투터치 (Option)', type: 'option', minutes: 10 },
  { id: 30, emoji: '🗳️', text: '다수결 지목\n너 마셔!' },
  { id: 31, emoji: '⚖️', text: '밸런스 게임', type: 'balance' },
]

// 지름길(다리) 칸: 3번 위에서 시작, 화면 번호 32~37
export const DEFAULT_BRIDGE = [
  { id: 'b0', emoji: '🚗', text: '대리 기사' },
  { id: 'b1', emoji: '🎫', text: '놉카드 +1', type: 'nop' },
  { id: 'b2', emoji: '⚙️', text: '연대책임 (Option)', type: 'option', minutes: 10 },
  { id: 'b3', emoji: '🔮', text: '텔레파시 게임' },
  { id: 'b4', emoji: '👉', text: '너! 마셔! (지목)' },
  { id: 'b5', emoji: '😈', text: '놉카드 내놔!', type: 'steal' },
]

// ---------------- 레이아웃 (세로 8×10 / 가로 10×8) ----------------
function bezierPts(P0, P1, P2, P3) {
  const f = (t) => {
    const u = 1 - t
    return {
      x: u * u * u * P0.x + 3 * u * u * t * P1.x + 3 * u * t * t * P2.x + t * t * t * P3.x,
      y: u * u * u * P0.y + 3 * u * u * t * P1.y + 3 * u * t * t * P2.y + t * t * t * P3.y,
    }
  }
  const N = 200
  const pts = []
  let len = 0
  let prev = f(0)
  pts.push({ ...prev, s: 0 })
  for (let k = 1; k <= N; k++) {
    const p = f(k / N)
    len += Math.hypot(p.x - prev.x, p.y - prev.y)
    pts.push({ ...p, s: len })
    prev = p
  }
  const centers = []
  for (let i = 0; i < BRIDGE_COUNT; i++) {
    const target = len * (0.1 + (0.8 * i) / (BRIDGE_COUNT - 1))
    const p = pts.find((q) => q.s >= target) || pts[pts.length - 1]
    centers.push({ x: p.x, y: p.y })
  }
  const d = `M ${P0.x} ${P0.y} C ${P1.x} ${P1.y}, ${P2.x} ${P2.y}, ${P3.x} ${P3.y}`
  return { centers, d }
}

function makeLayout({ cols, rows, corners, bridgeCurve, arrows, title, entrance, exit }) {
  // corners: [아래-오른쪽, 위-오른쪽, 위-왼쪽] 인덱스 (아래-왼쪽은 0)
  const [c1, c2, c3] = corners
  const grid = (i) => {
    if (i <= c1) return { col: i, row: rows - 1 } // 아래변 →
    if (i <= c2) return { col: cols - 1, row: rows - 1 - (i - c1) } // 오른쪽변 ↑
    if (i <= c3) return { col: cols - 1 - (i - c2), row: 0 } // 위변 ←
    return { col: 0, row: i - c3 } // 왼쪽변 ↓
  }
  const { centers, d } = bezierPts(...bridgeCurve)
  return { cols, rows, grid, bridgeCenters: centers, bridgePathD: d, arrows, title, entrance, exit }
}

export const LAYOUTS = {
  // 세로: 가로 8 × 세로 10. 모서리 0, 7, 16, 23
  portrait: makeLayout({
    cols: 8,
    rows: 10,
    corners: [7, 16, 23],
    bridgeCurve: [
      { x: 6.95, y: 2.55 },
      { x: 3.6, y: 2.4 },
      { x: 4.3, y: 6.7 },
      { x: 1.05, y: 6.45 },
    ],
    arrows: [{ x: 6.62, y: 2.55, dir: 'left' }, { x: 1.3, y: 6.45, dir: 'left' }],
    title: { left: '14%', top: '12%', width: '33%', height: '15%' },
    entrance: 14,
    exit: 29,
  }),
  // 가로: 가로 10 × 세로 8. 모서리 0, 9, 16, 25. 지름길: 3번(아래변) → 19번(위변)
  landscape: makeLayout({
    cols: 10,
    rows: 8,
    corners: [9, 16, 25],
    bridgeCurve: [
      { x: 3.5, y: 6.95 },
      { x: 1.7, y: 2.4 },
      { x: 8.3, y: 5.6 },
      { x: 6.5, y: 1.05 },
    ],
    arrows: [{ x: 3.5, y: 6.82, dir: 'up' }, { x: 6.5, y: 1.13, dir: 'up' }],
    title: { left: '11.5%', top: '14%', width: '36%', height: '24%' },
    entrance: 3,
    exit: 19,
  }),
}

// 칸 번호는 가로 10×8 보드 기준으로 직접 지정됨 (레이아웃 재배열 없음)
export function cellsForLayout(cells) {
  return cells
}

// 기본(세로) 레이아웃을 그대로 export — 기존 코드 호환
export function mainCellGrid(i) {
  return LAYOUTS.portrait.grid(i)
}
export const BRIDGE_CENTERS = LAYOUTS.portrait.bridgeCenters
export const BRIDGE_PATH_D = LAYOUTS.portrait.bridgePathD

// 위치 표현: { track: 'main' | 'bridge', idx }
export function nextPosition(pos, rules = { entrance: BRIDGE_ENTRANCE, exit: BRIDGE_EXIT }) {
  if (pos.track === 'main') {
    if (pos.idx === rules.entrance && pos.enterBridge) return { track: 'bridge', idx: 0 }
    return { track: 'main', idx: (pos.idx + 1) % MAIN_COUNT }
  }
  if (pos.idx >= BRIDGE_COUNT - 1) return { track: 'main', idx: rules.exit }
  return { track: 'bridge', idx: pos.idx + 1 }
}

// 주사위 값만큼 이동한 경로(각 스텝 위치 배열)를 반환
export function computePath(pos, steps, rules = { entrance: BRIDGE_ENTRANCE, exit: BRIDGE_EXIT }) {
  const path = []
  let cur = { ...pos }
  // 입구 칸에 "멈춰 있던" 플레이어만 다리로 진입
  if (cur.track === 'main' && cur.idx === rules.entrance) cur.enterBridge = true
  for (let s = 0; s < steps; s++) {
    cur = nextPosition(cur, rules)
    path.push({ track: cur.track, idx: cur.idx })
  }
  return path
}

export function cellAt(cells, bridge, pos) {
  return pos.track === 'main' ? cells[pos.idx] : bridge[pos.idx]
}

export function posKey(pos) {
  return `${pos.track}-${pos.idx}`
}

export function samePos(a, b) {
  return a.track === b.track && a.idx === b.idx
}
