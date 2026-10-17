# Task Contract: 승인된 회의록의 액션 아이템을 Jira 이슈로 만들고 기한이 속한 파트 스프린트에 넣음

> Generated at: `2026-10-17`
>
> 이 파일은 현재 작업 브랜치의 계약이다. 저장소 공통 정책은 `AGENTS.md`를 따른다.

## Work gate

- GitHub Issue: `#32`
- 관련 Jira 이슈·회의록: 해당 없음
- Branch: `feat/gh-32-jira-action-items` (worktree `~/Downloads/meeting-bot-gh32`)
- Base branch: `feat/gh-31-confluence-minutes`(#31). #31이 병합되면 `main` 위로 옮긴다

## Objective

- 승인된 회의록의 액션 아이템마다 Jira `작업` 이슈를 만들고, 기한이 든 파트 스프린트(없으면 백로그)에 넣는다.
- 만든 이슈 키를 회의록 표의 Jira 이슈 칸에 링크로 채운 뒤 Confluence에 쓴다.

## Scope

1. 설계: `TASK.md`, 결정 기록 `docs/decisions/2026-10-17-gh32-jira-action-items.md`
2. 워크플로: `scripts/build-workflow.js`, `workflows/src/jira-*.js`, `workflows/src/minutes-verify.js`, `workflows/src/approval-*.js`,
   `workflows/src/draft-request.js`, `workflows/src/failure-notice.js`, `workflows/*.json`, 테스트 `scripts/offline-workflow-test.js`, `scripts/e2e-n8n.js`, `test/e2e/mock-apis.js`
3. 운영 문서: `README.md`, `workflows/README.md`, `docs/design/meeting-notes.md`
4. 외부 설정: 배포 직전에 Confluence `회의록 템플릿`의 `ClickUp 작업` 열 이름을 `Jira 이슈`로 바꾼다(2026-10-17 사용자 결정, 열 이름만).
5. 실제 확인: 릴리스 배포 뒤 실제 회의 1회로 이슈가 생기고 회의록에 링크되는지 본다.

## Explicit exclusions

- Discord 표시 이름과 Jira 계정 연결, 담당자 자동 배정
- 이슈 상태 변경, 하위 작업, 에픽·기능명세서 연결
- 회의록 승인 없이 이슈 만들기
- Docker volume 삭제, 서버 접근 경로 변경, 유료 과금 설정 변경, 비밀값 기록

## Data and cost impact

- 녹음·녹취 데이터 처리: 해당 없음
- 외부 API로 보내는 데이터(음성 인식, 생성 모델): 해당 없음
- 외부 서비스 쓰기: 승인된 회의록의 액션 아이템(할 일, 담당 파트, 담당자 표시 이름, 기한)을 Jira 이슈로 쓴다
- 예상 API 호출량과 비용: 회의당 Jira 호출 2회 + 액션 아이템 수. 오프라인·E2E 테스트는 가짜 서버라 비용이 없다
- 서버·n8n 설정 변경: 없음(#31의 Atlassian Basic Auth 자격 증명을 같이 쓴다)

## Ownership

| Area (paths) | Owner | Required review |
| --- | --- | --- |
| `scripts/build-workflow.js`, `workflows/**` | n8n 워크플로 | 승인 없이 이슈를 만드는 경로가 없는지, 이슈 만들기를 재시도하지 않는지, 다시 처리해도 이슈가 두 번 생기지 않는지 |
| 테스트 `scripts/offline-*`, `scripts/e2e-n8n.js`, `test/e2e/*` | n8n 워크플로 | 테스트를 지우거나 건너뛰지 않았는지 |
| `docs/**`, `README.md`, `TASK.md` | 문서 | 사람 리뷰 |

## Existing user-owned changes

- 작업 시작 시 `git status --short`(worktree `~/Downloads/meeting-bot-gh32`): 변경 없음.

## Validation

```bash
python3 scripts/preflight.py
git diff --check
npm test
node scripts/build-workflow.js --check
npm run e2e:n8n
```

## Completion criteria

- 승인하면 액션 아이템 행마다 이슈가 1개 생기고, 기한이 든 파트 스프린트에 들어가며(없으면 백로그), 회의록의 Jira 이슈 칸에 키가 채워진 채
  Confluence에 써진다(오프라인 테스트, E2E: 실제 n8n 2.42.6과 가짜 Jira·Confluence).
- 같은 회의 레이블과 요약의 이슈가 있으면 다시 만들지 않고, 할 일이 없거나 없음인 행은 건너뛰며, 이슈 만들기는 재시도하지 않는다(오프라인·E2E).
- 운영 서버에서 실제 회의 1회로 Jira 이슈가 생기고 회의록에 링크된다(실제 운영).

## Decisions

- 2026-10-17 사용자 결정: 액션 아이템을 Jira 이슈로 만든다. 스프린트는 기한이 속한 파트 스프린트, 없으면 백로그.
- 2026-10-17 사용자 결정: Confluence 템플릿의 열 이름은 에이전트가 바꾼다.
- 2026-10-17 작업 판단: 이슈 필드, 스프린트 고르기, 다시 처리 규칙, 쓰는 순서는 결정 기록 4~7번을 따른다.
