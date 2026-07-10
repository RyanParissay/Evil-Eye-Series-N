/**
 * Generic file-backed JSON persistence — the app's deliberately-not-a-
 * database pattern, shared by every store: crash-safe writes
 * (write-then-rename) and serialized read-modify-write cycles so concurrent
 * mutators can't lose each other's updates.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export class JsonStore<T> {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    /** State when the file is missing or corrupt. */
    private readonly empty: () => T,
    /** Shapes whatever parsed off disk into a full T (defaults, migrations). */
    private readonly normalize: (parsed: unknown) => T,
  ) {}

  async read(): Promise<T> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      return this.normalize(JSON.parse(raw));
    } catch {
      return this.empty();
    }
  }

  /**
   * Serialized read-modify-write: mutators run one at a time, in call order,
   * each seeing the previous one's writes. The mutator returns the next
   * state plus a result to hand back to the caller.
   */
  update<R>(
    mutate: (data: T) => { data: T; result: R } | Promise<{ data: T; result: R }>,
  ): Promise<R> {
    const run = async (): Promise<R> => {
      const { data, result } = await mutate(await this.read());
      await this.write(data);
      return result;
    };
    const next = this.queue.then(run, run);
    // A rejected mutator must not wedge the chain for later callers.
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async write(data: T): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await rename(tmp, this.filePath);
  }
}
