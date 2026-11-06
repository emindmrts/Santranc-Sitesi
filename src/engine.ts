export type Color = 'w' | 'b';
export type PromotionPiece = 'q' | 'r' | 'b' | 'n';

export interface CastlingRights {
  K: boolean;
  Q: boolean;
  k: boolean;
  q: boolean;
}

export interface UndoRecord {
  castling: CastlingRights;
  ep: number | null;
  halfmove: number;
  fullmove: number;
}

export interface Move {
  from: number;
  to: number;
  piece: string;
  color: Color;
  captured: string | null;
  capturedSq: number | null;
  promotion: PromotionPiece | null;
  flags: string;
  san?: string;
  _order?: number;
  _rootScore?: number;
  _undo?: UndoRecord | null;
}

export interface MoveOptions {
  square?: number | string | null;
}

export interface MoveInput {
  from: number | string;
  to: number | string;
  promotion?: PromotionPiece | null;
}

export interface BestMoveOptions {
  depth?: number;
  time?: number;
  blunder?: number;
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const WHITE: Color = 'w';
export const BLACK: Color = 'b';
export const FILES = 'abcdefgh';
const PROMOTIONS: PromotionPiece[] = ['q', 'r', 'b', 'n'];
const KNIGHT_STEPS: number[][] = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING_STEPS: number[][] = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const ROOK_DIRS: number[][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const BISHOP_DIRS: number[][] = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const SAN_LETTERS: Record<string, string> = { k: 'Ş', q: 'V', r: 'K', b: 'F', n: 'A' };
const MATE = 100000;

function colorOf(piece: string): Color {
  return piece === piece.toUpperCase() ? WHITE : BLACK;
}

function opposite(color: Color): Color {
  return color === WHITE ? BLACK : WHITE;
}

function inside(row: number, col: number): boolean {
  return row >= 0 && row < 8 && col >= 0 && col < 8;
}

export function squareName(index: number): string {
  return FILES[index & 7] + (8 - (index >> 3));
}

export function nameToSquare(name: string): number {
  if (typeof name !== 'string' || name.length < 2) return -1;
  const file = FILES.indexOf(name[0]);
  const rank = Number(name[1]);
  if (file < 0 || !(rank >= 1 && rank <= 8)) return -1;
  return (8 - rank) * 8 + file;
}

export class Chess {
  board: string[];
  turn: Color;
  castling: CastlingRights;
  ep: number | null;
  halfmove: number;
  fullmove: number;
  private _history: Move[];
  private _counts: Map<string, number>;

  constructor(fen?: string) {
    this.board = new Array(64).fill('');
    this.turn = WHITE;
    this.castling = { K: false, Q: false, k: false, q: false };
    this.ep = null;
    this.halfmove = 0;
    this.fullmove = 1;
    this._history = [];
    this._counts = new Map();
    this.load(fen || START_FEN);
  }

  load(fen: string): boolean {
    const parts = String(fen).trim().split(/\s+/);
    if (parts.length < 4) return false;
    const rows = parts[0].split('/');
    if (rows.length !== 8) return false;
    const board = new Array<string>(64).fill('');
    for (let r = 0; r < 8; r++) {
      let c = 0;
      for (const ch of rows[r]) {
        if (ch >= '1' && ch <= '8') {
          c += Number(ch);
        } else if ('pnbrqkPNBRQK'.includes(ch)) {
          if (c > 7) return false;
          board[r * 8 + c] = ch;
          c++;
        } else {
          return false;
        }
      }
      if (c !== 8) return false;
    }
    this.board = board;
    this.turn = parts[1] === BLACK ? BLACK : WHITE;
    const rights = parts[2] || '-';
    this.castling = {
      K: rights.includes('K'),
      Q: rights.includes('Q'),
      k: rights.includes('k'),
      q: rights.includes('q'),
    };
    this.ep = parts[3] && parts[3] !== '-' ? nameToSquare(parts[3]) : null;
    this.halfmove = Number(parts[4]) || 0;
    this.fullmove = Number(parts[5]) || 1;
    this._history = [];
    this._counts = new Map([[this._key(), 1]]);
    return true;
  }

  fen(): string {
    const rows: string[] = [];
    for (let r = 0; r < 8; r++) {
      let row = '';
      let empty = 0;
      for (let c = 0; c < 8; c++) {
        const piece = this.board[r * 8 + c];
        if (!piece) {
          empty++;
        } else {
          if (empty) { row += String(empty); empty = 0; }
          row += piece;
        }
      }
      if (empty) row += String(empty);
      rows.push(row);
    }
    let rights = '';
    if (this.castling.K) rights += 'K';
    if (this.castling.Q) rights += 'Q';
    if (this.castling.k) rights += 'k';
    if (this.castling.q) rights += 'q';
    return [
      rows.join('/'),
      this.turn,
      rights || '-',
      this.ep === null ? '-' : squareName(this.ep),
      this.halfmove,
      this.fullmove,
    ].join(' ');
  }

  private _key(): string {
    let rights = '';
    if (this.castling.K) rights += 'K';
    if (this.castling.Q) rights += 'Q';
    if (this.castling.k) rights += 'k';
    if (this.castling.q) rights += 'q';
    return this.board.join('') + '|' + this.turn + '|' + rights + '|' + (this.ep === null ? '-' : this.ep);
  }

  kingSquare(color: Color): number {
    const king = color === WHITE ? 'K' : 'k';
    for (let i = 0; i < 64; i++) {
      if (this.board[i] === king) return i;
    }
    return -1;
  }

  inCheck(): boolean {
    const king = this.kingSquare(this.turn);
    if (king < 0) return false;
    return this.isAttacked(king, opposite(this.turn));
  }

  isAttacked(target: number, by: Color): boolean {
    const board = this.board;
    const r = target >> 3;
    const c = target & 7;

    const pawnRow = by === WHITE ? r + 1 : r - 1;
    if (pawnRow >= 0 && pawnRow < 8) {
      const pawn = by === WHITE ? 'P' : 'p';
      for (const dc of [-1, 1]) {
        const cc = c + dc;
        if (cc >= 0 && cc < 8 && board[pawnRow * 8 + cc] === pawn) return true;
      }
    }

    const knight = by === WHITE ? 'N' : 'n';
    for (const [dr, dc] of KNIGHT_STEPS) {
      const rr = r + dr;
      const cc = c + dc;
      if (inside(rr, cc) && board[rr * 8 + cc] === knight) return true;
    }

    const king = by === WHITE ? 'K' : 'k';
    for (const [dr, dc] of KING_STEPS) {
      const rr = r + dr;
      const cc = c + dc;
      if (inside(rr, cc) && board[rr * 8 + cc] === king) return true;
    }

    const rook = by === WHITE ? 'R' : 'r';
    const queen = by === WHITE ? 'Q' : 'q';
    for (const [dr, dc] of ROOK_DIRS) {
      let rr = r + dr;
      let cc = c + dc;
      while (inside(rr, cc)) {
        const piece = board[rr * 8 + cc];
        if (piece) {
          if (piece === rook || piece === queen) return true;
          break;
        }
        rr += dr;
        cc += dc;
      }
    }

    const bishop = by === WHITE ? 'B' : 'b';
    for (const [dr, dc] of BISHOP_DIRS) {
      let rr = r + dr;
      let cc = c + dc;
      while (inside(rr, cc)) {
        const piece = board[rr * 8 + cc];
        if (piece) {
          if (piece === bishop || piece === queen) return true;
          break;
        }
        rr += dr;
        cc += dc;
      }
    }

    return false;
  }

  private _mv(from: number, to: number, piece: string, extra?: Partial<Move>): Move {
    const move: Move = {
      from,
      to,
      piece,
      color: colorOf(piece),
      captured: null,
      capturedSq: null,
      promotion: null,
      flags: '',
    };
    if (extra) Object.assign(move, extra);
    return move;
  }

  private _generate(): Move[] {
    const moves: Move[] = [];
    const board = this.board;
    const us = this.turn;
    const them = opposite(us);

    for (let from = 0; from < 64; from++) {
      const piece = board[from];
      if (!piece || colorOf(piece) !== us) continue;
      const type = piece.toLowerCase();
      const r = from >> 3;
      const c = from & 7;

      if (type === 'p') {
        const dir = us === WHITE ? -1 : 1;
        const lastRow = us === WHITE ? 0 : 7;
        const startRow = us === WHITE ? 6 : 1;
        const one = from + dir * 8;
        if (one >= 0 && one < 64 && !board[one]) {
          if ((one >> 3) === lastRow) {
            for (const pr of PROMOTIONS) moves.push(this._mv(from, one, piece, { promotion: pr, flags: 'p' }));
          } else {
            moves.push(this._mv(from, one, piece));
            const two = from + dir * 16;
            if ((from >> 3) === startRow && !board[two]) {
              moves.push(this._mv(from, two, piece, { flags: 'b' }));
            }
          }
        }
        for (const dc of [-1, 1]) {
          const cc = c + dc;
          if (cc < 0 || cc > 7) continue;
          const to = (r + dir) * 8 + cc;
          if (to < 0 || to > 63) continue;
          const target = board[to];
          if (target && colorOf(target) === them) {
            if ((to >> 3) === lastRow) {
              for (const pr of PROMOTIONS) {
                moves.push(this._mv(from, to, piece, { captured: target, capturedSq: to, promotion: pr, flags: 'cp' }));
              }
            } else {
              moves.push(this._mv(from, to, piece, { captured: target, capturedSq: to, flags: 'c' }));
            }
          } else if (this.ep === to) {
            const capSq = to - dir * 8;
            const capPiece = board[capSq];
            if (capPiece && colorOf(capPiece) === them) {
              moves.push(this._mv(from, to, piece, { captured: capPiece, capturedSq: capSq, flags: 'ce' }));
            }
          }
        }
        continue;
      }

      if (type === 'n' || type === 'k') {
        const steps = type === 'n' ? KNIGHT_STEPS : KING_STEPS;
        for (const [dr, dc] of steps) {
          const rr = r + dr;
          const cc = c + dc;
          if (!inside(rr, cc)) continue;
          const to = rr * 8 + cc;
          const target = board[to];
          if (target && colorOf(target) === us) continue;
          moves.push(this._mv(from, to, piece, target ? { captured: target, capturedSq: to, flags: 'c' } : undefined));
        }
        if (type === 'k') {
          if (us === WHITE && from === 60) {
            if (this.castling.K && !board[61] && !board[62] && board[63] === 'R' &&
                !this.isAttacked(60, them) && !this.isAttacked(61, them) && !this.isAttacked(62, them)) {
              moves.push(this._mv(from, 62, piece, { flags: 'k' }));
            }
            if (this.castling.Q && !board[59] && !board[58] && !board[57] && board[56] === 'R' &&
                !this.isAttacked(60, them) && !this.isAttacked(59, them) && !this.isAttacked(58, them)) {
              moves.push(this._mv(from, 58, piece, { flags: 'q' }));
            }
          } else if (us === BLACK && from === 4) {
            if (this.castling.k && !board[5] && !board[6] && board[7] === 'r' &&
                !this.isAttacked(4, them) && !this.isAttacked(5, them) && !this.isAttacked(6, them)) {
              moves.push(this._mv(from, 6, piece, { flags: 'k' }));
            }
            if (this.castling.q && !board[3] && !board[2] && !board[1] && board[0] === 'r' &&
                !this.isAttacked(4, them) && !this.isAttacked(3, them) && !this.isAttacked(2, them)) {
              moves.push(this._mv(from, 2, piece, { flags: 'q' }));
            }
          }
        }
        continue;
      }

      const dirs = type === 'b' ? BISHOP_DIRS : type === 'r' ? ROOK_DIRS : ROOK_DIRS.concat(BISHOP_DIRS);
      for (const [dr, dc] of dirs) {
        let rr = r + dr;
        let cc = c + dc;
        while (inside(rr, cc)) {
          const to = rr * 8 + cc;
          const target = board[to];
          if (!target) {
            moves.push(this._mv(from, to, piece));
          } else {
            if (colorOf(target) === them) {
              moves.push(this._mv(from, to, piece, { captured: target, capturedSq: to, flags: 'c' }));
            }
            break;
          }
          rr += dr;
          cc += dc;
        }
      }
    }

    return moves;
  }

  moves(options?: MoveOptions): Move[] {
    const generated = this._generate();
    const legal: Move[] = [];
    for (const move of generated) {
      this._apply(move);
      const king = this.kingSquare(move.color);
      if (king >= 0 && !this.isAttacked(king, opposite(move.color))) legal.push(move);
      this._undoApply(move);
    }
    if (options && options.square !== undefined && options.square !== null) {
      const from = typeof options.square === 'string' ? nameToSquare(options.square) : options.square;
      return legal.filter((move) => move.from === from);
    }
    return legal;
  }

  _apply(move: Move): void {
    const board = this.board;
    move._undo = {
      castling: { ...this.castling },
      ep: this.ep,
      halfmove: this.halfmove,
      fullmove: this.fullmove,
    };

    if (move.captured && move.capturedSq !== null) board[move.capturedSq] = '';
    board[move.from] = '';
    board[move.to] = move.promotion
      ? (move.color === WHITE ? move.promotion.toUpperCase() : move.promotion)
      : move.piece;

    if (move.flags.includes('k')) {
      if (move.color === WHITE) { board[63] = ''; board[61] = 'R'; }
      else { board[7] = ''; board[5] = 'r'; }
    } else if (move.flags.includes('q') && move.piece.toLowerCase() === 'k') {
      if (move.color === WHITE) { board[56] = ''; board[59] = 'R'; }
      else { board[0] = ''; board[3] = 'r'; }
    }

    const rights = this.castling;
    if (move.piece === 'K') { rights.K = false; rights.Q = false; }
    if (move.piece === 'k') { rights.k = false; rights.q = false; }
    if (move.from === 63 || move.capturedSq === 63) rights.K = false;
    if (move.from === 56 || move.capturedSq === 56) rights.Q = false;
    if (move.from === 7 || move.capturedSq === 7) rights.k = false;
    if (move.from === 0 || move.capturedSq === 0) rights.q = false;

    this.ep = move.flags.includes('b') ? move.from + (move.color === WHITE ? -8 : 8) : null;
    this.halfmove = (move.piece.toLowerCase() === 'p' || move.captured) ? 0 : this.halfmove + 1;
    if (move.color === BLACK) this.fullmove++;
    this.turn = opposite(move.color);
  }

  _undoApply(move: Move): void {
    const undo = move._undo;
    if (!undo) return;
    const board = this.board;
    board[move.from] = move.piece;
    board[move.to] = '';
    if (move.captured && move.capturedSq !== null) board[move.capturedSq] = move.captured;

    if (move.flags.includes('k')) {
      if (move.color === WHITE) { board[61] = ''; board[63] = 'R'; }
      else { board[5] = ''; board[7] = 'r'; }
    } else if (move.flags.includes('q') && move.piece.toLowerCase() === 'k') {
      if (move.color === WHITE) { board[59] = ''; board[56] = 'R'; }
      else { board[3] = ''; board[0] = 'r'; }
    }

    this.castling = undo.castling;
    this.ep = undo.ep;
    this.halfmove = undo.halfmove;
    this.fullmove = undo.fullmove;
    this.turn = move.color;
  }

  _applyNull(): { turn: Color; ep: number | null } {
    const state = { turn: this.turn, ep: this.ep };
    this.turn = opposite(this.turn);
    this.ep = null;
    return state;
  }

  _undoNull(state: { turn: Color; ep: number | null }): void {
    this.turn = state.turn;
    this.ep = state.ep;
  }

  _nonPawnMaterial(color: Color): number {
    let total = 0;
    for (let i = 0; i < 64; i++) {
      const piece = this.board[i];
      if (!piece) continue;
      if (colorOf(piece) !== color) continue;
      const type = piece.toLowerCase();
      if (type !== 'p' && type !== 'k') total += values[type];
    }
    return total;
  }

  _san(move: Move, legal: Move[]): string {
    if (move.flags.includes('k')) return 'O-O';
    if (move.flags.includes('q') && move.piece.toLowerCase() === 'k') return 'O-O-O';

    const type = move.piece.toLowerCase();
    let san = type === 'p' ? '' : SAN_LETTERS[type];
    if (type !== 'p') {
      const others = legal.filter((other) =>
        other !== move &&
        other.piece.toLowerCase() === type &&
        other.to === move.to &&
        other.from !== move.from
      );
      if (others.length) {
        const sameFile = others.some((other) => (other.from & 7) === (move.from & 7));
        const sameRank = others.some((other) => (other.from >> 3) === (move.from >> 3));
        if (!sameFile) san += FILES[move.from & 7];
        else if (!sameRank) san += String(8 - (move.from >> 3));
        else san += squareName(move.from);
      }
    }
    if (move.captured) {
      if (type === 'p') san += FILES[move.from & 7];
      san += 'x';
    }
    san += squareName(move.to);
    if (move.promotion) san += '=' + SAN_LETTERS[move.promotion];
    return san;
  }

  move(input: MoveInput): Move | null {
    if (!input || input.from === undefined || input.to === undefined) return null;
    const from = typeof input.from === 'string' ? nameToSquare(input.from) : input.from;
    const to = typeof input.to === 'string' ? nameToSquare(input.to) : input.to;
    if (from < 0 || to < 0) return null;
    const legal = this.moves();
    let matches = legal.filter((move) => move.from === from && move.to === to);
    if (!matches.length) return null;
    if (input.promotion) {
      matches = matches.filter((move) => move.promotion === input.promotion);
    } else if (matches.some((move) => move.promotion)) {
      matches = matches.filter((move) => move.promotion === 'q');
    }
    const move = matches[0];
    if (!move) return null;
    const base = this._san(move, legal);
    this._apply(move);
    let suffix = '';
    if (this.inCheck()) suffix = this.moves().length ? '+' : '#';
    move.san = base + suffix;
    this._history.push(move);
    const key = this._key();
    this._counts.set(key, (this._counts.get(key) || 0) + 1);
    return move;
  }

  undo(): Move | null {
    const move = this._history.pop();
    if (!move) return null;
    const key = this._key();
    const count = (this._counts.get(key) || 1) - 1;
    if (count <= 0) this._counts.delete(key);
    else this._counts.set(key, count);
    this._undoApply(move);
    return move;
  }

  historyMoves(): Move[] {
    return this._history.slice();
  }

  isInsufficientMaterial(): boolean {
    let pawns = 0;
    let majors = 0;
    let knights = 0;
    const bishops: Record<Color, number[]> = { w: [], b: [] };
    for (let i = 0; i < 64; i++) {
      const piece = this.board[i];
      if (!piece) continue;
      const type = piece.toLowerCase();
      const color = colorOf(piece);
      if (type === 'p') pawns++;
      else if (type === 'r' || type === 'q') majors++;
      else if (type === 'n') knights++;
      else if (type === 'b') bishops[color].push((i >> 3) + (i & 7));
    }
    if (pawns || majors) return false;
    const minors = knights + bishops.w.length + bishops.b.length;
    if (minors <= 1) return true;
    if (knights === 0 && bishops.w.length === 1 && bishops.b.length === 1) {
      return bishops.w[0] % 2 === bishops.b[0] % 2;
    }
    return false;
  }

  isThreefoldRepetition(): boolean {
    return (this._counts.get(this._key()) || 0) >= 3;
  }

  isFiftyMoveDraw(): boolean {
    return this.halfmove >= 100;
  }

  isCheckmate(): boolean {
    return this.inCheck() && this.moves().length === 0;
  }

  isStalemate(): boolean {
    return !this.inCheck() && this.moves().length === 0;
  }

  isDraw(): boolean {
    return this.isFiftyMoveDraw() || this.isInsufficientMaterial() || this.isThreefoldRepetition();
  }
}

const values: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

const PST: Record<string, number[]> = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0,
  ],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  kMid: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20,
  ],
  kEnd: [
    -50, -40, -30, -20, -20, -30, -40, -50,
    -30, -20, -10, 0, 0, -10, -20, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -30, 0, 0, 0, 0, -30, -30,
    -50, -30, -30, -30, -30, -30, -30, -50,
  ],
};

const PASSED_BONUS = [0, 10, 18, 32, 55, 82, 115, 0];
const ISOLATED_PENALTY = 14;
const DOUBLED_PENALTY = 12;
const ROOK_OPEN_FILE = 22;
const ROOK_SEMI_OPEN_FILE = 11;
const KING_SHIELD_BONUS = 8;

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

interface PawnContext {
  pawnFiles: { w: number[]; b: number[] };
  pawnList: { w: number[]; b: number[] };
}

function evaluate(chess: Chess): number {
  const board = chess.board;
  let material = 0;
  let nonPawn = 0;
  let bishopsW = 0;
  let bishopsB = 0;
  const kings: Record<Color, number> = { w: -1, b: -1 };
  const pawns: PawnContext = {
    pawnFiles: { w: new Array(10).fill(0), b: new Array(10).fill(0) },
    pawnList: { w: [], b: [] },
  };

  for (let i = 0; i < 64; i++) {
    const piece = board[i];
    if (!piece) continue;
    const type = piece.toLowerCase();
    if (type === 'k') {
      kings[colorOf(piece)] = i;
      continue;
    }
    const value = values[type];
    if (type !== 'p') {
      nonPawn += value;
    } else {
      const color = colorOf(piece);
      pawns.pawnFiles[color][i & 7]++;
      pawns.pawnList[color].push(i);
    }
    if (type === 'b') {
      if (piece === 'B') bishopsW++;
      else bishopsB++;
    }
    const white = piece === piece.toUpperCase();
    const index = white ? i : (i ^ 56);
    const score = value + PST[type][index];
    material += white ? score : -score;
  }

  if (bishopsW >= 2) material += 25;
  if (bishopsB >= 2) material -= 25;

  for (let f = 0; f < 8; f++) {
    const wCount = pawns.pawnFiles.w[f];
    const bCount = pawns.pawnFiles.b[f];
    if (wCount > 1) material -= DOUBLED_PENALTY * (wCount - 1);
    if (bCount > 1) material += DOUBLED_PENALTY * (bCount - 1);
    const wAdjacent = pawns.pawnFiles.w[f - 1] + pawns.pawnFiles.w[f + 1];
    const bAdjacent = pawns.pawnFiles.b[f - 1] + pawns.pawnFiles.b[f + 1];
    if (wCount > 0 && wAdjacent === 0) material -= ISOLATED_PENALTY * wCount;
    if (bCount > 0 && bAdjacent === 0) material += ISOLATED_PENALTY * bCount;
  }

  for (const idx of pawns.pawnList.w) {
    const row = idx >> 3;
    const file = idx & 7;
    let passed = true;
    for (const blocker of pawns.pawnList.b) {
      const bRow = blocker >> 3;
      const bFile = blocker & 7;
      if (bRow < row && Math.abs(bFile - file) <= 1) {
        passed = false;
        break;
      }
    }
    if (passed) material += PASSED_BONUS[7 - row];
  }

  for (const idx of pawns.pawnList.b) {
    const row = idx >> 3;
    const file = idx & 7;
    let passed = true;
    for (const blocker of pawns.pawnList.w) {
      const wRow = blocker >> 3;
      const wFile = blocker & 7;
      if (wRow > row && Math.abs(wFile - file) <= 1) {
        passed = false;
        break;
      }
    }
    if (passed) material -= PASSED_BONUS[row];
  }

  for (let i = 0; i < 64; i++) {
    const piece = board[i];
    if (piece !== 'R' && piece !== 'r') continue;
    const white = piece === 'R';
    const color = white ? WHITE : BLACK;
    const file = i & 7;
    const own = pawns.pawnFiles[color][file];
    const enemy = pawns.pawnFiles[opposite(color)][file];
    if (own === 0) {
      material += white ? (enemy === 0 ? ROOK_OPEN_FILE : ROOK_SEMI_OPEN_FILE)
                        : -(enemy === 0 ? ROOK_OPEN_FILE : ROOK_SEMI_OPEN_FILE);
    }
  }

  const kingTable = nonPawn < 1500 ? PST.kEnd : PST.kMid;
  const endgame = kingTable === PST.kEnd;
  for (const color of [WHITE, BLACK] as Color[]) {
    const kingIdx = kings[color];
    if (kingIdx < 0) continue;
    const kingRow = kingIdx >> 3;
    const kingFile = kingIdx & 7;
    if (!endgame) {
      let shield = 0;
      for (let f = kingFile - 1; f <= kingFile + 1; f++) {
        if (f < 0 || f > 7) continue;
        const dir = color === WHITE ? -1 : 1;
        const rowA = kingRow + dir;
        const rowB = kingRow + dir * 2;
        for (const rr of [rowA, rowB]) {
          if (rr < 0 || rr > 7) continue;
          const sq = rr * 8 + f;
          const piece = board[sq];
          if (piece && piece.toLowerCase() === 'p' && colorOf(piece) === color) {
            shield++;
            break;
          }
        }
      }
      const shieldScore = shield * KING_SHIELD_BONUS;
      material += color === WHITE ? shieldScore : -shieldScore;
    }
    const kpst = kingTable[color === WHITE ? kingIdx : (kingIdx ^ 56)];
    material += color === WHITE ? kpst : -kpst;
  }

  return chess.turn === WHITE ? material : -material;
}

interface SearchContext {
  nodes: number;
  deadline: number;
  stop: boolean;
  killers: number[];
  history: number[][];
  plyKillers: number[][];
}

function orderMoves(moves: Move[], ctx: SearchContext | null, ply: number): void {
  const killerA = ctx && ctx.plyKillers[ply] ? ctx.plyKillers[ply][0] : 0;
  const killerB = ctx && ctx.plyKillers[ply] ? ctx.plyKillers[ply][1] : 0;
  for (const move of moves) {
    let score = 0;
    if (move.captured) {
      score += 1000000 + values[move.captured.toLowerCase()] * 8 - values[move.piece.toLowerCase()];
    }
    if (move.promotion) score += 9000 + values[move.promotion];
    const key = (move.from << 6) | move.to;
    if (killerA && key === killerA) score += 8000;
    else if (killerB && key === killerB) score += 7000;
    if (ctx && !move.captured) {
      score += ctx.history[move.from][move.to];
    }
    move._order = score;
  }
  moves.sort((a, b) => (b._order || 0) - (a._order || 0));
}

function quiesce(chess: Chess, alpha: number, beta: number, ctx: SearchContext, depthLeft: number): number {
  if (ctx.stop) return alpha;
  const stand = evaluate(chess);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  if (depthLeft <= 0) return alpha;
  if ((ctx.nodes++ & 255) === 0 && now() >= ctx.deadline) {
    ctx.stop = true;
    return alpha;
  }
  const moves = chess.moves().filter((move) => move.captured || move.promotion);
  orderMoves(moves, null, 0);
  for (const move of moves) {
    const gain = move.captured ? values[move.captured.toLowerCase()] : values[move.promotion || 'p'];
    if (stand + gain + 200 < alpha && !chess.inCheck()) continue;
    chess._apply(move);
    const score = -quiesce(chess, -beta, -alpha, ctx, depthLeft - 1);
    chess._undoApply(move);
    if (ctx.stop) return alpha;
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function search(chess: Chess, depth: number, alpha: number, beta: number, ply: number, canNull: boolean, ctx: SearchContext): number {
  if (ctx.stop) return alpha;
  if ((ctx.nodes++ & 255) === 0 && now() >= ctx.deadline) {
    ctx.stop = true;
    return alpha;
  }
  if (depth <= 0) return quiesce(chess, alpha, beta, ctx, 4);

  const moves = chess.moves();
  if (!moves.length) return chess.inCheck() ? -MATE + ply : 0;

  if (
    canNull &&
    depth >= 3 &&
    !chess.inCheck() &&
    chess._nonPawnMaterial(chess.turn) >= 1300 &&
    beta < MATE - 200
  ) {
    const nullState = chess._applyNull();
    const score = -search(chess, depth - 3, -beta, -beta + 1, ply + 1, false, ctx);
    chess._undoNull(nullState);
    if (ctx.stop) return alpha;
    if (score >= beta) return beta;
  }

  if (!ctx.plyKillers[ply]) ctx.plyKillers[ply] = [0, 0];
  orderMoves(moves, ctx, ply);

  let best = -Infinity;
  for (const move of moves) {
    chess._apply(move);
    const score = -search(chess, depth - 1, -beta, -alpha, ply + 1, true, ctx);
    chess._undoApply(move);
    if (ctx.stop) return best === -Infinity ? score : best;
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) {
      if (!move.captured) {
        const key = (move.from << 6) | move.to;
        if (ctx.plyKillers[ply][0] !== key) {
          ctx.plyKillers[ply][1] = ctx.plyKillers[ply][0];
          ctx.plyKillers[ply][0] = key;
        }
        ctx.history[move.from][move.to] += depth * depth;
      }
      break;
    }
  }
  return best;
}

export function bestMove(chess: Chess, options?: BestMoveOptions): Move | null {
  const config = options || {};
  const maxDepth = Math.max(1, config.depth || 3);
  const budget = Math.max(120, config.time || 900);
  const legal = chess.moves();
  if (!legal.length) return null;
  if (legal.length === 1) return legal[0];

  const ctx: SearchContext = {
    nodes: 0,
    deadline: now() + budget,
    stop: false,
    killers: [],
    history: Array.from({ length: 64 }, () => new Array(64).fill(0)),
    plyKillers: [],
  };

  orderMoves(legal, ctx, 0);
  let chosen = legal[0];

  for (let depth = 1; depth <= maxDepth; depth++) {
    let alpha = -Infinity;
    let localBest: Move | null = null;
    for (const move of legal) {
      chess._apply(move);
      const score = -search(chess, depth - 1, -Infinity, -alpha, 1, true, ctx);
      chess._undoApply(move);
      if (ctx.stop) break;
      move._rootScore = score;
      if (localBest === null || score > localBest._rootScore!) {
        localBest = move;
      }
      if (score > alpha) alpha = score;
    }
    if (ctx.stop) {
      if (localBest && localBest._rootScore! > (chosen._rootScore ?? - Infinity)) chosen = localBest;
      break;
    }
    if (localBest) {
      chosen = localBest;
      if (Math.abs(localBest._rootScore!) > MATE - 200) break;
    }
    legal.sort((a, b) => (b._rootScore === undefined ? -Infinity : b._rootScore) - (a._rootScore === undefined ? -Infinity : a._rootScore));
  }

  if (config.blunder && Math.random() < config.blunder) {
    const alternatives = legal.filter((move) => move !== chosen);
    if (alternatives.length) return alternatives[Math.floor(Math.random() * alternatives.length)];
  }
  return chosen;
}
