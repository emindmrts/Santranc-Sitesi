import { Chess, type Color, type Move, squareName, FILES } from './engine';

const PIECE_NAMES_TR: Record<string, string> = {
  p: 'piyon',
  n: 'at',
  b: 'fil',
  r: 'kale',
  q: 'vezir',
  k: 'şah',
};

export interface LossAnalysis {
  headline: string;
  blunderText: string;
  tacticalReason: string;
  tip: string;
  fullExplanation: string;
}

// PST and piece values helper for rapid board evaluation
const PIECE_VAL: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

function evaluatePosition(c: Chess, perspective: Color): number {
  const b = c.board;
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (!p) continue;
    const type = p.toLowerCase();
    const val = PIECE_VAL[type] || 0;
    const isWhite = p === p.toUpperCase();
    score += isWhite ? val : -val;
  }
  return perspective === 'w' ? score : -score;
}

export function explainLoss(chess: Chess, loserColor: Color): LossAnalysis {
  const history = chess.historyMoves();
  if (history.length === 0) {
    return {
      headline: 'Oyun çok erken bitti.',
      blunderText: '',
      tacticalReason: 'Tahtada yeterli hamle yapılmadan oyun sonlandı.',
      tip: 'Merkezi kontrol ederek oyuna başla.',
      fullExplanation: 'Tahtada yeterli hamle yapılmadan oyun sonlandı. Açılışta piyonlarla merkezi kontrol edip hafif taşları hızlıca geliştirmelisin.',
    };
  }

  // 1. Replay game to find the decisive blunder
  const replay = new Chess();
  let maxDrop = -Infinity;
  let decisiveBlunder: {
    moveNum: number;
    san: string;
    move: Move;
    drop: number;
    beforeFen: string;
  } | null = null;

  for (let i = 0; i < history.length; i++) {
    const move = history[i];
    const turn = replay.turn;
    const moveNum = Math.floor(i / 2) + 1;

    if (turn === loserColor) {
      const evalBefore = evaluatePosition(replay, loserColor);
      const beforeFen = replay.fen();
      replay.move(move);
      const evalAfter = evaluatePosition(replay, loserColor);
      const drop = evalBefore - evalAfter;

      if (drop > maxDrop) {
        maxDrop = drop;
        decisiveBlunder = {
          moveNum,
          san: move.san || `${squareName(move.from)}-${squareName(move.to)}`,
          move,
          drop,
          beforeFen,
        };
      }
    } else {
      replay.move(move);
    }
  }

  // 2. Analyze the final checkmate pattern
  const finalMove = history[history.length - 1];
  const matePieceType = finalMove ? finalMove.piece.toLowerCase() : 'q';
  const matePieceName = PIECE_NAMES_TR[matePieceType] || 'taş';
  const kingSq = chess.kingSquare(loserColor);
  const kingRank = 8 - Math.floor(kingSq / 8);
  const kingFile = FILES[kingSq % 8];

  let pattern = 'general';
  let tacticalReason = '';
  let tip = '';

  // Detect Back-rank mate (Arka sıra matı)
  const isBackRank = (loserColor === 'w' && kingRank === 1) || (loserColor === 'b' && kingRank === 8);
  if (isBackRank && (matePieceType === 'r' || matePieceType === 'q')) {
    pattern = 'back-rank';
    tacticalReason = `Şahın ${kingFile}${kingRank} karesinde kendi piyonlarının arkasında sıkışıp kaldı. Rakip ${matePieceName} arka sıraya sızarak savunmasız bir arka sıra matı vurdu.`;
    tip = 'Rok attıktan sonra h3/h6 veya g3/g6 sürerek şahına mutlaka kaçış karesi (hava deliği) aç.';
  }
  // Detect Scholar / f2-f7 weakness early in game
  else if (history.length <= 10 && (finalMove.to === 13 || finalMove.to === 53 || finalMove.to === 54 || finalMove.to === 14)) {
    pattern = 'early-f-weakness';
    tacticalReason = `Açılışta şahı koruyan en hassas kare olan ${squareName(finalMove.to)} karesi erkenden çöktü. Rakip vezir ve destek taşıyla erken mat ağı oluşturdu.`;
    tip = 'Açılışta f7/f2 piyonunu erken zayıflatma ve vezirin doğrudan şahına saldırmasını taş geliştirerek engelle.';
  }
  // Detect Queen coordination mate
  else if (matePieceType === 'q') {
    pattern = 'queen-crush';
    tacticalReason = `Rakip vezir, şahının etrafındaki zayıf karelere sızdı. Savunma taşlarının şahından kopması matı engelleyememene neden oldu.`;
    tip = 'Şah kanadına saldırı varken vezir kanadında gereksiz piyon toplamak yerine şahını savunmaya odaklan.';
  }
  // Knight/Bishop combination
  else if (matePieceType === 'n' || matePieceType === 'b') {
    pattern = 'minor-piece-mate';
    tacticalReason = `Rakip ${matePieceName} ve koordineli taşlar şahının kaçabileceği bütün kareleri kontrol altına aldı.`;
    tip = 'Açık hatları ve merkezi rakip hafif taşlara teslim etme; şahını koruyan fil ve atları erkenden feda etme.';
  }
  else {
    tacticalReason = `Rakip taş koordinasyonu şahının tüm kaçış karelerini kesti ve savunma blokajını aştı.`;
    tip = 'Oyun sonuna doğru şah güvenliğini daima birinci planda tut.';
  }

  // 3. Assemble decisive blunder commentary
  let blunderText = '';
  if (decisiveBlunder && decisiveBlunder.drop > 150) {
    const movedPieceName = PIECE_NAMES_TR[decisiveBlunder.move.piece.toLowerCase()] || 'taş';
    blunderText = `${decisiveBlunder.moveNum}. hamledeki **${decisiveBlunder.san}** (${movedPieceName}) hamlesi konumsal dengeni bozdu ve savunma hatlarını zayıflattı.`;
  } else if (decisiveBlunder) {
    blunderText = `${decisiveBlunder.moveNum}. hamleden itibaren rakip inisiyatifi ele geçirdi ve savunman baskı altında dağıldı.`;
  } else {
    blunderText = `Oyunun son bölümünde gelişen taktiksel baskı savunmanı aştı.`;
  }

  const headline = pattern === 'back-rank' ? 'Arka sıra zafiyeti nedeniyle mat oldun.'
    : pattern === 'early-f-weakness' ? 'Erken şah kanadı zaafiyeti nedeniyle mat oldun.'
    : 'Taş koordinasyonunun dağılması nedeniyle mat oldun.';

  const fullExplanation = `${blunderText} ${tacticalReason} ${tip}`;

  return {
    headline,
    blunderText,
    tacticalReason,
    tip,
    fullExplanation,
  };
}
