import type { OddsRecord } from './types.js';
import {
  listDatedRecords,
  readDatedRecord,
  writeDatedRecord,
} from './archiveUtils.js';

const oddsKey = (record: OddsRecord): string =>
  [
    record.market,
    record.gameId,
    record.entityId,
    record.selection,
    record.line ?? '',
    record.sportsbook ?? '',
    record.isClosing ? '1' : '0',
  ].join(':');

export class OddsArchive {
  public constructor(private readonly directory: string) {}

  public getByDate(analysisDate: string): OddsRecord[] {
    return readDatedRecord<OddsRecord[]>(this.directory, analysisDate) ?? [];
  }

  public list(): OddsRecord[] {
    return listDatedRecords<OddsRecord[]>(this.directory).flat();
  }

  public upsert(records: OddsRecord[]): string[] {
    const grouped = new Map<string, OddsRecord[]>();

    records.forEach((record) => {
      const existing = grouped.get(record.analysisDate) ?? [];
      existing.push(record);
      grouped.set(record.analysisDate, existing);
    });

    return Array.from(grouped.entries()).map(([analysisDate, incoming]) => {
      const merged = new Map<string, OddsRecord>();

      this.getByDate(analysisDate).forEach((record) => {
        merged.set(oddsKey(record), record);
      });

      incoming.forEach((record) => {
        merged.set(oddsKey(record), record);
      });

      return writeDatedRecord(
        this.directory,
        analysisDate,
        Array.from(merged.values()).sort((left, right) =>
          left.entityId.localeCompare(right.entityId),
        ),
      );
    });
  }
}
