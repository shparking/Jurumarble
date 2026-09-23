// Firebase Realtime Database 방 로직
// rooms/{CODE} = {
//   hostId, createdAt, status: 'lobby' | 'playing', layout,
//   players/{pid}: { name, color, nop, joinedAt },
//   order: [pid...], turn: number, pos: {track, idx}, dice: number,
//   lastMove: { id, playerId, path: [pos...], dice? },       // 모든 클라이언트가 이 경로대로 애니메이션
//   pending: { kind, playerId, pos } | null,                   // 도착 칸 처리 대기 (행동 주체만 버튼 활성)
//   event: { id, text },                                       // 토스트로 띄울 최근 이벤트
//   cells: { [idx]: text }, bridgeCells: { [idx]: text }       // 방장이 편집한 칸 텍스트
// }
import { dbGet, dbSet, dbUpdate, dbRemove, dbOn, dbOnConnected, dbPresence, now, DEMO, demoSeed, dbPurgeOldRooms } from './db'
import './firebase'
import { DEFAULT_CELLS, DEFAULT_BRIDGE, LAYOUTS, MAIN_COUNT, computePath, cellAt, cellsForLayout } from './game/board'
import { BALANCE_TOPICS } from './game/balance'
import { autoEmoji } from './game/emoji'

export const COLORS = ['#ea002c', '#2f6df6', '#1fa97a', '#f59e0b', '#8b5cf6', '#ec4899', '#0ea5e9', '#84cc16', '#14b8a6', '#f97316']

// ---------- 내 아이디 (기기별 고정) ----------
export function myId() {
  // 테스트용: ?pid=abc 로 열면 그 탭은 별도 플레이어로 취급 (같은 브라우저에서 2인 테스트)
  const q = new URLSearchParams(window.location.search).get('pid')
  if (q) return 'p_' + q.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20)
  try {
    let id = localStorage.getItem('pid')
    if (!id) {
      id = 'p_' + Math.random().toString(36).slice(2, 10)
      localStorage.setItem('pid', id)
    }
    return id
  } catch {
    return 'p_' + Math.random().toString(36).slice(2, 10)
  }
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function randomCode() {
  let s = ''
  for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  return s
}

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const roomPath = (code) => `rooms/${code}`
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

// ---------- 방 만들기 / 입장 ----------
export function purgeRooms() {
  return dbPurgeOldRooms().catch(() => 0)
}

export async function createRoom(name, layout = 'landscape') {
  const id = myId()
  // 오래된/시작 안 한 방 정리 (실패해도 방 만들기는 계속)
  purgeRooms()
  let code = randomCode()
  for (let tries = 0; tries < 5; tries++) {
    if ((await dbGet(roomPath(code))) == null) break
    code = randomCode()
  }
  await dbSet(roomPath(code), {
    hostId: id,
    createdAt: now(),
    status: 'lobby',
    layout,
    players: { [id]: { name, color: COLORS[0], nop: 0, joinedAt: now() } },
    pos: { track: 'main', idx: 0 },
    turn: 0,
    dice: 1,
  })
  if (DEMO) {
    demoSeed(code, ['관희', '윤정', '민수'], COLORS)
    // 데모: ?demo=1&start=30 처럼 시작 칸 지정 (특정 칸 테스트용)
    const st = parseInt(new URLSearchParams(window.location.search).get('start'), 10)
    if (!isNaN(st)) await dbUpdate(roomPath(code), { pos: { track: 'main', idx: ((st % MAIN_COUNT) + MAIN_COUNT) % MAIN_COUNT } })
    // 데모: &opt=m12,m29 처럼 진행 중인 옵션 타이머를 미리 만들어 둠
    const opt = new URLSearchParams(window.location.search).get('opt')
    if (opt) {
      const upd = {}
      opt.split(',').forEach((k, i) => {
        const cell = k.startsWith('m') ? DEFAULT_CELLS[+k.slice(1)] : DEFAULT_BRIDGE[+k.slice(1)]
        if (cell) upd[`options/${k}`] = { text: optionLabel(cell), startedAt: Date.now(), endsAt: Date.now() + (7 - i * 3) * 60000, minutes: 10 }
      })
      await dbUpdate(roomPath(code), upd)
    }
  }
  return code
}

export async function joinRoom(code, name) {
  code = code.trim().toUpperCase()
  const room = await dbGet(roomPath(code))
  if (room == null) throw new Error('그런 방이 없어요. 코드를 다시 확인해주세요.')
  const id = myId()
  const players = room.players || {}
  if (!players[id]?.name) {
    if (room.status !== 'lobby') throw new Error('이미 시작된 게임이에요.')
    if (Object.keys(players).length >= 10) throw new Error('방이 가득 찼어요 (최대 10명).')
    const used = new Set(Object.values(players).map((p) => p.color))
    const color = COLORS.find((c) => !used.has(c)) || COLORS[Object.keys(players).length % COLORS.length]
    await dbUpdate(`rooms/${code}/players/${id}`, { name, color, nop: 0, joinedAt: now() })
  } else if (players[id].name !== name) {
    await dbUpdate(`rooms/${code}/players/${id}`, { name })
  }
  return code
}

export async function leaveRoom(code) {
  const id = myId()
  const room = await dbGet(roomPath(code))
  if (room == null) return
  if (room.status === 'lobby') {
    await dbRemove(`rooms/${code}/players/${id}`)
    const rest = Object.keys(room.players || {}).filter((p) => p !== id)
    if (rest.length === 0) await dbRemove(roomPath(code))
    else if (room.hostId === id) await dbUpdate(roomPath(code), { hostId: rest[0] })
  }
}

// 방 삭제 (모든 참가자 화면에 '방이 사라졌어요' 표시)
export function removeRoom(code) {
  return dbRemove(roomPath(code)).catch(() => {})
}

export function subscribeRoom(code, cb) {
  return dbOn(roomPath(code), cb)
}

export function subscribeConnection(cb) {
  return dbOnConnected(cb)
}

export function setupPresence(code) {
  dbPresence(`rooms/${code}/players/${myId()}/online`)
}

// ---------- 방 상태에서 파생되는 값 ----------
// 방장이 텍스트를 바꾼 칸은 그 내용에 맞는 이모지를 자동으로 붙임
function withOverride(c, text) {
  return { ...c, text, emoji: autoEmoji(text, c.emoji) }
}
export function roomCells(room) {
  const base = cellsForLayout(DEFAULT_CELLS, room.layout || 'landscape')
  const ov = room.cells || {}
  return base.map((c, i) => (ov[i] != null && !c.locked ? withOverride(c, ov[i]) : c))
}
export function roomBridge(room) {
  const ov = room.bridgeCells || {}
  return DEFAULT_BRIDGE.map((c, i) => (ov[i] != null ? withOverride(c, ov[i]) : c))
}
export function roomOrder(room) {
  const ids = Object.keys(room.players || {}).filter((id) => room.players[id]?.name)
  return (room.order || ids).filter((id) => room.players?.[id]?.name)
}
export function currentPlayerId(room) {
  const order = roomOrder(room)
  return order.length ? order[(room.turn || 0) % order.length] : null
}

// ---------- 게임 진행 (행동 주체 클라이언트가 호출) ----------
export async function startGame(code, room) {
  const order = shuffle(Object.keys(room.players || {}).filter((id) => room.players[id]?.name))
  await dbUpdate(roomPath(code), {
    status: 'playing',
    order,
    turn: 0,
    pos: room.pos || { track: 'main', idx: 0 },
    pending: null,
    lastMove: null,
    event: { id: newId(), text: `순서: ${order.map((id) => room.players[id].name).join(' → ')}` },
  })
}

// 아직 안 나온 밸런스 주제 중 하나를 고름 (다 나오면 처음부터 다시)
export function pickTopic(room) {
  const used = room.usedTopics || []
  let pool = BALANCE_TOPICS.map((_, i) => i).filter((i) => !used.includes(i))
  if (!pool.length) pool = BALANCE_TOPICS.map((_, i) => i)
  return pool[Math.floor(Math.random() * pool.length)]
}

function pendingFor(room, playerId, pos) {
  const cell = cellAt(roomCells(room), roomBridge(room), pos)
  const kind = cell.type || 'normal'
  const p = { kind, playerId, pos }
  if (kind === 'balance') p.topic = pickTopic(room)
  return p
}

// 옵션 해제 칸에 도착하면 모든 옵션 타이머 삭제
function withReleaseUpdates(room, pending, updates, who) {
  if (pending?.kind === 'release') {
    updates.options = null
    const n = Object.keys(room.options || {}).length
    updates.event = { id: newId(), text: n ? `${who} 옵션 해제! 타이머 ${n}개 종료 ⏹` : `${who} 옵션 해제 (진행 중인 옵션 없음)` }
  }
  return updates
}
const optionKey = (pos) => (pos.track === 'main' ? `m${pos.idx}` : `b${pos.idx}`)
const optionLabel = (cell) => cell.text.replace(/\s*\(option\)\s*/i, '').trim()

// 옵션 수행 확정 → 모두에게 적용되는 타이머 시작. 이미 진행 중이면 시간 추가(+10분)
function optionStartUpdates(room, cell, pos, me, id, updates) {
  const minutes = cell.minutes || 10
  const key = optionKey(pos)
  const cur = room.options?.[key]
  const nowMs = Date.now()
  if (cur && cur.endsAt > nowMs) {
    updates[`options/${key}`] = {
      ...cur,
      endsAt: cur.endsAt + minutes * 60 * 1000,
      minutes: (cur.minutes || 0) + minutes,
    }
    const leftMin = Math.ceil((cur.endsAt + minutes * 60 * 1000 - nowMs) / 60000)
    updates.event = { id: newId(), text: `⏱ ${optionLabel(cell)} +${minutes}분 (남은 시간 ${leftMin}분)` }
  } else {
    updates[`options/${key}`] = {
      text: optionLabel(cell),
      startedAt: nowMs,
      endsAt: nowMs + minutes * 60 * 1000,
      minutes,
    }
    updates.event = { id: newId(), text: `⏱ ${optionLabel(cell)} ${minutes}분 시작 — 모두 적용!` }
  }
  return updates
}

// 방장: 끝난 옵션 타이머 정리 + 알림
export async function clearExpiredOptions(code, room) {
  if (room.hostId !== myId()) return
  const nowMs = Date.now()
  const expired = Object.entries(room.options || {}).filter(([, o]) => o.endsAt <= nowMs)
  if (!expired.length) return
  const updates = {}
  expired.forEach(([k]) => (updates[`options/${k}`] = null))
  updates.event = { id: newId(), text: `⏰ ${expired.map(([, o]) => o.text).join(', ')} 끝!` }
  await dbUpdate(roomPath(code), updates)
}

// 밸런스 주제가 정해질 때 usedTopics 갱신을 updates에 포함
function withTopicUpdates(room, pending, updates) {
  if (pending?.kind === 'balance' && pending.topic != null) {
    const used = room.usedTopics || []
    updates.usedTopics = used.length >= BALANCE_TOPICS.length - 1 ? [pending.topic] : [...used, pending.topic]
  }
  return updates
}

// 밸런스 게임: 다른 주제로 교체 (행동 주체만)
export async function rerollTopic(code, room) {
  const p = room.pending
  const id = DEMO ? p?.playerId : myId()
  if (!p || p.kind !== 'balance' || p.playerId !== id) return
  const next = { ...p, topic: pickTopic(room) }
  await dbUpdate(roomPath(code), withTopicUpdates(room, next, { pending: next }))
}

export async function rollDice(code, room) {
  const id = DEMO ? currentPlayerId(room) : myId() // 데모에서는 한 기기로 모두 조작
  if (currentPlayerId(room) !== id || room.pending || room.status !== 'playing') return
  const value = 1 + Math.floor(Math.random() * 6)
  const rules = LAYOUTS[room.layout || 'landscape']
  const path = computePath(room.pos, value, rules)
  const finalPos = path[path.length - 1]
  const updates = {
    dice: value,
    pos: finalPos,
    lastMove: { id: newId(), playerId: id, from: room.pos, path, dice: value },
    pending: pendingFor(room, id, finalPos),
  }
  const cell = cellAt(roomCells(room), roomBridge(room), finalPos)
  if ((cell.type || 'normal') === 'nop') {
    updates[`players/${id}/nop`] = (room.players[id]?.nop || 0) + 1
    updates.event = { id: newId(), text: `${room.players[id].name} 놉카드 1장 획득 🎫` }
  }
  withReleaseUpdates(room, updates.pending, updates, room.players[id].name)
  await dbUpdate(roomPath(code), withTopicUpdates(room, updates.pending, updates))
}

function nextTurnUpdates(room) {
  const order = roomOrder(room)
  return { turn: ((room.turn || 0) + 1) % Math.max(1, order.length), pending: null }
}

// 도착 칸 모달의 버튼 처리. action: 'done' | 'nop-use' | 'pick'(travel, target)
export async function resolvePending(code, room, action, target) {
  const p = room.pending
  const id = DEMO ? p?.playerId : myId()
  if (!p || p.playerId !== id) return
  const me = room.players[id]
  const cells = roomCells(room)
  const bridge = roomBridge(room)
  const rules = LAYOUTS[room.layout || 'landscape']
  const cell = cellAt(cells, bridge, p.pos)

  if (action === 'nop-use') {
    if (p.kind === 'option' || p.kind === 'release') return // 옵션은 놉카드로 거부 불가
    await dbUpdate(roomPath(code), {
      ...nextTurnUpdates(room),
      [`players/${id}/nop`]: Math.max(0, (me.nop || 0) - 1),
      event: { id: newId(), text: `${me.name} 놉카드 사용! "${cell.text}" 거부 🙅` },
    })
    return
  }

  switch (p.kind) {
    case 'move': {
      const d = cell.delta || 0
      let path
      if (d > 0) path = computePath(room.pos, d, rules)
      else path = [{ track: 'main', idx: (room.pos.idx + d + MAIN_COUNT) % MAIN_COUNT }]
      const finalPos = path[path.length - 1]
      const dest = cellAt(cells, bridge, finalPos)
      const updates = {
        pos: finalPos,
        lastMove: { id: newId(), playerId: id, from: room.pos, path },
        pending: pendingFor(room, id, finalPos),
        event: { id: newId(), text: `${me.name} ${d > 0 ? `앞으로 ${d}칸` : `뒤로 ${-d}칸`} → ${dest.text}` },
      }
      if ((dest.type || 'normal') === 'nop') {
        updates[`players/${id}/nop`] = (me.nop || 0) + 1
        updates.event = { id: newId(), text: `${me.name} ${d > 0 ? `앞으로 ${d}칸` : `뒤로 ${-d}칸`} → 놉카드 1장 획득 🎫` }
      }
      withReleaseUpdates(room, updates.pending, updates, me.name)
      await dbUpdate(roomPath(code), withTopicUpdates(room, updates.pending, updates))
      return
    }
    case 'goStart': {
      await dbUpdate(roomPath(code), {
        ...nextTurnUpdates(room),
        pos: { track: 'main', idx: 0 },
        lastMove: { id: newId(), playerId: id, from: room.pos, path: [{ track: 'main', idx: 0 }] },
        event: { id: newId(), text: `${me.name} 출발로 이동 ↩︎` },
      })
      return
    }
    case 'travel': {
      if (action === 'pick' && target) {
        const dest = cellAt(cells, bridge, target)
        const updates = {
          pos: target,
          lastMove: { id: newId(), playerId: id, from: room.pos, path: [target] },
          pending: (dest.type || 'normal') === 'travel' ? null : pendingFor(room, id, target),
          event: { id: newId(), text: `${me.name} ✈️ 세계 여행 → ${dest.text}` },
        }
        if ((dest.type || 'normal') === 'travel') Object.assign(updates, nextTurnUpdates(room))
        if ((dest.type || 'normal') === 'nop') updates[`players/${id}/nop`] = (me.nop || 0) + 1
        withReleaseUpdates(room, updates.pending, updates, me.name)
        await dbUpdate(roomPath(code), withTopicUpdates(room, updates.pending, updates))
      } else {
        // '칸 선택하기' 버튼 → 선택 모드로
        await dbUpdate(roomPath(code), { pending: { ...p, kind: 'picking' } })
      }
      return
    }
    case 'picking': {
      if (action === 'pick' && target) return resolvePending(code, { ...room, pending: { ...p, kind: 'travel' } }, 'pick', target)
      return
    }
    case 'option': {
      await dbUpdate(roomPath(code), optionStartUpdates(room, cell, p.pos, me, id, { ...nextTurnUpdates(room) }))
      return
    }
    case 'steal': {
      // action === 'steal' + target(playerId): 그 사람 놉카드 1장을 내게로
      if (action === 'steal' && target && room.players[target] && (room.players[target].nop || 0) > 0 && target !== id) {
        await dbUpdate(roomPath(code), {
          ...nextTurnUpdates(room),
          [`players/${target}/nop`]: room.players[target].nop - 1,
          [`players/${id}/nop`]: (me.nop || 0) + 1,
          event: { id: newId(), text: `${me.name}이(가) ${room.players[target].name}의 놉카드 1장을 가져갔어요 🎫` },
        })
        return
      }
      // 가져올 사람이 없을 때 '확인'
      const anyone = Object.entries(room.players || {}).some(([pid, pl]) => pid !== id && (pl.nop || 0) > 0)
      if (!anyone) await dbUpdate(roomPath(code), { ...nextTurnUpdates(room), event: { id: newId(), text: `놉카드 내놔! — 가져올 카드가 없어요 😅` } })
      return
    }
    case 'home':
    case 'rest': {
      await dbUpdate(roomPath(code), {
        ...nextTurnUpdates(room),
        event: { id: newId(), text: p.kind === 'rest' ? `${me.name} 휴식 ☕ 이번 턴은 쉬어가요` : `${me.name} 출발 칸 🚩` },
      })
      return
    }
    case 'normal':
    case 'balance': {
      await dbUpdate(roomPath(code), {
        ...nextTurnUpdates(room),
        event: { id: newId(), text: `${me.name} "${cell.text}" 수행 ✅` },
      })
      return
    }
    default:
      await dbUpdate(roomPath(code), nextTurnUpdates(room))
  }
}

// 놉카드 언제든 사용 (본인 것만)
export async function useNopAnytime(code, room) {
  const id = myId()
  const me = room.players?.[id]
  if (!me || (me.nop || 0) <= 0) return
  await dbUpdate(roomPath(code), {
    [`players/${id}/nop`]: me.nop - 1,
    event: { id: newId(), text: `${me.name} 놉카드 사용! 🙅` },
  })
}

// 방장: 칸 텍스트 편집 (locked 칸 제외)
export async function saveCellText(code, room, pos, text) {
  if (room.hostId !== myId()) return
  const key = pos.track === 'main' ? `cells/${pos.idx}` : `bridgeCells/${pos.idx}`
  const base = pos.track === 'main' ? cellsForLayout(DEFAULT_CELLS, room.layout || 'landscape')[pos.idx] : DEFAULT_BRIDGE[pos.idx]
  if (base.locked) return
  const t = text.trim()
  await dbSet(`rooms/${code}/${key}`, t && t !== base.text ? t : null)
}

export async function setLayout(code, room, layout) {
  if (room.hostId !== myId() || room.status !== 'lobby') return
  await dbUpdate(roomPath(code), { layout })
}

// 방장: 자리 비운 사람 등 때문에 막혔을 때 차례 강제 넘기기 (대기 중인 카드도 정리)
export async function hostSkipTurn(code, room) {
  if (room.hostId !== myId() || room.status !== 'playing') return
  const cur = room.players?.[currentPlayerId(room)]
  await dbUpdate(roomPath(code), {
    ...nextTurnUpdates(room),
    event: { id: newId(), text: `방장이 ${cur?.name || ''} 차례를 넘겼어요 ⏭` },
  })
}

export async function restartGame(code, room) {
  if (room.hostId !== myId()) return
  const updates = { status: 'lobby', pending: null, lastMove: null, turn: 0, pos: { track: 'main', idx: 0 }, order: null, options: null }
  Object.keys(room.players || {}).forEach((pid) => (updates[`players/${pid}/nop`] = 0))
  await dbUpdate(roomPath(code), updates)
}
