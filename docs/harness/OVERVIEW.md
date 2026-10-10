# Harness Overview

## 목적

AI 에이전트로 미팅봇을 만들 때 작업 범위, 검증 증거, 녹음 데이터·외부 쓰기·서버 노출 경계, 사람 승인이
사라지지 않게 하는 저장소 운영 체계다.

## 구성

하네스는 에이전트가 행동하기 전에 방향을 주는 **가이드**와 행동한 뒤 결과를 확인하는 **센서**로 나뉜다.

| 층 | 구성 | 종류 | 현재 상태 |
| --- | --- | --- | --- |
| 업무 게이트 | GitHub Issue, `TASK.md`, 작업 브랜치 | 가이드 | 문서 규칙 |
| 에이전트 계약 | `AGENTS.md`, `CLAUDE.md`, `.claude/skills/mb-*` | 가이드 | 문서 규칙 |
| 증거 양식 | `templates/*`, PR 템플릿, Issue 폼 | 가이드 | 템플릿 |
| 기계 검사 | `scripts/preflight.py` — `.env`·녹음 파일 추적, 토큰·Webhook URL 패턴 검사 | 센서 | 로컬 수동 실행 + CI |
| 읽기·명령 차단 | `.claude/settings.json` deny — `.env`, `secrets/`, `recordings/` 읽기, Docker volume 삭제 | 센서 | Claude Code가 자동 적용 |
| CI | `.github/workflows/harness.yml` — PR과 `main` push에서 preflight, 녹음 봇 오프라인 테스트, PR diff 공백 검사 | 센서 | GitHub Actions |
| 강제 장치 | `main` 브랜치 보호 규칙(필수 검사 `Harness / checks`) | 센서 | 없음. GitHub 설정에서 사람이 켠다 |

브랜치 보호 규칙을 켜기 전에는 CI가 실패해도 병합을 막지 못한다.

## 출처

`Qello-Labs/qello-knowledge`의 하네스(`main`, 2026-10-10 기준)와 `chore/harness-speckit-setup` 브랜치의
`.github/workflows/harness.yml`에서 가져와 이 저장소에 맞게 고쳤다.

| 이 저장소 | 원본 | 고친 점 |
| --- | --- | --- |
| `AGENTS.md` | `AGENTS.md` | ClickUp 작업 게이트를 GitHub Issue로 바꿈. 3절 RAG 규칙을 미팅봇 규칙(녹음·외부 전송, 워크플로 원칙, 외부 쓰기, 서버·n8n, 수치·비용)으로 바꿈. 결과 계약에서 인덱스·평가 필드 제거 |
| `CLAUDE.md` | `CLAUDE.md` | Spec Kit 규칙 제거. 상위 디렉터리 지침 비적용 문구, Skill 이름 충돌 안내 추가 |
| `.claude/settings.json` | 같은 파일 | Spec Kit 훅 제거. `recordings/` 읽기와 Docker volume 삭제 명령 차단 추가 |
| `scripts/preflight.py` | 같은 파일 | Discord 봇 토큰·Webhook URL, ClickUp 토큰, `TOKEN`·`ENCRYPTION_KEY` 환경 변수 규칙 추가. 오디오 파일과 `recordings/` 추적 검사 추가. 이 저장소에서 쓰지 않는 Notion·Figma·AWS·Slack·Postgres 규칙 제거 |
| `templates/task-contract.md` | 같은 파일 | ClickUp·명세 ID를 Issue로 바꾸고 데이터·비용 영향을 녹음·외부 API·외부 쓰기·서버 항목으로 바꿈 |
| `templates/decision-record.md` | 같은 파일 | 팀 동의 범위, 회의당 비용 항목 추가 |
| `.github/ISSUE_TEMPLATE/work.yml` | 같은 파일 | ClickUp·명세·스프린트 필수 입력 제거. 작업 종류에 `ops`, 영역 선택, 데이터·외부 서비스·비용 영향 추가 |
| `.github/PULL_REQUEST_TEMPLATE.md` | 같은 파일 | ClickUp 역링크 항목 제거. 녹음·n8n 자격 증명·결정 기록 확인 항목 추가 |
| `.github/workflows/harness.yml` | `chore/harness-speckit-setup` 브랜치의 같은 파일 | 로드맵 기반 Issue 폼 동기화 검사 제거. PR diff 공백 검사 추가 |
| `.claude/skills/mb-commit` | `harness-commit` | 이름 변경. 분할 축과 scope를 미팅봇 처리 단계로 바꿈. 평가 세트 규칙 제거 |
| `.claude/skills/mb-pr` | `harness-pr` | 이름 변경. ClickUp 연결·역링크 단계 제거. 오프라인 테스트 실행 추가 |
| `.claude/skills/mb-review` | `harness-review` | 이름 변경. 평가 항목을 녹음·워크플로·서버 확인 항목으로 바꿈 |

Skill 이름을 `harness-*`에서 `mb-*`로 바꾼 이유: Claude Code는 같은 이름의 Skill이 있으면 개인 Skill
(`~/.claude/skills/`)을 프로젝트 Skill보다 우선한다. 작성자 PC에 다른 저장소용 `harness-*` 개인 Skill이 있어
같은 이름을 쓰면 이 저장소의 규칙이 적용되지 않는다.

## 가져오지 않은 것

| 원본 | 이유 |
| --- | --- |
| `.specify/`, `speckit-*` Skill, 명세 ID 훅 | 이 저장소는 로드맵 명세 백로그가 없다. 필요해지면 따로 도입한다 |
| `CODEX.md`, `.codex/`, `.agents/` | 지금은 Claude Code만 쓴다. Codex를 쓰게 되면 원본의 Codex 대응표를 따른다 |
| `docs/github-workflow.md` | ClickUp이 계획 원본인 팀 절차다. 이 저장소는 GitHub Issue가 계획 원본이라 `AGENTS.md` 1·5절로 대신한다 |
| `templates/eval-report.md` | RAG 검색·생성 평가 양식이다. 회의록 품질 평가가 필요해지면 새로 쓴다 |
| `scripts/sync_issue_form.py`, `scripts/roadmap*.py` | 로드맵 백로그와 Issue 폼을 맞추는 도구다 |
| `docs/sdd/` | Qello Knowledge 전용 명세·조사 문서다 |

## 다음 단계

1. GitHub 저장소 설정에서 `main` 브랜치 보호 규칙을 켜고 필수 검사로 `Harness / checks`를 지정한다.
2. n8n 워크플로 JSON이 들어오면 자격 증명 값·Webhook 경로 검사를 preflight에 추가한다.
3. `TASK.md` Ownership 경로와 실제 변경 파일을 비교하는 검사.
