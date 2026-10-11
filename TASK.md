# Task Contract: n8n이 회의 채널에서 기간 안의 ✅ 결정 메시지 수집

> Generated at: `2026-10-11`
>
> 이 파일은 현재 작업 브랜치의 계약이다. 저장소 공통 정책은 `AGENTS.md`를 따른다.
> 상태: 2026-10-11 사용자 확인 후 구현. 단계마다 사용자 승인을 받았다.

## Work gate

- GitHub Issue: `#15`
- 관련 ClickUp 작업·회의록: 해당 없음
- Branch: `feat/gh-15-decision-messages` (worktree `~/Downloads/meeting-bot-gh15`)
- Base branch: `main` (#14 병합본)

## Objective

- 회의 녹취 워크플로(#13)에 회의 채널의 결정 메시지 수집을 더한다(설계 문서 9절 6단계, 5절 D).
- 기간 안에 사람이 쓴 메시지 중 ✅ 반응이 1개 이상인 것만 코드가 고르고, 실행 기록에 남긴다.

## Scope

- `workflows/src/*.js`: 기간 계산, 결정 메시지 고르기 Code 노드(새 파일). 알림 문구에 결정 메시지 수를 더한다
- `scripts/build-workflow.js`, `workflows/meeting-transcribe.json`(생성물): 결정 메시지 조회 HTTP Request 노드(`after`부터 100개씩, 기간이 끝나면 멈춤)와 Code 노드 추가
- `scripts/diff-workflow.js`: 화면 저장 때 빠지는 기본값이 새로 보이면 표에 더한다
- `scripts/offline-workflow-test.js`: 기간, 봇 제외, ✅ 판정, 여러 번 나눠 받기, 조회 실패
- `scripts/e2e-n8n.js`, `test/e2e/mock-apis.js`: 가짜 Discord 메시지 조회(`after`, 100개 넘는 메시지, 반응)
- `workflows/README.md`, `README.md`, `docs/design/meeting-notes.md`(5절 D, static data `[확인 필요]` 해소)

## Explicit exclusions

- 초안·근거 검증(7단계), 승인(8단계), ClickUp 쓰기와 "지난 회의 끝 시각" 갱신(9단계), 실패 알림 워크플로(10단계)
- 녹음 봇(`src/`)과 `docker-compose.yml` 변경. 필요해지면 멈추고 묻는다
- 실제 Discord 조회와 실제 OpenAI 호출은 사용자 확인 뒤 테스트 채널에서만 한다
- Docker volume 삭제, 서버 접근 경로 변경, 유료 과금 설정 변경은 별도 승인 없이 하지 않는다.
- 비밀값, 토큰, `.env` 값, 녹음 파일, 녹취 원문, 채팅 원문, 참석자 ID는 기록하지 않는다.

## Data and cost impact

- 녹음·녹취 데이터 처리 변경: 결정 메시지 원문(작성자 표시 이름, 내용, 링크)이 n8n 실행 기록에 7일 남는다.
- 외부 API로 보내는 데이터(음성 인식, 생성 모델): 변경 없음. 결정 메시지를 생성 모델로 보내는 것은 7단계다.
- 외부 서비스 쓰기(ClickUp, Discord): 회의 채널 알림 문구만 바뀐다. Discord 읽기(메시지 조회)가 기간 안 메시지 100개당 1회 늘어난다.
- 예상 API 호출량과 비용: 유료 API 추가 없음. 실제 확인 때 테스트 녹음으로 음성 인식을 다시 부르면 1회 추정 약 $0.006. E2E는 가짜 서버라 비용 없음.
- 서버·n8n 설정 변경: Discord 봇의 Message Content Intent를 Developer Portal에서 켠다(사용자). n8n 자격 증명은 5단계의 Discord Bot을 그대로 쓴다.

## Ownership

| Area (paths) | Owner | Required review |
| --- | --- | --- |
| `workflows/**`, `scripts/build-workflow.js`, `scripts/diff-workflow.js` | n8n 워크플로 | 기간 밖·봇·✅ 없는 메시지가 빠지는지, 100개를 넘을 때 빠짐없이 받는지, 조회 실패가 조용히 넘어가지 않는지 |
| `scripts/offline-workflow-test.js`, `scripts/e2e-n8n.js`, `test/e2e/*` | 테스트 | 기존 테스트 유지, 실제 API를 부르지 않는지 |
| `README.md`, `workflows/README.md`, `docs/design/meeting-notes.md`, `TASK.md` | 문서 | 사람 리뷰 |

## Existing user-owned changes

- 작업 시작 시 `git status --short`(새 worktree): 변경 없음.
- `~/Downloads/meeting-bot`(설계 세션 #12 미커밋 변경)과 `~/Downloads/meeting-bot-wt`(참고 구현)는 건드리지 않는다.

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

- 테스트 채널에서 기간 안의 ✅ 메시지만 고르고, ✅ 없는 메시지, 봇 메시지, 기간 밖 메시지는 빠진다 — 오프라인 테스트와 로컬 Docker E2E(100개를 넘는 메시지로 여러 번 나눠 받기 포함)
- 실제 테스트 채널에서 사용자가 만든 메시지로 같은 결과가 실행 기록에 남고, 회의 채널 알림에 결정 메시지 수가 나온다 — 로컬 n8n, 실제 Discord 조회
- 메시지 조회가 실패하면 조용히 끝나지 않고 실행이 실패한다 — 로컬 Docker E2E

## Decisions

- 2026-10-11 사용자 결정: 테스트는 새로 만든 테스트 채널에서 한다(설계 10절 ⑧).
- 2026-10-11 사용자 결정: 메시지 조회는 HTTP Request 노드와 `after`로 한다. n8n 2.42.6 Discord 노드는 전체 조회 때 채널 기록 전체를 `before`로 받고, 개수 제한은 최신 100개뿐이라 결정이 조용히 빠질 수 있다(노드 코드에서 확인).
- 2026-10-11 사용자 결정: "지난 회의 끝 시각"은 워크플로 static data에 둔다. 워크플로를 `import:workflow`로 다시 가져와도 유지되는 것을 일회용 n8n 2.42.6에서 확인했다(저장소 JSON에 `staticData`를 넣지 않는 동안).
- 2026-10-11 사용자 결정: 작업 폴더는 새 worktree `~/Downloads/meeting-bot-gh15`.
- 2026-10-11 사용자 결정: 요청은 최대 50번(메시지 5,000개)까지 한다. 마지막으로 받은 묶음이 100개를 채웠고 가장 최근 메시지가 회의 종료 전이면
  더 받을 메시지가 남은 것으로 보고 실행을 실패시킨다(n8n 페이지 넘김은 한도에서 조용히 멈추기 때문).
- 2026-10-11 사용자 결정: ✅가 달렸는데 내용과 첨부가 모두 없는 메시지가 있으면 Message Content Intent 확인을 요청하는 오류로 실행을 실패시킨다.
- 2026-10-11 사용자 결정: 작성자 이름은 `author.global_name`(없으면 `username`)을 쓴다. 서버 별명과 다를 수 있다. 작성자 ID는 남기지 않는다.
- 설계 상세(제안, 위 결정과 함께 확인): 기간은 시작 초과 ~ 회의 종료 이하이고 메시지 ID의 시각으로 거른다. 받은 메시지 중 가장 큰 ID를 다음 `after`로 쓰고,
  100개 미만이거나 가장 최근 메시지가 회의 종료를 넘으면 멈춘다. 사람이 쓴 메시지는 `author.bot`이 아니고 Webhook 메시지가 아니며 종류가 일반·답장인 것이다.
  ✅는 `reactions`의 `emoji.name === '✅'`이고 `count >= 1`이다. 조회 노드는 재시도 3회(5초)를 둔다. (사용자 확인, 2026-10-11)
- 2026-10-11 사용자 결정: 결정 메시지 표시는 ✅ 반응으로 유지한다. 본문 ✅(또는 `✅ 결정:` 머리말), 반응과 본문 둘 다, ✅ 답장을 검토했다.
  본문 방식은 "✅ PR 리뷰 완료" 같은 일상 메시지가 결정으로 잡히는 오탐이 있고 남의 메시지를 표시할 수 없으며, 셋 다 `AGENTS.md` 3.2
  ("지정한 반응(✅)이 달린 메시지") 변경이 필요해 반응을 유지했다.
- 2026-10-11 사용자 결정: 음성 인식과 결정 메시지 수집을 병렬 갈래로 두고 Merge(`chooseBranch`, `waitForAll`, 빈 항목 출력)로 합친다.
  알림 문구는 새 Code 노드 "알림 만들기"가 두 갈래 결과로 만든다. 대안은 순서만 바꾸기(결정 메시지 먼저, 추천안)와 지금 순서 유지였다.
  - n8n(executionOrder v1)은 갈래를 동시에 돌리지 않고 화면 위쪽 갈래부터 하나씩 끝까지 실행한다(문서). 시간은 줄지 않는다.
  - 작업 판단: 결정 메시지 갈래를 위에 두어 Discord 쪽이 실패하면 음성 인식(유료) 전에 멈추게 했다. E2E에서 조회 실패·빈 내용 회차에
    음성 인식 요청 0건을 확인했다.
  - 위치가 실행 순서를 정하므로 차이 검사가 같은 노드에서 갈라진 갈래들의 위아래 순서를 비교한다(위치 자체는 계속 무시).
- 2026-10-11 실제 확인(로컬 n8n 2.42.6, 테스트 채널, 실제 OpenAI·Discord): success 3.2초. 결정 메시지 갈래가 음성 인식보다 먼저 실행됐다.
  메시지 16개 조회(✅ 2개, 봇 11개, 빈 내용 0개), 결정 메시지 2개, 녹취 2줄, 알림 1건. 원문은 보지 않고 실행 기록에서 숫자만 뽑았다.
- 2026-10-11 화면 저장 차이 검사에서 확인하고 고친 것: 새 노드의 기본값이 화면 저장 때 빠진다(HTTP `method: GET`, 페이지 넘김
  `paginationMode`, 페이지 넘김 파라미터 항목의 `type: qs`, Merge `chooseBranchMode: waitForAll`). 차이 검사 기본값 표가 안쪽 경로와
  배열 항목(`a[].b`)을 받게 하고, 배열은 키 순서와 상관없이 비교하게 했다. 고친 뒤 화면 저장본과 차이 0건.
- 2026-10-11 작업 판단(사용자 확인):
  - 저장된 "지난 회의 끝 시각"이 이번 회의 종료보다 늦거나 시각이 아니면 처음 실행처럼 회의 시작 7일 전부터 본다.
  - 사람이 쓴 메시지는 Discord 메시지 종류 일반(0)과 답장(19)만 본다.
  - 첨부만 있고 내용이 빈 ✅ 메시지는 정상으로 보고 첨부 파일 이름을 남긴다.
  - 알림 문구는 결정 메시지 고르기 노드 한 곳에서 만든다(녹취 만들기 노드에서 뺐다).
- 2026-10-11 E2E에서 확인하고 고친 것(n8n 2.42.6 HTTP Request 페이지 넘김):
  - 페이지 넘김 식은 첫 요청 전에도 계산된다(응답 없음). 식이 깨지면 n8n이 그 값을 무시해서 처음에는 우연히 맞게 동작했다.
  - 조회가 500을 받았을 때 식이 깨지자 n8n이 페이지 넘김을 멈추고 오류 본문을 출력 항목으로 냈다. 실행은 success, 재시도 없음,
    알림은 "결정 메시지 0개"였다(조용한 실패).
  - 고침: 식이 배열이 아닌 본문도 계산하게 하고(그때 다음 after는 기간 시작 ID), 오류 응답은 완료로 보게 했다. 그러면 n8n이 상태 코드로
    오류를 올려 노드 재시도 3번 뒤 실패한다(E2E 확인). 고르기 노드도 메시지가 아닌 항목을 받으면 실패한다(두 번째 방어).
