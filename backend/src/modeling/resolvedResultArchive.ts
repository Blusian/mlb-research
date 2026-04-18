import type { ResolvedDailyResults } from './types.js';
import {
  listDatedRecords,
  readDatedRecord,
  writeDatedRecord,
} from './archiveUtils.js';

export class ResolvedResultArchive {
  public constructor(private readonly directory: string) {}

  public get(analysisDate: string): ResolvedDailyResults | null {
    return readDatedRecord<ResolvedDailyResults>(this.directory, analysisDate);
  }

  public save(results: ResolvedDailyResults): string {
    return writeDatedRecord(this.directory, results.analysisDate, results);
  }

  public list(): ResolvedDailyResults[] {
    return listDatedRecords<ResolvedDailyResults>(this.directory);
  }
}
