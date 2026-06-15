/**
 * Stdin capture for piped prompts.
 *
 * Several CLI tools accept their prompt on stdin (`echo "..." | tool`).
 * To scan that prompt the wrapper must consume stdin, which means the
 * captured data has to be re-supplied to the real tool when execution is
 * allowed (see ExecutionOptions.stdinData in the process executor).
 */

/**
 * Maximum stdin capture size (1MB), matching the file-content limit.
 */
export const MAX_STDIN_SIZE = 1 * 1024 * 1024;

/**
 * Whether stdin is piped (not an interactive terminal).
 */
export function isStdinPiped(): boolean {
  return !process.stdin.isTTY;
}

/**
 * Read all of stdin as UTF-8 text.
 *
 * Only call this when stdin is piped; on a TTY this would block until EOF.
 * Input beyond MAX_STDIN_SIZE is truncated for scanning purposes.
 *
 * @returns The captured stdin content
 */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(buffer);
    total += buffer.length;
    if (total >= MAX_STDIN_SIZE) {
      break;
    }
  }

  const content = Buffer.concat(chunks).toString('utf-8');
  if (content.length > MAX_STDIN_SIZE) {
    return content.slice(0, MAX_STDIN_SIZE);
  }
  return content;
}
