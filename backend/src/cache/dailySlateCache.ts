import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface DailySlateCacheOptions {
  cacheDirectory?: string;
}

export class DailySlateCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();
  private readonly cacheDirectory: string | null;

  public constructor(
    private readonly ttlMs: number,
    options: DailySlateCacheOptions = {},
  ) {
    this.cacheDirectory = options.cacheDirectory
      ? path.resolve(options.cacheDirectory)
      : null;

    if (this.cacheDirectory && !existsSync(this.cacheDirectory)) {
      mkdirSync(this.cacheDirectory, { recursive: true });
    }
  }

  public get(key: string): T | null {
    const cached = this.store.get(key);

    if (cached) {
      if (this.isExpired(cached)) {
        this.store.delete(key);
        this.deletePersistedEntry(key);
        return null;
      }

      return cached.value;
    }

    const persisted = this.readPersistedEntry(key);

    if (!persisted) {
      return null;
    }

    if (this.isExpired(persisted)) {
      this.deletePersistedEntry(key);
      return null;
    }

    this.store.set(key, persisted);
    return persisted.value;
  }

  public set(key: string, value: T): void {
    const entry: CacheEntry<T> = {
      value,
      expiresAt: Date.now() + this.ttlMs,
    };

    this.store.set(key, entry);
    this.writePersistedEntry(key, entry);
  }

  public delete(key: string): void {
    this.store.delete(key);
    this.deletePersistedEntry(key);
  }

  private isExpired(entry: CacheEntry<T>): boolean {
    return entry.expiresAt <= Date.now();
  }

  private entryPath(key: string): string | null {
    if (!this.cacheDirectory) {
      return null;
    }

    const digest = createHash('sha1').update(key).digest('hex');
    return path.join(this.cacheDirectory, `${digest}.json`);
  }

  private readPersistedEntry(key: string): CacheEntry<T> | null {
    const entryPath = this.entryPath(key);

    if (!entryPath || !existsSync(entryPath)) {
      return null;
    }

    try {
      const raw = readFileSync(entryPath, 'utf8');
      return JSON.parse(raw) as CacheEntry<T>;
    } catch {
      this.deletePersistedEntry(key);
      return null;
    }
  }

  private writePersistedEntry(key: string, entry: CacheEntry<T>): void {
    const entryPath = this.entryPath(key);

    if (!entryPath) {
      return;
    }

    writeFileSync(entryPath, JSON.stringify(entry, null, 2), 'utf8');
  }

  private deletePersistedEntry(key: string): void {
    const entryPath = this.entryPath(key);

    if (!entryPath || !existsSync(entryPath)) {
      return;
    }

    rmSync(entryPath, { force: true });
  }
}
