# Task Contract: n8n이 회의 녹음을 받아 발화별 음성 인식으로 녹취 생성

> Generated at: `2026-10-11`
>
> 이 파일은 현재 작업 브랜치의 계약이다. 저장소 공통 정책은 `AGENTS.md`를 따른다.
> 상태: 2026-10-11 사용자 확인 후 구현. 단계마다 사용자 승인을 받았다.

## Work gate

- GitHub Issue: `#13`
- 관련 ClickUp 작업·회의록: 해당 없음
- Branch: `feat/gh-13-transcribe` (worktree `~/Downloads/meeting-bot-gh13`)
- Base branch: `main`

## Objective

- 녹음 봇이 보낸 manifest를 n8n이 받아 발화마다 음성 인식을 하고, 시각 순 녹취를 만든다(설계 문서 9절 5단계, 5절 B·C).
- 워크플로 원본을 코드로 두고, n8n 화면에서 고친 내용을 놓치지 않게 차이 검사 스크립트를 둔다.

## Scope

- `workflows/src/*.js`(새 파일): Code 노드 코드. manifest 형식 검사, 파일 수 확인, 녹취 조립, 알림 문구
- `scripts/build-workflow.js`(새 파일): JS 소스로 `workflows/meeting-transcribe.json`을 만든다. `--check`로 커밋된 JSON이 코드와 같은지 확인
- `workflows/meeting-transcribe.json`(새 파일, 생성물)
- `scripts/diff-workflow.js`(새 파일): n8n에서 내보낸 JSON과 저장소 JSON을 노드 단위로 비교
- `scripts/offline-workflow-test.js`(새 파일): Code 노드를 n8n 없이 순서대로 실행하는 테스트
- `package.json`: `test`를 `test:recorder`(녹음 봇)와 `test:workflow`로 나누고 `e2e:n8n`을 더한다. 녹음 봇 이미지에는 `workflows/`가 없어
  이미지 안에서는 `test:recorder`만 돈다
- `scripts/e2e-n8n.js`, `test/e2e/*`(새 파일): 실제 n8n 2.42.6과 가짜 OpenAI·Discord 서버로 끝까지 실행(Docker·openssl 필요, `npm test`에는 넣지 않음)
- `workflows/README.md`, `README.md`: 빌드, 가져오기, 차이 검사, E2E 방법
- `docs/design/meeting-notes.md`: 3절 결정 표, 5절 B·C·실패 알림(Discord 멘션 예외), 6절 외부 전송 데이터, 7절 음성 인식 단가
- `docs/decisions/2026-10-11-gh13-transcription-nodes.md`(새 파일): 음성 인식·알림 노드 결정 기록(모델 비교와 Discord 멘션 예외)

## Explicit exclusions

- 결정 메시지 수집(6단계), 초안·근거 검증(7단계), 승인(8단계), ClickUp 쓰기(9단계), 실패 알림 워크플로(10단계)
- 녹음 봇(`src/`)과 `docker-compose.yml` 변경. 필요해지면 멈추고 묻는다
- 실제 OpenAI 호출은 사용자 확인 뒤 본인 테스트 녹음으로만 한다. 노드 결정 변경과 되돌림으로 모두 3회 했다(추정 약 $0.018)
- Docker volume 삭제, 서버 접근 경로 변경, 유료 과금 설정 변경은 별도 승인 없이 하지 않는다.
- 비밀값, 토큰, `.env` 값, 녹음 파일, 녹취 원문은 기록하지 않는다.

## Data and cost impact

- 녹음·녹취 데이터 처리 변경: 녹취가 n8n 실행 기록에 남는다(7일 보관, `EXECUTIONS_DATA_MAX_AGE=168`). Discord에는 녹취 원문을 올리지 않는다.
- 외부 API로 보내는 데이터(음성 인식, 생성 모델): 발화 음성과 참석자 표시 이름(프롬프트)을 OpenAI `gpt-4o-transcribe`로 보낸다. 데이터 처리 정책은 실제 호출 전에 확인해 보고한다.
- 외부 서비스 쓰기(ClickUp, Discord): 회의 채널에 "녹취 완료, 발화 N개" 알림 1건. 개발 중 실제 Discord 쓰기는 테스트 녹음 확인 때만 한다.
- 예상 API 호출량과 비용: 운영은 회의당 발화 수만큼 호출. 테스트는 실제 호출 1회(발화 10개, 약 1분). 단가는 실제 호출 전에 확인한다. E2E는 가짜 서버라 비용 없음.
- 서버·n8n 설정 변경: 로컬 n8n에 워크플로 1개와 자격 증명(OpenAI, Discord) 추가. 서버 배포는 하지 않는다.

## Ownership

| Area (paths) | Owner | Required review |
| --- | --- | --- |
| `workflows/**`, `scripts/build-workflow.js`, `scripts/diff-workflow.js` | n8n 워크플로 | JSON에 자격 증명 값·서버 주소가 없는지, 파일 수 확인이 조용히 넘어가지 않는지 |
| `scripts/offline-workflow-test.js`, `scripts/e2e-n8n.js`, `test/e2e/*`, `package.json` | 테스트 | 기존 테스트 유지, 실제 API를 부르지 않는지 |
| `README.md`, `workflows/README.md`, `docs/design/meeting-notes.md`, `docs/decisions/*`, `TASK.md` | 문서 | 사람 리뷰 |

## Existing user-owned changes

- 작업 시작 시 `git status --short`(새 worktree): 변경 없음.
- `~/Downloads/meeting-bot`(설계 세션 #12 미커밋 변경)과 `~/Downloads/meeting-bot-wt`(참고 구현)는 건드리지 않는다.

## Validation

```bash
python3 scripts/preflight.py
git diff --check
npm test
node scripts/build-workflow.js --check
npm run e2e:n8n
docker build -t meeting-bot:gh13 . && docker run --rm meeting-bot:gh13 npm run test:recorder
```

E2E는 별도 compose 프로젝트 이름과 임시 폴더를 쓰고, 사용자 `.env`와 `recordings/`를 쓰지 않는다.

## Completion criteria

- 실제 n8n 2.42.6에 워크플로를 가져와 가짜 OpenAI·Discord 서버를 상대로 manifest 수신부터 녹취와 채널 알림까지 실행되고, 발화 파일이 없으면 조용히 끝나지 않고 실패한다 — 로컬 Docker E2E
- 본인 테스트 녹음으로 실제 OpenAI를 호출해 n8n 실행 기록에 시각 순 녹취가 남는다 — 로컬 n8n, 실제 API 1회
- n8n 화면에서 노드 설정을 바꾸고 내보내면 차이 검사 스크립트가 바뀐 노드를 찾는다 — 로컬 n8n

## Decisions

- 2026-10-11 사용자 결정: 워크플로 원본은 코드. 화면 수정은 자유, 확정 수정은 코드로 옮기고 차이 검사 스크립트를 둔다.
- 2026-10-11 사용자 결정: 실제 API 첫 호출은 본인 테스트 녹음. 그 전에 가짜 API로 실제 n8n에서 끝까지 확인한다.
- 2026-10-11 사용자 결정: 녹취는 n8n 실행 기록에만 남긴다. Discord에 녹취 원문을 올리지 않는다.
- 2026-10-11 사용자 결정: 작업 폴더는 새 worktree `~/Downloads/meeting-bot-gh13`.
- 2026-10-11 사용자 결정: Webhook은 manifest를 받자마자 응답한다. 이후 실패는 10단계 실패 알림 전까지 n8n 실행 기록에서만 보인다.
- 2026-10-11 사용자 결정: 음성 인식 재시도는 HTTP Request 노드 전체 재시도(3회, 5초 간격)와 5개씩 batching. 발화 하나가 실패해도 회의 전체 발화를 다시 보낸다.
- 2026-10-11 사용자 결정: 차이 검사는 노드 이름 기준으로 parameters, type, typeVersion, 재시도 설정, 연결만 비교한다. 위치, 내부 ID, 자격 증명 ID는 무시한다.
- 2026-10-11 사용자 결정: Discord 알림은 n8n의 Discord Bot 자격 증명(녹음 봇과 같은 토큰)으로 manifest `textChannelId`에 보낸다.
  6단계 메시지 조회도 봇 토큰이 필요해 자격 증명을 하나로 둔다. 토큰을 바꿀 때 녹음 봇 `.env`와 n8n 자격 증명을 함께 고친다.
- 2026-10-11 사용자 결정(위 결정 일부 변경): n8n 화면에서 OpenAI·Discord 노드가 아이콘으로 구분되도록 두 HTTP 노드를 n8n 전용 노드로 바꾼다.
  - 음성 인식: OpenAI 노드(`audio` → `transcribe`). 노드에 모델이 `whisper-1`로 고정돼 `gpt-4o-transcribe`와 참석자 이름 프롬프트를 쓰지 않는다. 5개씩 batching도 없어지고 발화를 차례로 보낸다. 재시도(3회, 5초)는 유지한다.
  - 알림: Discord 노드(`message` → `send`). 멘션 차단(`allowed_mentions`) 옵션이 없다. 알림 문구는 코드가 만든 회의 ID와 숫자뿐이라 설계 5절 "멘션을 끈다" 원칙의 예외로 둔다. 노드의 서버(`guildId`) 칸은 필수라 manifest 값을 넣지만, 봇 토큰 방식에서는 서버 확인 요청을 하지 않는다(OAuth2일 때만, n8n 2.42.6 코드와 E2E에서 확인).
  - 위험: Whisper는 무음·짧은 한국어 구간에서 없는 말을 지어낼 수 있다. 실제 호출 재확인 때 본다.
  - 이전 `gpt-4o-transcribe` 실제 호출 1회(성공, 녹취 13줄)는 비교 기준으로 남긴다.
- 2026-10-11 사용자 결정(바로 위 결정 중 음성 인식 되돌림): 같은 테스트 녹음으로 `whisper-1`을 실제 호출해 보니(성공, 16.6초, 녹취 13줄)
  발화 한 줄 평균 길이가 `gpt-4o-transcribe`의 약 2배(12자 → 25자)였고 Whisper가 흔히 지어내는 문구 패턴이 1줄 나왔다.
  사용자가 두 녹취를 비교한 뒤 음성 인식을 HTTP Request 노드 + `gpt-4o-transcribe`(참석자 이름 프롬프트, 5개씩 batching, 재시도 3회)로 되돌렸다.
  알림은 Discord 전용 노드를 유지한다.
- 2026-10-11 작업 판단(리뷰 필요):
  - 발화가 0개인 manifest는 실패로 처리한다. 조용히 끝나지 않게 하기 위해서다.
  - 표시 이름 자리에 Discord ID가 들어온 참석자(녹음 봇이 멤버 정보를 못 읽은 경우)는 "참석자 N"으로 바꿔 녹취와 OpenAI 프롬프트에 ID가 들어가지 않게 한다.
  - 인식된 말이 없는 발화는 녹취 줄에서 빼고 `emptyCount`로 남긴다. 알림의 발화 수는 manifest의 발화 수다.
  - 알림 문구는 `회의 <회의 ID> 녹취 완료, 발화 N개`. 회의 ID는 시작 일시라 민감정보가 아니다.
  - 파일 읽기 결과의 개수와 순서(`binary.data.fileName`)를 모두 발화 목록과 비교한다. 실제 n8n의 fileName 값은 E2E에서 확인한다.
  - Code 노드는 공용 코드 없이 노드별 파일 하나로 둔다. n8n 화면에서 노드 하나만 열어도 읽히게 하기 위해서다.
