# Task Contract: README 개편과 다이어그램·실제 화면 추가

> Generated at: `2026-10-13`
>
> 이 파일은 현재 작업 브랜치의 계약이다. 저장소 공통 정책은 `AGENTS.md`를 따른다.
> 상태: 초안(사용자 확인 전).

## Work gate

- GitHub Issue: 해당 없음: 코드와 서비스 동작을 바꾸지 않는 문서 작업이다(README와 문서용 이미지만 바꾼다)
- 관련 ClickUp 작업·회의록: 해당 없음
- Branch: `docs/readme` (worktree `~/Downloads/meeting-bot-readme`)
- Base branch: `main` (`e018456`)

## Objective

- 처음 보는 개발자가 README만으로 개발 배경, 설계 판단, 시스템 구조, 실제 동작을 이해하게 한다.

## Scope

- `README.md`
- `docs/assets/**`: 배너 GIF, 다이어그램 원본(HTML)과 SVG, 실제 운영 화면 캡처
- `TASK.md`

## Explicit exclusions

- 코드, n8n 워크플로, compose, CI, 설계 문서와 결정 기록
- GitHub Pages 등 저장소 설정 변경
- Docker volume 삭제, 서버 접근 경로 변경, 유료 과금 설정 변경은 별도 승인 없이 하지 않는다.
- 비밀값, 토큰, `.env` 값, 녹음 파일, 녹취 원문은 기록하지 않는다.

## Data and cost impact

- 녹음·녹취 데이터 처리 변경: 해당 없음
- 외부 API로 보내는 데이터(음성 인식, 생성 모델): 해당 없음
- 외부 서비스 쓰기(ClickUp, Discord): 해당 없음
- 예상 API 호출량과 비용: 해당 없음
- 서버·n8n 설정 변경: 해당 없음
- 공개 범위: 실제 운영 캡처에 사용자 표시 이름, ClickUp 페이지 주소, 로컬 녹음 경로가 보인다. 사용자가 그대로 쓰기로 했다.

## Ownership

| Area (paths) | Owner | Required review |
| --- | --- | --- |
| `README.md`, `docs/assets/**` | 문서 | README 내용이 코드·설계 문서와 맞는지, 캡처에 비밀값이 없는지 |
| `TASK.md` | 문서 | 사람 리뷰 |

## Existing user-owned changes

- 작업 시작 시 `git status --short`(worktree `~/Downloads/meeting-bot-readme`): 변경 없음.
- `~/Downloads/meeting-bot`의 #12 미커밋 변경은 건드리지 않는다.
- `README.md`, `docs/assets/banner.gif`, `docs/assets/sequece.gif`는 작업 중 사용자가 직접 고치거나 바꿨다.

## Validation

```bash
python3 scripts/preflight.py
git diff --check
```

다이어그램은 diagram-design 스킬의 `self_check.py`와 `export_svg.py`로 확인한다.

## Completion criteria

- README의 이미지와 문서 링크, 목차 앵커가 모두 열린다.
- README의 설명이 코드와 설계 문서와 맞는다.
- preflight, `git diff --check`, CI가 통과한다.

## Decisions

- 2026-10-13 사용자 결정: README는 표와 설명을 줄이고 다이어그램과 실제 운영 화면 중심으로 쓴다.
- 2026-10-13 사용자 결정: 실제 운영 캡처를 README에 넣는다. 첨부 HTML은 GitHub에서 페이지로 열리지 않아 넣지 않는다.
