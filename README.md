# GREYHAVEN — 최후의 생존

버려진 섬에서 벌어지는 3인칭 서바이벌 웹 게임입니다. 브라우저에서 바로 실행되며, 멀티플레이를 지원합니다.

- 낙하산 강하 → 보급 상자 파밍 → 좁혀지는 자기장 → 최후의 1인
- 무기 5종(권총·기관단총·샷건·돌격소총·저격소총), 구급상자, 방탄복
- AI 봇, 슬라이딩·점프 이동, 절차적 캐릭터 애니메이션
- 외부 패키지 없이 Node.js 하나로 실행 (WebSocket 직접 구현)

## 실행

```bash
node serve.js        # http://localhost:8123
```

Windows에서는 `start_game.bat`을 더블클릭하면 됩니다.

- **혼자 하기**: 봇 19명과 대결
- **멀티 로비 참가**: 같은 서버에 접속한 사람끼리 경기. 먼저 들어온 사람이 방장이 되어 봇 수를 정하고 경기를 시작합니다.

## 조작

| 키 | 동작 |
|---|---|
| WASD / Shift / Space | 이동 / 달리기 / 점프 |
| C (달리는 중) | 슬라이딩 |
| 좌클릭 / 우클릭 | 사격 / 정밀 조준 |
| E · R · Q | 상자 열기 · 재장전 · 치료 |
| 1 / 2 / 휠 | 무기 교체 |
| M | 전체 지도 |

## 온라인으로 친구와 하기

- **임시 주소 (내 PC에서)**: `start_online.bat` 실행 → 창에 나오는 `https://….trycloudflare.com` 주소를 공유. `tools/cloudflared/cloudflared.exe`가 필요합니다 ([다운로드](https://github.com/cloudflare/cloudflared/releases/latest)).
- **상시 배포 (Render)**: render.com → New → Blueprint → 이 저장소 선택. `render.yaml`이 설정을 담고 있습니다.
- **Docker**: `docker build -t greyhaven . && docker run -p 8080:8080 greyhaven`

## 구성

| 파일 | 역할 |
|---|---|
| `serve.js` | 정적 파일 서버 + 멀티플레이 방 (로비, 체력·처치 판정, 자기장 피해, 상자 선점) |
| `game.js` | 게임 본체 (물리, 충돌, 봇 AI, 카메라, HUD, 네트워크) |
| `rig.js` | 캐릭터·무기 모델과 절차적 애니메이션 (IK, 보행, 사망 연출) |
| `zone.mjs` | 서버·클라이언트 공용 자기장 계산 |
| `assets/` | 블렌더에서 내보낸 섬 지형·건물·소품과 충돌 데이터 |

## 크레딧

건물·나무·바위·차량 모델: [Kenney](https://kenney.nl) (CC0). 섬 지형, 배치, 캐릭터, 게임 코드는 이 프로젝트에서 새로 제작했습니다.
