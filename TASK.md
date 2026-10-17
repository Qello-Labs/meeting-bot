# Task Contract: n8n이 회의록 템플릿을 Confluence에서 읽고 승인된 회의록을 Confluence 회의록 하위 페이지로 씀

> Generated at: `2026-10-17`
>
> 이 파일은 현재 작업 브랜치의 계약이다. 저장소 공통 정책은 `AGENTS.md`를 따른다.

## Work gate

- GitHub Issue: `#31` (#30 YouTrack 이전을 대체)
- 관련 Jira 이슈·회의록: 해당 없음
- Branch: `feat/gh-31-confluence-minutes` (worktree `~/Downloads/meeting-bot-gh31`)
- Base branch: `main` (`102d891`)

## Objective

- 회의록 템플릿을 Confluence `회의록 템플릿` 페이지에서 읽고, 승인된 회의록을 Confluence `회의록` 페이지의 하위 페이지로 쓴다.
- 같은 이름 확인, 쓰기 1회(재시도 없음), 다시 읽어 대조하는 지금 흐름과 승인 게이트는 그대로 둔다.
- 코드·문서·하네스의 ClickUp 언급을 Confluence·Jira로 바꾼다. 이력(지난 결정 기록, 지난 Issue·PR, 설계 문서의 단계 기록)은 고치지 않는다.

## Scope

1. 설계: `TASK.md`, 결정 기록 `docs/decisions/2026-10-17-gh31-confluence-minutes.md`
2. 워크플로: `scripts/build-workflow.js`, `workflows/src/*`(`shared/confluence-format.js` 추가, `clickup-*` → `minutes-*`),
   `workflows/*.json`(빌드 결과), `src/approval.js`(안내 문구), 테스트 `scripts/offline-*-test.js`, `scripts/e2e-n8n.js`, `test/e2e/*`
3. 운영 문서: `README.md`, `workflows/README.md`, `docs/design/meeting-notes.md`, `docs/assets/diagrams/*`(html, svg 라벨)
4. 하네스: `AGENTS.md`, `CLAUDE.md`, `.claude/skills/**`, `.github/ISSUE_TEMPLATE/work.yml`, `.github/PULL_REQUEST_TEMPLATE.md`,
   `templates/task-contract.md`, `scripts/preflight.py`(Atlassian 토큰 패턴 추가)
5. 실제 확인: 릴리스 배포 뒤 실제 회의 1회로 Confluence에 쓰고 대조한다.

## Explicit exclusions

- 액션 아이템의 Jira 이슈 생성(#32)
- 이미 ClickUp에 올린 회의록 이전(팀이 이미 옮김), ClickUp과 Confluence 동시 쓰기
- 지난 결정 기록(`docs/decisions/2026-10-1[13]-*`)과 병합된 Issue·PR 본문
- GIF와 실제 화면 캡처(`docs/assets/*.gif`, `docs/assets/screenshots/*`). 실제 운영 화면이 바뀐 뒤 다시 찍는다
- n8n 이미지 버전 올리기, Code 노드의 환경 변수 접근 열기
- Docker volume 삭제, 서버 접근 경로 변경, 유료 과금 설정 변경은 별도 승인 없이 하지 않는다.
- 비밀값, 토큰, `.env` 값, 녹음 파일, 녹취 원문은 기록하지 않는다.

## Data and cost impact

- 녹음·녹취 데이터 처리: 해당 없음
- 외부 API로 보내는 데이터(음성 인식, 생성 모델): 해당 없음
- 외부 서비스 쓰기: ClickUp 쓰기를 없애고 Confluence Qello 스페이스에 승인된 회의록을 쓴다
- 예상 API 호출량과 비용: 회의당 Confluence 호출 4회. OpenAI 호출 수는 그대로다. 오프라인·E2E 테스트는 가짜 서버라 비용이 없다
- 서버·n8n 설정 변경: n8n에 Atlassian Basic Auth 자격 증명 등록(사용자), 반영 뒤 ClickUp 자격 증명 삭제. `.env`와 n8n 이미지는 그대로

## Ownership

| Area (paths) | Owner | Required review |
| --- | --- | --- |
| `scripts/build-workflow.js`, `workflows/**` | n8n 워크플로 | 승인 없이 쓰는 경로가 없는지, 쓰기를 재시도하지 않는지, 같은 제목이면 멈추는지, 변환이 내용을 잃지 않는지 |
| 테스트 `scripts/offline-*`, `scripts/e2e-n8n.js`, `test/e2e/*` | n8n 워크플로 | 테스트를 지우거나 건너뛰지 않았는지 |
| `AGENTS.md`, `CLAUDE.md`, `.claude/**`, `.github/**`, `templates/*`, `scripts/preflight.py` | 하네스 | 정책이 완화되지 않았는지(외부 쓰기 승인, 비밀값 검사 범위) |
| `docs/**`, `README.md`, `TASK.md` | 문서 | 사람 리뷰 |

## Existing user-owned changes

- 작업 시작 시 `git status --short`(worktree `~/Downloads/meeting-bot-gh31`): 변경 없음.
- `~/Downloads/meeting-bot`의 #12 미커밋 변경과 `atd-work/`, `~/Downloads/meeting-bot-gh30`의 YouTrack 초안은 건드리지 않는다.

## Validation

```bash
python3 scripts/preflight.py
git diff --check
npm test
node scripts/build-workflow.js --check
npm run e2e:n8n
git grep -n -i clickup
```

## Completion criteria

- 워크플로가 Confluence 템플릿 페이지로 초안을 만들고, 승인하면 `회의록` 아래 하위 페이지를 1개 만든 뒤 다시 읽은 본문이 대조를 통과한다
  (오프라인 테스트, E2E: 실제 n8n 2.42.6과 가짜 Confluence).
- 같은 제목 페이지가 있으면 쓰지 않고, 쓰기는 재시도하지 않으며, 저장소에 토큰이 없다. ClickUp 언급은 이력 기록, 기존 화면 설명, preflight 토큰 규칙에만 남는다.
- 운영 서버에 배포한 뒤 실제 Confluence에서 템플릿을 읽고 `회의록` 아래에 1회 쓰고 대조가 통과한다(실제 운영).

## Decisions

- 2026-10-17 사용자 결정: 팀 문서가 Confluence로, 일정 관리가 Jira로 옮겨져 회의록 대상을 Confluence로 바꾼다. #30(YouTrack)은 이 Issue로 대체하고 닫는다.
- 2026-10-17 사용자 결정: Atlassian 클래식 API 토큰 1개를 n8n Basic Auth로 쓴다.
- 2026-10-17 사용자 결정: 하네스 문서(`AGENTS.md`, `CLAUDE.md`, `.claude/**` 포함)의 ClickUp 언급도 바꾼다. 정책은 완화하지 않는다.
- 2026-10-17 사용자 결정: PR은 사용자가 확인한 뒤 에이전트가 병합하고, production 배포 승인은 사용자가 GitHub에서 한다.
- 2026-10-17 작업 판단: 변환 방식, 스페이스 전체 제목 검색, 사이트 주소 상수, 대조 규칙은 결정 기록 5~8번을 따른다.
