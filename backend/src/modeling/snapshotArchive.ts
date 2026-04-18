import type { AnalysisSnapshot } from './types.js';
import {
  listDatedRecords,
  readDatedRecord,
  writeDatedRecord,
} from './archiveUtils.js';

export class SnapshotArchive {
  public constructor(private readonly directory: string) {}

  public get(analysisDate: string): AnalysisSnapshot | null {
    return readDatedRecord<AnalysisSnapshot>(this.directory, analysisDate);
  }

  public save(snapshot: AnalysisSnapshot): string {
    return writeDatedRecord(this.directory, snapshot.analysisDate, snapshot);
  }

  public list(): AnalysisSnapshot[] {
    return listDatedRecords<AnalysisSnapshot>(this.directory);
  }
}
