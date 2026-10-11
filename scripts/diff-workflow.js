// n8n 화면에서 내보낸 워크플로 JSON과 저장소 JSON을 노드 이름 기준으로 비교한다.
// 화면에서 확정한 수정을 코드(workflows/src, scripts/build-workflow.js)로 옮겼는지 확인하는 데 쓴다.
//   node scripts/diff-workflow.js <내보낸 JSON> [저장소 JSON]
// 동작에 영향을 주는 값(type, typeVersion, parameters, 노드 설정, 연결, 갈래 실행 순서)만 비교한다.
// 위치, 내부 ID, webhookId, 자격 증명 ID처럼 n8n이 가져올 때마다 바꾸는 값은 무시한다(2026-10-11 사용자 결정).
// 단, n8n은 한 노드에서 갈라진 갈래를 화면 위쪽부터 실행하므로 갈래들의 위아래 순서는 비교한다.
// 차이가 없으면 0, 있으면 1, 인자나 파일이 잘못되면 2로 끝난다.
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { WORKFLOW_FILE } from './build-workflow.js';

// 노드 설정과 n8n 기본값. 기본값과 같으면 값이 없는 것과 같게 본다.
const SETTINGS = {
  disabled: false,
  alwaysOutputData: false,
  executeOnce: false,
  retryOnFail: false,
  maxTries: 3,
  waitBetweenTries: 1000,
  onError: 'stopWorkflow',
  continueOnFail: false,
};

// n8n 화면에서 저장하면 기본값과 같은 파라미터가 JSON에서 빠진다(n8n 2.42.6에서 확인). 저장소 JSON은 값을 그대로 적어 두므로
// 빠진 쪽에 이 표의 기본값을 채워 비교한다. 화면 저장에서 새로 빠지는 값이 보이면 여기에 더한다.
// 키는 파라미터 경로다. `a.b`는 안쪽 값, `a[].b`는 배열 a의 각 항목 안 값이다. 바깥 값이 있을 때만 안쪽을 채운다.
const PARAMETER_DEFAULTS = {
  'n8n-nodes-base.webhook': { responseMode: 'onReceived' },
  'n8n-nodes-base.readWriteFile': { operation: 'read' },
  'n8n-nodes-base.discord': { authentication: 'botToken', operation: 'send', sendTo: 'channel' },
  'n8n-nodes-base.httpRequest': {
    method: 'GET',
    'options.pagination.pagination.paginationMode': 'updateAParameterInEachRequest',
    'options.pagination.pagination.parameters.parameters[].type': 'qs',
  },
  'n8n-nodes-base.merge': { chooseBranchMode: 'waitForAll' },
};

/** 경로의 값이 없으면 기본값을 채운다. 중간 값이 없으면 아무것도 만들지 않는다. */
function fillDefault(target, path, fallback) {
  const [head, ...rest] = path.split('.');
  const each = head.endsWith('[]');
  const key = each ? head.slice(0, -2) : head;
  if (rest.length === 0) {
    if (!each && target[key] === undefined) target[key] = fallback;
    return;
  }
  const inner = target[key];
  if (each && Array.isArray(inner)) inner.forEach((item) => isObject(item) && fillDefault(item, rest.join('.'), fallback));
  else if (!each && isObject(inner)) fillDefault(inner, rest.join('.'), fallback);
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
// 키 순서와 상관없이 같은 값이면 같은 문자열이 되게 키를 정렬해 직렬화한다(기본값을 채우면 키가 뒤에 붙는다).
const canonical = (value) =>
  JSON.stringify(value, (_, v) => (isObject(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));
const isEmpty = (value) => value === undefined || (isObject(value) && Object.keys(value).length === 0);

/** 내보낸 파일은 워크플로 하나이거나(화면 다운로드) 배열이다(CLI export). 배열이면 저장소 워크플로와 ID나 이름이 같은 것을 고른다. */
export function pickWorkflow(data, reference) {
  if (!Array.isArray(data)) return data;
  const found = data.find((w) => w?.id === reference.id) ?? data.find((w) => w?.name === reference.name);
  if (!found) throw new Error(`내보낸 파일에 ${reference.name} 워크플로가 없습니다`);
  return found;
}

const show = (value) => {
  if (value === undefined) return '(없음)';
  const text = JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
};

/** 코드는 통째로 보여 주지 않고 처음 달라진 줄만 보여 준다. */
function codeDiff(before, after) {
  const a = String(before ?? '').split('\n');
  const b = String(after ?? '').split('\n');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return `${i + 1}번째 줄부터 다름 (저장소 ${a.length}줄, 내보낸 것 ${b.length}줄)\n      저장소: ${show(a[i])}\n      내보냄: ${show(b[i])}`;
}

/** 두 값을 재귀로 비교해 달라진 경로를 모은다. 빈 객체와 값 없음은 같게 본다. */
function diffValues(before, after, at, out) {
  if (isEmpty(before) && isEmpty(after)) return;
  if (isObject(before) && isObject(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      diffValues(before[key], after[key], at ? `${at}.${key}` : key, out);
    }
    return;
  }
  if (canonical(before) === canonical(after)) return;
  if (typeof before === 'string' && typeof after === 'string' && (before.includes('\n') || after.includes('\n'))) {
    out.push(`${at}: ${codeDiff(before, after)}`);
    return;
  }
  out.push(`${at}: ${show(before)} → ${show(after)}`);
}

function nodeShape(node) {
  const settings = {};
  for (const [key, fallback] of Object.entries(SETTINGS)) {
    if (node[key] !== undefined && node[key] !== fallback) settings[key] = node[key];
  }
  // 기본값을 채우면서 원본을 바꾸지 않도록 복사한다.
  const parameters = structuredClone(node.parameters ?? {});
  for (const [path, fallback] of Object.entries(PARAMETER_DEFAULTS[node.type] ?? {})) fillDefault(parameters, path, fallback);
  return { type: node.type, typeVersion: node.typeVersion, parameters, settings };
}

/** 연결을 "보내는 노드[출력] → 받는 노드[입력]" 문자열 집합으로 바꾼다. */
function edges(connections = {}) {
  const out = new Set();
  for (const [from, byType] of Object.entries(connections)) {
    for (const [type, outputs] of Object.entries(byType ?? {})) {
      (outputs ?? []).forEach((targets, output) => {
        for (const target of targets ?? []) out.add(`${from}[${type} ${output}] → ${target.node}[${target.type} ${target.index}]`);
      });
    }
  }
  return out;
}

/**
 * 한 출력에서 갈라진 갈래들을 실행 순서(화면 위쪽부터, 같은 높이면 왼쪽부터)로 정렬한 목록.
 * n8n executionOrder v1이 이 순서로 갈래를 하나씩 끝까지 실행한다.
 */
function branchOrders(workflow) {
  const position = new Map((workflow.nodes ?? []).map((n) => [n.name, n.position ?? [0, 0]]));
  const orders = new Map();
  for (const [from, byType] of Object.entries(workflow.connections ?? {})) {
    (byType?.main ?? []).forEach((targets, output) => {
      const names = (targets ?? []).map((t) => t.node);
      if (names.length < 2) return;
      const order = [...names].sort((a, b) => {
        const [ax, ay] = position.get(a) ?? [0, 0];
        const [bx, by] = position.get(b) ?? [0, 0];
        return ay - by || ax - bx;
      });
      orders.set(`${from}[main ${output}]`, order);
    });
  }
  return orders;
}

/** 차이를 사람이 읽을 줄 목록으로 돌려준다. 빈 배열이면 동작이 같다. */
export function diffWorkflows(repo, exported) {
  const lines = [];
  const repoNodes = new Map(repo.nodes.map((n) => [n.name, n]));
  const exportedNodes = new Map((exported.nodes ?? []).map((n) => [n.name, n]));

  for (const name of repoNodes.keys()) {
    if (!exportedNodes.has(name)) lines.push(`- 노드 없음(이름이 바뀌었거나 지워짐): ${name}`);
  }
  for (const name of exportedNodes.keys()) {
    if (!repoNodes.has(name)) lines.push(`+ 저장소에 없는 노드: ${name}`);
  }
  for (const [name, node] of repoNodes) {
    if (!exportedNodes.has(name)) continue;
    const changes = [];
    diffValues(nodeShape(node), nodeShape(exportedNodes.get(name)), '', changes);
    if (changes.length > 0) lines.push(`~ ${name}`, ...changes.map((c) => `    ${c}`));
  }

  const before = edges(repo.connections);
  const after = edges(exported.connections);
  for (const edge of before) if (!after.has(edge)) lines.push(`- 연결 없음: ${edge}`);
  for (const edge of after) if (!before.has(edge)) lines.push(`+ 저장소에 없는 연결: ${edge}`);

  const exportedOrders = branchOrders(exported);
  for (const [source, order] of branchOrders(repo)) {
    const other = exportedOrders.get(source);
    // 갈래 구성이 다르면 연결 차이로 이미 보고했으므로 구성이 같을 때만 순서를 비교한다.
    const sameBranches = other && [...other].sort().join('\n') === [...order].sort().join('\n');
    if (sameBranches && other.join(', ') !== order.join(', ')) {
      lines.push(`~ 갈래 실행 순서 ${source}: ${order.join(', ')} → ${other.join(', ')}`);
    }
  }
  return lines;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [exportedPath, repoPath = WORKFLOW_FILE, ...rest] = process.argv.slice(2);
  let repo;
  let exported;
  try {
    if (!exportedPath || rest.length > 0) throw new Error('사용법: node scripts/diff-workflow.js <내보낸 JSON> [저장소 JSON]');
    repo = JSON.parse(await readFile(repoPath, 'utf8'));
    exported = pickWorkflow(JSON.parse(await readFile(exportedPath, 'utf8')), repo);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  const lines = diffWorkflows(repo, exported);
  if (lines.length === 0) {
    console.log(`${repo.name}: 저장소와 동작이 같습니다`);
  } else {
    console.log(`${repo.name}: 저장소와 다른 곳 ${lines.filter((l) => !l.startsWith('    ')).length}건. 확정할 수정이면 코드로 옮기세요.`);
    console.log(lines.join('\n'));
    process.exit(1);
  }
}
