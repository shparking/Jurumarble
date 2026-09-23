const PIPS = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
}

import { useEffect, useState } from 'react'

export default function Dice({ value, rolling, onClick }) {
  const on = new Set(PIPS[value] || [])
  const [landed, setLanded] = useState(false)
  useEffect(() => {
    if (rolling) return
    setLanded(true)
    const t = setTimeout(() => setLanded(false), 400)
    return () => clearTimeout(t)
  }, [rolling])
  return (
    <div className={`dice ${rolling ? 'rolling' : ''} ${landed ? 'landed' : ''}`} aria-label={`주사위 ${value}`} onClick={onClick} role={onClick ? 'button' : undefined}>
      {Array.from({ length: 9 }).map((_, i) => (
        <span key={i} className={`pip ${on.has(i) ? 'on' : ''}`} />
      ))}
    </div>
  )
}
