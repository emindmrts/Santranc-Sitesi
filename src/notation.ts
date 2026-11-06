export interface PgnInput {
  headers: Record<string, string>;
  sans: string[];
  result: string;
}

export function buildPgn(input: PgnInput): string {
  const headerLines = Object.entries(input.headers).map(([key, value]) => `[${key} "${value}"]`);

  let movetext = '';
  input.sans.forEach((san, index) => {
    if (index % 2 === 0) movetext += `${index / 2 + 1}. `;
    movetext += `${san} `;
  });
  movetext += input.result;

  const words = movetext.trim().split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && candidate.length > 80) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);

  return `${headerLines.join('\n')}\n\n${lines.join('\n')}\n`;
}
