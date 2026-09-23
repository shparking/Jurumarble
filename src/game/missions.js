// 돌발 미션: 주사위를 굴릴 때 10% 확률로 한 명에게만 몰래 전달. 시간이 끝나면 나머지가 5지선다로 맞힌다.
// text: 보기(퀴즈)에 보이는 일반형 / detail: 수행자에게만 보이는 구체형(이름·색 등 채움) / minutes: 3 또는 5
const COLORS = ['빨강', '파랑', '노랑', '초록', '보라', '검정']
export const MISSIONS = [
  { text: '특정 사람 이름을 5번 이상 부르기', detail: (t) => `"${t}" 이름을 5번 이상 부르기`, minutes: 5, target: true },
  { text: '"진짜?"를 5번 말하기', minutes: 5 },
  { text: '아무나 3명에게 칭찬하기', minutes: 5 },
  { text: '대화 중에 "치킨"을 3번 자연스럽게 끼워 넣기', minutes: 5 },
  { text: '팔짱 낀 채로만 말하기', minutes: 3 },
  { text: '남 말끝마다 "그치?"로 맞장구치기 (3번)', minutes: 3 },
  { text: '누군가와 하이파이브 하기', minutes: 3 },
  { text: '노래 가사 한 줄을 대사처럼 말하기', minutes: 5 },
  { text: '셀카 찍자고 제안해서 실제로 찍기', minutes: 5 },
  { text: '왼손으로만 잔 들기', minutes: 5 },
  { text: '"아니" 한 번도 안 쓰기 (금지어)', minutes: 5 },
  { text: '남의 소지품 하나를 빌려 쓰기 (안경·모자 등)', minutes: 5 },
  { text: '의성어 "톡"이나 "쨍" 같은 소리를 대화에 3번 넣기', minutes: 5 },
  { text: '숫자 "일곱"을 3번 말하기', minutes: 5 },
  { text: '"완전"을 5번 말하기', minutes: 5 },
  { text: '색깔 이름 하나를 3번 말하기', detail: () => `"${COLORS[Math.floor(Math.random() * COLORS.length)]}"을(를) 3번 말하기`, minutes: 5 },
  { text: '계절 이름 4개를 전부 한 번씩 말하기', minutes: 5 },
  { text: '웃을 때 "킥킥"으로 웃기 (2번 이상)', minutes: 5 },
  { text: '뭘 마실 때마다 "쓱" 소리 내기', minutes: 5 },
  { text: '감탄할 때 "헐" 대신 "어머"만 쓰기', minutes: 5 },
  { text: '헛기침 3번 하기', minutes: 3 },
  { text: '잔을 내려놓을 때마다 "탁" 말하기', minutes: 5 },
  { text: '대화 중 "쉿" 손짓 한 번 하기', minutes: 3 },
  { text: '건배할 때 "짠" 대신 "치어스" 말하기', minutes: 5 },
  { text: '자기 이름을 3인칭으로 2번 말하기', minutes: 5 },
  { text: '특정 사람과 눈 마주칠 때마다 윙크하기 (2번)', detail: (t) => `"${t}"와(과) 눈 마주칠 때마다 윙크하기 (2번)`, minutes: 5, target: true },
  { text: '잔을 두 손으로만 들기', minutes: 5 },
  { text: '말할 때 손가락으로 허공에 그림 그리며 설명하기 (2번)', minutes: 5 },
  { text: '웃을 때 "히히"로만 웃기', minutes: 5 },
  { text: '맛있다는 말을 "쫀득하다"로 3번 표현하기', minutes: 5 },
  { text: '뭘 가리킬 때마다 "저기 뾱" 하고 말하기', minutes: 5 },
  { text: '감탄사로 "오잉?"만 쓰기 (3번)', minutes: 5 },
  { text: '뭘 놓을 때 "툭", 집을 때 "쓱" 말하기 (각 2번)', minutes: 5 },
  { text: '대화 중 "쉬익~" 바람 빠지는 소리 흉내 내기 (1번)', minutes: 3 },
  { text: '잔 채울 때 "쪼르륵" 소리 내기 (2번)', minutes: 5 },
]

export const MISSION_CHANCE = 0.1
export const MISSION_CHOICES = 5

// 미션 하나 뽑기 + 5지선다(정답 + 오답 4개) 구성
export function drawMission(targetName) {
  const idx = Math.floor(Math.random() * MISSIONS.length)
  const m = MISSIONS[idx]
  const others = MISSIONS.map((_, i) => i).filter((i) => i !== idx)
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[others[i], others[j]] = [others[j], others[i]]
  }
  const pick = [idx, ...others.slice(0, MISSION_CHOICES - 1)]
  for (let i = pick.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pick[i], pick[j]] = [pick[j], pick[i]]
  }
  return {
    text: m.text,
    detail: m.detail ? m.detail(targetName) : m.text,
    minutes: m.minutes,
    choices: pick.map((i) => MISSIONS[i].text),
    answer: pick.indexOf(idx),
  }
}
