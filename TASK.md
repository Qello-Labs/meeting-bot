# Task Contract: n8n이 템플릿·녹취·결정 메시지로 회의록 초안을 쓰고 근거를 검증

> Generated at: `2026-10-11`
>
> 이 파일은 현재 작업 브랜치의 계약이다. 저장소 공통 정책은 `AGENTS.md`를 따른다.
> 상태: 확정(2026-10-11 사용자 확인). 구현은 진행 순서의 단계마다 확인받는다.

## Work gate

- GitHub Issue: `#17`
- 관련 ClickUp 작업·회의록: 해당 없음
- Branch: `feat/gh-17-draft-notes` (worktree `~/Downloads/meeting-bot-gh17`)
- Base branch: `main` (#16 병합본)

## Objective

- 회의 녹취 워크플로에 회의록 초안 작성과 근거 검증을 더한다(설계 문서 9절 7단계, 5절 E·F).
- LLM은 템플릿을 채우는 데만 쓰고, 고정 필드와 근거 검증은 코드가 한다(`AGENTS.md` 3.2).

## Scope

- `workflows/src/*.js`: 초안 요청 만들기, 초안 검증 Code 노드(새 파일). 알림 만들기에 초안 결과 개수를 더한다
- `scripts/build-workflow.js`, `workflows/meeting-transcribe.json`(생성물): 템플릿 읽기(HTTP, ClickUp v3)와 초안 작성(HTTP, OpenAI Responses API) 노드 추가
- `scripts/diff-workflow.js`: 화면 저장 때 빠지는 기본값이 새로 보이면 표에 더한다
- `scripts/offline-workflow-test.js`: 요청 형식, 고정 필드 덮어쓰기, 구조·근거 검증, 날짜·명세 ID 정리, 잘림·거절 처리
- `scripts/e2e-n8n.js`, `test/e2e/*`: 가짜 ClickUp·OpenAI(Responses API) 서버
- `docs/decisions/`(새 파일): 회의록 초안 모델(OpenAI로 녹취·결정 메시지를 보냄)의 결정 기록(데이터 처리 정책 포함)
- `workflows/README.md`, `README.md`, `docs/design/meeting-notes.md`(5절 E·F `[확인 필요]` 해소, 3절, 7절 비용)

## Explicit exclusions

- Discord 초안 표시와 승인 버튼(8단계), ClickUp 쓰기와 "지난 회의 끝 시각" 갱신(9단계), 실패 알림 워크플로(10단계)
- 녹음 봇(`src/`)과 `docker-compose.yml` 변경. 필요해지면 멈추고 묻는다
- 실제 GPT 호출과 실제 ClickUp 조회는 사용자 확인 뒤 테스트 녹음·테스트 채널로만 한다
- Docker volume 삭제, 서버 접근 경로 변경, 유료 과금 설정 변경은 별도 승인 없이 하지 않는다.
- 비밀값, 토큰, `.env` 값, 녹음 파일, 녹취 원문, 채팅 원문, 참석자 ID, 회의록 초안 원문은 기록하지 않는다.

## Data and cost impact

- 녹음·녹취 데이터 처리 변경: 회의록 초안이 n8n 실행 기록에 7일 남는다.
- 외부 API로 보내는 데이터(음성 인식, 생성 모델): 템플릿, 녹취, 결정 메시지(작성자 표시 이름, 내용, 링크), 참석자 이름을 OpenAI
  (`gpt-6-luna`, Responses API, `store: false`)로 보낸다. 공식 정책상 학습에 쓰지 않고, 오남용 감시 로그는 최대 30일 보관한다. `store: false`라
  응답 저장(기본 30일)은 하지 않는다. 설계 6절은 이 데이터를 Anthropic으로 보낸다고 적었으므로 제공자 변경을 결정 기록으로 남긴다.
- 외부 서비스 쓰기(ClickUp, Discord): ClickUp은 읽기만 한다. Discord 알림 문구에 초안 결과 개수가 더해진다.
- 예상 API 호출량과 비용: 회의당 GPT 1회. `gpt-6-luna`($0.10/$0.50 per 1M)로 입력 2만~3만, 출력 최대 3만 토큰이면 회의당 약 $0.02(추정, 측정값 아님).
  테스트 실제 호출 2~3회, 합계 $0.1 이하 예상.
  실제 확인 때 음성 인식을 다시 부르면 1회 약 $0.006. E2E는 가짜 서버라 비용 없음.
- 서버·n8n 설정 변경: n8n에 ClickUp 자격 증명을 추가한다(사용자 등록). OpenAI 자격 증명은 음성 인식과 같은 것을 쓴다.

## Ownership

| Area (paths) | Owner | Required review |
| --- | --- | --- |
| `workflows/**`, `scripts/build-workflow.js`, `scripts/diff-workflow.js` | n8n 워크플로 | 근거가 틀린 초안이 멈추는지, 고정 필드를 코드가 덮어쓰는지, 녹취·채팅 문장을 지시로 따르지 않게 하는지, 잘림·거절·조회 실패가 조용히 넘어가지 않는지 |
| `scripts/offline-workflow-test.js`, `scripts/e2e-n8n.js`, `test/e2e/*` | 테스트 | 기존 테스트 유지, 실제 API를 부르지 않는지 |
| `docs/decisions/*`, `README.md`, `workflows/README.md`, `docs/design/meeting-notes.md`, `TASK.md` | 문서 | 사람 리뷰 |

## Existing user-owned changes

- 작업 시작 시 `git status --short`(새 worktree): 변경 없음.
- `~/Downloads/meeting-bot`(설계 세션 #12 미커밋 변경), `~/Downloads/meeting-bot-wt`(참고 구현), `~/Downloads/meeting-bot-gh15`(병합된 6단계)는 건드리지 않는다.

## Validation

```bash
python3 scripts/preflight.py
git diff --check
npm test
node scripts/build-workflow.js --check
npm run e2e:n8n
```

E2E는 별도 compose 프로젝트 이름과 임시 폴더를 쓰고, 사용자 `.env`와 `recordings/`를 쓰지 않는다.

## Completion criteria

- 가짜 ClickUp·OpenAI 서버로 실제 n8n에서 템플릿 읽기부터 초안 검증과 알림까지 실행되고, 근거가 틀린 초안(녹취에 없는 시각,
  수집하지 않은 링크, 근거로 쓰이지 않은 ✅ 메시지, 구조 변경)은 멈춘다 — 오프라인 테스트, 로컬 Docker E2E
- 응답 잘림(`incomplete`), 거절(`refusal`), 템플릿 조회 실패는 조용히 끝나지 않고 실행이 실패한다 — 로컬 Docker E2E
- 실제 템플릿과 테스트 녹음·테스트 채널 메시지로 실제 GPT를 불러 초안이 실행 기록에 남고 검증 결과가 알림에 나온다 — 로컬 n8n

## Decisions

- 2026-10-11 사용자 결정: 템플릿의 워크스페이스·문서·페이지 ID는 워크플로 코드 상수로 둔다.
- (아래 OpenAI 전환으로 대체됨) 2026-10-11 사용자 결정: Claude는 HTTP Request 노드로 부른다. n8n 2.42.6 Anthropic 노드는 effort와 거절 대비 설정을 넣을 수 없고,
  ClickUp 노드에는 문서 기능이 없다(노드 코드에서 확인).
- (OpenAI 전환으로 대체됨) 2026-10-11 사용자 결정: 거절 대비 `fallbacks: "default"`(beta `server-side-fallback-2026-07-01`)를 켠다. cyber·frontier_llm 거절만
  Claude Sonnet 5로 다시 돌리고, 그 밖의 거절은 실패로 멈춘다.
- 2026-10-11 사용자 결정: 검증이 실패하면 회의 채널에는 오류 종류별 개수만 알리고 목록은 실행 기록에 남긴다.
- 2026-10-11 사용자 결정: 작업 폴더는 새 worktree `~/Downloads/meeting-bot-gh17`.
- 2026-10-11 사용자 결정: 초안 검증이 실패하면 실행은 성공으로 끝내고 회의 채널에 오류 종류별 개수를 알린다. 8단계(승인)로 넘기지 않게
  `draftOk: false`로 표시한다. API 오류(잘림, 거절, 템플릿 조회 실패)는 실행을 실패시킨다.
- 2026-10-11 사용자 결정: 수집한 ✅ 메시지가 없을 때만 `결정 사항`의 `*   없음` 한 줄을 근거 없이 허용한다.
- 2026-10-11 사용자 결정: 근거의 녹취 시각은 발화 줄의 `[HH:MM:SS]`와 정확히 같아야 한다. 녹음 끊김 줄의 시각은 근거가 될 수 없다.
- 2026-10-11 사용자 결정(설계 상세): 구조 기준은 실행 때 읽은 템플릿에서 뽑는다(`##` 제목 이름·순서, 필드 표 첫 열, 액션 아이템 표
  머리글). 고정 필드(일시=회의 시작의 한국 날짜, 회의 종류=`정기 회의`, 참석자=manifest 이름)는 코드가 덮어쓴다. 근거 링크는 수집한 결정
  메시지 링크와 정확히 같아야 하고, 수집한 ✅ 메시지는 모두 근거로 쓰여야 한다. 기한·다음 회의 일시가 `YYYY-MM-DD`가 아니면 지우고, 입력에
  없는 명세 ID는 지우고 기록한다. 응답이 코드 블록으로 감싸여 있으면 벗긴다.
- (OpenAI 전환으로 대체됨) 2026-10-11 사용자 결정(요청 형식): `claude-sonnet-5-5`, `output_config.effort: "high"`, `max_tokens: 16000`, thinking 생략(adaptive),
  샘플링 파라미터 없음, 응답은 `type === "text"` 블록을 읽고 `stop_reason`이 `end_turn`이 아니면 멈춘다(Claude API 참조 문서 2026-10-06 판과 대조).
- (OpenAI 전환으로 대체됨) 2026-10-11 사용자 결정(보완): 거절 여부는 `stop_reason`으로만 판단한다. `stop_details`는 거절일 때도 `null`일 수 있어 범주는 기록에만 쓴다.
  대체 모델로 넘어갔는지(응답의 `fallback` 블록)와 응답한 모델(`model`)을 실행 기록에 남긴다.
- 2026-10-11 사용자 결정: 초안 모델을 OpenAI로 바꾼다("GPT로 통일"). 4번 실제 확인에서 Anthropic API 크레딧이 없어 400이 났고(Claude Code
  클라우드 세션 크레딧은 API에 쓸 수 없다), 음성 인식에 이미 OpenAI를 쓰고 있어 제공자를 하나로 줄인다.
  - 모델: `gpt-6-luna`(사용자가 저가형을 골랐다. 추천안은 `gpt-6.1-sol`이었다). 형식을 어긴 초안은 검증 코드가 멈추고, 품질은 실제 호출로 본다.
  - 노드: HTTP Request + OpenAI 자격 증명(음성 인식과 같은 방식), `POST /v1/responses`.
  - 요청: `reasoning.effort: "high"`(지난 결정 유지), `max_output_tokens: 32000`(생각 토큰 포함, OpenAI 권장 25,000 이상), `store: false`
    (응답 30일 저장을 끈다), 샘플링 파라미터 없음. OpenAI에는 서버 쪽 대체 모델이 없어 fallbacks는 뺀다.
  - 응답: `status`가 `completed`가 아니면(`incomplete`의 `max_output_tokens`·`content_filter` 포함) 실행을 실패시킨다. 메시지 안에 `refusal`이
    있으면 실패시킨다. `phase`가 `commentary`인 메시지는 빼고 `output_text`를 읽는다. 응답 모델과 토큰 수를 실행 기록에 남긴다.
