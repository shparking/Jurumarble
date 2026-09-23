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
import { dbGet, dbSet, dbUpdate, dbRemove, dbOn, dbOnConnected, dbPresence, now, DEMO, demoSeed, dbPurgeOldRooms, dbWatchServerOffset, serverNow } from './db'
import './firebase'
import { DEFAULT_CELLS, DEFAULT_BRIDGE, LAYOUTS, MAIN_COUNT, computePath, cellAt, cellsForLayout } from './game/board'
import { BALANCE_TOPICS } from './game/balance'
import { pickLiarWords } from './game/liar'
import { pickBombTopic } from './game/bomb'
import { drawMission, MISSION_CHANCE } from './game/missions'
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

// 방 상태 갱신 + event 가 있으면 게임 로그(log/{id})에도 같이 기록
export const LOG_MAX = 80
function roomUpdate(code, updates) {
  const ev = updates.event
  if (ev && ev.id && ev.text) updates[`log/${ev.id}`] = { t: Date.now(), text: String(ev.text).replace(/\n/g, ' ') }
  return dbUpdate(roomPath(code), updates)
}
// 로그 최신순 배열
export function roomLog(room) {
  return Object.entries(room?.log || {})
    .map(([id, e]) => ({ id, ...e }))
    .sort((a, b) => b.t - a.t)
}
// 방장: 로그가 너무 길면 오래된 것 삭제
export async function trimLog(code, room) {
  if (room.hostId !== myId()) return
  const all = roomLog(room)
  if (all.length <= LOG_MAX) return
  const upd = {}
  all.slice(LOG_MAX).forEach((e) => (upd[`log/${e.id}`] = null))
  await dbUpdate(roomPath(code), upd)
}
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
    if (!isNaN(st)) await roomUpdate(code, { pos: { track: 'main', idx: ((st % MAIN_COUNT) + MAIN_COUNT) % MAIN_COUNT } })
    // 데모: &opt=m12,m29 처럼 진행 중인 옵션 타이머를 미리 만들어 둠
    const opt = new URLSearchParams(window.location.search).get('opt')
    if (opt) {
      const upd = {}
      opt.split(',').forEach((k, i) => {
        const cell = k.startsWith('m') ? DEFAULT_CELLS[+k.slice(1)] : DEFAULT_BRIDGE[+k.slice(1)]
        if (cell) upd[`options/${k}`] = { text: optionLabel(cell), startedAt: Date.now(), endsAt: Date.now() + (7 - i * 3) * 60000, minutes: 10 }
      })
      await roomUpdate(code, upd)
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
  if (room.kicked?.[id]) throw new Error('방장이 이 방에서 내보낸 참가자예요.')
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
    else if (room.hostId === id) await roomUpdate(code, { hostId: rest[0] })
  }
}

// 방 삭제 (모든 참가자 화면에 '방이 사라졌어요' 표시)
export function removeRoom(code) {
  return dbRemove(roomPath(code)).catch(() => {})
}

export function subscribeRoom(code, cb) {
  return dbOn(roomPath(code), cb)
}

export function watchServerOffset() {
  return dbWatchServerOffset()
}
export { serverNow }
export function subscribeConnection(cb) {
  return dbOnConnected(cb)
}

export function setupPresence(code) {
  dbPresence(`rooms/${code}/players/${myId()}/online`)
}

// ---------- 방 상태에서 파생되는 값 ----------
// 방장이 텍스트를 바꾼 칸은 그 내용에 맞는 이모지를 자동으로 붙임
// 방장이 내용을 바꾼 칸: 원래 기능(놉카드·옵션·밸런스 등)은 사라지고 '수행 완료'만 있는 일반 칸이 됨
function withOverride(c, text) {
  return { id: c.id, text, emoji: autoEmoji(text), type: 'normal', edited: true }
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
// 대기실에서 방장이 정한 순서(room.order)가 있으면 그대로, 없으면 랜덤. 새로 들어온 사람은 뒤에 붙임
export function lobbyOrder(room) {
  const ids = Object.keys(room.players || {}).filter((id) => room.players[id]?.name)
  const set = (room.order || []).filter((id) => ids.includes(id))
  return [...set, ...ids.filter((id) => !set.includes(id))]
}

// 방장: 대기실 순서 변경 (dir = -1 위로 / +1 아래로)
export async function moveOrder(code, room, playerId, dir) {
  if (room.hostId !== myId() || room.status !== 'lobby') return
  const order = lobbyOrder(room)
  const i = order.indexOf(playerId)
  const j = i + dir
  if (i < 0 || j < 0 || j >= order.length) return
  ;[order[i], order[j]] = [order[j], order[i]]
  await roomUpdate(code, { order, orderSet: true })
}

// 방장: 순서 랜덤으로 섞기 (대기실)
export async function shuffleOrder(code, room) {
  if (room.hostId !== myId() || room.status !== 'lobby') return
  await roomUpdate(code, { order: shuffle(lobbyOrder(room)), orderSet: true })
}

// 방장: 대기실에서 참가자 강퇴 (다시 못 들어옴)
export async function kickPlayer(code, room, playerId) {
  if (room.hostId !== myId() || room.status !== 'lobby' || playerId === myId()) return
  const name = room.players?.[playerId]?.name || ''
  const order = lobbyOrder(room).filter((id) => id !== playerId)
  await roomUpdate(code, {
    [`players/${playerId}`]: null,
    [`kicked/${playerId}`]: true,
    order: room.orderSet ? order : null,
    event: { id: newId(), text: `${name} 님이 방에서 나갔어요 (방장 강퇴)` },
  })
}

export async function startGame(code, room) {
  const order = room.orderSet ? lobbyOrder(room) : shuffle(lobbyOrder(room))
  await roomUpdate(code, {
    status: 'playing',
    order,
    turn: 0,
    proxy: null,
    mission: null,
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

// 훈민정음: 두 글자 초성 (흔한 자음만)
const CHOSUNG = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']
export function pickChosung(prev) {
  let c
  do {
    c = CHOSUNG[Math.floor(Math.random() * CHOSUNG.length)] + CHOSUNG[Math.floor(Math.random() * CHOSUNG.length)]
  } while (c === prev)
  return c
}

function pendingFor(room, playerId, pos) {
  const cell = cellAt(roomCells(room), roomBridge(room), pos)
  return makePending(room, playerId, pos, cell.type || 'normal')
}
// kind 별 대기 상태 만들기 (게임 선택권에서 고른 게임에도 사용)
function makePending(room, playerId, pos, kind, title) {
  const p = { kind, playerId, pos }
  if (title) p.title = title
  if (kind === 'balance') {
    p.topic = pickTopic(room)
    p.stage = 'vote' // vote → (tie → vote) / result / roulette
    p.round = 1
  }
  if (kind === 'liar') p.stage = 'category' // category → reveal → vote → result
  if (kind === 'hunmin') p.chosung = pickChosung()
  if (kind === 'vote') p.stage = 'vote' // vote → result
  if (kind === 'shuffle') {
    // 의리주: 방에 있는 사람들 순서를 무작위로
    const ids = Object.keys(room.players || {}).filter((id) => room.players[id]?.name)
    p.order = shuffle(ids)
    p.startedAt = Date.now()
  }
  if (kind === 'choose') p.stage = 'choose'
  if (kind === 'bomb') {
    p.stage = 'ready' // ready → ticking (explodeAt) → 확인
    p.topic = pickBombTopic()
  }
  if (kind === 'reaction') p.stage = 'ready' // ready → armed(goAt) → result
  if (kind === 'gamble') {
    // ask → spin(roulette, revealedAt). 놉카드가 0장이면 선택 없이 바로 룰렛
    const nop = room.players?.[playerId]?.nop || 0
    if (nop > 0) p.stage = 'ask'
    else Object.assign(p, { stage: 'spin', roulette: Math.random() < 0.5 ? 'win' : 'lose', revealedAt: Date.now(), nopAtSpin: 0 })
  }
  if (kind === 'option') {
    const cell = cellAt(roomCells(room), roomBridge(room), pos)
    if (cell.pair) {
      // 연대책임: 도착한 사람 외 한 명을 무작위로 짝 지정
      const others = Object.keys(room.players || {}).filter((id) => id !== playerId && room.players[id]?.name)
      p.partner = others.length ? others[Math.floor(Math.random() * others.length)] : null
    }
  }
  if (kind === 'aiPick') {
    // 방에 있는 사람(이름 있는 참가자) 중 아무나 한 명
    const ids = Object.keys(room.players || {}).filter((id) => room.players[id]?.name)
    p.target = ids[Math.floor(Math.random() * ids.length)] || playerId
    p.startedAt = Date.now()
  }
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
function optionStartUpdates(room, cell, pos, me, id, updates, partner) {
  const minutes = cell.minutes || 10
  const key = optionKey(pos)
  const cur = room.options?.[key]
  const nowMs = Date.now()
  // 연대책임: 짝(도착한 사람 ❤️ 무작위 1명). 재방문이면 새 짝으로 교체
  const pair = cell.pair && partner ? [id, partner] : null
  const pairText = pair ? `${room.players[pair[0]]?.name} ❤️ ${room.players[pair[1]]?.name}` : ''
  if (cur && cur.endsAt > nowMs) {
    updates[`options/${key}`] = {
      ...cur,
      endsAt: cur.endsAt + minutes * 60 * 1000,
      minutes: (cur.minutes || 0) + minutes,
      ...(pair ? { pair, who: pairText } : {}),
    }
    const leftMin = Math.ceil((cur.endsAt + minutes * 60 * 1000 - nowMs) / 60000)
    updates.event = { id: newId(), text: `⏱ ${optionLabel(cell)} +${minutes}분 (남은 시간 ${leftMin}분)${pair ? ` — ${pairText}` : ''}` }
  } else {
    updates[`options/${key}`] = {
      text: optionLabel(cell),
      startedAt: nowMs,
      endsAt: nowMs + minutes * 60 * 1000,
      minutes,
      ...(pair ? { pair, who: pairText } : {}),
    }
    updates.event = { id: newId(), text: pair ? `⏱ ${optionLabel(cell)} ${minutes}분 — ${pairText} 함께 벌칙!` : `⏱ ${optionLabel(cell)} ${minutes}분 시작 — 모두 적용!` }
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
  await roomUpdate(code, updates)
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
  const next = { ...p, topic: pickTopic(room), stage: 'vote', votes: null, round: (p.round || 1) + 1, revealedAt: null, roulette: null, refused: null }
  await roomUpdate(code, withTopicUpdates(room, next, { pending: next }))
}

export async function rollDice(code, room) {
  const id = DEMO ? currentPlayerId(room) : myId() // 데모에서는 한 기기로 모두 조작
  if (currentPlayerId(room) !== id || room.pending || room.status !== 'playing') return
  // 데모: ?demo=1&dice=3 처럼 주사위 값을 고정 (테스트용)
  const forced = DEMO ? parseInt(new URLSearchParams(window.location.search).get('dice'), 10) : NaN
  const value = forced >= 1 && forced <= 6 ? forced : 1 + Math.floor(Math.random() * 6)
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
  // 로그: 주사위 결과 (토스트 없이 기록만)
  const cellNo = finalPos.track === 'main' ? `${finalPos.idx}번` : `${32 + finalPos.idx}번`
  updates[`log/${newId()}`] = { t: Date.now(), text: `${room.players[id].name} 🎲 ${value} → ${cellNo} ${String(cell.text).replace(/\n/g, ' ')}` }
  if ((cell.type || 'normal') === 'nop') {
    updates[`players/${id}/nop`] = (room.players[id]?.nop || 0) + 1
    updates.event = { id: newId(), text: `${room.players[id].name} 놉카드 1장 획득 🎫` }
  }
  withReleaseUpdates(room, updates.pending, updates, room.players[id].name)
  maybeMission(room, updates)
  await roomUpdate(code, withTopicUpdates(room, updates.pending, updates))
}

// 돌발 미션: 진행 중인 미션이 없을 때 10% 확률로 한 명에게 몰래 전달 (데모: ?mission=초 로 강제)
function maybeMission(room, updates) {
  if (room.mission) return
  const ids = Object.keys(room.players || {}).filter((pid) => room.players[pid]?.name)
  if (ids.length < 2) return
  const forced = DEMO ? parseInt(new URLSearchParams(window.location.search).get('mission'), 10) : NaN
  if (!(forced > 0) && Math.random() >= MISSION_CHANCE) return
  const who = ids[Math.floor(Math.random() * ids.length)]
  const others = ids.filter((pid) => pid !== who)
  const targetName = room.players[others[Math.floor(Math.random() * others.length)]]?.name || ''
  const m = drawMission(targetName)
  const dur = forced > 0 ? forced * 1000 : m.minutes * 60 * 1000
  const nowMs = serverNow()
  updates.mission = { id: newId(), playerId: who, text: m.text, detail: m.detail, minutes: m.minutes, choices: m.choices, answer: m.answer, startedAt: nowMs, endsAt: nowMs + dur, stage: 'active' }
  updates[`log/${newId()}`] = { t: Date.now(), text: `🎯 누군가에게 돌발 미션이 주어졌습니다! (${m.minutes}분)` }
}

// 방장: 미션 시간이 끝나면 퀴즈 단계로
export async function missionTick(code, room) {
  const m = room.mission
  if (!m || m.stage !== 'active' || room.hostId !== myId()) return
  if (serverNow() < m.endsAt) return
  await roomUpdate(code, { 'mission/stage': 'quiz', event: { id: newId(), text: `⏰ ${room.players[m.playerId]?.name}의 미션 수행 시간이 끝났습니다!` } })
}
// 수행자 외 참가자: 5지선다 투표
export async function missionVote(code, room, idx) {
  const m = room.mission
  if (!m || m.stage !== 'quiz') return
  const ids = Object.keys(room.players || {}).filter((pid) => room.players[pid]?.name && pid !== m.playerId)
  const id = DEMO ? ids.find((pid) => m.votes?.[pid] == null) : myId()
  if (!id || !ids.includes(id)) return
  await roomUpdate(code, { [`mission/votes/${id}`]: idx })
}
// 결과 공개 (수행자 또는 방장)
export async function missionReveal(code, room) {
  const m = room.mission
  if (!m || m.stage !== 'quiz') return
  if (!DEMO && myId() !== m.playerId && myId() !== room.hostId) return
  await roomUpdate(code, { 'mission/stage': 'result', 'mission/revealedAt': Date.now() })
}
// 결과 계산: 투표자 과반이 맞히면 수행자 마시기, 아니면 틀린 사람들 마시기
export function missionResult(room, m) {
  const votes = m.votes || {}
  const voters = Object.keys(votes)
  const correct = voters.filter((pid) => votes[pid] === m.answer)
  const wrong = voters.filter((pid) => votes[pid] !== m.answer)
  const caught = voters.length > 0 && correct.length * 2 >= voters.length
  return { voters, correct, wrong, caught }
}
export async function missionDone(code, room) {
  const m = room.mission
  if (!m || m.stage !== 'result') return
  if (!DEMO && myId() !== m.playerId && myId() !== room.hostId) return
  const r = missionResult(room, m)
  const who = room.players[m.playerId]?.name
  const text = r.caught
    ? `🎯 돌발 미션 "${m.text}" — 들켰다! ${who} 마셔 🍶`
    : `🎯 돌발 미션 "${m.text}" — 못 맞힘! ${r.wrong.map((pid) => room.players[pid]?.name).filter(Boolean).join(', ') || '아무도'} 마셔 🍶`
  await roomUpdate(code, { mission: null, event: { id: newId(), text } })
}


function nextTurnUpdates(room) {
  const order = roomOrder(room)
  const upd = { turn: ((room.turn || 0) + 1) % Math.max(1, order.length), pending: null }
  // 대리기사: 대신 받기로 한 차례가 끝나면 해제
  if (room.proxy && room.proxy.turn === (room.turn || 0)) upd.proxy = null
  return upd
}

// 도착 칸 모달의 버튼 처리. action: 'done' | 'nop-use' | 'pick'(travel, target)
export async function resolvePending(code, room, action, target) {
  const p = room.pending
  if (!p) return

  // 밸런스 게임 소수 의견: 각자 놉카드로 본인만 거부 (턴은 행동자가 확인할 때 넘어감)
  if (action === 'target-nop' && p.kind === 'balance' && p.stage === 'result') {
    const r = balanceResult(p)
    const tid = DEMO ? r.losers.find((x) => !p.refused?.[x]) : myId()
    if (!tid || !r.losers.includes(tid) || p.refused?.[tid]) return
    const t = room.players[tid]
    if (!t || (t.nop || 0) <= 0) return
    await roomUpdate(code, {
      [`pending/refused/${tid}`]: true,
      [`players/${tid}/nop`]: t.nop - 1,
      event: { id: newId(), text: `${t.name} 놉카드 사용! 밸런스 벌주 거부 🙅` },
    })
    return
  }

  // AI 지목 / 다수결 지목: 지목된 사람이 놉카드로 거부할 수 있음 (행동 주체가 아니어도)
  if (action === 'target-nop' && (p.kind === 'aiPick' || (p.kind === 'vote' && p.stage === 'result'))) {
    const targets = p.kind === 'aiPick' ? [p.target] : voteWinners(p)
    const tid = DEMO ? targets[0] : myId()
    if (!targets.includes(tid)) return
    const t = room.players[tid]
    if (!t || (t.nop || 0) <= 0) return
    await roomUpdate(code, {
      ...nextTurnUpdates(room),
      [`players/${tid}/nop`]: t.nop - 1,
      event: { id: newId(), text: `${t.name} 놉카드 사용! ${p.kind === 'aiPick' ? 'AI 지목' : '다수결 지목'} 거부 🙅` },
    })
    return
  }

  const id = DEMO ? p.playerId : myId()
  if (p.playerId !== id) return
  const me = room.players[id]
  const cells = roomCells(room)
  const bridge = roomBridge(room)
  const rules = LAYOUTS[room.layout || 'landscape']
  const cell = cellAt(cells, bridge, p.pos)

  if (action === 'nop-use') {
    if (p.kind === 'option' || p.kind === 'release') return // 옵션은 놉카드로 거부 불가
    if (p.kind === 'liar' && p.stage !== 'category') return // 라이어 게임은 시작 전에만 거부 가능
    if (p.kind === 'balance' && p.stage !== 'vote') return
    if (p.kind === 'vote' || p.kind === 'choose' || p.kind === 'shuffle' || p.kind === 'gamble') return
    if ((p.kind === 'bomb' || p.kind === 'reaction') && p.stage !== 'ready') return
    await roomUpdate(code, {
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
      await roomUpdate(code, withTopicUpdates(room, updates.pending, updates))
      return
    }
    case 'goStart': {
      await roomUpdate(code, {
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
        await roomUpdate(code, withTopicUpdates(room, updates.pending, updates))
      } else {
        // '칸 선택하기' 버튼 → 선택 모드로
        await roomUpdate(code, { pending: { ...p, kind: 'picking' } })
      }
      return
    }
    case 'picking': {
      if (action === 'pick' && target) return resolvePending(code, { ...room, pending: { ...p, kind: 'travel' } }, 'pick', target)
      return
    }
    case 'option': {
      await roomUpdate(code, optionStartUpdates(room, cell, p.pos, me, id, { ...nextTurnUpdates(room) }, p.partner))
      return
    }
    case 'steal': {
      // action === 'steal' + target(playerId): 그 사람 놉카드 1장을 내게로
      if (action === 'steal' && target && room.players[target] && (room.players[target].nop || 0) > 0 && target !== id) {
        await roomUpdate(code, {
          ...nextTurnUpdates(room),
          [`players/${target}/nop`]: room.players[target].nop - 1,
          [`players/${id}/nop`]: (me.nop || 0) + 1,
          event: { id: newId(), text: `${me.name}이(가) ${room.players[target].name}의 놉카드 1장을 가져갔어요 🎫` },
        })
        return
      }
      // 가져올 사람이 없을 때 '확인'
      const anyone = Object.entries(room.players || {}).some(([pid, pl]) => pid !== id && (pl.nop || 0) > 0)
      if (!anyone) await roomUpdate(code, { ...nextTurnUpdates(room), event: { id: newId(), text: `놉카드 내놔! — 가져올 카드가 없어요 😅` } })
      return
    }
    case 'home':
    case 'rest': {
      await roomUpdate(code, {
        ...nextTurnUpdates(room),
        event: { id: newId(), text: p.kind === 'rest' ? `${me.name} 휴식 ☕ 이번 턴은 쉬어가요` : `${me.name} 출발 칸 🚩` },
      })
      return
    }
    case 'choose': {
      // 게임 선택권: 'choose' + target(balance|liar|hunmin) → 그 게임으로 전환
      const titles = { balance: '밸런스 게임', liar: '라이어 게임', hunmin: '훈민정음 게임', bomb: '폭탄 돌리기', reaction: '반응속도 게임' }
      if (action === 'choose' && titles[target]) {
        const np = makePending(room, id, p.pos, target, titles[target])
        await roomUpdate(code, withTopicUpdates(room, np, { pending: np, event: { id: newId(), text: `${me.name} 🎁 ${titles[target]} 선택!` } }))
      }
      return
    }
    case 'vote': {
      // 다수결 지목: 행동자가 결과 공개 → 카운트다운 후 최다 득표자 공개
      if (action === 'result' && Object.keys(p.votes || {}).length > 0) {
        await roomUpdate(code, { 'pending/stage': 'result', 'pending/revealedAt': Date.now() })
        return
      }
      if (action === 'done' && p.stage === 'result') {
        const winners = voteWinners(p)
        await roomUpdate(code, {
          ...nextTurnUpdates(room),
          event: { id: newId(), text: `🗳️ 다수결 지목 → ${winners.map((w) => room.players[w]?.name).join(', ')} 마셔! 🍶` },
        })
      }
      return
    }
    case 'shuffle': {
      await roomUpdate(code, {
        ...nextTurnUpdates(room),
        event: { id: newId(), text: `🥂 의리주 순서: ${(p.order || []).map((pid) => room.players[pid]?.name).filter(Boolean).join(' → ')}` },
      })
      return
    }
    case 'bomb': {
      if (action === 'start' && p.stage === 'ready') {
        // 15~40초 사이 랜덤 폭발 (서버 시각 기준)
        const dur = 15000 + Math.floor(Math.random() * 25000)
        await roomUpdate(code, { 'pending/stage': 'ticking', 'pending/startedAt': serverNow(), 'pending/explodeAt': serverNow() + dur })
        return
      }
      if (action === 'done' && p.stage === 'ticking') {
        await roomUpdate(code, { ...nextTurnUpdates(room), event: { id: newId(), text: `💣 폭탄 돌리기(${p.topic}) 터짐! 말하던 사람 마셔 🍶` } })
      }
      return
    }
    case 'reaction': {
      if (action === 'start' && p.stage === 'ready') {
        const wait = 2500 + Math.floor(Math.random() * 3500) // 2.5~6초 뒤 초록불
        await roomUpdate(code, { 'pending/stage': 'armed', 'pending/goAt': serverNow() + wait, 'pending/results': null })
        return
      }
      if (action === 'result' && p.stage === 'armed') {
        await roomUpdate(code, { 'pending/stage': 'result', 'pending/revealedAt': Date.now() })
        return
      }
      if (action === 'done' && p.stage === 'result') {
        const r = reactionRanking(room, p)
        const loser = r[r.length - 1]
        await roomUpdate(code, {
          ...nextTurnUpdates(room),
          event: { id: newId(), text: loser ? `⚡ 반응속도 꼴찌 ${room.players[loser.pid]?.name} (${loser.label}) 마셔! 🍶` : '⚡ 반응속도 게임 종료' },
        })
      }
      return
    }
    case 'gamble': {
      // ask: 도박 하기(spin) / 패스(skip). 카드가 있으면 +2 vs 전부 소멸, 없으면 안 마셔 vs 마셔
      if (action === 'spin' && p.stage === 'ask') {
        await roomUpdate(code, { 'pending/stage': 'spin', 'pending/roulette': Math.random() < 0.5 ? 'win' : 'lose', 'pending/revealedAt': Date.now(), 'pending/nopAtSpin': me.nop || 0 })
        return
      }
      if (action === 'skip' && p.stage === 'ask') {
        await roomUpdate(code, { ...nextTurnUpdates(room), event: { id: newId(), text: `🎰 ${me.name} 도박 패스 😌` } })
        return
      }
      if (action === 'done' && p.stage === 'spin') {
        const nop = me.nop || 0
        const upd = { ...nextTurnUpdates(room) }
        if (nop > 0) {
          if (p.roulette === 'win') {
            upd[`players/${id}/nop`] = nop + 2
            upd.event = { id: newId(), text: `🎰 ${me.name} 도박 성공! 놉카드 +2 🎫` }
          } else {
            upd[`players/${id}/nop`] = 0
            upd.event = { id: newId(), text: `🎰 ${me.name} 도박 실패… 놉카드 ${nop}장 소멸 💀` }
          }
        } else {
          upd.event = { id: newId(), text: p.roulette === 'win' ? `🎰 ${me.name} 도박 성공! 안 마셔도 돼요 😇` : `🎰 ${me.name} 도박 실패… 마셔! 🍶` }
        }
        await roomUpdate(code, upd)
      }
      return
    }
    case 'hunmin': {
      await roomUpdate(code, { ...nextTurnUpdates(room), event: { id: newId(), text: `${me.name} 훈민정음 (${p.chosung}) 수행 ✅` } })
      return
    }
    case 'liar': {
      // 'category' + target(카테고리 key): 단어 배정 → 확인 단계
      if (action === 'category' && target) {
        const ids = Object.keys(room.players || {}).filter((pid) => room.players[pid]?.name)
        const liar = ids[Math.floor(Math.random() * ids.length)]
        const [majority, minority] = pickLiarWords(target)
        const words = {}
        ids.forEach((pid) => (words[pid] = pid === liar ? minority : majority))
        await roomUpdate(code, {
          pending: { ...p, stage: 'reveal', category: target, liar, words, majority, minority, revealed: null, votes: null },
          event: { id: newId(), text: `🤥 라이어 게임 시작! 각자 키워드를 확인하세요` },
        })
        return
      }
      if (action === 'vote-start') {
        await roomUpdate(code, { 'pending/stage': 'vote', event: { id: newId(), text: `🗳️ 투표 시간! 라이어 같은 사람을 고르세요` } })
        return
      }
      if (action === 'result') {
        await roomUpdate(code, { 'pending/stage': 'result' })
        return
      }
      if (action === 'done' && p.stage === 'result') {
        await roomUpdate(code, {
          ...nextTurnUpdates(room),
          event: { id: newId(), text: `🤥 라이어 게임 결과: 다른 키워드는 ${room.players[p.liar]?.name}` },
        })
        return
      }
      return
    }
    case 'aiPick': {
      const t = room.players[p.target]
      await roomUpdate(code, {
        ...nextTurnUpdates(room),
        event: { id: newId(), text: `🤖 AI 지목 → ${t?.name || '?'} 마셔! 🍶` },
      })
      return
    }
    case 'balance': {
      const [ta, tb] = (BALANCE_TOPICS[p.topic] || ' vs ').split(' vs ')
      if (action === 'reroll') return rerollTopic(code, room)
      if (action === 'result' && p.stage === 'vote') {
        const r = balanceResult(p)
        if (r.total === 0) return
        if (r.tie) {
          await roomUpdate(code, { 'pending/stage': 'tie', 'pending/revealedAt': Date.now() })
        } else if (r.unanimous) {
          await roomUpdate(code, { 'pending/stage': 'roulette', 'pending/revealedAt': Date.now(), 'pending/roulette': Math.random() < 0.5 ? 'drink' : 'safe' })
        } else {
          await roomUpdate(code, { 'pending/stage': 'result', 'pending/revealedAt': Date.now() })
        }
        return
      }
      if (action === 'done' && (p.stage === 'result' || p.stage === 'roulette')) {
        const r = balanceResult(p)
        const text =
          p.stage === 'roulette'
            ? `⚖️ ${ta} ${r.a} : ${r.b} ${tb} 만장일치 → 룰렛 ${p.roulette === 'drink' ? '다같이 마셔! 🍻' : '아무도 안 마셔 😇'}`
            : `⚖️ ${ta} ${r.a} : ${r.b} ${tb} → 소수 ${r.losers.map((x) => room.players[x]?.name).filter(Boolean).join(', ')} 마셔! 🍶`
        await roomUpdate(code, { ...nextTurnUpdates(room), event: { id: newId(), text } })
      }
      return
    }
    case 'proxy': {
      // 대리기사: 다음 차례 사람의 벌칙을 내가 대신 수행
      const order = roomOrder(room)
      const nextTurn = ((room.turn || 0) + 1) % Math.max(1, order.length)
      const nextId = order[nextTurn]
      await roomUpdate(code, {
        ...nextTurnUpdates(room),
        proxy: { byId: id, byName: me.name, forId: nextId, forName: room.players[nextId]?.name || '', turn: nextTurn },
        event: { id: newId(), text: `🚗 대리기사 ${me.name} — ${room.players[nextId]?.name || '다음 사람'}의 벌칙을 대신 받아요!` },
      })
      return
    }
    case 'normal': {
      await roomUpdate(code, {
        ...nextTurnUpdates(room),
        event: { id: newId(), text: `${me.name} "${cell.text}" 수행 ✅` },
      })
      return
    }
    default:
      await roomUpdate(code, nextTurnUpdates(room))
  }
}

// 놉카드 언제든 사용 (본인 것만)
// 놉카드 수동 사용: 순서 목록에서 내 배지를 눌러 내 카드를 1장 사용 → 전원 알림 (본인만)
export async function useNopAnytime(code, room, targetId) {
  const id = DEMO ? targetId || myId() : myId()
  const t = room.players?.[id]
  if (!t || (t.nop || 0) <= 0) return
  await roomUpdate(code, {
    [`players/${id}/nop`]: t.nop - 1,
    event: { id: newId(), text: `🎫 ${t.name}님이 놉카드를 사용했습니다!` },
  })
}

// 방장: 칸 텍스트 편집 (locked 칸 제외)
export async function saveCellText(code, room, pos, text) {
  if (room.hostId !== myId() || room.status !== 'lobby') return
  const key = pos.track === 'main' ? `cells/${pos.idx}` : `bridgeCells/${pos.idx}`
  const base = pos.track === 'main' ? cellsForLayout(DEFAULT_CELLS, room.layout || 'landscape')[pos.idx] : DEFAULT_BRIDGE[pos.idx]
  if (base.locked) return
  const t = text.trim()
  await dbSet(`rooms/${code}/${key}`, t && t !== base.text ? t : null)
}

export async function setLayout(code, room, layout) {
  if (room.hostId !== myId() || room.status !== 'lobby') return
  await roomUpdate(code, { layout })
}

// 방장: 자리 비운 사람 등 때문에 막혔을 때 차례 강제 넘기기 (대기 중인 카드도 정리)
export async function hostSkipTurn(code, room) {
  if (room.hostId !== myId() || room.status !== 'playing') return
  const cur = room.players?.[currentPlayerId(room)]
  await roomUpdate(code, {
    ...nextTurnUpdates(room),
    event: { id: newId(), text: `방장이 ${cur?.name || ''} 차례를 넘겼어요 ⏭` },
  })
}

export async function restartGame(code, room) {
  if (room.hostId !== myId()) return
  const updates = { status: 'lobby', pending: null, lastMove: null, turn: 0, pos: { track: 'main', idx: 0 }, order: null, orderSet: null, options: null, log: null, mission: null, proxy: null }
  Object.keys(room.players || {}).forEach((pid) => (updates[`players/${pid}/nop`] = 0))
  await roomUpdate(code, updates)
}

// ---------- 라이어 게임: 모든 참가자가 쓰는 동작 ----------
// 내 키워드를 확인했다고 표시
export async function liarReveal(code, room) {
  const p = room.pending
  const id = DEMO ? null : myId()
  if (!p || p.kind !== 'liar' || p.stage !== 'reveal') return
  if (DEMO) {
    // 데모: 모든 참가자를 확인 처리
    const upd = {}
    Object.keys(p.words || {}).forEach((pid) => (upd[`pending/revealed/${pid}`] = true))
    return roomUpdate(code, upd)
  }
  if (!p.words?.[id]) return
  await roomUpdate(code, { [`pending/revealed/${id}`]: true })
}
// 투표 (본인 표만)
export async function liarVote(code, room, target) {
  const p = room.pending
  if (!p || p.kind !== 'liar' || p.stage !== 'vote' || !target) return
  const id = DEMO ? Object.keys(p.words || {}).find((pid) => !p.votes?.[pid]) : myId()
  if (!id || !p.words?.[id]) return
  await roomUpdate(code, { [`pending/votes/${id}`]: target })
}
// 결과 계산: 최다 득표(단독)가 라이어면 시민 승리
export function liarResult(room, p) {
  const tally = {}
  Object.values(p.votes || {}).forEach((t) => (tally[t] = (tally[t] || 0) + 1))
  const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1])
  const top = sorted[0]
  const unique = top && (!sorted[1] || sorted[1][1] < top[1])
  const caught = !!(unique && top[0] === p.liar)
  return { tally, top: top?.[0] || null, tie: !!(top && !unique), caught }
}

// ---------- 다수결 지목 ----------
export async function castVote(code, room, target) {
  const p = room.pending
  if (!p || p.kind !== 'vote' || p.stage !== 'vote' || !target) return
  const ids = Object.keys(room.players || {}).filter((pid) => room.players[pid]?.name)
  const id = DEMO ? ids.find((pid) => !p.votes?.[pid]) : myId()
  if (!id || !ids.includes(id)) return
  await roomUpdate(code, { [`pending/votes/${id}`]: target })
}
// 최다 득표자(들)
export function voteWinners(p) {
  const tally = {}
  Object.values(p.votes || {}).forEach((t) => (tally[t] = (tally[t] || 0) + 1))
  const max = Math.max(0, ...Object.values(tally))
  return Object.keys(tally).filter((k) => tally[k] === max)
}
export function voteTally(p) {
  const tally = {}
  Object.values(p.votes || {}).forEach((t) => (tally[t] = (tally[t] || 0) + 1))
  return tally
}

// ---------- 밸런스 게임 투표 ----------
export async function balanceVote(code, room, choice) {
  const p = room.pending
  if (!p || p.kind !== 'balance' || p.stage !== 'vote' || !['A', 'B'].includes(choice)) return
  const ids = Object.keys(room.players || {}).filter((pid) => room.players[pid]?.name)
  const id = DEMO ? ids.find((pid) => !p.votes?.[pid]) || ids[0] : myId()
  if (!id || !ids.includes(id)) return
  await roomUpdate(code, { [`pending/votes/${id}`]: choice })
}
// 결과: a/b 표 수, 동점, 만장일치, 소수 의견(마시는 사람들)
export function balanceResult(p) {
  const votes = p.votes || {}
  const A = Object.keys(votes).filter((k) => votes[k] === 'A')
  const B = Object.keys(votes).filter((k) => votes[k] === 'B')
  const total = A.length + B.length
  const tie = total > 0 && A.length === B.length
  const unanimous = total > 0 && (A.length === 0 || B.length === 0)
  const losers = tie || unanimous ? [] : A.length < B.length ? A : B
  const loserSide = losers.length ? (A.length < B.length ? 'A' : 'B') : null
  return { a: A.length, b: B.length, A, B, total, tie, unanimous, losers, loserSide }
}

// ---------- 반응속도 게임 ----------
// 내 탭 기록: goAt 이전이면 부정출발('early'), 아니면 반응 시간(ms)
export async function reactionTap(code, room) {
  const p = room.pending
  if (!p || p.kind !== 'reaction' || p.stage !== 'armed' || !p.goAt) return
  const ids = Object.keys(room.players || {}).filter((pid) => room.players[pid]?.name)
  const id = DEMO ? ids.find((pid) => p.results?.[pid] == null) : myId()
  if (!id || !ids.includes(id) || p.results?.[id] != null) return
  const t = serverNow()
  const val = t < p.goAt ? -1 : t - p.goAt
  await roomUpdate(code, { [`pending/results/${id}`]: DEMO ? (val < 0 ? -1 : val + Math.floor(Math.random() * 300)) : val })
}
// 순위: 반응 빠른 순. 부정출발(-1)과 미참여는 맨 뒤
export function reactionRanking(room, p) {
  const ids = Object.keys(room.players || {}).filter((pid) => room.players[pid]?.name)
  const rows = ids.map((pid) => {
    const v = p.results?.[pid]
    if (v == null) return { pid, v: Infinity, label: '미참여' }
    if (v < 0) return { pid, v: 1e9, label: '부정출발' }
    return { pid, v, label: `${(v / 1000).toFixed(3)}초` }
  })
  return rows.sort((a, b) => a.v - b.v)
}
