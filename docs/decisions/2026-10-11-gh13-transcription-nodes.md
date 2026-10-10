# Decision Record: 회의 녹취 워크플로의 음성 인식·알림 노드

> Created at: `2026-10-11`
> GitHub Issue: `#13`
> Status: Accepted (사용자 결정, 2026-10-11)

## Context

5단계 회의 녹취 워크플로를 n8n 화면에서 볼 때, 외부 서비스를 부르는 노드가 OpenAI·Discord 아이콘으로 구분되기를 사용자가 원했다.
처음 구현은 두 노드 모두 HTTP Request 노드였다. n8n 2.42.6의 전용 노드(OpenAI, Discord)는 아이콘이 나오지만 API 기능을 일부만 노출한다.
녹취의 `[HH:MM:SS]` 시각과 내용은 7단계에서 회의록 결정의 근거가 되므로 음성 인식 품질이 중요하다.

## Decision

음성 인식은 HTTP Request 노드로 `gpt-4o-transcribe`를 부르고, 회의 채널 알림은 Discord 전용 노드로 보낸다.

## Rationale

- n8n 2.42.6 OpenAI 노드의 음성 인식(`audio` → `transcribe`)은 코드에 모델이 `whisper-1`로 고정돼 있고 프롬프트 옵션이 없다.
  `gpt-4o-transcribe`와 참석자 이름 프롬프트를 쓸 수 없다.
- 같은 테스트 녹음으로 두 모델을 실제 호출해 비교한 뒤 사용자가 `gpt-4o-transcribe`를 골랐다(Evidence).
- Discord 노드는 알림 문구만 보내는 이 단계에서는 기능이 충분하고 화면에서 아이콘으로 구분된다.

## Alternatives considered

| Alternative | Advantages | Disadvantages | Reason not selected |
| --- | --- | --- | --- |
| 두 노드 모두 HTTP Request + 스티커 메모 | 동작 변화 없음, 멘션 차단 유지 | 아이콘이 아니라 메모로만 구분 | 사용자가 아이콘 표시를 원함 |
| 두 노드 모두 전용 노드 | 둘 다 아이콘 | 음성 인식이 `whisper-1` 고정, 이름 프롬프트 없음 | 실제 비교에서 `whisper-1` 녹취가 더 나빴다고 사용자가 판단 |
| 노드 이름에 이모지 | 동작 변화 없음 | 아이콘이 아님 | 사용자가 아이콘 표시를 원함 |

## Evidence

- 노드 코드(n8n 2.42.6 이미지 안 `@n8n/n8n-nodes-langchain` OpenAi `v2/actions/audio/transcribe.operation.js`): `const model = 'whisper-1'`,
  옵션은 언어와 temperature뿐.
- 노드 코드(`n8n-nodes-base` Discord `v2`): 봇 토큰 방식의 주소는 `https://discord.com/api/v10` 고정, 보내는 본문은 `content`와
  flags·tts·답장 옵션뿐이고 `allowed_mentions`가 없다. 서버 확인 요청(`GET /users/@me/guilds`)은 OAuth2일 때만 한다.
- 실제 호출(로컬 n8n 2.42.6, 본인 테스트 녹음 1개: 발화 10개, 끊긴 구간 3개, 약 1분). 실행 기록에서 숫자만 뽑았고 녹취 원문은 보지 않았다.

  | 회차 | 음성 인식 | 상태 | 시간 | 녹취 줄(끊김) | 발화 한 줄 평균 | Whisper가 흔히 지어내는 문구 패턴 |
  | --- | --- | --- | --- | --- | --- | --- |
  | 1 | HTTP + `gpt-4o-transcribe` | success | 4.2초 | 13 (3) | 12자 | 0줄 |
  | 2 | OpenAI 노드 (`whisper-1`) | success | 16.6초 | 13 (3) | 25자 | 1줄 |
  | 3 | HTTP + `gpt-4o-transcribe` (최종 구성) | success | 3.0초 | 13 (3) | 12자 | 0줄 |

  사용자가 n8n 화면에서 1·2회차 녹취를 직접 비교한 뒤 `gpt-4o-transcribe`로 되돌렸다. 녹음 1개의 비교라 일반화하지 않는다.
- E2E(가짜 API, 오프라인): 재시도 확인에서 발화 6개 중 요청 1건 실패 시 HTTP 노드(batching)는 요청 12건, OpenAI 노드(차례로 보냄)는 7건.
- 단가와 정책(2026-10-11 조회, 공식 문서를 웹으로 가져와 확인):
  - <https://developers.openai.com/api/docs/pricing>: `gpt-4o-transcribe` 추정 $0.006/분, `whisper-1`(Whisper) $0.006/분
  - <https://developers.openai.com/api/docs/guides/your-data>: API 데이터는 기본으로 학습에 쓰지 않는다. `/v1/audio/transcriptions`는
    표에서 오남용 감시 보존 None, 일반 문구는 오남용 감시 로그 최대 30일. 지역 처리는 미국·유럽만.

## Data and cost

- 외부로 전송되는 데이터와 제공자의 학습 사용·보존 정책: 발화 음성과 참석자 표시 이름(프롬프트)을 OpenAI로 보낸다. 학습에 쓰지 않고, 보존은 최대 30일로 본다.
- 팀 동의 범위와의 관계: 설계 문서 6절 "발화 음성 → OpenAI" 범위 안. 표시 이름은 프롬프트로 함께 간다.
- 예상 호출량과 회의당 비용: 발화 수만큼 호출. 추정 $0.006/분이라 발화가 40~60분인 회의는 약 $0.24~0.36(추정, 측정값 아님). 재시도가 나면 그 회의분이 다시 든다.
- 교체 시 영향: 음성 인식 노드를 바꾸면 `scripts/build-workflow.js`, 오프라인 테스트, E2E 기대값을 함께 고친다.

## Consequences

### Positive

- 녹취 품질과 이름 표기에 유리한 `gpt-4o-transcribe`와 참석자 이름 프롬프트를 유지한다.
- 알림 노드는 화면에서 Discord 아이콘으로 보인다.

### Negative / risks

- 음성 인식 노드는 HTTP 아이콘으로 보인다.
- Discord 노드는 멘션을 끌 수 없다. 설계 5절 "Discord로 보내는 모든 메시지는 멘션을 끈다"의 예외이며, 알림 문구를 코드가 만든 회의 ID와 숫자로만
  채워 위험을 없앴다. 녹취, 채팅, 오류 문구가 들어가는 메시지(실패 알림, 초안)에는 이 노드를 쓰지 않는다.
- Discord 노드는 주소가 고정이라 E2E에서 테스트 네트워크 안의 `discord.com` 가짜 서버와 테스트 CA를 쓴다.

## Revisit conditions

- n8n을 올려 OpenAI 노드가 `gpt-4o-transcribe`나 프롬프트를 지원할 때
- n8n Discord 노드에 `allowed_mentions` 옵션이 생기거나, 알림에 사람이 쓴 글을 넣어야 할 때
- 운영에서 음성 인식 품질이나 회의당 비용이 문제가 될 때

## Approval

- Approvers: 사용자 (2026-10-11 작업 세션에서 결정)
- Approved at: 2026-10-11
