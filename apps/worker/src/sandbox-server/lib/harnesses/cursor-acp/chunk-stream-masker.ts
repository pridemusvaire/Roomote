import { maskText, type SecretSet } from './secret-mask';

/**
 * Masks one stream of text chunks. A secret the agent streams over several
 * chunks is whole only in the running text, so the last `longest secret - 1`
 * characters (the most a secret still being written can span) are held back
 * until more text, or the end of the stream, shows whether they are one.
 */
export class ChunkStreamMasker<Chunk extends { text: string }> {
  private held = '';
  private last: Chunk | undefined;

  constructor(private readonly secrets: SecretSet) {}

  /** The chunk that is safe to show now, or undefined while all is held. */
  push(chunk: Chunk): Chunk | undefined {
    this.last = chunk;
    const secrets = this.secrets.values;
    const holdBack = Math.max(0, ...secrets.map((secret) => secret.length - 1));
    const masked = maskText(this.held + chunk.text, secrets);
    const safeLength = Math.max(0, masked.length - holdBack);
    this.held = masked.slice(safeLength);

    return this.emit(masked.slice(0, safeLength));
  }
  /** The held tail, once the stream has ended; the masker is then reset. */
  end(): Chunk | undefined {
    const rest = this.held;
    this.held = '';

    return this.emit(rest);
  }

  private emit(text: string): Chunk | undefined {
    return text.length > 0 && this.last ? { ...this.last, text } : undefined;
  }
}
