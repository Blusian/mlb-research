import 'dotenv/config';

import { readFileSync } from 'node:fs';

import { env } from '../../config/env.js';
import { parseCliArgs } from '../cli.js';
import { OddsArchive } from '../oddsArchive.js';
import { parseOddsCsv, resolveOddsRecords } from '../odds.js';
import { SnapshotArchive } from '../snapshotArchive.js';

const run = async () => {
  const args = parseCliArgs(process.argv.slice(2));
  const filePath = args.file;

  if (!filePath) {
    throw new Error('Pass an odds CSV file with --file=/path/to/odds.csv');
  }

  const csv = readFileSync(filePath, 'utf8');
  const parsedRows = parseOddsCsv(csv);
  const snapshotArchive = new SnapshotArchive(env.MODELING_SNAPSHOT_DIRECTORY);
  const snapshotMap = new Map(
    snapshotArchive.list().map((snapshot) => [snapshot.analysisDate, snapshot]),
  );
  const records = resolveOddsRecords(parsedRows, snapshotMap);
  const archive = new OddsArchive(env.MODELING_ODDS_DIRECTORY);
  const savedPaths = archive.upsert(records);

  console.log(
    JSON.stringify(
      {
        importedRecords: records.length,
        dates: [...new Set(records.map((record) => record.analysisDate))].sort(),
        savedPaths,
      },
      null,
      2,
    ),
  );
};

void run();
