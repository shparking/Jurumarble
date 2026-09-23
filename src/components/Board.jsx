import { useLayoutEffect, useRef, useState } from 'react'
import { LAYOUTS } from '../game/board'
import { characterOf } from '../game/characters'

// 모든 칸의 글자 크기를 하나로 통일: 각 칸이 넘치지 않는 최대 크기를 구해 그 중 최솟값을 전체에 적용
const FONT_MAX = 14
const FONT_MIN = 7

function fitOne(el, wrap, max, min) {
  const box = el.parentElement
  const cs = getComputedStyle(box)
  const emo = box.querySelector('.emo')
  const emoH = emo ? emo.getBoundingClientRect().height + parseFloat(getComputedStyle(emo).marginBottom || 0) : 0
  const innerH = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - emoH
  const innerW = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
  el.style.overflowWrap = wrap
  let size = max
  el.style.fontSize = size + 'px'
  while (size > min && (el.scrollHeight > innerH + 0.5 || el.scrollWidth > innerW + 0.5)) {
    size -= 0.5
    el.style.fontSize = size + 'px'
  }
  return size
}

function useUniformFont(rootRef, deps) {
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const run = () => {
      const els = Array.from(root.querySelectorAll('.cell-inner .txt'))
      if (!els.length) return
      // 1) 단어를 끊지 않을 때 / 2) 어디서든 줄바꿈할 때 각각 맞는 크기
      const min = parseFloat(root.dataset.fontMin) || FONT_MIN
      const keep = els.map((el) => fitOne(el, 'normal', FONT_MAX, min))
      const any = els.map((el) => fitOne(el, 'anywhere', FONT_MAX, min))
      const target = Math.max(min, Math.min(...any))
      els.forEach((el, i) => {
        el.style.fontSize = target + 'px'
        // 그 크기에서 단어를 안 끊어도 들어가는 칸은 keep-all, 아니면 글자 단위 줄바꿈
        el.style.overflowWrap = keep[i] >= target ? 'normal' : 'anywhere'
      })
    }
    run()
    const ro = new ResizeObserver(run)
    ro.observe(root)
    if (document.fonts?.ready) document.fonts.ready.then(run)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

// 위치 → 보드 내 퍼센트 좌표 (칸 중심)
export function posToPercent(pos, L) {
  if (pos.track === 'main') {
    const { col, row } = L.grid(pos.idx)
    return { x: ((col + 0.5) / L.cols) * 100, y: ((row + 0.5) / L.rows) * 100 }
  }
  const c = L.bridgeCenters[pos.idx]
  return { x: (c.x / L.cols) * 100, y: (c.y / L.rows) * 100 }
}

// 3D 캐릭터 이미지, 로드 실패 시 이모지로 대체
function TokenImage({ ch }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <span className="token-emoji">{ch.emoji}</span>
  return <img className="token-img" src={ch.img} alt={ch.name} draggable={false} onError={() => setFailed(true)} />
}

// 칸 상단 띠: 모든 칸 동일한 색 (특수 칸도 동일)
function bandColor() {
  return 'var(--band)'
}

const ICONS = {
  home: '🚩',
  travel: '✈️',
  rest: '☕',
  goStart: '↩︎',
  nop: '🎫',
}

export default function Board({ cells, bridge, tokenPos, character, activeKey, picking, onCellTap, layout = 'portrait' }) {
  const ch = characterOf(character)
  const L = LAYOUTS[layout] || LAYOUTS.portrait
  const { cols: COLS, rows: ROWS } = L
  const tp = posToPercent(tokenPos, L)
  const rootRef = useRef(null)
  useUniformFont(rootRef, [layout, cells.map((c) => c.text).join('|'), bridge.map((c) => c.text).join('|')])

  const renderInner = (cell, i, isBridge) => (
    <div className={`cell-inner ${cell.type || 'normal'}`}>
      <span className="band" style={{ background: bandColor(cell, i, isBridge) }}>
        <span className="num">{isBridge ? 32 + i : i}</span>
      </span>
      {(cell.emoji || ICONS[cell.type]) && <span className="emo">{cell.emoji || ICONS[cell.type]}</span>}
      <span className="txt">{cell.text}</span>
      {cell.type === 'home' && (
        <svg className="go" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-label="진행 방향">
          <path d="M5 12h13" />
          <path d="M13 6l6 6-6 6" />
        </svg>
      )}
    </div>
  )

  return (
    <div className={`board-wrap ${layout} ${picking ? 'picking' : ''}`} style={{ aspectRatio: layout === 'landscape' ? '10 / 11.6' : '8 / 13' }}>
      <div className="board" ref={rootRef} style={{ '--cols': COLS, '--rows': ROWS }} data-font-min={layout === 'landscape' ? 6 : 7}>
        {/* 다리: 도로 모양 */}
        <svg className="bridge-svg" viewBox={`0 0 ${COLS} ${ROWS}`} preserveAspectRatio="none">
          <path className="road-shadow" d={L.bridgePathD} strokeWidth="1.12" />
          <path className="road" d={L.bridgePathD} strokeWidth="1.0" />
          <path className="road-line" d={L.bridgePathD} strokeWidth="0.045" />
        </svg>

        {/* 다리 입구/출구 화살표 (SVG 늘어남 없이 HTML로 배치) */}
        {L.arrows.map((a, i) => (
          <div
            key={i}
            className={`road-arrow ${i === 0 ? 'in' : 'out'}`}
            style={{ left: `${(a.x / COLS) * 100}%`, top: `${(a.y / ROWS) * 100}%`, '--rot': { up: '0deg', right: '90deg', down: '180deg', left: '270deg' }[a.dir] }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 15l6-6 6 6" />
            </svg>
          </div>
        ))}

        {cells.map((cell, i) => {
          const { col, row } = L.grid(i)
          const key = `main-${i}`
          const cls = [
            'cell',
            cell.type || 'normal',
            i === L.entrance ? 'entrance' : '',
            activeKey === key ? 'active' : '',
          ].join(' ')
          return (
            <div
              key={key}
              className={cls}
              style={{ left: `${(col / COLS) * 100}%`, top: `${(row / ROWS) * 100}%` }}
              onClick={() => onCellTap?.({ track: 'main', idx: i })}
            >
              {renderInner(cell, i, false)}
            </div>
          )
        })}

        {bridge.map((cell, i) => {
          const c = L.bridgeCenters[i]
          const key = `bridge-${i}`
          const cls = ['cell', 'bridge', cell.type || 'normal', activeKey === key ? 'active' : ''].join(' ')
          return (
            <div
              key={key}
              className={cls}
              style={{ left: `${(c.x / COLS) * 100}%`, top: `${(c.y / ROWS) * 100}%` }}
              onClick={() => onCellTap?.({ track: 'bridge', idx: i })}
            >
              {renderInner(cell, i, true)}
            </div>
          )
        })}

        {picking && <div className="pick-hint">가고 싶은 칸을 탭하세요</div>}

        {/* 공용 말 (현재 차례 플레이어 색) */}
        <div className="token" style={{ left: `${tp.x}%`, top: `${tp.y}%` }}>
          <span key={`${tokenPos.track}-${tokenPos.idx}`} className="token-inner">
            <TokenImage ch={ch} />
          </span>
        </div>
      </div>
    </div>
  )
}
