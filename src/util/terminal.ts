export function stripTerminalNoise(input: string): string {
  if (!input) return input;

  // OSC 633 (VS Code shell integration): ESC ] 633 ; ... (terminated by BEL or ST)
  const OSC_VSCODE_633 = /\u001b\]633;.*?(?:\u0007|\u001b\\)/gs;

  // Generic OSC: ESC ] ... BEL | ST
  const OSC_GENERIC = /\u001b\].*?(?:\u0007|\u001b\\)/gs;

  // ANSI CSI sequences (including SGR colors): ESC [ ... final byte @-~
  const CSI_ANY = /\u001b\[[0-?]*[ -\/]*[@-~]/g;

  // Remove ANSI escape codes
  let cleaned = input
    .replace(OSC_VSCODE_633, '')
    .replace(OSC_GENERIC, '')
    .replace(CSI_ANY, '');

  // Handle carriage returns: process each line separately
  // Split on any CR (not followed by LF) and keep all non-empty segments
  return cleaned
    .split(/\r(?!\n)/)
    .filter(s => s.trim())
    .join('\n');
}

export function cleanAndSplitLines(chunk: string): string[] {
  const cleaned = stripTerminalNoise(chunk);
  // Normalize Windows newlines and split
  return cleaned.replace(/\r\n/g, '\n').split('\n');
}

