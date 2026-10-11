# Decision Record: 회의록 초안 모델과 호출 방식

> Created at: `2026-10-11`
> GitHub Issue: `#17`
> Status: Accepted (사용자 결정, 2026-10-11)

## Context

7단계에서 회의 녹취 워크플로가 ClickUp 템플릿, 녹취, ✅ 결정 메시지로 회의록 초안을 쓴다. LLM 호출은 템플릿을 채우는 1회뿐이고
구조와 근거는 코드가 검증한다(설계 5절 E·F, `AGENTS.md` 3.2). 처음에는 `claude-sonnet-5-5`(설계 10절 ⑥)로 구현했다.
실제 확인에서 Anthropic API 크레딧이 없어 HTTP 400("Your credit balance is too low")이 났다. 사용자 계정의 Claude Code 클라우드 세션
크레딧은 API 요금에 쓸 수 없다. 음성 인식에는 이미 OpenAI를 쓰고 있다.

이 결정으로 녹취와 결정 메시지 원문이 OpenAI로 간다. 설계 6절은 이 데이터를 Anthropic으로 보낸다고 적었으므로 제공자 변경을 기록한다(`AGENTS.md` 3.1).

## Decision

회의록 초안은 HTTP Request 노드와 OpenAI 자격 증명으로 Responses API(`gpt-6-luna`, `reasoning.effort: "high"`, `store: false`)를 불러 쓴다.

## Rationale

- 외부 생성 모델 제공자를 음성 인식과 같은 OpenAI 하나로 줄인다. 자격 증명과 과금 계정도 하나다("GPT로 통일", 사용자 결정).
- 모델은 사용자가 저가형을 골랐다. 형식이나 근거가 틀린 초안은 검증 코드가 멈추므로 잘못된 회의록이 나가는 대신 멈춘다.
  품질은 실제 회의로 확인하고, 자주 멈추면 다시 본다.
- `store: false`로 Responses API의 응답 저장(기본 30일)을 끈다. 녹취가 OpenAI에 오남용 감시 로그 외로 남지 않게 한다.
- HTTP Request 노드는 음성 인식과 같은 방식이다. 요청 본문을 코드로 모두 정하고, E2E 가짜 서버로 실제 n8n이 보내는 요청을 확인한다.

## Alternatives considered

| Alternative | Advantages | Disadvantages | Reason not selected |
| --- | --- | --- | --- |
| `claude-sonnet-5-5` 유지, Console 크레딧 충전 | 처음 설계 그대로, 거절 시 서버 쪽 대체 모델(`fallbacks`) | 제공자 2곳, 별도 충전 필요 | 사용자가 GPT로 통일하기로 함 |
| `gpt-6.1-sol` ($2/$10) | Astra에 가까운 성능(OpenAI 설명) | 회의당 비용이 luna의 약 20배 | 사용자가 저가형을 고름(추천안이었음) |
| `gpt-6-astra` ($10/$50) | 품질 여유가 가장 큼 | 비용이 sol의 5배 | 이 작업에 과함 |
| n8n OpenAI 노드(Responses) | 화면에서 OpenAI 아이콘 | effort가 low/medium/high뿐, `store` 기본 true, 출력 변환 방식을 새로 확인해야 함 | 사용자가 HTTP Request를 고름 |

## Evidence

- 공식 문서(2026-10-11 조회):
  - <https://developers.openai.com/api/docs/pricing>: `gpt-6-luna` $0.10 / $0.50, `gpt-6.1-sol` $2 / $10, `gpt-6-astra` $10 / $50 (1M 토큰, 입력 / 출력)
  - <https://developers.openai.com/api/docs/models>: luna는 비용 효율형, effort `none`~`max`, 컨텍스트 1.05M, 최대 출력 128K
  - <https://developers.openai.com/api/docs/guides/your-data>: `/v1/responses`는 학습에 쓰지 않음, 오남용 감시 보존 30일,
    Responses API 응답은 기본 30일 저장(`store`를 끄면 저장하지 않음)
  - <https://developers.openai.com/api/docs/guides/reasoning>: 생각 토큰도 `max_output_tokens`에 들어가며 처음에는 25,000 이상을 남겨 두라고 권함.
    한도에 닿으면 `status: "incomplete"`, `incomplete_details.reason: "max_output_tokens"`
- 노드 코드(n8n 2.42.6 이미지): Anthropic 자격 증명은 `x-api-key`만 붙이고, ClickUp 자격 증명은 `Authorization`에 토큰을 그대로 넣는다.
  OpenAI 노드(`OpenAi/v2/actions/text/response.operation.js`)의 effort 선택지는 low/medium/high, `store` 기본값은 true.
- 오프라인 테스트: 요청 키 6개(`input`, `instructions`, `max_output_tokens`, `model`, `reasoning`, `store`), 잘림·콘텐츠 필터·거절·빈 응답은 실행 실패,
  근거·구조가 틀린 초안 16가지는 `draftOk: false`. 코드를 일부러 망가뜨린 18가지를 모두 잡았다.
- E2E(실제 n8n 2.42.6, 가짜 OpenAI·ClickUp·Discord, 비용 없음): 11회 상태 success, error, error, error, success, error, error, success, error, error, error.
  실제 n8n이 보낸 요청에 `Authorization: Bearer <테스트 키>`, `gpt-6-luna`, effort `high`, `max_output_tokens` 32000, `store: false`가 있고 샘플링 파라미터가 없었다.
- 실제 호출(로컬 n8n 2.42.6, 실제 ClickUp 템플릿, 테스트 녹음 발화 2개, 테스트 채널 ✅ 메시지 2개, 2026-10-11, 1회). 실행 기록에서 숫자만 읽었다.
  - Anthropic(전환 전): 템플릿 읽기까지 성공, 초안 작성에서 HTTP 400(크레딧 없음)
  - OpenAI: success, 17개 노드, 약 13초(초안 작성 9.2초). 응답 `completed`, 출력 reasoning 2개 + 최종 메시지 1개.
    토큰 입력 1,034, 출력 970(생각 711). 초안 검증 `draftOk: true`, 오류 0건, 지운 값 0건. 알림에 검증 결과가 나왔다.
  - 템플릿 페이지 응답은 `content` 필드에 Markdown(400자)을 담고, 본문이 테스트 fixture(`test/e2e/template.js`)와 같다.
  - 사용자가 n8n 화면에서 초안을 확인했다. 입력에 말이 거의 없어 결정 이유는 "기록 없음"으로 나왔다. 품질 판단 근거로는 부족하다.

## Data and cost

- 외부로 전송되는 데이터와 제공자의 학습 사용·보존 정책: 템플릿, 녹취, 결정 메시지(작성자 표시 이름, 내용, 링크), 참석자 이름을 OpenAI로 보낸다.
  학습에 쓰지 않고, 오남용 감시 로그는 최대 30일 보관된다. `store: false`라 응답 저장은 하지 않는다. 지역 처리 옵션은 쓰지 않는다.
- 팀 동의 범위와의 관계: 팀 동의는 "녹음, 외부 API 전송"으로 받았고 설계 6절은 녹취·결정 메시지를 Anthropic으로 보낸다고 적었다.
  제공자가 OpenAI로 바뀌므로 팀에 알린다(사용자에게 요청함). 음성은 이미 OpenAI로 보내고 있다.
- 예상 호출량과 회의당 비용: 회의당 1회. 입력 2만~3만, 출력 최대 3만 토큰이면 약 $0.02(추정, 측정값 아님).
  실제 호출 1회(발화 2개)는 토큰 2,004개로 공시 단가 기준 약 $0.0006(계산값, 청구액 아님). 실제 회의 비용은 운영에서 잰다.
  HTTP 오류(연결, 5xx, 429)는 노드가 3번까지 다시 보낸다(사용자 결정). 시간 초과 뒤 다시 보내면 그 회의분 비용이 최대 3배다.
- 교체 시 영향: 모델 이름은 `workflows/src/draft-request.js`의 상수 하나다. 다른 제공자로 바꾸면 요청 형식(`draft-request.js`), 응답 처리
  (`draft-check.js` 앞부분), 노드 주소와 자격 증명(`scripts/build-workflow.js`), 오프라인 테스트와 E2E 가짜 응답을 함께 고친다. 검증 규칙은 그대로다.

## Consequences

### Positive

- 외부 생성 모델 제공자와 과금 계정이 OpenAI 하나다.
- 회의당 초안 비용이 추정 $0.02 수준이다.
- 응답이 OpenAI에 저장되지 않는다.

### Negative / risks

- 저가형 모델이 실제 회의(긴 녹취, 이유가 있는 결정)에서 근거 형식을 얼마나 지키는지 아직 모른다. 형식을 어기면 초안이 멈추고 사람이 손으로 써야 한다.
- OpenAI에는 서버 쪽 대체 모델이 없어 거절되면 그 회의는 초안 없이 멈춘다.
- 이 단계에는 실패 알림 워크플로가 없어(10단계) 잘림·거절·API 오류는 n8n 실행 기록에서만 보인다. 실제 확인에서도 크레딧 오류 때 알림이 오지 않았다.

## Revisit conditions

- 운영에서 근거 형식이나 구조 때문에 멈춘 초안이 잦을 때(`gpt-6.1-sol`로 올리는 것을 먼저 본다)
- 실제 회의 초안을 사람이 크게 고쳐야 할 때
- OpenAI의 데이터 보존 정책이나 가격이 바뀔 때
- 팀이 녹취를 OpenAI로 보내는 데 동의하지 않을 때

## Approval

- Approvers: 사용자 (2026-10-11 작업 세션에서 결정)
- Approved at: 2026-10-11
