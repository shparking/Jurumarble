// 공용 말 캐릭터: 수달 (사용자 제공 이미지, 배경 제거한 투명 PNG)
import otterImg from '../assets/otter.png'
export const OTTER = { name: '수달', emoji: '🦦', img: otterImg }
export const DEFAULT_CHARACTER = 'otter'
export function characterOf() {
  return OTTER
}
