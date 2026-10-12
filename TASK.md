# Task Contract: n8n 실행이 실패하면 실패한 노드와 오류 종류를 회의 채널에 알림

> Generated at: `2026-10-11`
>
> 이 파일은 현재 작업 브랜치의 계약이다. 저장소 공통 정책은 `AGENTS.md`를 따른다.
> 상태: 확정(2026-10-11 사용자 확인). 설계를 합의한 뒤 구현은 단계마다 확인받는다.

## Work gate

- GitHub Issue: `#23`
- 관련 ClickUp 작업·회의록: 해당 없음
- Branch: `feat/gh-23-failure-alert` (worktree `~/Downloads/meeting-bot-gh23`)
- Base branch: `main` (#22 병합본 `b8ee5ad`)

## Objective

- 회의 녹취 워크플로가 실패하면 n8n 오류 워크플로가 실패한 노드와 오류 종류를 회의 채널에 알린다(설계 9절 10단계, 5절 "실패 알림").
- 서버 배포와 실제 회의는 #24에서 한다.

## Scope

- `workflows/src/*.js`: 오류 워크플로의 Code 노드(채널 찾기, 알림 문구 만들기)
- `scripts/build-workflow.js`, `workflows/*.json`(생성물): 오류 워크플로 생성, 회의 녹취 워크플로 `settings.errorWorkflow` 연결
- `scripts/diff-workflow.js`: 새 노드의 화면 저장 기본값
- `scripts/offline-workflow-test.js`, `scripts/e2e-n8n.js`, `test/e2e/*`: 실패 알림 오프라인 테스트와 E2E(가짜 Discord)
- `workflows/README.md`, `README.md`, `docs/design/meeting-notes.md`(5절 "실패 알림", B·F의 "10단계 전까지" 문장)

## Explicit exclusions

- 서버 배포, 실제 회의(#24)
- 자동 재시도
- 근거 검증 실패 경로(이미 회의 채널 알림이 감)
- 녹음 봇(`src/**`) 변경. 설계에서 필요해지면 범위를 다시 확인받는다
- Docker volume 삭제, 서버 접근 경로 변경, 유료 과금 설정 변경은 별도 승인 없이 하지 않는다.
- 비밀값, 토큰, `.env` 값, 녹음 파일, 녹취 원문은 기록하지 않는다.

## Data and cost impact

- 녹음·녹취 데이터 처리 변경: 해당 없음. 알림에 녹취·초안 원문과 주소를 넣지 않는다
- 외부 API로 보내는 데이터(음성 인식, 생성 모델): 해당 없음
- 외부 서비스 쓰기(ClickUp, Discord): Discord 회의 채널에 실패 알림. HTTP 노드로 보내고 멘션을 끈다
- 예상 API 호출량과 비용: E2E는 가짜 서버. 실제 확인은 OpenAI 호출 없이 실패를 일으키는 방법을 설계에서 정하고, 호출이 필요하면 예상 비용을 먼저 알린다
- 서버·n8n 설정 변경: 오류 워크플로 추가. 서버 반영과 n8n API 키 등록은 #24

## Ownership

| Area (paths) | Owner | Required review |
| --- | --- | --- |
| `workflows/**`, `scripts/build-workflow.js`, `scripts/diff-workflow.js` | n8n 워크플로 | 알림에 원문·주소가 섞이지 않는지, 멘션이 꺼져 있는지, 알림 실패가 다시 오류를 부르지 않는지 |
| `scripts/offline-*.js`, `scripts/e2e-n8n.js`, `test/e2e/*` | 테스트 | 기존 테스트 유지, 실제 API를 부르지 않는지 |
| `README.md`, `workflows/README.md`, `docs/design/meeting-notes.md`, `TASK.md` | 문서 | 사람 리뷰 |

## Existing user-owned changes

- 작업 시작 시 `git status --short`(worktree `~/Downloads/meeting-bot-gh23`): 변경 없음.
- `~/Downloads/meeting-bot`에는 #12의 미커밋 변경이 있다. 그 폴더와 `.env`, `recordings/`는 건드리지 않는다.

## Validation

```bash
python3 scripts/preflight.py
git diff --check
npm test
node scripts/build-workflow.js --check
npm run e2e:n8n
```

## Completion criteria

- 초안 작성 오류나 ClickUp 쓰기 오류로 실행이 실패하면 회의 채널 알림이 1건 간다(`npm run e2e:n8n`, 가짜 Discord가 받은 요청).
- 알림에 녹취·초안 원문과 주소가 없고 멘션이 꺼져 있다(오프라인 테스트, 코드를 일부러 망가뜨려 실패를 잡는지 확인).
- ~~로컬 확인용 n8n에서 실제 Discord 테스트 채널로 알림이 1회 온다~~: #24에서 확인한다(2026-10-12 사용자 결정).

## Decisions

- 2026-10-11 사용자 결정: 10단계를 실패 알림(#23)과 서버 배포·실제 회의(#24)로 나눈다.
- 2026-10-11 사용자 결정: #4는 #24의 실제 회의로 함께 확인하고, 증빙은 #4에 따로 적는다.
- 2026-10-11 사용자 결정(추천안): 회의 녹취 워크플로가 manifest 확인 직후 `$execution.customData`에 채널 ID를 적고,
  오류 워크플로가 읽기 전용 n8n API 키(`execution:read`)로 실패한 실행을 읽어 회의 채널을 찾는다. 채널을 모르면 코드 상수로 둔 고정 채널로 보낸다.
- 2026-10-11 사용자 결정: 고정 채널은 실제 회의 채널(`1547149294015094817`)이다. `scripts/build-workflow.js` 코드 상수로 둔다.
- 2026-10-11 사용자 결정(추천안): 알림에는 코드가 정한 값(실패한 노드 이름, 오류 종류 분류, 회의 ID, n8n 실행 ID)만 넣는다.
  `error.message`, `execution.url`, 요청 본문은 넣지 않는다. `페이지 만들기` 이후의 실패면 ClickUp에 페이지가 생겼는지 확인하라고 덧붙인다.
- 2026-10-11 사용자 결정(추천안): 승인 뒤 실패하면 채널 알림을 먼저 보내고, 초안 메시지 상태를 실패로 고친다(메시지 ID는 customData).
- 2026-10-12 사용자 결정(추천안): 실제 Discord 알림 확인을 #24(서버 배포)로 옮긴다. n8n API 키는 n8n마다 따로 만들어야 해서 로컬 키는
  버리게 되고, n8n 쪽 경로(키, 실행 읽기, customData, 재개 뒤 실패)는 E2E에서 확인했다. #23은 실제 Discord 확인 없이 병합된다.
- 2026-10-11 확인한 사실(n8n 2.42.6 일회용 컨테이너 실험): Error Trigger 입력에는 실패한 실행의 노드 출력이 없고, HTTP 노드 실패 시
  요청 본문과 쿼리를 포함한 주소가 들어온다. customData는 `includeData=true`로 읽을 때만 오고, throw한 노드에서 적은 값은 남지 않는다.
