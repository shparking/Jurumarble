// 데이터 저장소 추상화: 기본은 Firebase, `?demo` 로 열면 브라우저 메모리(한 기기 미리보기용)
import { ref, set, get, update, onValue, onDisconnect, remove, serverTimestamp, query, orderByChild, endAt, limitToFirst } from 'firebase/database'

export const DEMO = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('demo')

// ---------- 메모리 백엔드 ----------
const mem = { data: {}, subs: new Set() }
const parts = (p) => p.split('/').filter(Boolean)
function memGet(path) {
  let cur = mem.data
  for (const k of parts(path)) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = cur[k]
  }
  // React가 변경을 감지하도록 항상 새 객체로 복사
  return cur === undefined ? null : JSON.parse(JSON.stringify(cur))
}
function memSet(path, val) {
  const ps = parts(path)
  if (!ps.length) {
    mem.data = val ?? {}
    return notify()
  }
  let cur = mem.data
  for (const k of ps.slice(0, -1)) {
    if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {}
    cur = cur[k]
  }
  const last = ps[ps.length - 1]
  if (val === null || val === undefined) delete cur[last]
  else cur[last] = JSON.parse(JSON.stringify(val))
  notify()
}
function notify() {
  mem.subs.forEach((cb) => cb())
}

// ---------- 공개 API ----------
let fbDb = null
export function initDb(db) {
  fbDb = db
}

export const now = () => (DEMO ? Date.now() : serverTimestamp())

export async function dbGet(path) {
  if (DEMO) return memGet(path)
  const snap = await get(ref(fbDb, path))
  return snap.exists() ? snap.val() : null
}
export async function dbSet(path, val) {
  if (DEMO) return memSet(path, val)
  return set(ref(fbDb, path), val)
}
export async function dbUpdate(path, updates) {
  if (DEMO) {
    Object.entries(updates).forEach(([k, v]) => memSet(`${path}/${k}`, v))
    return
  }
  return update(ref(fbDb, path), updates)
}
export async function dbRemove(path) {
  if (DEMO) return memSet(path, null)
  return remove(ref(fbDb, path))
}
export function dbOn(path, cb) {
  if (DEMO) {
    const fn = () => cb(memGet(path))
    mem.subs.add(fn)
    fn()
    return () => mem.subs.delete(fn)
  }
  return onValue(ref(fbDb, path), (snap) => cb(snap.exists() ? snap.val() : null))
}
export function dbOnConnected(cb) {
  if (DEMO) {
    cb(true)
    return () => {}
  }
  return onValue(ref(fbDb, '.info/connected'), (snap) => cb(!!snap.val()))
}
// 서버 시간 보정: 폰마다 시계가 조금씩 달라서, 동시에 시작해야 하는 게임(반응속도 등)은 서버 시각 기준으로 맞춤
let serverOffset = 0
export function dbWatchServerOffset() {
  if (DEMO || !fbDb) return () => {}
  return onValue(ref(fbDb, '.info/serverTimeOffset'), (snap) => {
    serverOffset = Number(snap.val()) || 0
  })
}
export const serverNow = () => Date.now() + serverOffset

export function dbPresence(path) {
  if (DEMO) return memSet(path, true)
  const r = ref(fbDb, path)
  set(r, true)
  onDisconnect(r).set(false)
}

// 데모용: 가짜 참가자 추가
export function demoSeed(code, names, colors) {
  if (!DEMO) return
  names.forEach((n, i) => memSet(`rooms/${code}/players/demo${i}`, { name: n, color: colors[(i + 1) % colors.length], nop: i === 1 ? 2 : 0, joinedAt: Date.now() }))
}

// 방 정리 (방 만들 때 / 앱 열 때 호출)
//  - 대기실(lobby)에서 1시간 넘게 시작 안 한 방 삭제
//  - 상태와 무관하게 24시간 지난 방 삭제
// ※ 규칙에 ".indexOn": ["createdAt"] 가 있어야 동작 (없으면 조용히 실패)
export const LOBBY_TTL_MS = 60 * 60 * 1000
export const ROOM_TTL_MS = 24 * 60 * 60 * 1000
export async function dbPurgeOldRooms(limit = 30) {
  if (DEMO) return 0
  const nowMs = Date.now()
  const q = query(ref(fbDb, 'rooms'), orderByChild('createdAt'), endAt(nowMs - LOBBY_TTL_MS), limitToFirst(limit))
  const snap = await get(q)
  if (!snap.exists()) return 0
  const updates = {}
  snap.forEach((child) => {
    const r = child.val() || {}
    const created = typeof r.createdAt === 'number' ? r.createdAt : 0
    const stale = created <= nowMs - ROOM_TTL_MS
    const neverStarted = r.status !== 'playing'
    if (stale || neverStarted) updates[child.key] = null
  })
  if (!Object.keys(updates).length) return 0
  await update(ref(fbDb, 'rooms'), updates)
  return Object.keys(updates).length
}
