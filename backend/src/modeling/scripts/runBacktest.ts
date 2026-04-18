import 'dotenv/config';

import { env } from '../../config/env.js';
import { BacktestService } from '../backtestService.js';
import { parseCliArgs } from '../cli.js';
import { OddsArchive } from '../oddsArchive.js';
import { ResolvedResultArchive } from '../resolvedResultArchive.js';
import { SnapshotArchive } from '../snapshotArchive.js';
import type { BacktestMarket } from '../types.js';

const run = async () => {
  const args = parseCliArgs(process.argv.slice(2));
  const market = (args.market ?? 'game_moneyline_home') as BacktestMarket;
  const service = new BacktestService(
    new SnapshotArchive(env.MODELING_SNAPSHOT_DIRECTORY),
    new ResolvedResultArchive(env.MODELING_RESULT_DIRECTORY),
    new OddsArchive(env.MODELING_ODDS_DIRECTORY),
  );
  const report = service.runBacktest({
    market,
    minEdge: Number.parseFloat(args['min-edge'] ?? '0.03'),
    minCalibrationSamples: Number.parseInt(
      args['min-calibration-samples'] ?? '30',
      10,
    ),
  });

  console.log(JSON.stringify(report, null, 2));
};

void run();
