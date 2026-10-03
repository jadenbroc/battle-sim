import { runBulk, type BulkResult } from './engine/bulk';
import type { FightConfig } from './engine/fight';

export interface BulkRequest {
  config: FightConfig;
  runs: number;
  seed: string;
}

export type BulkMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'result'; result: BulkResult };

const ctx = self as unknown as { postMessage(message: BulkMessage): void; onmessage: ((e: MessageEvent<BulkRequest>) => void) | null };

ctx.onmessage = (e) => {
  const { config, runs, seed } = e.data;
  const result = runBulk(config, runs, seed, (done, total) => ctx.postMessage({ type: 'progress', done, total }));
  ctx.postMessage({ type: 'result', result });
};
