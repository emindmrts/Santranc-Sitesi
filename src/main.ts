import { Chess, bestMove, FILES, squareName, type Color, type Move, type PromotionPiece } from './engine';
import { buildPgn } from './notation';
import { explainLoss } from './coach';
import './styles.css';

const START_COUNTS: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const CAP_GLYPH: Record<string, string> = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛' };
const VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const PIECE_NAMES: Record<string, string> = { p: 'piyon', n: 'at', b: 'fil', r: 'kale', q: 'vezir', k: 'şah' };
interface WorkerConfig {
  elo: number | null;
  skill: number;
  movetime: number;
}

interface FallbackConfig {
  depth: number;
  time: number;
  blunder: number;
}

interface LevelSpec {
  label: string;
  worker: WorkerConfig;
  fallback: FallbackConfig;
}

const LEVELS: Record<string, LevelSpec> = {
  cirak: {
    label: 'Çırak',
    worker: { elo: 1350, skill: 20, movetime: 260 },
    fallback: { depth: 2, time: 600, blunder: 0.32 },
  },
  kulup: {
    label: 'Kulüp',
    worker: { elo: 1900, skill: 20, movetime: 420 },
    fallback: { depth: 3, time: 900, blunder: 0.08 },
  },
  usta: {
    label: 'Usta',
    worker: { elo: 2600, skill: 20, movetime: 800 },
    fallback: { depth: 4, time: 1300, blunder: 0 },
  },
  sampiyon: {
    label: 'Şampiyon',
    worker: { elo: null, skill: 20, movetime: 1600 },
    fallback: { depth: 6, time: 2000, blunder: 0 },
  },
};
const TIMES: number[] = [0, 60, 180, 900, 1800];
const TIME_INCS: Record<number, number> = { 0: 0, 60: 0, 180: 2, 900: 0, 1800: 0 };
const STORE_KEY = 'santranc.net:game:v2';
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');

type Mode = 'ai' | 'duo';

interface GameOverInfo {
  winner: Color | null;
  reason: string;
}

function $<T extends Element>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}

function $all<T extends Element>(selector: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

const boardEl = $<HTMLElement>('#board')!;
const barTop = $<HTMLElement>('#barTop')!;
const barBottom = $<HTMLElement>('#barBottom')!;
const statusEl = $<HTMLElement>('#status')!;
const statusTitle = $<HTMLElement>('#statusTitle')!;
const statusSub = $<HTMLElement>('#statusSub')!;
const announcer = $<HTMLElement>('#announcer')!;
const movesEl = $<HTMLElement>('#moves')!;
const moveCountEl = $<HTMLElement>('#moveCount')!;
const promoEl = $<HTMLElement>('#promo')!;
const promoChoices = $<HTMLElement>('#promoChoices')!;
const promoCancel = $<HTMLButtonElement>('#promoCancel')!;
const resultEl = $<HTMLElement>('#result')!;
const resultTitle = $<HTMLElement>('#resultTitle')!;
const resultReason = $<HTMLElement>('#resultReason')!;
const resultSub = $<HTMLElement>('#resultSub')!;
const resultCoach = $<HTMLElement>('#resultCoach');
const coachHeadline = $<HTMLElement>('#coachHeadline');
const coachText = $<HTMLElement>('#coachText');
const coachTip = $<HTMLElement>('#coachTip');
const soundBtn = $<HTMLButtonElement>('#soundBtn')!;
const undoBtn = $<HTMLButtonElement>('#undoBtn')!;
const flipBtn = $<HTMLButtonElement>('#flipBtn')!;
const resignBtn = $<HTMLButtonElement>('#resignBtn')!;
const hintBtn = $<HTMLButtonElement>('#hintBtn')!;
const consoleEl = $<HTMLElement>('.console')!;
const modeSeg = $<HTMLElement>('#modeSeg')!;
const levelSeg = $<HTMLElement>('#levelSeg')!;
const sideSeg = $<HTMLElement>('#sideSeg')!;
const timeSeg = $<HTMLElement>('#timeSeg')!;
const historyBar = $<HTMLElement>('#historyBar')!;
const historyLabel = $<HTMLElement>('#historyLabel')!;
const historyBackBtn = $<HTMLButtonElement>('#historyBackBtn')!;
const fenCopyBtn = $<HTMLButtonElement>('#fenCopyBtn')!;
const pgnCopyBtn = $<HTMLButtonElement>('#pgnCopyBtn')!;
const toastEl = $<HTMLElement>('#toast')!;

let chess = new Chess();
let startFen: string | null = null;
const fenHistory: string[] = [chess.fen()];
let mode: Mode = 'ai';
let level = 'kulup';
let playerColor: Color = 'w';
let timeControl = 180;
let timeInc = 2;
let clocks = { w: 0, b: 0 };
let started = false;
let gameOver: GameOverInfo | null = null;
let flipped = false;
let selected: number | null = null;
let legalMoves: Move[] = [];
let legalTargets = new Set<number>();
let captureTargets = new Set<number>();
let lastMove: { from: number; to: number } | null = null;
let thinking = false;
let engineReady = false;
let aiToken = 0;
let aiRequestId = 0;
const pendingRequests = new Map<number, ((response: { move: AiReply | null; engine: 'stockfish' | 'unavailable' }) => void)>();
let viewPly: number | null = null;
let focusIdx = 60;
let dismissed = false;
let soundOn = true;
let lastTick = 0;
let persistCounter = 0;
let resignArmed = false;
let resignTimer = 0;
let pendingPromo: { from: number; to: number } | null = null;
let drag: {
  from: number;
  startX: number;
  startY: number;
  moved: boolean;
  ghost: HTMLElement | null;
} | null = null;
let audioCtx: AudioContext | null = null;
let animTimers: number[] = [];
let toastTimer = 0;

const squares: HTMLButtonElement[] = [];
for (let i = 0; i < 64; i++) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sq';
  button.dataset.sq = String(i);
  button.tabIndex = -1;
  squares.push(button);
  boardEl.appendChild(button);
}

interface AiReply {
  from: number;
  to: number;
  promotion: PromotionPiece | null;
}

interface AiResponse {
  id: number;
  move: AiReply | null;
  engine: 'stockfish' | 'unavailable';
  ready?: boolean;
}

function warmUpEngine(): void {
  const message = { id: -2, fen: '', cfg: { elo: null, skill: 20, movetime: 0 }, warmup: true };
  aiWorker.postMessage(message);
}

const aiWorker = new Worker(new URL('./ai.worker', import.meta.url), { type: 'module' });
aiWorker.addEventListener('message', (event) => {
  const data = event.data as AiResponse;
  if (data.ready) {
    engineReady = true;
    renderStatus();
    return;
  }
  const resolve = pendingRequests.get(data.id);
  pendingRequests.delete(data.id);
  if (resolve) resolve({ move: data.move, engine: data.engine });
});

function requestBestMove(fen: string, cfg: WorkerConfig): Promise<{ move: AiReply | null; engine: 'stockfish' | 'unavailable' }> {
  return new Promise((resolve) => {
    const id = ++aiRequestId;
    pendingRequests.set(id, resolve);
    aiWorker.postMessage({ id, fen, cfg });
    const budget = engineReady ? cfg.movetime + 4000 : 2500;
    window.setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        resolve({ move: null, engine: 'unavailable' });
      }
    }, budget);
  });
}

const colorOf = (piece: string): Color => (piece === piece.toUpperCase() ? 'w' : 'b');
const other = (color: Color): Color => (color === 'w' ? 'b' : 'w');
const aiSide = (): Color => (playerColor === 'w' ? 'b' : 'w');
const freshClocks = () => (timeControl
  ? { w: timeControl * 1000, b: timeControl * 1000 }
  : { w: 0, b: 0 });
const livePly = (): number => chess.historyMoves().length;

function pieceMarkup(piece: string): string {
  const color = colorOf(piece);
  const type = piece.toLowerCase();
  return `<svg class="piece ${color === 'w' ? 'white' : 'black'}" viewBox="0 0 45 45" aria-hidden="true"><use href="#p-${type}"></use></svg>`;
}

function fmtClock(ms: number): string {
  const clamped = Math.max(0, ms);
  const tenths = Math.ceil(clamped / 100);
  const minutes = Math.floor(tenths / 600);
  const seconds = Math.floor((tenths % 600) / 10);
  const rest = tenths % 10;
  if (clamped < 20000) {
    return `${minutes}:${String(seconds).padStart(2, '0')}.${rest}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function capturedBy(color: Color, board: string[]): string[] {
  const opponent = other(color);
  const present: Record<string, number> = { p: 0, n: 0, b: 0, r: 0, q: 0 };
  for (const piece of board) {
    if (piece && colorOf(piece) === opponent) present[piece.toLowerCase()]++;
  }
  const missing: string[] = [];
  for (const type of ['q', 'r', 'b', 'n', 'p']) {
    const count = Math.max(0, START_COUNTS[type] - present[type]);
    for (let i = 0; i < count; i++) missing.push(type);
  }
  return missing;
}

function material(color: Color, board: string[]): number {
  let total = 0;
  for (const piece of board) {
    if (piece && colorOf(piece) === color) total += VALUES[piece.toLowerCase()] || 0;
  }
  return total;
}

function canAct(): boolean {
  return !thinking && !gameOver && viewPly === null && (mode !== 'ai' || chess.turn === playerColor);
}

function renderBoard(): void {
  const board = resolvedBoard();
  const checkSquare = viewPly === null && !gameOver && chess.inCheck()
    ? chess.kingSquare(chess.turn)
    : -1;

  for (let i = 0; i < 64; i++) {
    const el = squares[i];
    const row = i >> 3;
    const col = i & 7;
    const viewRow = flipped ? 7 - row : row;
    const viewCol = flipped ? 7 - col : col;

    el.style.order = String(viewRow * 8 + viewCol);
    el.classList.toggle('light', (row + col) % 2 === 0);
    el.classList.toggle('dark', (row + col) % 2 === 1);
    el.classList.toggle('sel', selected === i);
    el.classList.toggle('legal', legalTargets.has(i));
    el.classList.toggle('capture', captureTargets.has(i));
    el.classList.toggle('last', !!lastMove && (lastMove.from === i || lastMove.to === i));
    el.classList.toggle('check', checkSquare === i);

    const piece = board[i];
    const playable = !!piece && colorOf(piece) === chess.turn && canAct();
    el.classList.toggle('playable', playable);
    let html = '';
    if (viewCol === 0) html += `<span class="coord rank">${8 - row}</span>`;
    if (viewRow === 7) html += `<span class="coord file">${FILES[col]}</span>`;
    if (piece) html += pieceMarkup(piece);
    el.innerHTML = html;
    el.tabIndex = i === focusIdx ? 0 : -1;

    const name = squareName(i);
    const label = piece
      ? `${name}, ${colorOf(piece) === 'w' ? 'beyaz' : 'siyah'} ${PIECE_NAMES[piece.toLowerCase()]}`
      : `${name}, boş kare`;
    el.setAttribute('aria-label', label);
  }
}

function resolvedBoard(): string[] {
  if (viewPly === null) return chess.board;
  const viewer = new Chess(fenHistory[viewPly]);
  return viewer.board;
}

function setBar(bar: HTMLElement, color: Color, board: string[]): void {
  const isComputer = mode === 'ai' && aiSide() === color;
  const name = mode === 'ai'
    ? (isComputer ? 'Bilgisayar' : 'Sen')
    : (color === 'w' ? 'Beyaz' : 'Siyah');

  $('.who-name', bar)!.textContent = name;
  const swatch = $('.swatch', bar)!;
  swatch.className = `swatch ${color}`;

  const turn: Color | null = viewPly === null ? chess.turn : colorAtPlyColor();
  const active = turn !== null && turn === color && (viewPly === null ? !gameOver : true);
  bar.classList.toggle('active', active);

  const caps = $<HTMLElement>('.caps', bar)!;
  const taken = capturedBy(color, board);
  caps.textContent = taken.map((type) => CAP_GLYPH[type]).join('');
  caps.title = taken.length ? `Alınan taşlar: ${taken.length}` : '';

  const diff = material('w', board) - material('b', board);
  const lead = color === 'w' ? diff : -diff;
  $('.lead', bar)!.textContent = lead > 0 ? `+${lead}` : '';

  const clockEl = $('.clock', bar)!;
  if (!timeControl) {
    clockEl.textContent = 'Süresiz';
    clockEl.classList.add('untimed');
    clockEl.classList.remove('low');
  } else {
    clockEl.classList.remove('untimed');
    clockEl.textContent = fmtClock(clocks[color]);
    clockEl.classList.toggle('low', started && clocks[color] <= 20000);
  }
}

function colorAtPlyColor(): Color | null {
  if (viewPly === null || viewPly >= fenHistory.length) return chess.turn;
  const viewer = new Chess(fenHistory[viewPly]);
  return viewer.turn;
}

function renderBars(): void {
  const board = resolvedBoard();
  setBar(barTop, flipped ? 'w' : 'b', board);
  setBar(barBottom, flipped ? 'b' : 'w', board);
}

function paintClock(color: Color): void {
  if (!timeControl) return;
  const bar = color === 'w'
    ? (flipped ? barTop : barBottom)
    : (flipped ? barBottom : barTop);
  const clockEl = $('.clock', bar)!;
  clockEl.textContent = fmtClock(clocks[color]);
  clockEl.classList.toggle('low', started && clocks[color] <= 20000);
}

function resultHeadline(): string {
  if (!gameOver) return '';
  if (gameOver.winner === null) return 'Berabere.';
  if (mode === 'ai') return gameOver.winner === playerColor ? 'Kazandın.' : 'Bilgisayar kazandı.';
  return gameOver.winner === 'w' ? 'Beyaz kazandı.' : 'Siyah kazandı.';
}

function reasonText(reason: string): string {
  switch (reason) {
    case 'checkmate': return 'Şah mat';
    case 'stalemate': return 'Pat';
    case 'timeout': return 'Süre bitti';
    case 'resign': return 'İstifa';
    case 'material': return 'Yetersiz materyal';
    case 'fifty': return 'Elli hamle kuralı';
    case 'repetition': return 'Üç kez tekrar';
    default: return 'Oyun bitti';
  }
}

function moveTotal(): number {
  return Math.max(1, Math.ceil(livePly() / 2));
}

function levelText(): string {
  const worker = LEVELS[level].worker;
  return worker.elo === null ? 'tam güç' : `~Elo ${String(worker.elo)}`;
}

function statusInfo(): { title: string; sub: string; cls: string } {
  if (viewPly !== null) {
    return {
      title: 'Geçmişte gezinmedesin',
      sub: `${viewPly}. hamle gösteriliyor. ← → ile gez, «Sıraya dön» ile tahtaya dön.`,
      cls: 'over',
    };
  }
  if (gameOver) {
    return {
      title: resultHeadline(),
      sub: `${reasonText(gameOver.reason)}. ${moveTotal()} hamlede oyun bitti.`,
      cls: 'over',
    };
  }
  if (thinking) {
    return {
      title: 'Bilgisayar düşünüyor',
      sub: engineReady
        ? `Zorluk: ${LEVELS[level].label} · Stockfish Elo ${levelText()}. Sıra onda.`
        : 'Stockfish motoru başlatılıyor, NNUE ağı indiriliyor…',
      cls: 'thinking',
    };
  }
  const inCheck = chess.inCheck();
  if (mode === 'duo') {
    const side = chess.turn === 'w' ? 'Beyaz' : 'Siyah';
    return {
      title: inCheck ? `Şah! Sıra ${side.toLowerCase()}da` : `Sıra ${side.toLowerCase()}da`,
      sub: 'Taş seç, noktalara dokun.',
      cls: inCheck ? 'check' : '',
    };
  }
  if (chess.turn !== playerColor) {
    return {
      title: 'Bilgisayar oynuyor',
      sub: `Zorluk: ${LEVELS[level].label}. Sıra onda.`,
      cls: 'thinking',
    };
  }
  return {
    title: inCheck ? 'Şah! Sıra sende' : 'Sıra sende',
    sub: 'Taş seç, noktalara dokun.',
    cls: inCheck ? 'check' : '',
  };
}

function renderStatus(): void {
  const info = statusInfo();
  statusTitle.textContent = info.title;
  statusSub.textContent = info.sub;
  statusEl.classList.toggle('thinking', info.cls === 'thinking');
  statusEl.classList.toggle('over', info.cls === 'over');
  statusEl.classList.toggle('check', info.cls === 'check');
  announcer.textContent = `${info.title}. ${info.sub}`;
}

function renderMoves(): void {
  const history = chess.historyMoves();
  const plies = history.length;
  moveCountEl.textContent = `${Math.ceil(plies / 2)} hamle`;

  if (!plies) {
    movesEl.innerHTML = '<p class="moves-empty">Henüz hamle yok. İlk taşı sen oynat.</p>';
    return;
  }

  const rows: string[] = [];
  const viewed = viewPly ?? plies;
  for (let i = 0; i < plies; i += 2) {
    const number = i / 2 + 1;
    const white = history[i];
    const black = history[i + 1];
    rows.push('<div class="ply-row">');
    rows.push(`<span class="ply-no">${number}.</span>`);
    rows.push(`<button type="button" class="ply${i + 1 === viewed ? ' current' : ''}" data-ply="${i + 1}" title="${white.san} sonrası konumu">${white.san}</button>`);
    rows.push(black
      ? `<button type="button" class="ply${i + 2 === viewed ? ' current' : ''}" data-ply="${i + 2}" title="${black.san} sonrası konumu">${black.san}</button>`
      : '<span class="ply idle"></span>');
    rows.push('</div>');
  }
  movesEl.innerHTML = rows.join('');
  if (viewPly === null) movesEl.scrollTop = movesEl.scrollHeight;
}

function renderHistoryBar(): void {
  if (viewPly === null) {
    historyBar.hidden = true;
    return;
  }
  historyBar.hidden = false;
  historyLabel.textContent = `${viewPly} / ${livePly()} hamle gösteriliyor`;
}

function positionSegThumb(seg: HTMLElement): void {
  const active = $all<HTMLButtonElement>('button[aria-pressed="true"]', seg)[0];
  if (!active) {
    seg.style.setProperty('--seg-thumb-w', '0px');
    return;
  }
  seg.style.setProperty('--seg-thumb-x', `${active.offsetLeft}px`);
  seg.style.setProperty('--seg-thumb-w', `${active.offsetWidth}px`);
}

function renderSettings(): void {
  consoleEl.classList.toggle('is-duo', mode === 'duo');
  const setSeg = (seg: HTMLElement, value: string) => {
    $all('button', seg).forEach((button) => {
      button.setAttribute('aria-pressed', String((button as HTMLButtonElement).dataset.value === value));
    });
    if (seg !== timeSeg) positionSegThumb(seg);
  };
  setSeg(modeSeg, mode);
  setSeg(levelSeg, level);
  setSeg(sideSeg, playerColor);
  setSeg(timeSeg, String(timeControl));
}

function renderSound(): void {
  soundBtn.setAttribute('aria-pressed', String(soundOn));
  soundBtn.setAttribute('aria-label', soundOn ? 'Sesi kapat' : 'Sesi aç');
  soundBtn.title = soundOn ? 'Sesi kapat' : 'Sesi aç';
  soundBtn.classList.toggle('muted', !soundOn);
}

function renderOverlay(): void {
  if (!gameOver || dismissed) {
    resultEl.hidden = true;
    if (resultCoach) resultCoach.hidden = true;
    return;
  }
  resultReason.textContent = reasonText(gameOver.reason);
  resultTitle.textContent = resultHeadline();
  resultSub.textContent = `${moveTotal()} hamlede oyun bitti. Yeni oyun ile rövanşı al.`;

  if (resultCoach && coachHeadline && coachText && coachTip) {
    if (gameOver.reason === 'checkmate' && gameOver.winner !== null) {
      const loser = other(gameOver.winner);
      const analysis = explainLoss(chess, loser);
      coachHeadline.textContent = analysis.headline;
      coachText.textContent = `${analysis.blunderText} ${analysis.tacticalReason}`;
      coachTip.textContent = analysis.tip;
      resultCoach.hidden = false;
    } else {
      resultCoach.hidden = true;
    }
  }

  resultEl.hidden = false;
}

function renderActions(): void {
  const plies = livePly();
  undoBtn.disabled = thinking || plies === 0;
  resignBtn.disabled = !!gameOver || plies === 0;
  hintBtn.disabled = !!gameOver || viewPly !== null || thinking;
  flipBtn.disabled = false;
  fenCopyBtn.disabled = plies === 0 && !startFen;
  pgnCopyBtn.disabled = plies === 0 && !startFen;
}

let hintTimer = 0;

function clearHint(): void {
  $all('.sq.hint', boardEl).forEach((square) => square.classList.remove('hint'));
}

async function showHint(): Promise<void> {
  if (!canAct()) return;
  hintBtn.disabled = true;
  const response = await requestBestMove(chess.fen(), { elo: null, skill: 20, movetime: 200 });
  clearHint();
  if (!canAct()) {
    renderActions();
    return;
  }
  let best = response.move;
  if (best === null) {
    const fallback = bestMove(chess, LEVELS[level].fallback);
    if (fallback) {
      best = { from: fallback.from, to: fallback.to, promotion: fallback.promotion };
    }
  }
  if (!best) {
    showToast('İpucu verilemedi.');
    renderActions();
    return;
  }
  squares[best.from].classList.add('hint');
  squares[best.to].classList.add('hint');
  window.clearTimeout(hintTimer);
  hintTimer = window.setTimeout(clearHint, 2400);
  renderActions();
}

function announceMove(move: Move): void {
  const who = move.color === 'w' ? 'Beyaz' : 'Siyah';
  announcer.textContent = `${who} ${move.san} oynadı.`;
}

function renderAll(): void {
  renderBoard();
  renderBars();
  renderStatus();
  renderMoves();
  renderHistoryBar();
  renderSettings();
  renderActions();
  renderSound();
  renderOverlay();
}

function showToast(message: string): void {
  toastEl.textContent = message;
  toastEl.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.classList.remove('visible');
  }, 1800);
}

async function copyText(text: string, message: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    showToast(message);
  } catch {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
      showToast(message);
    } catch {
      showToast('Kopyalama başarısız.');
    }
  }
}

const resultNewBtn = document.querySelector('#resultNew') as HTMLButtonElement;

function tone(frequency: number, duration: number, type: OscillatorType, delay: number, volume: number): void {
  if (!soundOn) return;
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    const start = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.03);
  } catch {}
}

function playMoveSound(move: Move): void {
  if (move.captured) {
    tone(150, 0.12, 'square', 0, 0.05);
    tone(96, 0.16, 'triangle', 0.015, 0.06);
  } else {
    tone(300, 0.08, 'triangle', 0, 0.055);
  }
  if (chess.inCheck()) {
    tone(620, 0.09, 'triangle', 0.1, 0.045);
    tone(820, 0.12, 'triangle', 0.19, 0.045);
  }
}

function playEndSound(): void {
  [392, 523, 659].forEach((frequency, index) => {
    tone(frequency, 0.24, 'triangle', index * 0.11, 0.04);
  });
}

function clearAnimTimers(): void {
  animTimers.forEach((timer) => window.clearTimeout(timer));
  animTimers = [];
  $all('.move-ghost').forEach((ghost) => ghost.remove());
  $all('.sq.animating', boardEl).forEach((square) => square.classList.remove('animating'));
}

function scheduleMoveAnimation(move: Move): void {
  if (REDUCED.matches) return;
  let rookFrom: number | null = null;
  let rookTo: number | null = null;
  if (move.flags.includes('k')) {
    rookFrom = move.color === 'w' ? 63 : 7;
    rookTo = move.color === 'w' ? 61 : 5;
  } else if (move.flags.includes('q') && move.piece.toLowerCase() === 'k') {
    rookFrom = move.color === 'w' ? 56 : 0;
    rookTo = move.color === 'w' ? 59 : 3;
  }
  launchPieceGhost(move.from, move.to, move.piece);
  if (rookFrom !== null && rookTo !== null) {
    launchPieceGhost(rookFrom, rookTo, move.color === 'w' ? 'R' : 'r');
  }
  if (move.captured && move.capturedSq === move.to) {
    launchCaptureFade(move.to, move.captured);
  }
}

function launchPieceGhost(from: number, to: number, piece: string): void {
  const startRect = squares[from].getBoundingClientRect();
  const endRect = squares[to].getBoundingClientRect();
  const ghost = document.createElement('div');
  ghost.className = 'move-ghost';
  ghost.style.width = `${endRect.width}px`;
  ghost.style.height = `${endRect.height}px`;
  ghost.style.left = `${startRect.left}px`;
  ghost.style.top = `${startRect.top}px`;
  ghost.innerHTML = pieceMarkup(piece);
  document.body.appendChild(ghost);
  squares[to].classList.add('animating');
  window.requestAnimationFrame(() => {
    ghost.style.transform = `translate(${endRect.left - startRect.left}px, ${endRect.top - startRect.top}px)`;
  });
  const timer = window.setTimeout(() => {
    ghost.remove();
    squares[to].classList.remove('animating');
  }, 180);
  animTimers.push(timer);
}

function launchCaptureFade(square: number, piece: string): void {
  const rect = squares[square].getBoundingClientRect();
  const ghost = document.createElement('div');
  ghost.className = 'move-ghost move-ghost-fade';
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  ghost.innerHTML = pieceMarkup(piece);
  document.body.appendChild(ghost);
  window.requestAnimationFrame(() => {
    ghost.style.opacity = '0';
    ghost.style.transform = 'scale(0.82)';
  });
  const timer = window.setTimeout(() => ghost.remove(), 160);
  animTimers.push(timer);
}

function clearSelection(): void {
  selected = null;
  legalMoves = [];
  legalTargets = new Set();
  captureTargets = new Set();
}

function selectSquare(index: number): void {
  selected = index;
  legalMoves = chess.moves({ square: index });
  legalTargets = new Set(legalMoves.map((move) => move.to));
  captureTargets = new Set(legalMoves.filter((move) => move.captured).map((move) => move.to));
  renderBoard();
}

function activate(index: number): void {
  if (!canAct()) {
    if (viewPly !== null) setViewPly(null);
    return;
  }
  const piece = chess.board[index];
  if (selected !== null) {
    if (index === selected) {
      clearSelection();
      renderBoard();
      return;
    }
    if (piece && colorOf(piece) === chess.turn) {
      selectSquare(index);
      return;
    }
    if (legalTargets.has(index)) {
      tryMove(selected, index);
      return;
    }
  }
  if (piece && colorOf(piece) === chess.turn) {
    selectSquare(index);
  } else if (selected !== null) {
    clearSelection();
    renderBoard();
  }
}

function openPromotion(from: number, to: number): void {
  const color = chess.turn;
  const items: [PromotionPiece, string][] = [['q', 'Vezir'], ['r', 'Kale'], ['b', 'Fil'], ['n', 'At']];
  promoChoices.innerHTML = items.map(([type, label]) =>
    `<button type="button" data-promo="${type}" aria-label="${label}">` +
    `<svg class="piece ${color === 'w' ? 'white' : 'black'}" viewBox="0 0 45 45" aria-hidden="true"><use href="#p-${type}"></use></svg>` +
    `<span>${label}</span></button>`).join('');
  pendingPromo = { from, to };
  promoEl.hidden = false;
  const first = $<HTMLButtonElement>('button', promoChoices);
  if (first) first.focus({ preventScroll: true });
}

function closePromotion(): void {
  pendingPromo = null;
  promoEl.hidden = true;
  clearSelection();
  renderBoard();
}

function finishMove(from: number, to: number, promotion: PromotionPiece | null): void {
  const move = chess.move({ from, to, promotion });
  if (!move) return;
  clearSelection();
  pendingPromo = null;
  promoEl.hidden = true;
  if (viewPly !== null) viewPly = null;
  lastMove = { from: move.from, to: move.to };
  focusIdx = move.to;
  started = true;
  lastTick = performance.now();
  if (timeControl && timeInc) clocks[move.color] += timeInc * 1000;
  dismissed = false;
  clearAnimTimers();
  scheduleMoveAnimation(move);
  fenHistory.push(chess.fen());
  playMoveSound(move);
  renderAll();
  persist();
  afterMove();
  announceMove(move);
}

function tryMove(from: number, to: number): void {
  if (!canAct()) return;
  const candidates = chess.moves({ square: from }).filter((move) => move.to === to);
  if (!candidates.length) {
    clearSelection();
    renderBoard();
    return;
  }
  if (candidates.some((move) => move.promotion)) {
    openPromotion(from, to);
    return;
  }
  finishMove(from, to, null);
}

function endGame(info: GameOverInfo): void {
  if (gameOver) return;
  gameOver = info;
  thinking = false;
  aiToken++;
  pendingRequests.clear();
  clearSelection();
  lastTick = 0;
  dismissed = false;
  renderAll();
  persist();
  playEndSound();
  window.setTimeout(() => {
    if (!resultEl.hidden) resultNewBtn.focus({ preventScroll: true });
  }, 60);
}

function afterMove(): void {
  const hasMoves = chess.moves().length > 0;
  if (!hasMoves) {
    if (chess.inCheck()) endGame({ winner: other(chess.turn), reason: 'checkmate' });
    else endGame({ winner: null, reason: 'stalemate' });
    return;
  }
  if (chess.isInsufficientMaterial()) { endGame({ winner: null, reason: 'material' }); return; }
  if (chess.isFiftyMoveDraw()) { endGame({ winner: null, reason: 'fifty' }); return; }
  if (chess.isThreefoldRepetition()) { endGame({ winner: null, reason: 'repetition' }); return; }
  renderStatus();
  renderBars();
  renderActions();
  if (mode === 'ai' && chess.turn === aiSide()) void scheduleAI();
}

async function scheduleAI(): Promise<void> {
  if (mode !== 'ai' || gameOver || chess.turn !== aiSide()) return;
  thinking = true;
  renderStatus();
  renderBars();
  renderActions();
  renderBoard();
  const token = ++aiToken;
  const levelSpec = LEVELS[level];
  const response = await requestBestMove(chess.fen(), levelSpec.worker);
  if (token !== aiToken || gameOver) {
    if (token === aiToken) {
      thinking = false;
      renderStatus();
      renderActions();
      renderBoard();
    }
    return;
  }
  thinking = false;
  let best: AiReply | null = response.move;
  let engineSource: 'stockfish' | 'fallback' = response.engine === 'stockfish' ? 'stockfish' : 'fallback';
  if (best === null) {
    const fallback = bestMove(new Chess(chess.fen()), levelSpec.fallback);
    if (fallback) {
      best = { from: fallback.from, to: fallback.to, promotion: fallback.promotion };
      engineSource = 'fallback';
    }
  }
  if (!best) {
    renderAll();
    return;
  }
  setEngineMarker(engineSource);
  const move = chess.move({ from: best.from, to: best.to, promotion: best.promotion });
  if (!move) {
    renderAll();
    return;
  }
  lastMove = { from: move.from, to: move.to };
  focusIdx = move.to;
  started = true;
  lastTick = performance.now();
  if (timeControl && timeInc) clocks[move.color] += timeInc * 1000;
  dismissed = false;
  clearAnimTimers();
  scheduleMoveAnimation(move);
  fenHistory.push(chess.fen());
  playMoveSound(move);
  renderAll();
  persist();
  afterMove();
  announceMove(move);
}

function setEngineMarker(source: 'stockfish' | 'fallback'): void {
  (window as unknown as { __lastAiEngine?: string }).__lastAiEngine = source;
}

function tickClock(): void {
  if (gameOver || !started || !timeControl || document.hidden) {
    lastTick = 0;
    return;
  }
  const nowTime = performance.now();
  if (!lastTick) {
    lastTick = nowTime;
    return;
  }
  const delta = nowTime - lastTick;
  lastTick = nowTime;
  const turn = chess.turn;
  clocks[turn] = Math.max(0, clocks[turn] - delta);
  paintClock(turn);
  persistCounter++;
  if (persistCounter >= 50) {
    persistCounter = 0;
    persist();
  }
  if (clocks[turn] <= 0) {
    endGame({ winner: other(turn), reason: 'timeout' });
  }
}

function resetResign(): void {
  resignArmed = false;
  resignBtn.textContent = 'İstifa';
  resignBtn.classList.remove('armed');
  window.clearTimeout(resignTimer);
}

function undoMove(): void {
  if (thinking || !livePly()) return;
  let pops = 0;
  while (livePly() && pops < 2) {
    chess.undo();
    fenHistory.pop();
    pops++;
    if (mode === 'duo' || chess.turn === playerColor) break;
  }
  if (!livePly()) {
    started = false;
    clocks = freshClocks();
    lastTick = 0;
  } else {
    lastTick = performance.now();
  }
  gameOver = null;
  dismissed = false;
  viewPly = null;
  clearSelection();
  clearAnimTimers();
  clearHint();
  resetResign();
  const history = chess.historyMoves();
  lastMove = history.length
    ? { from: history[history.length - 1].from, to: history[history.length - 1].to }
    : null;
  focusIdx = history.length ? history[history.length - 1].to : (flipped ? 4 : 60);
  renderAll();
  persist();
  if (mode === 'ai' && chess.turn === aiSide()) void scheduleAI();
}

function flipBoard(): void {
  flipped = !flipped;
  renderBoard();
  renderBars();
  persist();
}

function newGame(loadFen?: string): void {
  aiToken++;
  pendingRequests.clear();
  thinking = false;
  let initial: Chess | null = null;
  if (loadFen) {
    try {
      const probe = new Chess(loadFen);
      if (probe.moves().length > 0) initial = probe;
    } catch {}
  }
  startFen = initial ? loadFen! : null;
  chess = initial ?? new Chess();
  fenHistory.length = 0;
  fenHistory.push(chess.fen());
  clocks = freshClocks();
  started = false;
  gameOver = null;
  dismissed = false;
  viewPly = null;
  pendingPromo = null;
  promoEl.hidden = true;
  clearSelection();
  clearAnimTimers();
  clearHint();
  lastMove = null;
  lastTick = 0;
  persistCounter = 0;
  resetResign();
  flipped = mode === 'ai' ? playerColor === 'b' : false;
  focusIdx = flipped ? 4 : 60;
  renderAll();
  persist();
  if (mode === 'ai') warmUpEngine();
  if (mode === 'ai' && chess.turn === aiSide()) void scheduleAI();
}

function setViewPly(ply: number | null): void {
  viewPly = ply;
  clearSelection();
  const history = chess.historyMoves();
  lastMove = ply !== null && ply > 0
    ? { from: history[ply - 1].from, to: history[ply - 1].to }
    : null;
  renderAll();
  if (ply === null) {
    const target = squares[focusIdx === undefined ? 60 : focusIdx];
    if (target) target.focus({ preventScroll: true });
  }
}

function navigateHistory(delta: number): void {
  const total = livePly();
  if (!total) return;
  const base = viewPly === null ? total : viewPly;
  const target = Math.min(total, Math.max(0, base + delta));
  if (target === total) setViewPly(null);
  else setViewPly(target);
}

function exportFen(): string {
  if (viewPly !== null) return fenHistory[viewPly];
  return chess.fen();
}

function pgnResult(): string {
  if (!gameOver) {
    return livePly() ? '*' : '*';
  }
  if (gameOver.winner === 'w') return '1-0';
  if (gameOver.winner === 'b') return '0-1';
  return '1/2-1/2';
}

function pgnNames(): [string, string] {
  if (mode === 'duo') return ['Beyaz', 'Siyah'];
  return playerColor === 'w' ? ['Sen', 'Bilgisayar'] : ['Bilgisayar', 'Sen'];
}

function syncTabIndex(): void {
  squares.forEach((sq, index) => {
    sq.tabIndex = index === focusIdx ? 0 : -1;
  });
}

function squareAtPoint(x: number, y: number): HTMLButtonElement | null {
  const element = document.elementFromPoint(x, y);
  return element ? (element.closest('.sq') as HTMLButtonElement | null) : null;
}

function highlightDrop(x: number, y: number): void {
  $all('.sq.drop-target', boardEl).forEach((target) => target.classList.remove('drop-target'));
  const target = squareAtPoint(x, y);
  if (target && legalTargets.has(Number(target.dataset.sq))) target.classList.add('drop-target');
}

function endDrag(event: PointerEvent, attempt: boolean): void {
  if (!drag) return;
  const current = drag;
  drag = null;
  boardEl.classList.remove('dragging');
  squares[current.from].classList.remove('dragging-origin');
  $all('.sq.drop-target', boardEl).forEach((target) => target.classList.remove('drop-target'));
  if (current.ghost) current.ghost.remove();
  if (!current.moved || !attempt) {
    renderBoard();
    return;
  }
  const target = squareAtPoint(event.clientX, event.clientY);
  if (!target) {
    clearSelection();
    renderBoard();
    return;
  }
  const index = Number(target.dataset.sq);
  if (index === current.from) return;
  if (legalTargets.has(index)) {
    tryMove(current.from, index);
  } else {
    clearSelection();
    renderBoard();
  }
}

boardEl.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  if (!promoEl.hidden || !resultEl.hidden) return;
  const target = (event.target as HTMLElement).closest('.sq') as HTMLButtonElement | null;
  if (!target) return;
  const index = Number(target.dataset.sq);
  focusIdx = index;
  if (!canAct()) {
    syncTabIndex();
    if (viewPly !== null) setViewPly(null);
    return;
  }
  activate(index);
  if (selected === index && chess.board[index] && colorOf(chess.board[index]) === chess.turn) {
    drag = { from: index, startX: event.clientX, startY: event.clientY, moved: false, ghost: null };
    target.focus({ preventScroll: true });
    if (boardEl.setPointerCapture) {
      try {
        boardEl.setPointerCapture(event.pointerId);
      } catch {}
    }
  }
});

boardEl.addEventListener('pointermove', (event) => {
  if (!drag) return;
  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;
  if (!drag.moved && Math.hypot(dx, dy) > 5) {
    const piece = chess.board[drag.from];
    if (!piece) {
      drag = null;
      return;
    }
    drag.moved = true;
    const rect = squares[drag.from].getBoundingClientRect();
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.innerHTML = pieceMarkup(piece);
    ghost.style.left = `${event.clientX}px`;
    ghost.style.top = `${event.clientY}px`;
    document.body.appendChild(ghost);
    drag.ghost = ghost;
    squares[drag.from].classList.add('dragging-origin');
    boardEl.classList.add('dragging');
  }
  if (drag.moved && drag.ghost) {
    drag.ghost.style.left = `${event.clientX}px`;
    drag.ghost.style.top = `${event.clientY}px`;
    highlightDrop(event.clientX, event.clientY);
  }
});

boardEl.addEventListener('pointerup', (event) => endDrag(event, true));
boardEl.addEventListener('pointercancel', (event) => endDrag(event, false));

boardEl.addEventListener('click', (event) => {
  if (event.detail !== 0) return;
  const target = (event.target as HTMLElement).closest('.sq') as HTMLButtonElement | null;
  if (!target) return;
  focusIdx = Number(target.dataset.sq);
  activate(focusIdx);
});

boardEl.addEventListener('focusin', (event) => {
  const target = (event.target as HTMLElement).closest('.sq') as HTMLButtonElement | null;
  if (!target) return;
  focusIdx = Number(target.dataset.sq);
  syncTabIndex();
});

boardEl.addEventListener('keydown', (event) => {
  const key = event.key;
  if (key === 'Escape') {
    if (selected !== null) {
      clearSelection();
      renderBoard();
    }
    return;
  }
  if (!promoEl.hidden || !resultEl.hidden) return;
  if (key === 'Enter' || key === ' ') {
    event.preventDefault();
    activate(focusIdx);
    return;
  }
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return;
  event.preventDefault();
  let row = focusIdx >> 3;
  let col = focusIdx & 7;
  if (key === 'Home') col = 0;
  else if (key === 'End') col = 7;
  else if (key === 'ArrowUp') row += flipped ? 1 : -1;
  else if (key === 'ArrowDown') row += flipped ? -1 : 1;
  else if (key === 'ArrowLeft') col += flipped ? 1 : -1;
  else if (key === 'ArrowRight') col += flipped ? -1 : 1;
  row = Math.min(7, Math.max(0, row));
  col = Math.min(7, Math.max(0, col));
  focusIdx = row * 8 + col;
  syncTabIndex();
  squares[focusIdx].focus({ preventScroll: true });
});

window.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement | null;
  if (target && (target.closest('.sq') || target.closest('input, textarea, select, [contenteditable]'))) return;
  if (!promoEl.hidden || !resultEl.hidden) return;
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    navigateHistory(-1);
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    navigateHistory(1);
  }
});

promoChoices.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest('button[data-promo]') as HTMLButtonElement | null;
  if (!button || !pendingPromo) return;
  const from = pendingPromo.from;
  const to = pendingPromo.to;
  finishMove(from, to, button.dataset.promo as PromotionPiece);
  const target = squares[to];
  if (target) target.focus({ preventScroll: true });
});

promoCancel.addEventListener('click', closePromotion);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !promoEl.hidden) {
    event.preventDefault();
    closePromotion();
  }
});

function bindSeg(segment: HTMLElement, onChange: (value: string) => void): void {
  segment.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('button[data-value]') as HTMLButtonElement | null;
    if (!button || button.getAttribute('aria-pressed') === 'true') return;
    onChange(button.dataset.value || '');
  });
}

bindSeg(modeSeg, (value) => {
  mode = value as Mode;
  newGame();
});

bindSeg(levelSeg, (value) => {
  level = value;
  newGame();
});

bindSeg(sideSeg, (value) => {
  playerColor = value as Color;
  newGame();
});

bindSeg(timeSeg, (value) => {
  timeControl = Number(value);
  timeInc = TIME_INCS[timeControl] ?? 0;
  newGame();
  scrollToBoard();
});

function scrollToBoard(): void {
  const section = $('#oyna');
  if (!section) return;
  section.scrollIntoView({
    behavior: REDUCED.matches ? 'auto' : 'smooth',
    block: 'start',
  });
}

$('#newGameTop')!.addEventListener('click', () => {
  newGame();
  scrollToBoard();
});

$('#newGameCta')!.addEventListener('click', () => {
  newGame();
  scrollToBoard();
});

soundBtn.addEventListener('click', () => {
  soundOn = !soundOn;
  renderSound();
  if (soundOn) tone(440, 0.08, 'triangle', 0, 0.05);
  persist();
});

undoBtn.addEventListener('click', undoMove);
flipBtn.addEventListener('click', flipBoard);
hintBtn.addEventListener('click', () => void showHint());

resignBtn.addEventListener('click', () => {
  if (gameOver || !livePly()) return;
  if (!resignArmed) {
    resignArmed = true;
    resignBtn.textContent = 'Emin misin?';
    resignBtn.classList.add('armed');
    window.clearTimeout(resignTimer);
    resignTimer = window.setTimeout(resetResign, 2800);
    return;
  }
  resetResign();
  const loser = mode === 'ai' ? playerColor : chess.turn;
  endGame({ winner: other(loser), reason: 'resign' });
});

resultNewBtn.addEventListener('click', () => {
  newGame();
  squares[focusIdx].focus({ preventScroll: true });
});

$('#resultClose')!.addEventListener('click', () => {
  dismissed = true;
  renderOverlay();
  squares[focusIdx].focus({ preventScroll: true });
});

fenCopyBtn.addEventListener('click', () => {
  copyText(exportFen(), 'FEN kopyalandı.');
});

pgnCopyBtn.addEventListener('click', () => {
  copyText(buildPgn({
    headers: {
      Event: 'santranc.net oyunu',
      Site: 'santranc.net',
      Date: `${new Date().getFullYear()}.${String(new Date().getMonth() + 1).padStart(2, '0')}.${String(new Date().getDate()).padStart(2, '0')}`,
      Round: '-',
      White: pgnNames()[0],
      Black: pgnNames()[1],
      Result: pgnResult(),
    },
    sans: chess.historyMoves().map((move) => move.san || ''),
    result: pgnResult(),
  }).trim(), 'PGN kopyalandı.');
});

historyBackBtn.addEventListener('click', () => setViewPly(null));

movesEl.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest('button.ply') as HTMLElement | null;
  if (!button) return;
  setViewPly(Number(button.dataset.ply));
});

function persist(): void {
  try {
    const data = {
      v: 2,
      moves: chess.historyMoves().map((move) => ({
        from: move.from,
        to: move.to,
        promotion: move.promotion,
      })),
      mode,
      level,
      playerColor,
      timeControl,
      timeInc,
      startFen,
      clocks,
      flipped,
      gameOver,
      sound: soundOn,
    };
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch {}
}

function restore(): boolean {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORE_KEY);
  } catch {
    return false;
  }
  if (!raw) return false;

  let data: any = null;
  try {
    data = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!data || data.v !== 2 || !Array.isArray(data.moves)) return false;

  if (data.mode === 'ai' || data.mode === 'duo') mode = data.mode;
  if (LEVELS[data.level]) level = data.level;
  if (data.playerColor === 'w' || data.playerColor === 'b') playerColor = data.playerColor;
  if (TIMES.includes(data.timeControl)) timeControl = data.timeControl;
  timeInc = Number.isFinite(Number(data.timeInc))
    ? Math.max(0, Number(data.timeInc))
    : TIME_INCS[timeControl] ?? 0;
  if (typeof data.sound === 'boolean') soundOn = data.sound;
  if (typeof data.startFen === 'string' && data.startFen) {
    try {
      if (new Chess(data.startFen).moves().length > 0) startFen = data.startFen;
    } catch {}
  }

  const restored = new Chess(startFen ?? undefined);
  for (const saved of data.moves) {
    if (!saved || !restored.move({ from: saved.from, to: saved.to, promotion: saved.promotion })) {
      return false;
    }
  }

  chess = restored;
  fenHistory.length = 0;
  fenHistory.push(new Chess(startFen ?? undefined).fen());
  let replay = new Chess(startFen ?? undefined);
  for (const saved of data.moves) {
    replay.move({ from: saved.from, to: saved.to, promotion: saved.promotion });
    fenHistory.push(replay.fen());
  }

  clocks = freshClocks();
  if (
    TIMES.includes(data.timeControl) &&
    data.clocks && Number.isFinite(Number(data.clocks.w)) && Number.isFinite(Number(data.clocks.b))
  ) {
    clocks = {
      w: Math.max(0, Number(data.clocks.w)),
      b: Math.max(0, Number(data.clocks.b)),
    };
  }
  started = data.moves.length > 0;
  flipped = !!data.flipped;
  dismissed = false;
  if (
    data.gameOver &&
    (data.gameOver.winner === null || data.gameOver.winner === 'w' || data.gameOver.winner === 'b') &&
    typeof data.gameOver.reason === 'string'
  ) {
    gameOver = data.gameOver as GameOverInfo;
  } else {
    gameOver = null;
  }
  const history = chess.historyMoves();
  lastMove = history.length
    ? { from: history[history.length - 1].from, to: history[history.length - 1].to }
    : null;
  focusIdx = history.length ? history[history.length - 1].to : (flipped ? 4 : 60);
  return true;
}

document.addEventListener('visibilitychange', () => {
  lastTick = 0;
});

setInterval(tickClock, 100);

const restored = restore();
if (restored) {
  renderAll();
  if (mode === 'ai') warmUpEngine();
  if (!gameOver && mode === 'ai' && chess.turn === aiSide()) void scheduleAI();
} else {
  newGame();
}

function renderMiniBoards(): void {
  $all<HTMLElement>('.mini[data-fen]').forEach((mini) => {
    let board: string[] | null = null;
    try {
      board = new Chess(mini.dataset.fen || '').board;
    } catch {
      board = null;
    }
    if (!board) return;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 64; i++) {
      const cell = document.createElement('div');
      const row = i >> 3;
      const col = i & 7;
      cell.className = `sqm ${(row + col) % 2 === 0 ? 'light' : 'dark'}`;
      const piece = board[i];
      if (piece) cell.innerHTML = pieceMarkup(piece);
      frag.appendChild(cell);
    }
    mini.innerHTML = '';
    mini.appendChild(frag);
  });
}

function bindFameCards(): void {
  document.addEventListener('click', (event) => {
    const card = (event.target as HTMLElement).closest('[data-load-fen]') as HTMLElement | null;
    if (!card) return;
    const fen = card.dataset.loadFen || '';
    const title = card.dataset.title || 'Pozisyon';
    newGame(fen);
    if (startFen !== fen) {
      showToast('Pozisyon yüklenemedi.');
      return;
    }
    scrollToBoard();
    showToast(`${title} pozisyonu yüklendi.`);
  });
}

function bindPromoBanner(): void {
  const banner = $<HTMLElement>('#promoBanner');
  const close = $<HTMLButtonElement>('#promoClose');
  if (!banner || !close) return;
  let dismissed = false;
  try {
    dismissed = localStorage.getItem('santranc.net:banner') === 'off';
  } catch {}
  if (dismissed) banner.hidden = true;
  close.addEventListener('click', () => {
    banner.hidden = true;
    try {
      localStorage.setItem('santranc.net:banner', 'off');
    } catch {}
  });
}

renderMiniBoards();
bindFameCards();
bindPromoBanner();

function bindFooterHandlers(): void {
  const form = document.querySelector<HTMLFormElement>('#newsletterForm');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = form.querySelector<HTMLInputElement>('input[type="email"]');
      if (input && input.value.trim()) {
        showToast('Bülten kaydınız alındı, teşekkürler!');
        input.value = '';
      }
    });
  }

  const privacy = document.querySelector<HTMLAnchorElement>('#privacyLink');
  if (privacy) {
    privacy.addEventListener('click', (e) => {
      e.preventDefault();
      showToast('santranc.net çerez veya kişisel veri toplamaz. Reklamsız ve ücretsizdir.');
    });
  }

  const terms = document.querySelector<HTMLAnchorElement>('#termsLink');
  if (terms) {
    terms.addEventListener('click', (e) => {
      e.preventDefault();
      showToast('santranc.net GPLv3 açık kaynak lisansıyla sunulan ücretsiz bir satranç platformudur.');
    });
  }
}

bindFooterHandlers();

function refreshSegThumbs(): void {
  [modeSeg, sideSeg, levelSeg].forEach(positionSegThumb);
}

window.addEventListener('resize', refreshSegThumbs);
if (document.fonts?.ready) document.fonts.ready.then(() => refreshSegThumbs());

