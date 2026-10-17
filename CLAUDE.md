@AGENTS.md
@TASK.md

# Claude Code Entry Point

공통 정책은 `AGENTS.md`에서, 현재 작업의 범위와 상태는 `TASK.md`에서 가져온다.
이 파일은 Claude Code 전용 실행 규칙만 정의하며 `AGENTS.md`의 정책을 완화하지 않는다.

상위 디렉터리에 다른 프로젝트의 `AGENTS.md`나 `CLAUDE.md`가 함께 로드되더라도 이 저장소에는 적용하지 않는다.
이 저장소의 규칙은 이 파일과 저장소 루트의 `AGENTS.md`다.

## 작업 시작 순서

1. `AGENTS.md`의 공통 정책을 확인한다.
2. `TASK.md`의 범위와 GitHub Issue를 확인한다. 없으면 `templates/task-contract.md`로 초안을 만들고
   사람의 확인을 받는다.
3. 작업 유형에 맞는 Skill과 아래 문서 선택표의 해당 행만 읽는다.
4. 허용 범위와 금지 작업을 확인한 뒤 시작한다.

## 프로젝트 Skill

| Skill | 역할 |
| --- | --- |
| `/mb-commit` | 변경을 검토 목적 단위로 나눈 커밋 초안을 보여주고 승인 후 커밋 |
| `/mb-pr` | 로컬 검증, PR 초안, 승인 후 push와 PR 생성 |
| `/mb-review` | 범위, 증빙, 녹음 데이터·외부 쓰기·비용 위험 검토. 구현은 수정하지 않음 |

개인 Skill(`~/.claude/skills/harness-*`)이 같은 이름의 프로젝트 Skill보다 우선하므로 이 저장소에서는
`harness-*` 대신 위 `mb-*` Skill을 쓴다.

## 문서 선택표

현재 작업에 해당하는 행만 읽는다.

| 작업 | 읽을 문서 |
| --- | --- |
| 하네스 구조와 출처 | `docs/harness/OVERVIEW.md` |
| 기술 선택·정책 결정 | `templates/decision-record.md` |
| 녹음·외부 API 전송 범위 변경 | `AGENTS.md` 3.1, `templates/decision-record.md` |
| n8n 워크플로·서버 설정 변경 | `AGENTS.md` 3.2~3.4 |
| 운영 지표·비용 기록 | `AGENTS.md` 3.5 |

## Claude Code 명령 제한

- `.env`, `.env.*`, `secrets/`, `recordings/`를 읽지 않는다. `.claude/settings.json`에서 차단한다.
- Docker volume을 지우는 명령은 사람의 확인 없이 실행하지 않는다. `.claude/settings.json`에서 차단한다.
- Confluence, Jira, Discord, GitHub 등 외부 서비스에 쓰는 MCP 도구는 사람이 요청한 경우에만 호출한다.
- `AGENTS.md`, `CLAUDE.md`, `.claude/**`는 사람의 승인 후에만 수정한다.

## 모델 선택

저장소는 특정 모델 ID를 강제하지 않는다. 음성 인식·생성 모델의 선택과 변경은 결정 기록으로 남긴다.
