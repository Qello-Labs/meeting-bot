# Task Contract: 릴리스 태그를 승인하면 녹음 봇 이미지와 n8n 워크플로를 서버에 자동 배포

> Generated at: `2026-10-13`
>
> 이 파일은 현재 작업 브랜치의 계약이다. 저장소 공통 정책은 `AGENTS.md`를 따른다.
> 상태: 확정(2026-10-13 사용자 확인). 구현은 단계마다 확인받는다.

## Work gate

- GitHub Issue: `#26`
- 관련 ClickUp 작업·회의록: 해당 없음
- Branch: `chore/gh-26-release-deploy` (worktree `~/Downloads/meeting-bot-gh26`)
- Base branch: `main` (#25 병합본 `c03c016`)
- 선행: #24 수동 배포 3~5단계 완료(2026-10-13). #24의 실제 회의 확인은 이 작업과 별도로 진행한다.

## Objective

- `vX.Y.Z` 태그를 만들고 `production` 환경에서 승인하면, GitHub Actions가 arm64 녹음 봇 이미지를 GHCR에 올리고 SSH로 서버에 배포한다.
- 워크플로 JSON이 바뀐 릴리스는 n8n에 자동으로 반영하고(자격 증명 연결, Publish), 안전하지 않으면 미루고 알린다.

## Scope

- `.github/workflows/release.yml`(새 파일): 태그 → 검사 → 이미지 빌드·GHCR → `production` 승인 → SSH 배포 → GitHub Release
- `scripts/deploy/*`(새 파일): 서버 배포 스크립트(태그 검증, 회의 중 미룸, 이미지 교체, 워크플로 반영, 상태 확인, 되돌리기)
- `docker-compose.yml`: 녹음 봇을 GHCR 이미지로 실행하고 로컬 개발용 빌드는 유지
- 워크플로 반영 코드와 테스트: `scripts/*`, `scripts/e2e-n8n.js`, `test/e2e/*`, `package.json`(`npm test`에 배포 오프라인 테스트 추가)
- 결정 기록 `docs/decisions/*`: GitHub Actions의 SSH 접속(서버 접근 경로), 워크플로 완전 자동 반영
- 문서: `README.md`, `workflows/README.md`, `docs/design/meeting-notes.md`(배포 절)
- `TASK.md`

## Explicit exclusions

- 인바운드 포트 추가, 터널
- 서버 자체 러너(self-hosted runner). GitHub 문서가 공개 저장소에 쓰지 말라고 권한다
- n8n 이미지 버전 올리기, `.env` 값 자동 관리
- 녹음 봇·워크플로 동작 변경
- Docker volume 삭제, Always Free 한도를 넘는 자원
- 비밀값, 토큰, `.env` 값, 서버 주소, 녹음 파일, 녹취 원문은 기록하지 않는다. 배포 키·서버 주소·호스트 키는 GitHub `production` 환경 비밀값에만 둔다.

## Data and cost impact

- 녹음·녹취 데이터 처리: 해당 없음
- 외부 API로 보내는 데이터(음성 인식, 생성 모델): 해당 없음
- 외부 서비스 쓰기: GHCR 이미지, GitHub Release, 배포 결과 알림(보낼 곳 미정)
- 예상 API 호출량과 비용: GitHub Actions(공개 저장소)와 GHCR(공개 이미지) 비용은 확인 필요
- 서버·n8n 설정 변경: GitHub Actions가 SSH로 서버에 접속(접근 경로 변경, 결정 기록과 승인 필요), 배포 전용 계정 추가, n8n 워크플로 자동 반영

## Ownership

| Area (paths) | Owner | Required review |
| --- | --- | --- |
| `.github/workflows/release.yml`, `scripts/deploy/*` | 배포 | 승인 전에 비밀값이 쓰이지 않는지, 포크 PR에서 돌지 않는지, 배포 키로 배포 외 명령이 안 되는지, 되돌리기 |
| `docker-compose.yml` | 배포 | 포트·볼륨·비밀값 전달 범위가 그대로인지 |
| 워크플로 반영 코드, `scripts/e2e-n8n.js`, `test/e2e/*` | n8n 워크플로 | 승인 대기 실행이 있으면 미루는지, 실패하면 이전 워크플로로 되돌리는지 |
| `docs/**`, `README.md`, `workflows/README.md`, `TASK.md` | 문서 | 사람 리뷰 |

## Existing user-owned changes

- 작업 시작 시 `git status --short`(worktree `~/Downloads/meeting-bot-gh26`): 변경 없음.
- `~/Downloads/meeting-bot`에는 #12 미커밋 변경, `~/Downloads/meeting-bot-gh24`에는 #24 미커밋 변경(TASK.md, 결정 기록 3건)이 있다. 건드리지 않는다.

## Validation

```bash
python3 scripts/preflight.py
git diff --check
npm test
node scripts/build-workflow.js --check
npm run e2e:n8n
```

## Completion criteria

- 태그를 만들고 `production` 승인을 하면 서버의 녹음 봇이 그 버전 이미지로 바뀐다(실제 서버).
- 워크플로가 바뀐 릴리스는 자격 증명이 연결되고 켜진 채로 반영되고, 승인 대기 실행이 있으면 반영을 미룬다(E2E와 실제 서버).
- 이전 태그를 다시 배포하면 되돌아가고, 배포 키로는 배포 스크립트 외의 명령을 실행할 수 없다(실제 서버).

## Decisions

- 2026-10-13 사용자 결정: 배포는 GitHub Actions가 SSH로 서버에 한다(Push). 추천안(서버가 릴리스를 확인하는 Pull)과 다르다.
- 2026-10-13 사용자 결정(추천안): 녹음 봇 이미지는 GitHub Actions에서 arm64로 빌드해 GHCR에 올린다.
- 2026-10-13 사용자 결정(추천안): 릴리스는 `vX.Y.Z` 태그, GitHub Release, `production` 환경 승인으로 관리한다.
- 2026-10-13 사용자 결정: n8n 워크플로는 완전 자동으로 반영한다. 추천안(반자동)과 다르다.
- 2026-10-13 사용자 결정: #24 수동 배포 뒤에 진행한다.
- 2026-10-13 확인(n8n 2.42.6 일회용 컨테이너 실험): 공개 API 키는 `workflow:read/update/activate`, `credential:list`, `execution:list` 등
  필요한 범위만 골라 만들 수 있다. `GET /credentials`는 이름·종류를 준다. `GET /executions?status=waiting`이 된다. 켜진 워크플로에 `PUT`하면
  새 버전(versionId·activeVersionId)이 되지만 Webhook은 옛 정의로 돌고, `POST /workflows/{id}/activate` 뒤에 새 정의가 등록된다. 고치기 전부터
  기다리던 실행은 실행에 저장된 옛 정의로 재개된다. 배포 스크립트는 static data를 그대로 넣어 보내고, E2E 15회차에서 유지를 확인했다.
- 2026-10-13 사용자 결정(추천안): 워크플로는 n8n 공개 API로 반영한다(자격 증명 이름·종류로 노드에 연결 → `PUT` → `activate`). n8n을 멈추지 않는다.
  배포용 n8n API 키(범위: workflow:read/update/activate, credential:list, execution:list)를 서버에 따로 둔다.
- 2026-10-13 사용자 결정(추천안): 승인 대기 실행이 있어도 반영한다. 기다리던 실행은 옛 정의로 끝나므로, 배포 결과에 그 개수만 적는다.
  Issue #26 완료 조건 ②의 "승인 대기 실행이 있으면 미룬다"는 이 결정으로 바뀐다.
- 2026-10-13 사용자 결정(추천안): 배포 결과 알림은 GitHub(Actions 실행 기록, Release, production 배포 기록)에만 남긴다.
- 2026-10-13 사용자 결정: 첫 릴리스는 `v1.0.0`이다. 추천안(`v0.1.0`)과 다르다.
- 2026-10-13 작업 판단(3단계, 리뷰 필요): 서버 배포 폴더를 `/opt/meeting-bot`(deploy 계정 소유)로 옮긴다. compose에 `name: meeting-bot`을 고정해
  폴더를 옮겨도 같은 volume(`meeting-bot_n8n_data`, `meeting-bot_recordings`)을 쓴다. 녹음 봇 태그는 `.env`의 `RECORDER_TAG`에 배포 스크립트가 적는다
  (사람이 `docker compose up -d`를 해도 배포된 태그를 쓰게 하려는 것). 배포 스크립트는 그 태그의 내용으로 실행해, 회의 중이면 체크아웃 전에 미룬다.
- 2026-10-13 확인(3단계): 셸 스크립트 오프라인 테스트가 bash의 한글 변수 경계 문제(`"$previous로"`가 `previous` 뒤 한글 바이트까지 변수 이름으로
  읽혀 되돌리기 단계에서 죽음)를 잡았다. 한글 앞 변수를 모두 `${...}`로 감쌌다.
- 2026-10-13 작업 판단(4단계, 리뷰 필요): 릴리스 워크플로는 main에 있는 커밋의 태그만 배포하고, 같은 태그의 GHCR 이미지가 있으면 덮어쓰지 않는다.
  수동 실행(되돌리기)은 Release를 만들지 않는다. 배포가 겹치면 기다린다(concurrency, 취소 안 함). 태그 입력은 환경 변수로만 쓰고 형식을 검사한다.
  package.json 버전과 태그가 같은지는 검사하지 않는다.
- 2026-10-13 확인(4단계): actionlint 1.7.11(shellcheck 0.11.0 포함)로 release.yml과 harness.yml, shellcheck로 배포 셸 스크립트를 검사해 통과했다.
- 2026-10-13 사용자 결정(추천안): `production` 환경 승인자는 사용자 혼자이고 자기 승인을 허용한다(혼자 운영이라 Prevent self-review를 켜면 승인할 사람이 없다).
  승인 단계는 배포 전 한 번 더 확인하는 역할이다. `AGENTS.md`의 "자기 결과를 자기가 승인하지 않는다"와는 거리가 있어 남은 위험으로 적는다.
- 2026-10-13 작업 판단: 태그 push로 도는 워크플로와 배포 스크립트가 태그 커밋(main) 안에 있어야 하므로, `v1.0.0` 전에 #26 PR을 병합한다.
  순서: 5단계(서버·GitHub 설정) → 문서·커밋·PR·병합 → `v1.0.0` 릴리스와 되돌리기 확인.
- 2026-10-13 확인(5-1): 서버에 `deploy` 계정(docker 그룹)을 만들고, `~/meeting-bot`을 `docker compose down`(volume 유지)으로 내린 뒤
  `/opt/meeting-bot`(deploy 소유)에 다시 받아 `.env`를 옮기고 띄웠다. volume은 `meeting-bot_n8n_data`, `meeting-bot_recordings` 그대로이고
  두 워크플로가 켜져 있다. 예전 폴더 `~/meeting-bot`은 남겨 두었다.
- 2026-10-13 확인(5-2, 실제 서버): 진입 스크립트를 `/usr/local/bin/meeting-bot-deploy`에 설치(해시 앞 16자리 Mac 파일과 같음)하고, 배포 전용 키를
  `command=`와 `no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty`로 deploy 계정에 등록했다(`authorized_keys` 600, deploy 소유).
  Mac에서 배포 키로: `ls` → 64(거부), `deploy v1.0` → 64, `deploy v0.0.1` → 65(서버가 태그를 받아 와 없음을 확인),
  포트 포워딩 → "administratively prohibited". 완료 조건 ③의 "배포 키로는 배포 스크립트 외의 명령을 실행할 수 없다"를 확인했다.
- 2026-10-13 확인(5-3·5-4): 사용자가 서버 호스트 키 지문 대조, 배포용 n8n API 키(`.env`의 `N8N_DEPLOY_API_KEY`)를 마쳤다고 알렸다(대조 결과 값은 공유하지 않음).
  GitHub API로 `production` 환경을 조회했다: 배포 대상 `main` 브랜치·`v*` 태그, 비밀값 `DEPLOY_HOST`·`DEPLOY_KNOWN_HOSTS`·`DEPLOY_SSH_KEY`,
  승인자 `required_reviewers`(tkv00, prevent_self_review false). 처음 조회 때는 승인자 규칙이 없어(저장되지 않음) 다시 추가했다.
