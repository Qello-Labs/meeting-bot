# Task Contract: <TASK-TITLE>

> Generated at: `<CREATED-AT>`
>
> 이 파일은 현재 작업 브랜치의 계약이다. 저장소 공통 정책은 `AGENTS.md`를 따른다.

## Work gate

- GitHub Issue: `#<번호>` 또는 해당 없음: 사유
- 관련 ClickUp 작업·회의록: 해당 없음 또는 설명
- Branch:
- Base branch: `main`

## Objective

- TODO

## Scope

- TODO

## Explicit exclusions

- TODO
- Docker volume 삭제, 서버 접근 경로 변경, 유료 과금 설정 변경은 별도 승인 없이 하지 않는다.
- 비밀값, 토큰, `.env` 값, 녹음 파일, 녹취 원문은 기록하지 않는다.

## Data and cost impact

- 녹음·녹취 데이터 처리 변경: 해당 없음 또는 설명
- 외부 API로 보내는 데이터(음성 인식, 생성 모델): 해당 없음 또는 설명
- 외부 서비스 쓰기(ClickUp, Discord): 해당 없음 또는 설명
- 예상 API 호출량과 비용: 해당 없음 또는 설명
- 서버·n8n 설정 변경: 해당 없음 또는 설명

## Ownership

| Area (paths) | Owner | Required review |
| --- | --- | --- |
| TODO | TODO | TODO |

## Existing user-owned changes

- 작업 시작 시 `git status --short` 결과를 확인하고 여기에 기록한다.

## Validation

```bash
python3 scripts/preflight.py
git diff --check
```

## Completion criteria

<!-- Issue의 관찰 가능한 완료 조건 1~3개를 옮긴다. -->
- TODO

## Decisions

<!-- YYYY-MM-DD 사용자 결정: 내용 -->
