# Task Contract: 봇 음성 연결이 끊기거나 재시작돼도 같은 회의로 이어서 녹음

> Generated at: `2026-10-11`
>
> 이 파일은 현재 작업 브랜치의 계약이다. 저장소 공통 정책은 `AGENTS.md`를 따른다.

## Work gate

- GitHub Issue: `#8`
- 관련 ClickUp 작업·회의록: 해당 없음
- Branch: `feat/gh-8-reconnect`
- Base branch: `main`

## Objective

- 회의 하나는 `/회의녹음 시작`부터 `/회의녹음 종료`까지 이어진다. 종료 명령 전에는 봇 연결 끊김이나 재시작 때문에 회의가 나뉘거나 사라지지 않게 한다.

## Scope

- `src/recorder.js`: 연결 감시와 재접속, 끊긴 구간 기록, 회의 상태 저장, 재시작 이어 가기
- `src/state.js`(새 파일): 상태 파일 읽기·쓰기, 끝나지 않은 회의 찾기, 재시작 순간 쓰던 발화 살리기
- `src/finalize.js`: manifest에 `gaps`를 넣고, manifest를 쓴 뒤 상태 파일을 지운다.
- `src/index.js`: 기존 5초 뒤 종료 처리를 없애고 알림 전달, 채널 삭제 시 종료, 시작할 때 끝나지 않은 회의 이어 가기
- `scripts/offline-reconnect-test.js`(새 파일), `package.json`(`test` 명령), `.github/workflows/harness.yml`(`npm test`로 실행)
- `docs/design/meeting-notes.md` 5절 A, `README.md`

## Explicit exclusions

- n8n 쪽 처리. 끊긴 구간을 회의록에 적을지는 7단계에서 정한다.
- `docker-compose.yml`과 재시작 정책(4단계)
- 녹음 범위 변경. 녹음은 여전히 시작~종료 명령 사이에서만 한다.
- Docker volume 삭제, 서버 접근 경로 변경, 유료 과금 설정 변경은 별도 승인 없이 하지 않는다.
- 비밀값, 토큰, `.env` 값, 녹음 파일, 녹취 원문은 기록하지 않는다.

## Data and cost impact

- 녹음·녹취 데이터 처리: 녹음 폴더에 상태 파일(`state.json`)이 생기고 manifest를 쓰면 지운다. manifest에 `gaps`가 추가된다.
- 외부 API로 보내는 데이터(음성 인식, 생성 모델): 해당 없음
- 외부 서비스 쓰기(ClickUp, Discord): 회의 채널에 끊김, 재접속, 재시작 이어 가기 알림이 추가된다.
- 예상 API 호출량과 비용: 해당 없음
- 서버·n8n 설정 변경: 해당 없음

## Ownership

| Area (paths) | Owner | Required review |
| --- | --- | --- |
| `src/` | 녹음 봇 | 종료 명령 전에 회의가 끝나는 경로가 채널 삭제뿐인지 |
| `scripts/offline-*.js`, `package.json`, `.github/workflows/harness.yml` | 테스트, CI | 기존 테스트를 유지하는지 |
| `docs/design/meeting-notes.md`, `README.md`, `TASK.md` | 문서 | 사람 리뷰 |

## Existing user-owned changes

- 작업 시작 시 `git status --short`: 변경 없음(최신 `main`에서 별도 작업 폴더로 시작).

## Validation

```bash
python3 scripts/preflight.py
git diff --check
npm test
docker build -t meeting-bot:check .
docker run --rm meeting-bot:check npm test
```

실제 Discord 확인(사용자): 테스트 서버에서 봇 연결 끊기, 다른 채널로 옮기기, 프로세스 강제 종료 후 재시작, 음성 채널 삭제.

## Completion criteria

- 사람이 봇의 연결을 끊거나 다른 채널로 옮겨도 같은 회의 폴더로 이어서 녹음하고, 끊긴 구간이 manifest `gaps`에 남고, 알림이 끊길 때와 다시 붙을 때 한 번씩 온다.
- 회의 중 봇 프로세스를 강제 종료하고 다시 켜면 같은 회의로 이어지고, 종료 명령 뒤 manifest 하나에 재시작 전후 발화가 모두 들어 있다.
- 음성 채널을 삭제하면 그때까지의 녹음으로 회의가 끝나고 manifest가 만들어진다.

## Decisions

- 2026-10-11 사용자 결정: 사람이 끊어도 다시 들어간다. 채널을 옮기면 옮긴 채널에서 이어 간다. 재시작하면 같은 회의로 이어 간다. 재접속은 5초부터 30초까지 간격을 늘려 종료 명령까지 계속한다.
- 2026-10-11 작업 판단(리뷰 필요): 재시작 뒤 10분이 지났으면 이어 가지 않고 그때까지의 녹음으로 마무리한다. 회의가 끝난 뒤 한참 지나 봇이 음성 채널에 들어가 녹음을 다시 시작하지 않게 하기 위해서다.
- 2026-10-11 작업 판단(리뷰 필요): 상태 파일의 마지막 기록 시각을 15초마다 갱신한다. 재시작 때 끊긴 구간의 시작은 이 시각으로 잡으므로 실제보다 최대 15초 이르게 기록될 수 있다.
- 2026-10-11 작업 판단: Ctrl+C(SIGINT)는 지금처럼 회의를 마무리한다. 컨테이너 재시작 신호(SIGTERM)는 처리하지 않아 상태 파일이 남고, 다시 켜지면 이어 간다.
