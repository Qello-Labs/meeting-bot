# Task Contract: 녹음 봇 코드를 저장소로 이전

> Generated at: `2026-10-11`
>
> 이 파일은 현재 작업 브랜치의 계약이다. 저장소 공통 정책은 `AGENTS.md`를 따른다.

## Work gate

- GitHub Issue: `#5`
- 관련 ClickUp 작업·회의록: 해당 없음
- Branch: `chore/gh-5-move-recorder`
- Base branch: `main`

## Objective

- 저장소 밖(`~/Desktop/meeting-recorder`)에 있던 녹음 봇 코드를 저장소로 옮긴다. 녹음 동작은 바꾸지 않는다.
- 이후 단계(설계 문서 9절)를 Issue, 브랜치, PR로 진행할 수 있게 한다.

## Scope

- `src/` 5개 파일(`commands.js`, `deploy-commands.js`, `finalize.js`, `index.js`, `recorder.js`)
- `scripts/offline-test.js`, `package.json`, `package-lock.json`, `Dockerfile`, `.dockerignore`, `.env.example`
- `README.md`: 원래 README의 봇 설치·사용 설명을 합친다.
- `.github/workflows/harness.yml`: Node 24, ffmpeg, `npm ci`, 오프라인 테스트 단계를 추가한다.
- `scripts/offline-test.js`: 결과를 출력만 해서 CI에서 실패를 잡지 못하므로, 발화 수와 길이를 확인하는 검사를 추가한다(작업 판단, 리뷰 필요).
- `docs/harness/OVERVIEW.md`: 다음 단계 목록에서 CI 오프라인 테스트 항목을 완료로 옮긴다.
- 2026-10-10 사용자 결정에 따른 변경 세 가지
  - DAVE 로그는 프로토콜 버전만 남기고 음성 개인정보 보호 코드 출력은 뺀다.
  - CI에 오프라인 테스트를 추가한다.
  - 패키지 이름을 `meeting-recorder`에서 `meeting-bot`으로 바꾼다.

## Explicit exclusions

- 원래 폴더의 `docs/`(다이어그램, 생성 스크립트), `node_modules/`, `.DS_Store`, `.gitignore`
- `docker-compose.yml`: 4단계(compose 보완)에서 다룬다.
- 자동 재접속: 3단계에서 다룬다.
- 녹음 로직 변경
- Docker volume 삭제, 서버 접근 경로 변경, 유료 과금 설정 변경은 별도 승인 없이 하지 않는다.
- 비밀값, 토큰, `.env` 값, 녹음 파일, 녹취 원문은 기록하지 않는다.

## Data and cost impact

- 녹음·녹취 데이터 처리: 해당 없음. 동작을 바꾸지 않는다.
- 외부 API로 보내는 데이터(음성 인식, 생성 모델): 해당 없음
- 외부 서비스 쓰기(ClickUp, Discord): 해당 없음
- 예상 API 호출량과 비용: 해당 없음. CI 실행 시간이 늘어난다.
- 서버·n8n 설정 변경: 해당 없음

## Ownership

| Area (paths) | Owner | Required review |
| --- | --- | --- |
| `src/`, `scripts/offline-test.js`, `package*.json` | 녹음 봇 | 이전 전후 동작이 같은지 |
| `Dockerfile`, `.dockerignore`, `.env.example` | 배포 | 비밀값이 없는지, arm64 빌드 |
| `.github/workflows/harness.yml` | CI | 기존 검사를 유지하는지 |
| `README.md`, `TASK.md`, `docs/harness/OVERVIEW.md` | 문서 | 사람 리뷰 |

## Existing user-owned changes

- 작업 시작 시 `git status --short`: 변경 없음(최신 `main`에서 별도 작업 폴더로 시작).
- 원래 폴더의 `src/recorder.js`에는 1단계(#4) 검증용 DAVE 로그가 들어 있다. 2026-10-11 회의 테스트에 쓰므로 원래 폴더는 고치지 않는다.

## Validation

```bash
python3 scripts/preflight.py
git diff --check
npm ci
node scripts/offline-test.js
docker build -t meeting-bot:check .
docker run --rm meeting-bot:check node scripts/offline-test.js
```

## Completion criteria

- 저장소에서 `npm ci` 뒤 `node scripts/offline-test.js`가 통과한다.
- arm64 Docker 이미지가 빌드되고 이미지 안에서 오프라인 테스트가 통과한다.
- CI에서 preflight와 오프라인 테스트가 통과한다.

## Decisions

- 2026-10-10 사용자 결정: DAVE 로그는 프로토콜 버전만 남긴다.
- 2026-10-10 사용자 결정: CI에 오프라인 테스트를 추가한다.
- 2026-10-10 사용자 결정: 패키지 이름을 `meeting-bot`으로 바꾼다.
- 2026-10-10 사용자 결정: 1단계(#4)는 2026-10-11 회의에서 확인하고, 그 전에는 성공을 가정하고 진행한다.
