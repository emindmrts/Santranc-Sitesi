interface WorkerConfig {
  elo: number | null;
  skill: number;
  movetime: number;
}

interface RequestMessage {
  id: number;
  fen: string;
  cfg: WorkerConfig;
  warmup?: boolean;
}

interface ReplyPayload {
  from: number;
  to: number;
  promotion: 'q' | 'r' | 'b' | 'n' | null;
}

interface ResponseMessage {
  id: number;
  move: ReplyPayload | null;
  engine: 'stockfish' | 'unavailable';
  ready?: boolean;
}

const FILES = 'abcdefgh';

interface QueuedRequest {
  id: number;
  fen: string;
  cfg: WorkerConfig;
}

let sf: Worker | null = null;
let loadFailed = false;
let engineReady = false;
let initialEvalSet = false;
const queue: QueuedRequest[] = [];
let currentId: number | null = null;
let currentCfg: WorkerConfig | null = null;
let awaitingReady = false;
let busy = false;

function engineScriptUrl(): string {
  return new URL('/engine/stockfish-nnue-16-single.js', self.location.origin).href;
}

function nnueUrl(): string {
  return new URL('/engine/nn-5af11540bbfe.nnue', self.location.origin).href;
}

function post(response: ResponseMessage): void {
  self.postMessage(response);
}

function lineOf(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data && typeof (data as { line?: string }).line === 'string') return (data as { line: string }).line;
  return '';
}

function squareFromName(part: string): number {
  const file = FILES.indexOf(part[0]);
  const rank = Number(part[1]);
  if (file < 0 || !(rank >= 1 && rank <= 8)) return -1;
  return (8 - rank) * 8 + file;
}

function parseUciMove(token: string): ReplyPayload | null {
  if (!token || token === '(none)' || token.length < 4) return null;
  const from = squareFromName(token.slice(0, 2));
  const to = squareFromName(token.slice(2, 4));
  if (from < 0 || to < 0) return null;
  const promoToken = token.length > 4 ? token[4] : null;
  const promotion = promoToken === 'q' || promoToken === 'r' || promoToken === 'b' || promoToken === 'n'
    ? (promoToken as 'q' | 'r' | 'b' | 'n')
    : null;
  return { from, to, promotion };
}

function sendToEngine(command: string): void {
  if (sf) sf.postMessage(command);
}

function startNext(): void {
  const request = queue.shift();
  if (!request || !sf) {
    currentId = null;
    currentCfg = null;
    busy = false;
    return;
  }
  busy = true;
  currentId = request.id;
  currentCfg = request.cfg;
  awaitingReady = true;
  sendToEngine('position fen ' + request.fen);
  sendToEngine('setoption name Skill Level value ' + request.cfg.skill);
  if (request.cfg.elo !== null) {
    sendToEngine('setoption name UCI_LimitStrength value true');
    sendToEngine('setoption name UCI_Elo value ' + request.cfg.elo);
  } else {
    sendToEngine('setoption name UCI_LimitStrength value false');
  }
  sendToEngine('isready');
}

function applyReady(): void {
  engineReady = true;
  if (awaitingReady) {
    awaitingReady = false;
    const movetime = currentCfg ? currentCfg.movetime : 600;
    sendToEngine('go movetime ' + movetime);
  }
}

self.addEventListener('message', (event: MessageEvent<RequestMessage>) => {
  const { id, fen, cfg } = event.data;
  if (event.data.warmup) {
    if (!sf && !loadFailed) {
      queue.push({ id, fen, cfg });
      spawnEngine();
    }
    return;
  }
  if (!sf) {
    if (loadFailed) {
      post({ id, move: null, engine: 'unavailable' });
      return;
    }
    queue.push({ id, fen, cfg });
    spawnEngine();
    return;
  }
  queue.push({ id, fen, cfg });
  if (engineReady && !busy) startNext();
});

function spawnEngine(): boolean {
  if (sf || loadFailed) return false;
  try {
    sf = new Worker(engineScriptUrl());
  } catch {
    loadFailed = true;
    sf = null;
    queue.length = 0;
    busy = false;
    if (currentId !== null) {
      post({ id: currentId, move: null, engine: 'unavailable' });
      currentId = null;
    }
    return false;
  }
  sf.onerror = () => {
    loadFailed = true;
    queue.length = 0;
    busy = false;
    currentId = null;
    if (sf) {
      sf.terminate();
      sf = null;
    }
    if (currentId !== null) {
      post({ id: currentId, move: null, engine: 'unavailable' });
      currentId = null;
    }
  };
  sf.onmessage = (engineEvent: MessageEvent<string | { line: string }>) => {
    const line = lineOf(engineEvent.data);
    if (!line) return;
    if (line.startsWith('uciok')) {
      sendToEngine('setoption name EvalFile value ' + nnueUrl());
      sendToEngine('setoption name Threads value 1');
      sendToEngine('setoption name Hash value 32');
      sendToEngine('isready');
      return;
    }
    if (line.startsWith('readyok')) {
      if (!engineReady || !initialEvalSet) {
        if (!initialEvalSet) {
          engineReady = true;
          initialEvalSet = true;
          post({ id: -1, move: null, engine: 'stockfish', ready: true });
        }
        startNext();
      } else if (busy && awaitingReady) {
        applyReady();
      }
      return;
    }
    if (line.startsWith('bestmove')) {
      const token = line.split(' ')[1];
      const move = parseUciMove(token);
      const replyId = currentId !== null ? currentId : -1;
      currentId = null;
      currentCfg = null;
      busy = false;
      post({ id: replyId, move, engine: 'stockfish' });
      if (queue.length) startNext();
      return;
    }
  };
  sendToEngine('uci');
  return true;
}
