# Task Contract: n8n이 회의록 초안을 Discord 버튼으로 보내고 승인·거절·기한 초과로 재개

> Generated at: `2026-10-11`
>
> 이 파일은 현재 작업 브랜치의 계약이다. 저장소 공통 정책은 `AGENTS.md`를 따른다.
> 상태: 확정(2026-10-11 사용자 확인). 구현은 진행 순서의 단계마다 확인받는다.

## Work gate

- GitHub Issue: `#19`
- 관련 ClickUp 작업·회의록: 해당 없음
- Branch: `feat/gh-19-approval-buttons` (worktree `~/Downloads/meeting-bot-gh19`)
- Base branch: `main` (#18 병합본)

## Objective

- 초안 검증을 통과한 회의록 초안을 회의 채널에 보여 주고, 팀원이 버튼으로 승인하거나 거절할 때까지 n8n이 기다리게 한다
  (설계 문서 9절 8단계, 5절 G).
- 승인·거절·기한 초과가 각각 n8n 실행을 재개하고, 결과가 메시지에 남는다.

## Scope

- `workflows/src/*.js`: 초안 메시지 만들기, 결정 읽기 Code 노드(새 파일). 알림 만들기는 draftOk에 따라 갈래가 나뉘는 만큼만 고친다
- `scripts/build-workflow.js`, `workflows/meeting-transcribe.json`(생성물): 초안 보내기(HTTP, Discord), 승인 기다리기(Wait), 결과 표시(HTTP, Discord)
  노드와 draftOk 갈래
- `scripts/diff-workflow.js`: 새 노드(Wait 등)와 7단계에서 미룬 HTTP 노드의 화면 저장 기본값
- `src/*.js`: 녹음 봇의 버튼 클릭 처리(새 파일 1개와 `src/index.js` 연결)
- `scripts/offline-*.js`, `package.json`(테스트 명령만), `scripts/e2e-n8n.js`, `test/e2e/*`: 버튼 처리 오프라인 테스트, 가짜 Discord에 메시지 수정·
  파일 첨부 경로, Wait 재개 E2E
- `workflows/README.md`, `README.md`, `docs/design/meeting-notes.md`(5절 G의 `[확인 필요]` 해소, 3절 결정표, 9절)

## Explicit exclusions

- `수정` 버튼과 모달, 재검증 반복(별도 단계, 2026-10-11 사용자 결정)
- ClickUp 쓰기와 지난 회의 끝 시각 갱신(9단계), 실패 알림 워크플로(10단계)
- 녹음 동작(녹음 시작·종료, 마무리, 보관)과 `docker-compose.yml`의 포트 변경. compose 환경 변수 추가가 필요해지면 멈추고 묻는다
- Docker volume 삭제, 서버 접근 경로 변경, 유료 과금 설정 변경은 별도 승인 없이 하지 않는다.
- 비밀값, 토큰, `.env` 값, 녹음 파일, 녹취 원문, 채팅 원문, 참석자 ID, 회의록 초안 원문은 기록하지 않는다.

## Data and cost impact

- 녹음·녹취 데이터 처리 변경: 회의록 초안이 회의 채널 메시지(embed 또는 `.md` 첨부)로 남는다. n8n 보관 기간(7일)과 관계없이 남는다.
- 외부 API로 보내는 데이터(음성 인식, 생성 모델): 해당 없음(7단계와 같다)
- 외부 서비스 쓰기(ClickUp, Discord): 회의 채널에 초안 메시지를 쓰고, 결정 뒤 버튼을 끄고 결과를 적는다. 멘션은 끈다(`allowed_mentions.parse = []`).
  ClickUp 쓰기는 없다. 실제 Discord 쓰기는 테스트 채널에서만 한다.
- 예상 API 호출량과 비용: Discord API만 쓴다(비용 없음). 실제 확인에서 음성 인식·GPT를 다시 부르면 회의당 7단계와 같은 비용(추정 수 센트)이 든다.
- 서버·n8n 설정 변경: 녹음 봇이 n8n 재개 주소를 부른다. 주소는 기존 `MEETING_ENDED_WEBHOOK_URL`의 origin(`http://n8n:5678`)을 쓰는 것을 제안한다.
  서버 포트는 열지 않는다.

## Ownership

| Area (paths) | Owner | Required review |
| --- | --- | --- |
| `workflows/**`, `scripts/build-workflow.js`, `scripts/diff-workflow.js` | n8n 워크플로 | draftOk가 false인 초안이 버튼으로 가지 않는지, 멘션이 꺼지는지, 기한 초과가 재개되는지 |
| `src/**` | 녹음 봇 | 녹음 동작을 바꾸지 않는지, 봇 클릭·틀린 서명·끝난 실행을 거르는지, 3초 안에 상호작용에 응답하는지 |
| `scripts/offline-*.js`, `scripts/e2e-n8n.js`, `test/e2e/*` | 테스트 | 기존 테스트 유지, 실제 API를 부르지 않는지 |
| `README.md`, `workflows/README.md`, `docs/design/meeting-notes.md`, `TASK.md` | 문서 | 사람 리뷰 |

## Existing user-owned changes

- 작업 시작 시 `git status --short`(새 worktree): 변경 없음.
- `~/Downloads/meeting-bot`(#12 미커밋 변경), `~/Downloads/meeting-bot-wt`(참고 구현), `~/Downloads/meeting-bot-gh15`(병합된 6단계)는 건드리지 않는다.
- `~/Downloads/meeting-bot-gh17`은 병합된 7단계 폴더다(main으로 바꿔 둠). 확인용 n8n(`meeting-bot-gh17-local`, `~/meeting-bot-local-n8n`)은
  이 단계 실제 확인에 다시 쓰고 끝나면 사용자 승인을 받아 지운다.

## Validation

```bash
python3 scripts/preflight.py
git diff --check
npm test
node scripts/build-workflow.js --check
npm run e2e:n8n
```

E2E는 별도 compose 프로젝트 이름과 임시 폴더를 쓰고, 사용자 `.env`와 `recordings/`를 쓰지 않는다.

## Completion criteria

- 승인, 거절, 기한 초과가 각각 n8n 실행을 재개하고 버튼이 꺼진다 — 오프라인 테스트, 로컬 Docker E2E(가짜 Discord, 실제 n8n Wait 노드)
- 서명이 틀린 버튼, 이미 끝난 실행, 봇 계정 클릭은 실행을 바꾸지 않는다 — 오프라인 테스트, 로컬 Docker E2E
- 테스트 채널에서 실제 버튼을 눌러 승인과 거절이 반영된다 — 로컬 n8n + 녹음 봇, 실제 Discord

## Decisions

- 2026-10-11 사용자 결정: 재개 주소의 서명은 버튼 ID에 넣는다(`동작:실행 ID:서명`, 약 80자, Discord 한도 100자). 녹음 봇은 고정된 노드 ID로
  Docker 내부 재개 주소를 조립한다. 재개 주소는 Docker 네트워크 안에서만 열려 있다.
  대안: n8n이 녹음 봇의 내부 HTTP 서버로 주소를 보낸다(봇에 서버·저장소가 생김).
- 2026-10-11 사용자 결정: `수정` 버튼은 8단계에 넣지 않는다. 그 전까지 고칠 내용은 승인 뒤 ClickUp에서 고친다.
- 2026-10-11 사용자 결정: 초안은 4,096자까지 embed 1개, 넘으면 앞부분 embed와 전체 `.md` 첨부로 보인다(설계 표의 "여러 embed" 구간은 뺀다).
- 2026-10-11 확인한 사실(n8n 2.42.6 이미지 코드): 재개 주소는 `/webhook-waiting/<실행 ID>/<노드 ID>?signature=<HMAC 64자>`이고 서명이 없거나
  틀리면 401이다. 서명은 경로(실행 ID, 노드 ID)로 만든다.
- 2026-10-11 사용자 결정(설계 상세, 제안을 확정):
  - 구현 첫 단계로 E2E용 n8n에서 실험해 정한다. 결과는 아래 "실험 결과"에 적었다.
  - 흐름: 초안 검증 → (draftOk) 초안 메시지 만들기 → 초안 보내기 → 승인 기다리기(Wait, 최대 3일) → 결정 읽기 → 결과 표시.
    draftOk가 false이면 지금처럼 알림만 보낸다.
  - 버튼 ID: `mb:<approve|reject>:<실행 ID>:<서명>`. 녹음 봇은 `<origin>/webhook-waiting/<실행 ID>?signature=<서명>`으로 부른다(노드 ID 불필요). 녹음 봇은 `mb:`로 시작하는 버튼만 처리하고, 봇 계정 클릭은 무시한다.
  - 녹음 봇은 상호작용을 먼저 지연 응답(누른 사람에게만 보임)하고 n8n에 `{ decision, by }`를 보낸다. `by`는 누른 사람의 표시 이름이고 ID는 보내지 않는다.
    n8n이 401·404 등으로 거절하면 "이미 처리됐거나 유효하지 않은 버튼"이라고 답한다.
  - 녹음 봇이 부를 n8n 주소는 `MEETING_ENDED_WEBHOOK_URL`의 origin을 쓴다. 새 환경 변수와 열린 포트는 없다.
  - 진행 순서: TASK 확정 → 실험 → n8n 노드·오프라인 테스트 → 녹음 봇 버튼 처리·오프라인 테스트 → E2E·화면 저장 확인 → 실제 Discord 확인
    → 문서·커밋·PR. 단계마다 멈추고 확인받는다.
  - 결과 표시는 n8n이 한다: 버튼을 지우고 embed에 "승인: <이름>", "거절: <이름>", "기한 초과(3일)"를 적는다. 기한 초과 때는 회의 채널에도 알린다.
  - Discord 메시지는 HTTP Request 노드와 Discord Bot 자격 증명으로 보낸다(`allowed_mentions` 때문에 Discord 노드를 쓰지 않는다).
- 2026-10-11 실험 결과(일회용 n8n 2.42.6 컨테이너, Webhook → Code → Wait(On Webhook Call, 제한 20초) → Code, 비용 없음, 실험 뒤 지움):
  - Wait 앞 Code 노드에서 `$execution.resumeUrl`은 `<base>/webhook-waiting/<실행 ID>?signature=<64자>`이다. 경로에 노드 ID가 없다.
    그래서 버튼 ID에 노드 ID를 넣거나 Wait 노드 ID를 고정할 필요가 없다(가져오기 뒤에도 JSON의 노드 ID는 유지됐다).
  - 재개 응답: 서명 없음·틀린 서명·다른 실행의 서명 401(`Invalid token`), 경로에 노드 ID를 붙이면 404, 정상 200, 이미 재개된 실행을 다시 부르면 409.
  - 재개되면 Wait 노드는 요청의 `body`(`{ decision, by }`)를 담은 항목을 내보낸다.
  - 기한이 지나면 Wait 노드는 받은 입력 항목을 그대로 내보낸다(`body` 없음). 기한 뒤 실제 재개까지 약 40초 걸렸다(n8n 대기 확인 주기).
    결정 읽기 노드는 `body.decision`이 없으면 기한 초과로 본다.
- 2026-10-11 E2E에서 찾아 고친 것(작업 판단):
  - n8n 2.42.6 Code 노드 실행 환경에는 `URL`이 없다. 재개 주소를 정규식으로 읽고, 오프라인 테스트 도구가 `URL`과 `structuredClone`을 가린다.
  - HTTP 노드 4.2의 multipart는 파일 필드 이름을 비워도 건너뛰지 않고 실패한다. 긴 초안 확인(If) 노드로 첨부해 보내는 노드와 JSON으로
    보내는 노드를 나누고, 결정 읽기는 실행된 보내기 노드(`$('…').isExecuted`)에서 메시지 ID를 읽는다.
- 2026-10-11 화면 저장 확인: 승인 기다리기(Wait)에서 `responseMode`, `limitType` 기본값이 빠졌다. 차이 검사 기본값 표에 더했다.
  If 노드와 HTTP 노드(7단계 포함)는 빠지는 값이 없었다.
