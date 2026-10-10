# meeting-bot

Discord 회의를 말하는 사람별로 녹음하고, n8n 워크플로가 음성 인식과 회의록 초안 작성을 거쳐
승인된 회의록을 ClickUp에 올리는 봇이다.

| 문서 | 내용 |
| --- | --- |
| [AGENTS.md](AGENTS.md) | 사람과 AI 에이전트의 공통 작업 계약 |
| [CLAUDE.md](CLAUDE.md) | Claude Code 진입점, 프로젝트 Skill |
| [docs/harness/OVERVIEW.md](docs/harness/OVERVIEW.md) | 하네스 구성, 출처, 다음 단계 |
| [templates/](templates) | 작업 계약(`TASK.md`), 결정 기록 양식 |
| [docs/design/meeting-notes.md](docs/design/meeting-notes.md) | 회의록 자동화 설계 |

## 녹음 봇

`/회의녹음 시작`부터 `/회의녹음 종료`까지만 음성 채널에 들어가 말하는 사람별로 녹음한다.

```
/회의녹음 시작 ─> 발화마다 .ogg 저장 ─> /회의녹음 종료
   ─> 짧은 발화 제거, webm 변환, manifest.json 작성 ─> n8n Webhook 호출
```

| 경로 | 내용 |
| --- | --- |
| `src/index.js` | 명령 처리, 녹음 시작과 종료, 연결 끊김 처리 |
| `src/recorder.js` | 음성 채널 연결, 발화별 녹음, 종료 순서 |
| `src/finalize.js` | 짧은 발화 제거, webm 변환, manifest 작성, n8n 호출 |
| `src/commands.js`, `src/deploy-commands.js` | `/회의녹음` 명령 정의와 등록 |
| `scripts/offline-test.js` | Discord 없이 녹음, 종료, 변환, manifest 작성 확인 |

### Discord 준비

1. [Discord 개발자 포털](https://discord.com/developers/applications)에서 Application을 만들고 Bot 토큰을 발급한다.
2. Bot 설정에서 **Message Content Intent**를 켠다. 녹음 봇에는 필요 없고, n8n이 같은 토큰으로 회의 채널의 결정 메시지를 읽을 때 필요하다.
3. OAuth2 URL Generator에서 scope는 `bot`, `applications.commands`를 고르고, 권한은 채널 보기, 메시지 보내기, 링크 임베드,
   파일 첨부, 메시지 기록 보기, 연결을 골라 팀 서버에 초대한다. 관리자 권한은 주지 않는다.

### 로컬에서 실행

```bash
cp .env.example .env   # DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID 채우기
npm ci
npm run deploy-commands   # /회의녹음 명령 등록. 한 번만 하면 된다
npm start
```

n8n 없이 녹음만 확인할 때는 `.env`의 `MEETING_ENDED_WEBHOOK_URL`을 비워 둔다. 서버에서 n8n과 함께 띄우는 방법은
설계 문서 9절의 compose 보완 단계에서 추가한다.

### 결과물

```
recordings/20261013-1400/
├── manifest.json
└── segments/
    ├── 000012345-123456789012345678.webm   # 회의 시작 후 12.345초, 해당 사용자 ID
    └── ...
```

`manifest.json`에는 회의 시작과 끝 시각, 참석자 이름, 발화마다 파일 이름, 화자, 시작과 끝(회의 시작 기준 ms)이 들어 있다.

- 발화는 1초 동안 조용하면 끝난 것으로 보고, `MIN_SEGMENT_MS`(기본 700ms)보다 짧은 발화는 버린다.
- OpenAI 음성 인식은 ogg를 받지 않아서 Opus를 다시 인코딩하지 않고 webm으로만 옮긴다.
- 종료할 때는 진행 중인 발화를 끝까지 쓴 뒤 음성 연결을 끊는다. 연결부터 끊으면 라이브러리가 스트림을 닫아 마지막 조각이 잘릴 수 있다.
- 회의 하나는 `/회의녹음 시작`부터 `/회의녹음 종료`까지 이어진다. 봇의 음성 연결이 끊기면 종료 명령을 받을 때까지 같은 회의로 다시 들어가고,
  끊긴 구간을 manifest `gaps`에 남긴다. 음성 채널이 삭제된 경우에만 그때까지의 녹음으로 회의를 끝낸다.
- 회의 중에는 녹음 폴더에 `state.json`을 남긴다. 봇이 재시작되면 10분 안이면 같은 회의로 이어 가고, 더 지났으면 그때까지의 녹음으로 마무리한다.
  manifest를 쓰면 `state.json`은 지운다.
- Ctrl+C로 봇을 끄면 그때까지의 녹음으로 회의를 마무리한다.
- 음성 연결이 준비될 때와 참석자가 바뀔 때 콘솔에 `DAVE 프로토콜 v<버전>`을 남긴다. 0이면 암호화 세션이 없다.

### 알아 둘 점

- Discord는 2026년 3월 1일부터 음성 통화를 종단 간 암호화(DAVE)로만 지원한다. `@discordjs/voice` 0.19에 DAVE 라이브러리
  `@snazzah/davey`가 기본으로 들어 있다. 실제 채널에서 녹음되는지는 #4에서 확인한다.
- `@discordjs/voice` README에 "Audio receive is not documented by Discord so stable support is not guaranteed"라고 적혀 있다.
  Discord가 바꾸면 녹음이 안 될 수 있다.

### 확인하기

```bash
npm test                            # ffmpeg 필요
docker build -t meeting-bot .
docker run --rm meeting-bot npm test
```

오프라인 테스트는 ffmpeg로 만든 Opus 패킷을 실제 수신 스트림에 넣는다. `offline-test.js`는 녹음, 강제 종료, webm 변환, manifest 작성을,
`offline-reconnect-test.js`는 연결 끊김 뒤 재접속, 채널 이동, 채널 삭제, 봇 재시작 뒤 이어 가기를 가짜 음성 연결로 확인한다.
CI도 같은 테스트를 돌린다.

## 작업 흐름

1. Meeting Bot 작업 폼으로 GitHub Issue를 만든다.
2. 최신 `main`에서 `<type>/gh-<번호>-<short-slug>` 브랜치를 만든다.
3. `templates/task-contract.md`를 복사해 `TASK.md`를 채운다.
4. 작업 후 `/mb-commit`으로 커밋하고 `/mb-pr`로 PR을 연다. 리뷰는 `/mb-review`와 사람이 한다.
5. 완료 조건과 증빙을 확인한 뒤 Issue를 닫는다.

커밋 전 검사:

```bash
python3 scripts/preflight.py --staged
```
