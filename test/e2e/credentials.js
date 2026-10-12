// E2E 테스트에서만 쓰는 n8n 자격 증명. 값은 가짜(dummy-로 시작)이고 요청은 test/e2e/mock-apis.js로만 간다.
// 음성 인식·템플릿 읽기·초안 작성 HTTP 노드는 테스트용 JSON에서 주소를 가짜 서버로 바꾼다. Discord 노드는 주소가 고정이라 테스트 compose가 discord.com을 가짜 서버로 돌린다.
export const TEST_CREDENTIALS = {
  discordBotApi: { id: 'e2eDiscordBot001', name: 'E2E Discord', data: { botToken: 'dummy-e2e-discord' } },
  openAiApi: { id: 'e2eOpenAi0000001', name: 'E2E OpenAI', data: { apiKey: 'dummy-e2e-openai' } },
  clickUpApi: { id: 'e2eClickUp000001', name: 'E2E ClickUp', data: { accessToken: 'dummy-e2e-clickup' } },
  // 실패 알림이 n8n API로 실패한 실행을 읽을 때 쓴다. 키는 테스트 n8n이 뜬 뒤 만들어 value에 넣는다(scripts/e2e-n8n.js).
  httpHeaderAuth: { id: 'e2eN8nApiKey0001', name: 'E2E n8n API', data: { name: 'X-N8N-API-KEY', value: null } },
};
