import { DurableObject } from "cloudflare:workers";

export class RateLimiter extends DurableObject<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    void state.blockConcurrencyWhile(() => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS events (
          kind TEXT NOT NULL,
          occurred_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS events_kind_time ON events(kind, occurred_at);
      `);
      return Promise.resolve();
    });
  }

  count(kind: string, windowMs: number): number {
    const cutoff = Date.now() - windowMs;
    this.ctx.storage.sql.exec("DELETE FROM events WHERE occurred_at < ?", cutoff - 86_400_000);
    return this.ctx.storage.sql.exec<{ count: number }>(
      "SELECT COUNT(*) AS count FROM events WHERE kind = ? AND occurred_at >= ?", kind, cutoff,
    ).one().count;
  }

  record(kind: string): void {
    this.ctx.storage.sql.exec("INSERT INTO events (kind, occurred_at) VALUES (?, ?)", kind, Date.now());
  }

  consume(kind: string, windowMs: number, limit: number): boolean {
    if (this.count(kind, windowMs) >= limit) return false;
    this.record(kind);
    return true;
  }
}
