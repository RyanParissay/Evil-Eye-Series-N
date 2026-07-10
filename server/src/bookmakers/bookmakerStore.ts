/**
 * Persistence for the bookmaker registry — a JsonStore specialization.
 */
import type { BookmakerConfig } from '@shared/types';
import { JsonStore } from '../lib/jsonStore';

export interface BookmakerData {
  bookmakers: BookmakerConfig[];
}

/** Structural interface so tests can substitute an in-memory store. */
export interface BookmakerDataStore {
  read(): Promise<BookmakerData>;
  update<T>(
    mutate: (
      data: BookmakerData,
    ) => { data: BookmakerData; result: T } | Promise<{ data: BookmakerData; result: T }>,
  ): Promise<T>;
}

export class BookmakerStore extends JsonStore<BookmakerData> implements BookmakerDataStore {
  constructor(filePath: string) {
    super(
      filePath,
      () => ({ bookmakers: [] }),
      (parsed) => ({
        bookmakers: ((parsed ?? {}) as Partial<BookmakerData>).bookmakers ?? [],
      }),
    );
  }
}
