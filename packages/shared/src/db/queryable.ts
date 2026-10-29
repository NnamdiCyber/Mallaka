/**
 * Minimal database interface used by services. Satisfied by `pg.Pool` and
 * `pg.PoolClient`, and by the pg-mem test pool, so services never import a
 * concrete pool in their business logic.
 */
export interface Queryable {
  query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }>;
}
