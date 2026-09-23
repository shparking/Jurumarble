import { useEffect, useRef, useState } from 'react'
import Board from './components/Board'
import Dice from './components/Dice'
import { cellAt, posKey, LAYOUTS } from './game/board'
import { DEMO, LOBBY_TTL_MS } from './db'
import {
  myId,
  createRoom,
  joinRoom,
  leaveRoom,
  subscribeRoom,
  subscribeConnection,
  setupPresence,
  roomCells,
  roomBridge,
  roomOrder,
  currentPlayerId,
  startGame,
  rollDice,
  resolvePending,
  useNopAnytime,
  saveCellText,
  restartGame,
  rerollTopic,
  clearExpiredOptions,
  hostSkipTurn,
  purgeRooms,
  removeRoom,
  lobbyOrder,
  moveOrder,
  shuffleOrder,
  liarReveal,
  liarVote,
  liarResult,
  roomLog,
  trimLog,
} from './room'
import { BALANCE_TOPICS } from './game/balance'
import { DEFAULT_CHARACTER } from './game/characters'
import { autoEmoji } from './game/emoji'
import { LIAR_CATEGORIES, liarCategory } from './game/liar'
import { DEFAULT_CELLS, DEFAULT_BRIDGE } from './game/board'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const KIND_LABEL = {
  nop: '놉카드 획득',
  move: '이동',
  goStart: '출발로',
  travel: '세계 여행',
  picking: '세계 여행',
  rest: '휴식',
  home: '출발',
  balance: '밸런스 게임',
  option: '옵션 (10분)',
  release: '옵션 해제',
  steal: '놉카드 뺏기',
  aiPick: 'AI 지목',
  liar: '라이어 게임',
}

function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('theme')
      if (saved === 'light' || saved === 'dark') return saved
    } catch {}
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('theme', theme)
    } catch {}
  }, [theme])
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))]
}

function Icon({ name }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
  switch (name) {
    case 'sun':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      )
    case 'moon':
      return (
        <svg {...common}>
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )
    case 'log':
      return (
        <svg {...common}>
          <path d="M8 6h13M8 12h13M8 18h13" />
          <path d="M3 6h.01M3 12h.01M3 18h.01" />
        </svg>
      )
    case 'exit':
      return (
        <svg {...common}>
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
      )
    default:
      return null
  }
}

// AI 지목: 3, 2, 1 카운트다운 → 축하 화면 (모든 폰에 동시에 표시)
function AiPickOverlay({ room, pending, me, iAct, onDone, onTargetNop }) {
  const [step, setStep] = useState(3) // 3,2,1 → 0 = 공개
  useEffect(() => {
    setStep(3)
    const t1 = setTimeout(() => setStep(2), 1000)
    const t2 = setTimeout(() => setStep(1), 2000)
    const t3 = setTimeout(() => setStep(0), 3000)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
    }
  }, [pending.target, pending.startedAt])
  useEffect(() => {
    if (step === 0) {
      try {
        navigator.vibrate?.([80, 40, 80, 40, 200])
      } catch {}
    }
  }, [step])
  const target = room.players[pending.target]
  const isTarget = DEMO || pending.target === me
  const pieces = Array.from({ length: 28 })
  return (
    <div className="ai-overlay">
      {step > 0 ? (
        <div className="ai-count" key={step}>
          <div className="ai-robot">🤖</div>
          <div className="ai-num">{step}</div>
          <div className="ai-sub">AI가 한 명을 고르고 있어요…</div>
        </div>
      ) : (
        <div className="ai-reveal">
          <div className="confetti" aria-hidden>
            {pieces.map((_, i) => (
              <i key={i} style={{ '--i': i, left: `${(i * 37) % 100}%`, animationDelay: `${(i % 7) * 0.12}s`, background: ['#ea002c', '#f47725', '#ffd166', '#06d6a0', '#4cc9f0', '#b388ff'][i % 6] }} />
            ))}
          </div>
          <div className="ai-congrats">🎉 Congratulations! 🎉</div>
          <div className="ai-avatar" style={{ background: target?.color }}>
            {target?.name?.slice(0, 1)}
          </div>
          <div className="ai-name">
            <b>{target?.name}</b> 마셔! 🍶
          </div>
          <div className="ai-actions">
            {isTarget && (target?.nop || 0) > 0 && (
              <button className="btn btn-ghost" onClick={onTargetNop}>
                <NopIcon /> 놉카드로 거부
              </button>
            )}
            {iAct ? (
              <button className="btn btn-primary" onClick={onDone}>
                확인
              </button>
            ) : (
              <div className="waiting">{room.players[pending.playerId]?.name}이(가) 확인하면 다음 차례로 넘어가요</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// 라이어 게임(워드 울프): 키워드 확인 → 설명 → 투표 → 결과. 모든 폰에 표시
function LiarPanel({ room, pending: p, me, iAct, code }) {
  const [show, setShow] = useState(false)
  useEffect(() => setShow(false), [p.stage])
  const ids = Object.keys(p.words || {}).filter((pid) => room.players[pid]?.name)
  const myWord = DEMO ? p.majority : p.words?.[me]
  const revealedCount = ids.filter((pid) => p.revealed?.[pid]).length
  const votes = p.votes || {}
  const votedCount = ids.filter((pid) => votes[pid]).length
  const myVote = DEMO ? null : votes[me]
  const cat = liarCategory(p.category)
  // 설명 순서: 행동 주체부터 차례대로
  const order = roomOrder(room)
  const startIdx = Math.max(0, order.indexOf(p.playerId))
  const speak = [...order.slice(startIdx), ...order.slice(0, startIdx)].filter((pid) => ids.includes(pid))
  const res = p.stage === 'result' ? liarResult(room, p) : null
  return (
    <div className="modal-backdrop">
      <div className="modal liar">
        <div className="kicker">🤥 라이어 게임 · {cat.emoji} {cat.name}</div>
        {p.stage === 'reveal' && (
          <>
            <h2>각자 키워드를 확인하세요!</h2>
            <div className="muted">한 명만 비슷하지만 다른 키워드를 받았어요. 누가 라이어인지는 본인도 몰라요. 키워드를 직접 말하지 말고 관련 설명만 하세요.</div>
            {myWord ? (
              <button
                className={`word-card ${show ? 'on' : ''}`}
                onClick={() => {
                  setShow((v) => !v)
                  if (!show) liarReveal(code, room)
                }}
              >
                {show ? (
                  <>
                    <span className="word-label">내 키워드</span>
                    <span className="word">{myWord}</span>
                    <span className="word-hint">다시 탭하면 숨겨요</span>
                  </>
                ) : (
                  <>
                    <span className="word-label">탭해서 확인</span>
                    <span className="word">🔒</span>
                    <span className="word-hint">다른 사람이 보지 않게 조심!</span>
                  </>
                )}
              </button>
            ) : (
              <div className="muted" style={{ marginTop: 12 }}>
                이 게임에 참여하지 않은 참가자예요 (게임 시작 후 입장).
              </div>
            )}
            <div className="section-title">설명 순서 · 확인 {revealedCount}/{ids.length}</div>
            <div className="speak-list">
              {speak.map((pid, i) => (
                <span key={pid} className={`speak ${p.revealed?.[pid] ? 'ok' : ''}`}>
                  <b>{i + 1}</b> {room.players[pid].name}
                  {p.revealed?.[pid] ? ' ✓' : ''}
                </span>
              ))}
            </div>
            <div className="actions">
              {iAct ? (
                <button className="btn btn-primary" onClick={() => resolvePending(code, room, 'vote-start')}>
                  설명 끝 → 투표 시작 {revealedCount < ids.length ? `(확인 ${revealedCount}/${ids.length})` : ''}
                </button>
              ) : (
                <div className="waiting">설명이 끝나면 {room.players[p.playerId]?.name}이(가) 투표를 시작해요</div>
              )}
            </div>
          </>
        )}
        {p.stage === 'vote' && (
          <>
            <h2>라이어는 누구?</h2>
            <div className="muted">다른 키워드를 받은 것 같은 사람을 한 명 고르세요. ({votedCount}/{ids.length} 투표)</div>
            <div className="steal-list">
              {ids.map((pid) => {
                const pl = room.players[pid]
                const n = Object.values(votes).filter((t) => t === pid).length
                return (
                  <button key={pid} className={`steal-btn ${myVote === pid ? 'picked' : ''}`} disabled={!DEMO && !p.words?.[me]} onClick={() => liarVote(code, room, pid)}>
                    <span className="avatar sm" style={{ background: pl.color }}>
                      {pl.name.slice(0, 1)}
                    </span>
                    <span className="pname">{pl.name}</span>
                    {n > 0 && <span className="tag">{n}표</span>}
                    {myVote === pid && <span className="me-tag">내 표</span>}
                  </button>
                )
              })}
            </div>
            <div className="actions">
              {iAct ? (
                <button className="btn btn-primary" onClick={() => resolvePending(code, room, 'result')} disabled={votedCount === 0}>
                  결과 공개 {votedCount < ids.length ? `(${votedCount}/${ids.length})` : ''}
                </button>
              ) : (
                <div className="waiting">모두 투표하면 {room.players[p.playerId]?.name}이(가) 결과를 공개해요</div>
              )}
            </div>
          </>
        )}
        {p.stage === 'result' && res && (
          <>
            <h2>결과 공개</h2>
            <div className="liar-reveal">
              <div className="liar-row">
                <span className="avatar" style={{ background: room.players[p.liar]?.color }}>
                  {room.players[p.liar]?.name?.slice(0, 1)}
                </span>
                <div>
                  <div className="muted">다른 키워드를 받은 사람</div>
                  <b>{room.players[p.liar]?.name}</b>
                </div>
              </div>
              <div className="liar-words">
                <span>
                  다수 키워드 <b>{p.majority}</b>
                </span>
                <span>
                  다른 키워드 <b>{p.minority}</b>
                </span>
              </div>
              <div className="tally">
                {ids
                  .map((pid) => ({ pid, n: res.tally[pid] || 0 }))
                  .sort((a, b) => b.n - a.n)
                  .map(({ pid, n }) => (
                    <div key={pid} className={`tally-row ${pid === p.liar ? 'liar' : ''}`}>
                      <span className="avatar sm" style={{ background: room.players[pid]?.color }}>
                        {room.players[pid]?.name?.slice(0, 1)}
                      </span>
                      <span className="pname">{room.players[pid]?.name}</span>
                      <span className="tally-bar">
                        <i style={{ width: `${ids.length ? (n / ids.length) * 100 : 0}%` }} />
                      </span>
                      <b>{n}표</b>
                    </div>
                  ))}
              </div>
            </div>
            <div className="actions">
              {iAct ? (
                <button className="btn btn-primary" onClick={() => resolvePending(code, room, 'done')}>
                  확인
                </button>
              ) : (
                <div className="waiting">{room.players[p.playerId]?.name}이(가) 확인하면 다음 차례로</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function BalanceTopic({ topic }) {
  const [a, b] = topic.split(' vs ')
  return (
    <div className="bal-topic">
      <div className="opt">{a}</div>
      <div className="vs">VS</div>
      <div className="opt">{b}</div>
    </div>
  )
}

// 진행 중인 옵션 타이머 (모든 폰에 표시, 1초마다 갱신)
function OptionTimers({ options }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const list = Object.entries(options || {}).sort((a, b) => a[1].endsAt - b[1].endsAt)
  if (!list.length) return null
  const nowMs = Date.now()
  return (
    <div className="timers">
      {list.map(([k, o]) => {
        const left = Math.max(0, o.endsAt - nowMs)
        const mm = String(Math.floor(left / 60000)).padStart(2, '0')
        const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, '0')
        const pct = o.minutes ? Math.max(0, Math.min(100, (left / (o.minutes * 60000)) * 100)) : 0
        return (
          <div className={`timer ${left < 60000 ? 'soon' : ''}`} key={k}>
            <div className="timer-bar" style={{ width: `${pct}%` }} />
            <span className="timer-text">{o.text}</span>
            <span className="timer-who">모두</span>
            <span className="timer-time">{left === 0 ? '끝!' : `${mm}:${ss}`}</span>
          </div>
        )
      })}
    </div>
  )
}

// 진단 패널: 주소 뒤에 ?debug=1 을 붙이면 표시. 오류와 방 상태를 모아 복사할 수 있음
const DEBUG = new URLSearchParams(window.location.search).has('debug')
const errLog = []
if (DEBUG) {
  window.addEventListener('error', (e) => errLog.push(`[error] ${e.message} @${e.filename?.split('/').pop()}:${e.lineno}`))
  window.addEventListener('unhandledrejection', (e) => errLog.push(`[promise] ${e.reason?.message || e.reason}`))
}
function DebugPanel({ room, code, me, connected }) {
  const [open, setOpen] = useState(true)
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const info = {
    time: new Date().toISOString(),
    ua: navigator.userAgent,
    screen: `${window.innerWidth}x${window.innerHeight}`,
    connected,
    code,
    me,
    online: navigator.onLine,
    room: room && {
      status: room.status,
      hostId: room.hostId,
      turn: room.turn,
      order: room.order,
      players: Object.fromEntries(Object.entries(room.players || {}).map(([k, v]) => [k, `${v.name} nop=${v.nop || 0} online=${v.online}`])),
      pos: room.pos,
      pending: room.pending,
      lastMove: room.lastMove && { id: room.lastMove.id, dice: room.lastMove.dice, len: room.lastMove.path?.length },
      options: room.options,
      event: room.event?.text,
    },
    errors: errLog.slice(-20),
  }
  const text = JSON.stringify(info, null, 1)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      alert('진단 정보를 복사했어요. 채팅에 붙여넣어 주세요.')
    } catch {
      prompt('아래 내용을 길게 눌러 복사하세요', text)
    }
  }
  return (
    <div className={`debug ${open ? '' : 'min'}`}>
      <div className="debug-bar">
        <b>DEBUG</b>
        <span className={connected ? 'ok' : 'bad'}>{connected ? '연결됨' : '연결 안 됨'}</span>
        <span>{room?.status || '-'}</span>
        <span>err {errLog.length}</span>
        <span className="spacer" />
        <button onClick={copy}>복사</button>
        <button onClick={() => setOpen((o) => !o)}>{open ? '접기' : '펼치기'}</button>
      </div>
      {open && <pre>{text}</pre>}
    </div>
  )
}

function NopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

export default function App() {
  const [theme, toggleTheme] = useTheme()
  const me = myId()

  // ---- 접속 정보 ----
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem('name') || ''
    } catch {
      return ''
    }
  })
  const [codeInput, setCodeInput] = useState('')
  const [code, setCode] = useState(() => {
    const q = new URLSearchParams(window.location.search).get('room')
    if (q) return q.toUpperCase()
    try {
      return sessionStorage.getItem('room') || ''
    } catch {
      return ''
    }
  })
  const [room, setRoom] = useState(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')
  const [busyBtn, setBusyBtn] = useState(false)

  // ---- 화면 상태 ----
  const [animPos, setAnimPos] = useState(null) // 애니메이션 중 표시 위치
  const [animating, setAnimating] = useState(false)
  const [activeKey, setActiveKey] = useState(null)
  const [toast, setToast] = useState(null)
  const [peek, setPeek] = useState(null)
  const [showLog, setShowLog] = useState(false)
  const [editing, setEditing] = useState(null) // { pos, cell, text }
  const [rolling, setRolling] = useState(false)
  const [diceShow, setDiceShow] = useState(1)
  const lastMoveId = useRef(null)
  const lastEventId = useRef(null)

  useEffect(() => subscribeConnection(setConnected), [])

  // 앱을 열 때 한 번: 대기실에서 1시간 넘게 시작 안 한 방 / 하루 지난 방 정리
  useEffect(() => {
    if (connected) purgeRooms()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected])

  // 방 구독
  useEffect(() => {
    if (!code) {
      setRoom(null)
      return
    }
    try {
      sessionStorage.setItem('room', code)
    } catch {}
    let first = true
    const off = subscribeRoom(code, (r) => {
      if (first) {
        // 처음 받은 스냅샷의 이동/이벤트는 재생하지 않음
        first = false
        lastMoveId.current = r?.lastMove?.id ?? 'none'
        lastEventId.current = r?.event?.id ?? 'none'
      }
      setRoom(r)
      if (r === null) {
        setCode('')
        setError('방이 사라졌어요.')
      }
    })
    return () => off()
  }, [code])

  // 참가가 확정된 뒤에만 접속 상태 기록
  const joined = !!room?.players?.[me]?.name
  useEffect(() => {
    if (code && joined) setupPresence(code)
  }, [code, joined])

  // 링크로 들어왔는데 아직 참가 전이면 자동 참가 시도 (이름이 있을 때)
  useEffect(() => {
    if (room && !room.players?.[me]?.name) {
      if (name.trim() && room.status === 'lobby') {
        joinRoom(code, name.trim()).catch((e) => {
          setCode('')
          setError(e.message)
        })
      } else {
        setCodeInput(code)
        setCode('')
        setError(room.status === 'lobby' ? '이름을 입력하고 입장을 눌러주세요.' : '이미 시작된 게임이에요.')
      }
    }
  }, [room, me, name, code])

  // 이동 애니메이션: lastMove가 바뀌면 모두가 같은 경로로 말을 움직임
  useEffect(() => {
    const mv = room?.lastMove
    if (!mv || mv.id === lastMoveId.current) return
    lastMoveId.current = mv.id
    let cancelled = false
    ;(async () => {
      setAnimating(true)
      if (mv.from) setAnimPos(mv.from)
      if (mv.dice) {
        setRolling(true)
        for (let i = 0; i < 8; i++) {
          setDiceShow(1 + Math.floor(Math.random() * 6))
          await sleep(70)
        }
        setDiceShow(mv.dice)
        setRolling(false)
        await sleep(300)
      }
      for (const p of mv.path || []) {
        if (cancelled) return
        setAnimPos(p)
        setActiveKey(posKey(p))
        await sleep(230)
      }
      await sleep(120)
      setAnimPos(null)
      setActiveKey(null)
      setAnimating(false)
    })()
    return () => {
      cancelled = true
    }
  }, [room?.lastMove?.id])

  // 이벤트 토스트
  useEffect(() => {
    const ev = room?.event
    if (!ev || ev.id === lastEventId.current) return
    lastEventId.current = ev.id
    setToast(String(ev.text).replace(/\n/g, " "))
    const t = setTimeout(() => setToast(null), 2200)
    return () => clearTimeout(t)
  }, [room?.event?.id])

  useEffect(() => {
    if (room?.dice && !animating) setDiceShow(room.dice)
  }, [room?.dice, animating])

  // 내 차례가 되면 진동(지원 기기) + 알림
  const prevTurnRef = useRef(null)
  useEffect(() => {
    if (!room || room.status !== 'playing') return
    const cur = currentPlayerId(room)
    const key = `${room.turn}-${cur}`
    if (prevTurnRef.current === key) return
    const wasSet = prevTurnRef.current !== null
    prevTurnRef.current = key
    if (wasSet && cur === me && !DEMO) {
      try {
        navigator.vibrate?.([120, 60, 120])
      } catch {}
      setToast('내 차례! 주사위를 굴려주세요 🎲')
      setTimeout(() => setToast(null), 2000)
    }
  }, [room?.turn, room?.status, room?.order])

  // 대기실에서 1시간 넘게 시작하지 않은 내 방은 방장 기기가 스스로 닫음
  useEffect(() => {
    if (!room || room.hostId !== me || room.status !== 'lobby' || typeof room.createdAt !== 'number') return
    const check = () => {
      if (Date.now() - room.createdAt >= LOBBY_TTL_MS) removeRoom(code)
    }
    check()
    const t = setInterval(check, 30000)
    return () => clearInterval(t)
  }, [room, me, code])

  // 방장 기기: 로그가 길어지면 오래된 항목 정리
  useEffect(() => {
    if (room && room.hostId === me) trimLog(code, room)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Object.keys(room?.log || {}).length])

  // 방장 기기가 끝난 옵션 타이머를 정리 (1초마다 확인)
  useEffect(() => {
    if (!room || room.hostId !== me || !room.options) return
    const t = setInterval(() => clearExpiredOptions(code, room), 1000)
    return () => clearInterval(t)
  }, [room, me, code])


  // ---- 홈 동작 ----
  const saveName = (n) => {
    setName(n)
    try {
      localStorage.setItem('name', n)
    } catch {}
  }
  const enter = async (fn) => {
    if (!name.trim()) return setError('이름을 먼저 입력해주세요.')
    setBusyBtn(true)
    setError('')
    try {
      const c = await fn()
      setCode(c)
    } catch (e) {
      setError(e.message || '실패했어요. 다시 시도해주세요.')
    }
    setBusyBtn(false)
  }
  const onCreate = () => enter(() => createRoom(name.trim()))
  const onJoin = () => {
    if (codeInput.trim().length < 4) return setError('방 코드 4자리를 입력해주세요.')
    return enter(() => joinRoom(codeInput, name.trim()))
  }
  const onLeave = async () => {
    if (room) await leaveRoom(code)
    setCode('')
    try {
      sessionStorage.removeItem('room')
    } catch {}
  }
  const shareLink = async () => {
    const url = `${location.origin}${location.pathname}?room=${code}`
    try {
      if (navigator.share) await navigator.share({ title: '주루마블', text: `방 코드 ${code}`, url })
      else {
        await navigator.clipboard.writeText(url)
        setToast('초대 링크를 복사했어요')
        setTimeout(() => setToast(null), 1800)
      }
    } catch {}
  }

  // ---- 파생 값 ----
  const isHost = room?.hostId === me
  const cells = room ? roomCells(room) : []
  const bridge = room ? roomBridge(room) : []
  const order = room ? roomOrder(room) : []
  const curId = room ? currentPlayerId(room) : null
  const cur = curId && room?.players?.[curId]
  const myTurn = DEMO || curId === me
  const pending = room?.pending
  // 아직 재생하지 않은 이동이 있으면 출발 위치를 먼저 보여줌 (말이 먼저 점프하는 것 방지)
  const unplayed = room?.lastMove && room.lastMove.id !== lastMoveId.current
  const displayPos = animPos || (unplayed && room.lastMove.from) || room?.pos || { track: 'main', idx: 0 }
  const showPending = pending && !animating && !unplayed
  const autoKind = pending && ['move', 'goStart', 'home', 'rest'].includes(pending.kind)
  const picking = showPending && pending.kind === 'picking'
  const iAct = DEMO || pending?.playerId === me
  const layout = 'landscape'
  const atEntrance = room && displayPos.track === 'main' && displayPos.idx === LAYOUTS[layout].entrance
  const playerCount = Object.keys(room?.players || {}).length

  // 이동 칸(앞으로/뒤로 n칸, 출발로)은 카드 없이 자동 실행 — 행동 주체 기기가 처리
  const autoRef = useRef(null)
  useEffect(() => {
    const p = room?.pending
    if (!p || !showPending || !autoKind || !iAct) return
    const key = `${room.lastMove?.id}-${p.kind}`
    if (autoRef.current === key) return
    autoRef.current = key
    const t = setTimeout(() => resolvePending(code, room, 'done'), 500)
    return () => clearTimeout(t)
  }, [room?.pending, showPending, autoKind, iAct])

  const onCellTap = (p) => {
    if (!room) return
    const cell = cellAt(cells, bridge, p)
    if (picking && iAct) {
      if (posKey(p) === posKey(room.pos)) return
      return resolvePending(code, room, 'pick', p)
    }
    if (isHost && !cell.locked && room.status === 'lobby') {
      setEditing({ pos: p, cell, text: cell.text })
      return
    }
    setPeek({ pos: p, cell })
  }

  const pendingCell = showPending ? cellAt(cells, bridge, pending.pos) : null

  // ---------- 렌더 ----------
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className={`brand-dot ${connected ? '' : 'off'}`} title={connected ? '연결됨' : '연결 중…'} /> 주루마블
          {room && <span className="code-chip">{code}</span>}
        </div>
        <div className="row">
          {room && (
            <button className="icon-btn" onClick={() => setShowLog(true)} aria-label="게임 로그" title="게임 로그">
              <Icon name="log" />
            </button>
          )}
          {room && (
            <button className="icon-btn" onClick={onLeave} aria-label="나가기" title="나가기">
              <Icon name="exit" />
            </button>
          )}
          <button className="icon-btn" onClick={toggleTheme} aria-label="테마 전환">
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
        </div>
      </header>

      {/* ---------- 홈 ---------- */}
      {!room && (
        <>
          <div className="hero">
            <h1>
              <span className="hero-emo" aria-hidden>🍺</span>주루마블<span className="hero-emo" aria-hidden>🎲</span>
            </h1>
            <p>이름을 정하고 방을 만들거나, 친구가 준 코드로 들어가세요.</p>
          </div>

          <div className="card card-pad stack">
            <div>
              <div className="label">내 이름</div>
              <input className="field" placeholder="예) 상혁" value={name} maxLength={10} onChange={(e) => saveName(e.target.value)} />
            </div>
            <button className="btn btn-primary btn-block" onClick={onCreate} disabled={busyBtn || !name.trim()}>
              새 방 만들기
            </button>
            <div className="divider">
              <span>또는</span>
            </div>
            <div className="row">
              <input
                className="field code-field"
                placeholder="방 코드"
                value={codeInput}
                maxLength={4}
                autoCapitalize="characters"
                onChange={(e) => setCodeInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && onJoin()}
              />
              <button className="btn btn-ghost" onClick={onJoin} disabled={busyBtn || codeInput.length < 4 || !name.trim()}>
                입장
              </button>
            </div>
            {error && <div className="error">{error}</div>}
            {!connected && <div className="muted">서버에 연결 중이에요… 계속 이 상태면 Realtime Database 주소를 확인해주세요.</div>}
          </div>
        </>
      )}

      {/* ---------- 대기실 ---------- */}
      {room && room.status === 'lobby' && (
        <>
          <div className="card card-pad stack">
            <div className="row">
              <div>
                <div className="label">방 코드</div>
                <div className="big-code">{code}</div>
              </div>
              <div className="spacer" />
              <button className="btn btn-ghost btn-sm" onClick={shareLink}>
                초대 링크
              </button>
            </div>
            <div className="muted">친구들이 이 코드로 들어오면 아래에 나타나요. 순서는 방장이 정할 수 있고, 안 정하면 랜덤이에요.</div>
          </div>

          <div className="card card-pad stack">
            <div className="row">
              <div className="label" style={{ marginBottom: 0 }}>
                참가자 {playerCount}명 · {room.orderSet ? '순서: 방장 지정' : '순서: 랜덤'}
              </div>
              <div className="spacer" />
              {isHost && playerCount >= 2 && (
                <button className="btn btn-ghost btn-sm" onClick={() => shuffleOrder(code, room)}>
                  🔀 섞기
                </button>
              )}
            </div>
            <div className="player-list">
              {lobbyOrder(room).map((pid, i, arr) => {
                const p = room.players[pid]
                return (
                  <div className="player-row" key={pid}>
                    <span className="order">{i + 1}</span>
                    <span className="avatar" style={{ background: p.color }}>
                      {p.name.slice(0, 1)}
                    </span>
                    <span className="player-name">{p.name}</span>
                    {pid === me && <span className="me-tag">나</span>}
                    {pid === room.hostId && <span className="tag">방장</span>}
                    {isHost && (
                      <span className="order-btns">
                        <button aria-label="위로" disabled={i === 0} onClick={() => moveOrder(code, room, pid, -1)}>
                          ▲
                        </button>
                        <button aria-label="아래로" disabled={i === arr.length - 1} onClick={() => moveOrder(code, room, pid, 1)}>
                          ▼
                        </button>
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
            {isHost && <div className="muted">▲▼ 로 순서를 바꿀 수 있어요. 1번부터 시작합니다.</div>}
          </div>

          {isHost ? (
            <div className="card card-pad stack">
              <div className="muted">아래 보드에서 칸을 탭하면 내용을 고칠 수 있어요. 게임이 시작되면 고칠 수 없어요. (출발·세계여행·이동 칸은 고정)</div>
              <button className="btn btn-primary btn-block" onClick={() => startGame(code, room)} disabled={playerCount < 2}>
                {playerCount < 2 ? '2명 이상 모이면 시작할 수 있어요' : '게임 시작'}
              </button>
            </div>
          ) : (
            <div className="card card-pad muted">방장이 시작하면 자동으로 게임 화면으로 넘어가요.</div>
          )}

          <Board
            cells={cells}
            bridge={bridge}
            tokenPos={{ track: 'main', idx: 0 }}
            character={room.token || DEFAULT_CHARACTER}
            activeKey={null}
            picking={false}
            onCellTap={onCellTap}
            layout={layout}
          />
        </>
      )}

      {/* ---------- 게임 ---------- */}
      {room && room.status === 'playing' && cur && (
        <>
          <div className={`card turn-panel ${myTurn ? 'mine' : ''}`}>
            <Dice value={diceShow} rolling={rolling} onClick={myTurn && !pending && !animating ? () => rollDice(code, room) : undefined} />
            <div className="turn-info">
              <div className="who">
                <span className="avatar sm" style={{ background: cur.color }}>
                  {cur.name.slice(0, 1)}
                </span>
                {myTurn ? '내 차례!' : `${cur.name}의 차례`}
              </div>
              <div className="sub">
                {animating
                  ? '이동 중…'
                  : picking
                    ? iAct
                      ? '보드에서 갈 칸을 탭하세요'
                      : `${cur.name}이(가) 갈 칸을 고르고 있어요`
                    : pending
                      ? iAct
                        ? '도착! 아래에서 선택하세요'
                        : `${cur.name}이(가) 결정 중…`
                      : myTurn
                        ? atEntrance
                          ? '이번 이동은 다리로 갑니다 🌉'
                          : '주사위를 굴려주세요'
                        : '기다려주세요'}
              </div>
            </div>
            <button className="btn btn-primary" onClick={() => rollDice(code, room)} disabled={!myTurn || !!pending || animating}>
              굴리기
            </button>
          </div>

          <OptionTimers options={room.options} />

          <Board
            cells={cells}
            bridge={bridge}
            tokenPos={displayPos}
            character={room.token || DEFAULT_CHARACTER}
            activeKey={activeKey}
            picking={picking && iAct}
            onCellTap={onCellTap}
            layout={layout}
          />

          <div>
            <div className="section-title">순서 · 놉카드</div>
            <div className="players-strip">
              {order.map((pid, i) => {
                const p = room.players[pid]
                if (!p?.name) return null
                const mine = pid === me
                return (
                  <div className={`pcard ${pid === curId ? 'turn' : ''} ${mine ? 'me' : ''} ${p.online === false ? 'offline' : ''}`} key={pid} title={p.online === false ? '연결 끊김' : ''}>
                    <span className="order">{i + 1}</span>
                    <span className="avatar sm" style={{ background: p.color }}>
                      {p.name.slice(0, 1)}
                    </span>
                    <span className="pname">{p.name}</span>
                    <button
                      className={`nop-badge ${(p.nop || 0) === 0 ? 'empty' : ''}`}
                      onClick={() => mine && useNopAnytime(code, room)}
                      disabled={!mine || (p.nop || 0) === 0}
                      title={mine ? '놉카드 사용' : '놉카드 보유 수'}
                    >
                      <NopIcon /> {p.nop || 0}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          {isHost && (
            <div className="row">
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => confirm(`${cur.name} 차례를 넘길까요? (대기 중인 카드도 정리됩니다)`) && hostSkipTurn(code, room)}>
                ⏭ 차례 넘기기
              </button>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => confirm('게임을 끝내고 대기실로 돌아갈까요?') && restartGame(code, room)}>
                대기실로
              </button>
            </div>
          )}
        </>
      )}

      {/* ---------- AI 지목: 카운트다운 + 축하 화면 ---------- */}
      {room && showPending && pending.kind === 'aiPick' && (
        <AiPickOverlay
          room={room}
          pending={pending}
          me={me}
          iAct={iAct}
          onDone={() => resolvePending(code, room, 'done')}
          onTargetNop={() => resolvePending(code, room, 'target-nop')}
        />
      )}

      {/* ---------- 라이어 게임 ---------- */}
      {room && showPending && pending.kind === 'liar' && pending.stage !== 'category' && (
        <LiarPanel room={room} pending={pending} me={me} iAct={iAct} code={code} />
      )}

      {/* ---------- 도착 칸 모달 ---------- */}
      {room && showPending && !picking && !autoKind && pending.kind !== 'aiPick' && !(pending.kind === 'liar' && pending.stage !== 'category') && pendingCell && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="kicker">{KIND_LABEL[pending.kind] || (pending.pos.track === 'bridge' ? '다리 칸' : `${pending.pos.idx}번 칸`)}</div>
            <h2>{pendingCell.text}</h2>
            {pending.kind === 'balance' && pending.topic != null && (
              <BalanceTopic topic={BALANCE_TOPICS[pending.topic]} />
            )}
            <div className="muted">
              <b style={{ color: room.players[pending.playerId]?.color }}>{room.players[pending.playerId]?.name}</b>
              {pending.kind === 'nop' && ' — 놉카드 1장이 지급되었어요.'}
              {(pending.kind === 'normal' || pending.kind === 'balance') && (iAct ? ' — 수행하거나 놉카드로 거부할 수 있어요.' : ' — 수행 중이에요.')}
              {pending.kind === 'option' &&
                (room.options?.[`${pending.pos.track === 'main' ? 'm' : 'b'}${pending.pos.idx}`]?.endsAt > Date.now()
                  ? ` — 이미 진행 중인 옵션이에요. 모두에게 ${pendingCell.minutes || 10}분이 추가됩니다. (놉카드 사용 불가)`
                  : ` — 모두에게 적용되는 옵션이에요. ${pendingCell.minutes || 10}분 타이머가 전원 화면에 표시됩니다. (놉카드 사용 불가)`)}
              {pending.kind === 'release' && ' — 진행 중이던 옵션 타이머가 모두 종료됐어요.'}
              {pending.kind === 'steal' &&
                (Object.entries(room.players).some(([pid, pl]) => pid !== pending.playerId && (pl.nop || 0) > 0)
                  ? iAct
                    ? ' — 놉카드를 가진 사람을 골라 1장 가져오세요.'
                    : ' — 누구의 놉카드를 가져갈지 고르고 있어요.'
                  : ' — 놉카드를 가진 사람이 없어요.')}
              {pending.kind === 'move' && ` — ${pendingCell.delta > 0 ? `${pendingCell.delta}칸 앞으로` : `${-pendingCell.delta}칸 뒤로`} 이동합니다.`}
              {pending.kind === 'goStart' && ' — 출발 칸으로 돌아갑니다.'}
              {pending.kind === 'travel' && ' — 말을 원하는 칸으로 옮기고, 그 칸의 내용을 실행해요.'}
              {pending.kind === 'rest' && ' — 이번 턴은 쉬어가요.'}
              {pending.kind === 'liar' && (iAct ? ' — 키워드 카테고리를 고르면 모두에게 키워드가 배정돼요. 한 명만 비슷하지만 다른 키워드를 받아요.' : ' — 카테고리를 고르고 있어요.')}
              {pending.kind === 'home' && ' — 출발 칸이에요. 아무 일도 없어요.'}
            </div>
            {pending.kind === 'liar' && (
              <div className="cat-grid">
                {LIAR_CATEGORIES.map((c) => (
                  <button key={c.key} className="cat-btn" disabled={!iAct} onClick={() => resolvePending(code, room, 'category', c.key)}>
                    <span className="cat-emo">{c.emoji}</span>
                    <span>{c.name}</span>
                  </button>
                ))}
              </div>
            )}
            {pending.kind === 'steal' && (
              <div className="steal-list">
                {Object.entries(room.players)
                  .filter(([pid, pl]) => pid !== pending.playerId && pl.name)
                  .map(([pid, pl]) => (
                    <button
                      key={pid}
                      className={`steal-btn ${(pl.nop || 0) > 0 ? '' : 'none'}`}
                      disabled={!iAct || (pl.nop || 0) === 0}
                      onClick={() => resolvePending(code, room, 'steal', pid)}
                    >
                      <span className="avatar sm" style={{ background: pl.color }}>
                        {pl.name.slice(0, 1)}
                      </span>
                      <span className="pname">{pl.name}</span>
                      <span className={`nop-badge ${(pl.nop || 0) === 0 ? 'empty' : ''}`}>
                        <NopIcon /> {pl.nop || 0}
                      </span>
                    </button>
                  ))}
              </div>
            )}
            {iAct ? (
              <div className="actions">
                {pending.kind === 'balance' && (
                  <button className="btn btn-ghost" onClick={() => rerollTopic(code, room)} title="다른 주제">
                    🔄 다른 주제
                  </button>
                )}
                {(pending.kind === 'normal' || pending.kind === 'balance' || pending.kind === 'liar') && (room.players[pending.playerId]?.nop || 0) > 0 && (
                  <button className="btn btn-ghost" onClick={() => resolvePending(code, room, 'nop-use')}>
                    <NopIcon /> 놉카드 사용
                  </button>
                )}
                {pending.kind !== 'liar' && !(pending.kind === 'steal' && Object.entries(room.players).some(([pid, pl]) => pid !== pending.playerId && (pl.nop || 0) > 0)) && (
                <button className="btn btn-primary" onClick={() => resolvePending(code, room, 'done')}>
                  {pending.kind === 'normal' || pending.kind === 'balance' ? '수행 완료' : pending.kind === 'option' ? (room.options?.[`${pending.pos.track === 'main' ? 'm' : 'b'}${pending.pos.idx}`]?.endsAt > Date.now() ? `⏱ +${pendingCell.minutes || 10}분 추가` : `⏱ ${pendingCell.minutes || 10}분 시작`) : pending.kind === 'travel' ? '칸 선택하기' : '확인'}
                </button>
                )}
              </div>
            ) : (
              <div className="actions">
                <div className="waiting">{room.players[pending.playerId]?.name}의 선택을 기다리는 중…</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------- 게임 로그 ---------- */}
      {showLog && room && (
        <div className="modal-backdrop" onClick={() => setShowLog(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="kicker">게임 로그</div>
            <h2>지금까지 일어난 일</h2>
            <div className="log">
              {roomLog(room).length === 0 && <div className="muted">아직 기록이 없어요.</div>}
              {roomLog(room).map((e) => (
                <div className="line" key={e.id}>
                  <span className="log-time">{new Date(e.t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</span>
                  <span>{e.text}</span>
                </div>
              ))}
            </div>
            <div className="actions">
              <button className="btn btn-ghost" onClick={() => setShowLog(false)}>
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- 칸 보기 ---------- */}
      {peek && !showPending && (
        <div className="modal-backdrop" onClick={() => setPeek(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="kicker">{peek.pos.track === 'bridge' ? '다리 칸' : `${peek.pos.idx}번 칸`}</div>
            <h2>{peek.cell.text}</h2>
            {peek.cell.locked && <div className="muted">고정 칸 (편집 불가)</div>}
            <div className="actions">
              <button className="btn btn-ghost" onClick={() => setPeek(null)}>
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- 방장 칸 편집 ---------- */}
      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="kicker">{editing.pos.track === 'bridge' ? '다리 칸 편집' : `${editing.pos.idx}번 칸 편집`}</div>
            <div className="edit-preview">
              <span className="edit-emo">{autoEmoji(editing.text, editing.cell.emoji)}</span>
              <span className="muted">내용에 맞는 이모지가 자동으로 붙어요 (단어에 따라 바뀜)</span>
            </div>
            <textarea
              className="field field-area"
              value={editing.text}
              maxLength={30}
              rows={2}
              autoFocus
              placeholder="칸에 보일 글자 (줄바꿈은 Enter)"
              onChange={(e) => setEditing({ ...editing, text: e.target.value.replace(/\n{2,}/g, '\n') })}
            />
            <div className="muted" style={{ marginTop: 6 }}>
              Enter 로 줄을 나눌 수 있어요 (칸에서 그대로 두 줄로 보여요).
            </div>
            {editing.cell.type && editing.cell.type !== 'normal' && (
              <div className="muted" style={{ marginTop: 8 }}>
                ⚠️ 내용을 바꾸면 이 칸의 기능({KIND_LABEL[editing.cell.type] || editing.cell.type})은 사라지고, 도착하면 글자와 <b>수행 완료</b> 버튼만 나오는 일반 칸이 돼요.
              </div>
            )}
            {editing.cell.edited && (
              <div className="muted" style={{ marginTop: 8 }}>
                이 칸은 수정된 칸이에요. 원래 내용과 기능으로 되돌리려면 <b>원래대로</b>를 누르세요.
              </div>
            )}
            <div className="actions">
              <button className="btn btn-ghost" onClick={() => setEditing(null)}>
                취소
              </button>
              {editing.cell.edited && (
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    const base = editing.pos.track === 'main' ? DEFAULT_CELLS[editing.pos.idx] : DEFAULT_BRIDGE[editing.pos.idx]
                    saveCellText(code, room, editing.pos, base.text)
                    setEditing(null)
                  }}
                >
                  원래대로
                </button>
              )}
              <button
                className="btn btn-primary"
                onClick={() => {
                  saveCellText(code, room, editing.pos, editing.text)
                  setEditing(null)
                }}
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
      {DEBUG && <DebugPanel room={room} code={code} me={me} connected={connected} />}
    </div>
  )
}
