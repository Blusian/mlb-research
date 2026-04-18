import { average, clamp } from '../providers/live/statsApiUtils.js';
import {
  buildHomeRunFeatureVector,
  trainHomeRunModel,
  type HomeRunTrainingExample,
} from './homeRunModel.js';
import { derivePredictionsForMarket, settlePredictions } from './marketModels.js';
import { OddsArchive } from './oddsArchive.js';
import { ResolvedResultArchive } from './resolvedResultArchive.js';
import { SnapshotArchive } from './snapshotArchive.js';
import type {
  AnalysisSnapshot,
  BacktestOptions,
  BacktestReport,
  BettingStrategyReport,
  ProbabilityMetrics,
  ReliabilityBucket,
  ResolvedDailyResults,
  SettledPrediction,
} from './types.js';

const clampProbability = (value: number): number => clamp(value, 0.001, 0.999);

const defaultBacktestOptions = {
  minEdge: 0.03,
  minCalibrationSamples: 30,
} satisfies Omit<BacktestOptions, 'market'>;

const probabilityMetrics = (
  predictions: SettledPrediction[],
  selector: (prediction: SettledPrediction) => number,
): ProbabilityMetrics => {
  const probabilities = predictions.map((prediction) =>
    clampProbability(selector(prediction)),
  );
  const outcomes = predictions.map((prediction) => prediction.outcome);

  return {
    sampleSize: predictions.length,
    averageProbability: average(probabilities),
    actualRate: average(outcomes),
    brierScore: average(
      probabilities.map((probability, index) => {
        const outcome = outcomes[index];
        return outcome === undefined ? 0 : (probability - outcome) ** 2;
      }),
    ),
    logLoss: average(
      probabilities.map((probability, index) => {
        const outcome = outcomes[index];
        if (outcome === undefined) {
          return 0;
        }

        return -(
          outcome * Math.log(probability) +
          (1 - outcome) * Math.log(1 - probability)
        );
      }),
    ),
  };
};

const reliabilityBuckets = (
  predictions: SettledPrediction[],
  selector: (prediction: SettledPrediction) => number,
): ReliabilityBucket[] =>
  Array.from({ length: 10 }, (_, bucketIndex) => {
    const lowerBound = bucketIndex / 10;
    const upperBound = lowerBound + 0.1;
    const bucketPredictions = predictions.filter((prediction) => {
      const probability = selector(prediction);
      return (
        probability >= lowerBound &&
        (bucketIndex === 9 ? probability <= upperBound : probability < upperBound)
      );
    });

    if (bucketPredictions.length === 0) {
      return {
        lowerBound,
        upperBound,
        count: 0,
        averageProbability: 0,
        actualRate: 0,
      };
    }

    return {
      lowerBound,
      upperBound,
      count: bucketPredictions.length,
      averageProbability: average(bucketPredictions.map(selector)),
      actualRate: average(bucketPredictions.map((prediction) => prediction.outcome)),
    };
  });

const calibrateWalkForward = (
  predictions: SettledPrediction[],
  minCalibrationSamples: number,
): SettledPrediction[] => {
  const buckets = Array.from({ length: 10 }, () => ({
    count: 0,
    successes: 0,
  }));
  let totalCount = 0;
  let totalSuccesses = 0;

  return predictions.map((prediction) => {
    const bucketIndex = Math.min(9, Math.floor(prediction.rawProbability * 10));
    const bucket = buckets[bucketIndex];
    let calibratedProbability = prediction.rawProbability;

    if (totalCount >= minCalibrationSamples) {
      const overallRate = totalSuccesses / totalCount;

      if (bucket && bucket.count > 0) {
        const bucketRate = (bucket.successes + overallRate * 5) / (bucket.count + 5);
        calibratedProbability = clampProbability(
          bucketRate * 0.65 + prediction.rawProbability * 0.35,
        );
      } else {
        calibratedProbability = clampProbability(
          overallRate * 0.5 + prediction.rawProbability * 0.5,
        );
      }
    }

    if (bucket) {
      bucket.count += 1;
      bucket.successes += prediction.outcome;
    }

    totalCount += 1;
    totalSuccesses += prediction.outcome;

    return {
      ...prediction,
      calibratedProbability,
      edge:
        prediction.impliedProbability === undefined
          ? undefined
          : calibratedProbability - prediction.impliedProbability,
    };
  });
};

const bettingStrategyReport = (
  predictions: SettledPrediction[],
  minEdge: number,
): BettingStrategyReport | undefined => {
  const eligiblePredictions = predictions.filter(
    (prediction) =>
      prediction.decimalOdds !== undefined && prediction.impliedProbability !== undefined,
  );
  const betsPlaced = eligiblePredictions.filter(
    (prediction) => (prediction.edge ?? -Infinity) >= minEdge,
  );

  if (eligiblePredictions.length === 0) {
    return undefined;
  }

  const unitsWon = betsPlaced.reduce((total, prediction) => {
    if (prediction.outcome === 1) {
      return total + ((prediction.decimalOdds ?? 1) - 1);
    }

    return total - 1;
  }, 0);

  return {
    eligiblePredictions: eligiblePredictions.length,
    betsPlaced: betsPlaced.length,
    unitsRisked: betsPlaced.length,
    unitsWon,
    roi: betsPlaced.length > 0 ? unitsWon / betsPlaced.length : 0,
    averageEdge: average(betsPlaced.map((prediction) => prediction.edge ?? 0)),
    averageImpliedProbability: average(
      betsPlaced.map((prediction) => prediction.impliedProbability ?? 0),
    ),
    hitRate: average(betsPlaced.map((prediction) => prediction.outcome)),
  };
};

const assumptionsByMarket: Record<BacktestOptions['market'], string[]> = {
  game_moneyline_home: [
    'Home moneyline probabilities are derived from current hitter and starting pitcher rankings, not a trained team-level win model.',
    'If home-side odds are imported, the strategy compares calibrated home-win probability against the imported implied probability.',
  ],
  hitter_home_run: [
    'Home-run probabilities blend the heuristic home-run curve with a walk-forward logistic model once enough prior settled snapshots exist.',
    'Bat-tracking features and handedness-aware park factors are included in the home-run feature set before calibration.',
  ],
  pitcher_strikeouts: [
    'Pitcher strikeout probabilities require imported odds lines for the target line and side.',
    'Expected strikeouts blend strikeout rate, swinging-strike rate, opponent strikeout rate, and innings projection.',
  ],
  pitcher_walks: [
    'Pitcher walk probabilities require imported odds lines for the target line and side.',
    'Expected walks blend pitcher command indicators, opponent patience, and projected batters faced rather than using season BB% alone.',
  ],
  pitcher_outs: [
    'Pitcher outs probabilities require imported odds lines for the target line and side.',
    'Expected outs blend leash, pitch-efficiency, projected walks, and contact-management support instead of mapping straight from ERA.',
  ],
};

const buildHomeRunTrainingExamples = (
  snapshot: AnalysisSnapshot,
  results: ResolvedDailyResults,
): HomeRunTrainingExample[] => {
  const hitterOutcomes = new Map<string, 0 | 1>(
    results.hitters.map((hitter) => [
      `${hitter.gameId}:${hitter.playerId}`,
      hitter.homeRuns > 0 ? 1 : 0,
    ]),
  );

  return snapshot.analysis.rankings.hitters.flatMap((hitter) => {
    const outcome = hitterOutcomes.get(`${hitter.gameId}:${hitter.playerId}`);

    if (outcome === undefined) {
      return [];
    }

    return [
      {
        analysisDate: snapshot.analysisDate,
        playerId: hitter.playerId,
        gameId: hitter.gameId,
        features: buildHomeRunFeatureVector(hitter),
        outcome: outcome as 0 | 1,
      } satisfies HomeRunTrainingExample,
    ];
  });
};

export class BacktestService {
  public constructor(
    private readonly snapshotArchive: SnapshotArchive,
    private readonly resultArchive: ResolvedResultArchive,
    private readonly oddsArchive: OddsArchive,
  ) {}

  public runBacktest(
    options: Pick<BacktestOptions, 'market'> & Partial<Omit<BacktestOptions, 'market'>>,
  ): BacktestReport {
    const resolvedOptions = {
      ...defaultBacktestOptions,
      ...options,
    } satisfies BacktestOptions;
    const snapshotMap = new Map(
      this.snapshotArchive.list().map((snapshot) => [snapshot.analysisDate, snapshot]),
    );
    const resultMap = new Map(
      this.resultArchive.list().map((result) => [result.analysisDate, result]),
    );
    const oddsByDate = new Map<string, ReturnType<OddsArchive['getByDate']>>();

    this.oddsArchive.list().forEach((record) => {
      const existing = oddsByDate.get(record.analysisDate) ?? [];
      existing.push(record);
      oddsByDate.set(record.analysisDate, existing);
    });

    const dates = Array.from(snapshotMap.keys())
      .filter((analysisDate) => resultMap.has(analysisDate))
      .sort();
    const accumulatedHomeRunExamples: HomeRunTrainingExample[] = [];
    const settledPredictions = dates.flatMap((analysisDate) => {
      const snapshot = snapshotMap.get(analysisDate);
      const results = resultMap.get(analysisDate);

      if (!snapshot || !results) {
        return [];
      }

      const homeRunModel =
        resolvedOptions.market === 'hitter_home_run'
          ? trainHomeRunModel(accumulatedHomeRunExamples)
          : null;
      const settled = settlePredictions(
        derivePredictionsForMarket(
          snapshot,
          resolvedOptions.market,
          oddsByDate.get(analysisDate) ?? [],
          {
            homeRunModel,
          },
        ),
        results,
      );
      buildHomeRunTrainingExamples(snapshot, results).forEach((example) => {
        accumulatedHomeRunExamples.push(example);
      });

      return settled;
    });
    const calibratedPredictions = calibrateWalkForward(
      settledPredictions,
      resolvedOptions.minCalibrationSamples,
    );

    return {
      market: resolvedOptions.market,
      sampleSize: calibratedPredictions.length,
      dates,
      raw: probabilityMetrics(calibratedPredictions, (prediction) => prediction.rawProbability),
      calibrated: probabilityMetrics(
        calibratedPredictions,
        (prediction) => prediction.calibratedProbability ?? prediction.rawProbability,
      ),
      rawReliability: reliabilityBuckets(
        calibratedPredictions,
        (prediction) => prediction.rawProbability,
      ),
      calibratedReliability: reliabilityBuckets(
        calibratedPredictions,
        (prediction) => prediction.calibratedProbability ?? prediction.rawProbability,
      ),
      strategy: bettingStrategyReport(
        calibratedPredictions,
        resolvedOptions.minEdge,
      ),
      assumptions: assumptionsByMarket[resolvedOptions.market],
    };
  }
}
