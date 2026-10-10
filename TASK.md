# Task Contract: 서버용 docker-compose 구성과 녹음 일주일 보관

> Generated at: `2026-10-11`
>
> 이 파일은 현재 작업 브랜치의 계약이다. 저장소 공통 정책은 `AGENTS.md`를 따른다.

## Work gate

- GitHub Issue: `#10`
- 관련 ClickUp 작업·회의록: 해당 없음
- Branch: `chore/gh-10-compose`
- Base branch: `main`

## Objective

- Oracle 서버에서 녹음 봇과 n8n을 함께 띄울 compose 구성을 만든다.
- 녹음 파일을 끝난 지 7일 뒤 지워 보관 기간(일주일) 결정을 지킨다.

## Scope

- `docker-compose.yml`(새 파일): 녹음 봇과 n8n 2.42.6, `127.0.0.1:5678`, 암호화 키 필수, 녹음 volume 공유(n8n 읽기 전용),
  n8n 파일 접근 제한, 실행 기록 7일, 봇 시간대 `Asia/Seoul`, `workflows/` 읽기 전용 연결
- `src/retention.js`(새 파일), `src/index.js`: 봇이 켜질 때와 하루 한 번 끝난 지 7일 지난 회의 폴더 삭제
- `scripts/offline-retention-test.js`(새 파일), `package.json`(`test` 명령)
- `workflows/README.md`(새 파일): 워크플로 JSON을 넣고 가져오는 방법
- `.dockerignore`, `README.md`
- `.env.example`에 `N8N_ENCRYPTION_KEY` 줄을 더하는 변경은 저장소 설정이 `.env.*` 접근을 막아 하지 않았다. 사용자가 직접 더하거나 별도 승인 후 한다. README와 compose 오류 메시지로 안내한다.

## Explicit exclusions

- n8n 워크플로 JSON(5단계부터)
- Oracle 인스턴스 생성과 실제 서버 배포(10단계)
- 녹음 범위 변경
- Docker volume 삭제, 서버 접근 경로 변경, 유료 과금 설정 변경은 별도 승인 없이 하지 않는다.
- 비밀값, 토큰, `.env` 값, 녹음 파일, 녹취 원문은 기록하지 않는다.

## Data and cost impact

- 녹음·녹취 데이터 처리: 끝난 지 7일이 지난 회의 폴더를 자동으로 지운다. 끝나지 않은 회의(상태 파일만 있는 폴더)는 지우지 않는다.
  n8n 실행 기록도 7일 뒤 지운다.
- 외부 API로 보내는 데이터(음성 인식, 생성 모델): 해당 없음
- 외부 서비스 쓰기(ClickUp, Discord): 해당 없음
- 예상 API 호출량과 비용: 해당 없음
- 서버·n8n 설정 변경: 서버 실행 구성을 새로 정한다. 인바운드 포트는 열지 않는다.

## Ownership

| Area (paths) | Owner | Required review |
| --- | --- | --- |
| `docker-compose.yml`, `.dockerignore` | 배포 | n8n이 밖으로 열리지 않는지, 비밀값이 없는지 |
| `src/retention.js`, `src/index.js` | 녹음 봇 | 지우는 대상이 끝난 지 7일 지난 회의 폴더뿐인지 |
| `scripts/offline-retention-test.js`, `package.json` | 테스트 | 기존 테스트 유지 |
| `workflows/README.md`, `README.md`, `TASK.md` | 문서 | 사람 리뷰 |

## Existing user-owned changes

- 작업 시작 시 `git status --short`: 변경 없음. 저장소 폴더에 사용자 `.env`와 테스트 녹음(`recordings/`)이 있으며 Git이 무시한다. 둘 다 건드리지 않는다.

## Validation

```bash
python3 scripts/preflight.py
git diff --check
npm test
docker compose config
```

compose 동작은 사용자 `.env`를 쓰지 않도록 임시 env 파일과 별도 프로젝트 이름으로 확인한다. 녹음 봇은 가짜 토큰이라 Discord에 접속하지 않는다.

## Completion criteria

- 로컬에서 두 컨테이너가 뜨고, n8n은 `127.0.0.1:5678`에만 열리며, `N8N_ENCRYPTION_KEY`가 없으면 시작이 거부된다.
- 녹음 봇 컨테이너에서 `http://n8n:5678`에 닿고, n8n 컨테이너는 `/recordings`를 읽을 수 있지만 쓸 수 없다.
- 끝난 지 7일이 지난 회의 폴더만 지워지고, 7일 안의 회의와 끝나지 않은 회의는 남는다.

## Decisions

- 2026-10-11 사용자 결정: 녹음 일주일 보관은 녹음 봇이 켜질 때와 하루 한 번 지운다.
- 2026-10-11 사용자 결정: 녹음 봇 컨테이너 시간대는 `Asia/Seoul`.
- 2026-10-11 사용자 결정: `workflows/`를 지금 n8n에 읽기 전용으로 연결한다.
- 2026-10-11 작업 판단: 지우는 폴더는 회의 ID 형식(`YYYYMMDD-HHMM`)인 것만 본다. 녹음 폴더에 다른 폴더가 있어도 지우지 않는다.
  manifest가 있으면 그 안의 종료 시각으로, manifest와 상태 파일이 둘 다 없으면(시작에 실패한 회의) 폴더 수정 시각으로 7일을 잰다.
