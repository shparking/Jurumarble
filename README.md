# 주루마블 (Jurumarble)

모바일 웹 주루마블. 각자 폰으로 같은 방에 접속해 말 하나를 순서대로 움직입니다.
Vite + React + Firebase Realtime Database.

## 1. Firebase 준비 (한 번만)
1. https://console.firebase.google.com → 프로젝트 `juru-marvel` 선택
2. 왼쪽 메뉴 **빌드 → Realtime Database → 데이터베이스 만들기**
   - 위치: 아무 곳 (미국 `us-central1` 이면 추가 설정 없음)
   - 보안 규칙: **테스트 모드로 시작** (친구들끼리 쓰는 용도)
3. 만들어지면 **데이터 탭 상단에 URL**이 보입니다. 예)
   - `https://juru-marvel-default-rtdb.firebaseio.com` (미국) → 그대로 두면 됨
   - `https://juru-marvel-default-rtdb.asia-southeast1.firebasedatabase.app` (싱가포르 등) →
     프로젝트 폴더에 `.env` 파일을 만들고 `VITE_FIREBASE_DB_URL=그 주소` 한 줄을 넣으세요 (`.env.example` 참고)

`src/firebase.js` 에 콘솔에서 받은 firebaseConfig 값이 들어 있습니다.

### ⚠️ 테스트 모드 규칙은 30일 뒤 만료됩니다
콘솔 > Realtime Database > **규칙** 탭을 열어 아래 내용으로 바꾸고 **게시**를 누르세요 (만료 없음, 친구들끼리 쓰는 용도):
```json
{ "rules": { "rooms": { ".read": true, ".write": true, ".indexOn": ["createdAt"] } } }
```
(같은 내용이 `database.rules.json` 에 있습니다.)

## 배포 (GitHub → Vercel)
### GitHub 에 올릴 것
이 폴더에서 **아래 항목만** 올리면 됩니다 (`node_modules/`, `dist/`, `single/` 은 올리지 않음):
```
index.html  package.json  package-lock.json
vite.config.js  vite.single.config.js  vite.test.config.js
database.rules.json  .env.example  .gitignore  README.md
src/            (전체: App.jsx, room.js, db.js, firebase.js, styles.css, main.jsx, assets/, components/, game/)
```
`tools/` 폴더는 선택(3D 렌더 실험용, 없어도 됨). `src/App.local.jsx.bak` 도 삭제해도 됩니다.

### Vercel 설정
Add New Project → GitHub repo 선택 → Framework Preset **Vite**, Build Command `npm run build`, Output Directory `dist` → Deploy.
환경변수는 필요 없음(DB 주소가 `src/firebase.js` 에 기본값으로 들어 있음).

### 방 자동 정리
- 대기실에서 **1시간** 안에 시작하지 않은 방은 자동 삭제 (방장 기기가 스스로 닫고, 다른 사람이 앱을 열 때도 정리)
- 시작한 방도 **24시간** 지나면 정리
- 이 정리는 규칙에 `".indexOn": ["createdAt"]` 가 있어야 동작합니다 (위 규칙 JSON 참고)

## 2. 실행
```bash
npm install
npm run dev      # 같은 와이파이의 폰에서는 터미널에 뜨는 Network 주소로 접속
npm run build    # dist/ 배포용 (Firebase Hosting, Vercel, Netlify 등 아무 곳)
```

## 3. 플레이 흐름
- 이름 입력 → **새 방 만들기** (방장) / 친구는 **방 코드 4자리**로 입장 (또는 초대 링크)
- 대기실: 방장이 ▲▼로 순서 지정(안 정하면 랜덤), 칸을 탭해 내용 편집(출발·세계여행은 고정, Enter로 줄바꿈, 내용에 맞는 이모지 자동), 2명 이상이면 **게임 시작**
- 게임: 내 차례에만 굴리기 활성. 모든 폰에서 같은 이동 애니메이션 → 도착 칸 카드가 전원에게 표시, 행동 주체만 버튼 사용
  - 놉카드 칸: 자동 지급 / 일반 칸: 수행 완료 또는 놉카드로 거부 / 이동 칸: 자동 이동 후 그 칸 실행
  - 세계여행(좌상단): 보드에서 칸을 탭해 이동 후 그 칸 실행
  - AI 지목(3번 칸): 방에 있는 사람 중 한 명을 랜덤 지목 → 3·2·1 카운트다운 → 축하 화면 "(이름) 마셔!" (지목된 사람은 놉카드로 거부 가능)
  - 지름길: 3 → 19 (3번 칸에 정확히 멈추면 다음 턴에 다리로, 다리 칸 32~37)
  - 놉카드는 언제든 본인 카드에서 사용 가능, 보유 수는 전원에게 공개

## 구조
- `src/firebase.js` Firebase 초기화 · `src/room.js` 방/게임 진행 로직(DB 읽기·쓰기)
- `src/game/board.js` 칸 데이터, 레이아웃(가로/세로), 이동 규칙
- `src/components/Board.jsx`, `Dice.jsx`, `src/App.jsx`(화면), `src/styles.css`
- `src/db.js` Firebase/데모 저장소 추상화 · `src/game/emoji.js` 자동 이모지 규칙 · `src/game/balance.js` 밸런스 주제 200개
