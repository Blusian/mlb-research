export interface StatGlossaryEntry {
  label: string;
  description: string;
}

export const STAT_GLOSSARY = {
  ab: {
    label: 'AB',
    description:
      'At-bats. Official batting chances that exclude walks, hit-by-pitches, sacrifice bunts, and catcher interference.',
  },
  avg: {
    label: 'AVG',
    description:
      'Batting average. Hits divided by at-bats. When shown as "AVG vs hand", it is the hitter’s average against that pitcher handedness.',
  },
  obp: {
    label: 'OBP',
    description:
      'On-base percentage. How often a hitter reaches base through hits, walks, and hit-by-pitches.',
  },
  slg: {
    label: 'SLG',
    description:
      'Slugging percentage. Total bases divided by at-bats, used as a quick measure of power.',
  },
  ops: {
    label: 'OPS',
    description:
      'On-base plus slugging. OBP + SLG. A quick summary of overall offensive production.',
  },
  xwoba: {
    label: 'xwOBA',
    description:
      'Expected weighted on-base average. Statcast’s quality-of-contact estimate of overall offensive value.',
  },
  xba: {
    label: 'xBA',
    description:
      'Expected batting average. Statcast estimate of how often a hitter should record a hit based on contact quality.',
  },
  xslg: {
    label: 'xSLG',
    description:
      'Expected slugging. Statcast estimate of slugging based on exit velocity and launch angle.',
  },
  pa: {
    label: 'PA',
    description:
      'Plate appearances. Every completed trip to the plate, including walks and hit-by-pitches.',
  },
  currentPa: {
    label: 'Current PA',
    description:
      'Current-season plate appearances used for the matchup split shown on the card.',
  },
  historyPa: {
    label: 'History PA',
    description:
      'Previous-season plate appearances used to stabilize the current-season split.',
  },
  bf: {
    label: 'BF',
    description:
      'Batters faced. The number of hitters a pitcher has faced.',
  },
  currentBf: {
    label: 'Current BF',
    description:
      'Current-season batters faced for the pitcher.',
  },
  historyBf: {
    label: 'History BF',
    description:
      'Previous-season batters faced used to stabilize the current pitcher profile.',
  },
  bvp: {
    label: 'BvP',
    description:
      'Batter vs pitcher. Historical head-to-head results between a hitter and the specific opposing pitcher.',
  },
  bvpPa: {
    label: 'BvP PA',
    description:
      'The number of historical plate appearances in the batter-vs-pitcher sample.',
  },
  bvpOps: {
    label: 'BvP OPS',
    description:
      'The hitter’s historical OPS against this specific pitcher.',
  },
  bvpHr: {
    label: 'BvP HR',
    description:
      'The hitter’s historical home run count against this specific pitcher.',
  },
  bvpScore: {
    label: 'BvP score',
    description:
      'A model score built from batter-vs-pitcher history. Larger samples matter more than tiny ones.',
  },
  hitScore: {
    label: 'Hit score',
    description:
      'The model’s overall hitting grade for today’s matchup.',
  },
  hrScore: {
    label: 'HR score',
    description:
      'The model’s home-run upside grade for today’s matchup.',
  },
  floorScore: {
    label: 'Floor',
    description:
      'A lower-volatility hitting score that leans toward stable contact and on-base skill.',
  },
  riskScore: {
    label: 'Risk',
    description:
      'A volatility score. Higher values mean more downside, strikeout risk, or blow-up risk.',
  },
  pitchScore: {
    label: 'Pitch',
    description:
      'The model’s overall pitcher grade for today’s matchup.',
  },
  safeScore: {
    label: 'Safe',
    description:
      'Pitcher safety score. Higher values mean a steadier run-prevention profile.',
  },
  mixFit: {
    label: 'Mix fit',
    description:
      'Pitch-mix fit. Measures how well the expected pitch mix matches the hitter or pitcher in this matchup.',
  },
  mixEdge: {
    label: 'Mix edge',
    description:
      'Pitch-mix edge. A pitcher-side score showing how favorable the arsenal looks against the opposing lineup.',
  },
  hardHitRate: {
    label: 'Hard-hit',
    description:
      'Hard-hit rate. Share of batted balls hit 95 mph or harder.',
  },
  barrelRate: {
    label: 'Barrel',
    description:
      'Barrel rate. Share of batted balls hit in Statcast’s ideal power zone for exit velocity and launch angle.',
  },
  squaredUpRate: {
    label: 'Squared-up',
    description:
      'Bat-tracking quality-of-contact rate. Higher values generally mean cleaner, more efficient contact.',
  },
  blastRate: {
    label: 'Blast rate',
    description:
      'Bat-tracking measure of especially forceful swings or contact events.',
  },
  batSpeed: {
    label: 'Bat speed',
    description:
      'Average bat speed from Statcast bat-tracking, shown in miles per hour.',
  },
  recentForm: {
    label: 'Recent form',
    description:
      'A blended recent-performance score built from recent games rather than a single raw stat.',
  },
  parkVsHand: {
    label: 'Park vs hand',
    description:
      'Park factor adjusted for the hitter’s handedness. Higher numbers favor offense.',
  },
  parkFactor: {
    label: 'Park factor',
    description:
      'Overall run-scoring environment for the park. Higher than 100 favors offense; lower than 100 favors pitchers.',
  },
  hrFactor: {
    label: 'HR factor',
    description:
      'Home-run factor for the park. Higher than 100 favors home runs.',
  },
  hand: {
    label: 'Hand',
    description:
      'Player handedness. For hitters this is batting side; for pitchers it is throwing hand.',
  },
  lineupSpot: {
    label: 'Spot / Order',
    description:
      'The projected or confirmed batting-order position in the lineup.',
  },
  kRate: {
    label: 'K rate',
    description:
      'Strikeout rate. Percentage of plate appearances or batters faced that end in strikeouts.',
  },
  bbRate: {
    label: 'BB rate',
    description:
      'Walk rate. Percentage of plate appearances or batters faced that end in walks.',
  },
  swStr: {
    label: 'SwStr',
    description:
      'Swinging-strike rate. The percentage of pitches that produce a swinging strike.',
  },
  projectedKs: {
    label: 'Proj Ks',
    description:
      'Projected strikeouts for the pitcher in today’s matchup.',
  },
  lineupKVsHand: {
    label: 'Lineup K vs hand',
    description:
      'Estimated strikeout tendency of the opposing lineup against the pitcher’s handedness.',
  },
  matchupKRate: {
    label: 'Matchup K rate',
    description:
      'The pitcher’s expected strikeout rate after adjusting for the opponent, park, and matchup context.',
  },
  kPark: {
    label: 'K park',
    description:
      'Strikeout park factor. Higher values make strikeouts more favorable for pitchers.',
  },
  ip: {
    label: 'IP',
    description:
      'Innings pitched. One inning equals three outs recorded.',
  },
  roleCertainty: {
    label: 'Role',
    description:
      'Role certainty. Higher values mean the model expects the pitcher to work a more stable starter workload.',
  },
  earlyExitRisk: {
    label: 'Early-exit risk',
    description:
      'Pitcher risk score for being pulled early because of matchup trouble, pitch count, or command.',
  },
  line: {
    label: 'Line',
    description:
      'The prop line or threshold the player must clear, such as Over 1.5 hits or Over 4.5 strikeouts.',
  },
  projection: {
    label: 'Projection',
    description:
      'The model’s estimated outcome for the stat in today’s game.',
  },
  confidenceScore: {
    label: 'Confidence score',
    description:
      'A model score summarizing how strong the matchup looks for the specific market.',
  },
  projectedPa: {
    label: 'Projected PA',
    description:
      'Estimated plate appearances for the hitter in today’s lineup context.',
  },
  tb: {
    label: 'TB',
    description:
      'Total bases. Single = 1, double = 2, triple = 3, home run = 4.',
  },
  rbi: {
    label: 'RBI',
    description:
      'Runs batted in. Runs scored because of the batter’s plate appearance, with a few official-scoring exceptions.',
  },
  hr: {
    label: 'HR',
    description:
      'Home runs. In scoring cards, "HR score" is the model’s home-run upside, not a raw home run count.',
  },
  runs: {
    label: 'Runs',
    description:
      'Runs scored by the hitter.',
  },
  hits: {
    label: 'Hits',
    description:
      'Hits recorded by the hitter.',
  },
  expectedBf: {
    label: 'Expected BF',
    description:
      'Expected batters faced for the pitcher in today’s workload projection.',
  },
  walks: {
    label: 'Walks',
    description:
      'Base on balls. Trips to first base awarded without a hit.',
  },
  walksAllowed: {
    label: 'Walks allowed',
    description:
      'Pitcher walks allowed. The number of batters the pitcher has put on base via walk.',
  },
  outs: {
    label: 'Outs',
    description:
      'Outs recorded by the pitcher. Three outs equals one full inning pitched.',
  },
  projectedOuts: {
    label: 'Projected outs',
    description:
      'The model’s estimate for how many outs the pitcher will record in today’s game.',
  },
  lineupSource: {
    label: 'Lineup source',
    description:
      'Shows whether the prop is using an official posted lineup, a projected lineup, or a mixed/partial lineup input.',
  },
  lineupConfidence: {
    label: 'Lineup confidence',
    description:
      'How complete and reliable the opposing lineup data is for this matchup projection.',
  },
  opponentWalkRate: {
    label: 'Opponent BB rate',
    description:
      'Estimated walk tendency of the opposing lineup, used to adjust pitcher walk expectations.',
  },
  pitchCap: {
    label: 'Pitch cap',
    description:
      'Pitch-count restriction risk. Higher values suggest a greater chance the pitcher is managed on workload.',
  },
  era: {
    label: 'ERA',
    description:
      'Earned run average. Earned runs allowed per nine innings.',
  },
  er: {
    label: 'ER',
    description:
      'Earned runs allowed by the pitcher.',
  },
  whip: {
    label: 'WHIP',
    description:
      'Walks plus hits per inning pitched. Lower is better for pitchers.',
  },
  fip: {
    label: 'FIP',
    description:
      'Fielding independent pitching. Estimates pitcher run prevention using strikeouts, walks, hit batters, and home runs.',
  },
  xFip: {
    label: 'xFIP',
    description:
      'Expected FIP. Similar to FIP, but normalizes home-run rate toward league average.',
  },
  startingPitcher: {
    label: 'SP',
    description:
      'Starting pitcher. The pitcher expected to begin the game.',
  },
  homePlateUmpire: {
    label: 'Home plate ump',
    description:
      'The home plate umpire. The strike zone can slightly affect pitcher and hitter outcomes.',
  },
  projectedTotalRuns: {
    label: 'Projected total',
    description:
      'Combined game run projection for both teams after lineup, pitcher, park, and weather adjustments.',
  },
  totalRuns: {
    label: 'Total runs',
    description:
      'Combined runs scored by both teams in the game. This is the live stat used for game-total over and under tracking.',
  },
  projectionConfidence: {
    label: 'Projection confidence',
    description:
      'Confidence level for the game-total projection based on lineup certainty, data quality, and matchup coverage.',
  },
  delta: {
    label: 'Delta',
    description:
      'Difference between the model projection and the betting line or target threshold.',
  },
  live: {
    label: 'Live',
    description:
      'The current live in-game stat total tracked for the selected prop.',
  },
  over45: {
    label: 'O4.5',
    description:
      'Over 4.5. The chance a pitcher records at least 5 strikeouts.',
  },
  over35: {
    label: 'O3.5',
    description:
      'Over 3.5. The chance a pitcher records at least 4 strikeouts.',
  },
  over: {
    label: 'Over',
    description:
      'An over prop wins when the player finishes above the selected line.',
  },
  under: {
    label: 'Under',
    description:
      'An under prop wins when the player finishes below the selected line.',
  },
  push: {
    label: 'Push',
    description:
      'A push means the final stat landed exactly on the line, so the prop neither wins nor loses.',
  },
} as const satisfies Record<string, StatGlossaryEntry>;

export type StatGlossaryKey = keyof typeof STAT_GLOSSARY;

const normalize = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');

const GLOSSARY_ALIASES: Record<string, StatGlossaryKey> = {
  ab: 'ab',
  avg: 'avg',
  'avg vs hand': 'avg',
  obp: 'obp',
  'obp vs hand': 'obp',
  slg: 'slg',
  'slg vs hand': 'slg',
  ops: 'ops',
  'ops vs hand': 'ops',
  xwoba: 'xwoba',
  'xwoba vs hand': 'xwoba',
  xba: 'xba',
  'xba vs hand': 'xba',
  xslg: 'xslg',
  'xslg vs hand': 'xslg',
  pa: 'pa',
  'current pa': 'currentPa',
  'history pa': 'historyPa',
  bf: 'bf',
  'expected bf': 'expectedBf',
  'current bf': 'currentBf',
  'history bf': 'historyBf',
  bvp: 'bvp',
  'bvp pa': 'bvpPa',
  'bvp ops': 'bvpOps',
  'bvp hr': 'bvpHr',
  'bvp score': 'bvpScore',
  'hit score': 'hitScore',
  'overall hit score': 'hitScore',
  'hr score': 'hrScore',
  'hr upside': 'hrScore',
  floor: 'floorScore',
  risk: 'riskScore',
  pitch: 'pitchScore',
  safe: 'safeScore',
  'mix fit': 'mixFit',
  'pitch mix': 'mixFit',
  'pitch mix fit': 'mixFit',
  'mix edge': 'mixEdge',
  'hard-hit': 'hardHitRate',
  'hard-hit rate': 'hardHitRate',
  barrel: 'barrelRate',
  'barrel rate': 'barrelRate',
  'squared-up': 'squaredUpRate',
  'squared-up rate': 'squaredUpRate',
  'blast rate': 'blastRate',
  'bat speed': 'batSpeed',
  'recent form': 'recentForm',
  'park vs hand': 'parkVsHand',
  'park factor': 'parkFactor',
  'hr factor': 'hrFactor',
  hand: 'hand',
  spot: 'lineupSpot',
  order: 'lineupSpot',
  'k rate': 'kRate',
  'k-rate': 'kRate',
  k: 'kRate',
  'bb rate': 'bbRate',
  'bb-rate': 'bbRate',
  bb: 'walks',
  swstr: 'swStr',
  'proj ks': 'projectedKs',
  'lineup k vs hand': 'lineupKVsHand',
  'matchup k rate': 'matchupKRate',
  'k park': 'kPark',
  ip: 'ip',
  role: 'roleCertainty',
  'early-exit risk': 'earlyExitRisk',
  line: 'line',
  projection: 'projection',
  'confidence score': 'confidenceScore',
  'projected pa': 'projectedPa',
  tb: 'tb',
  'total bases': 'tb',
  rbi: 'rbi',
  'runs batted in': 'rbi',
  hr: 'hr',
  'home run': 'hr',
  'home runs': 'hr',
  runs: 'runs',
  hits: 'hits',
  bases: 'tb',
  walks: 'walks',
  'walks allowed': 'walksAllowed',
  outs: 'outs',
  'projected outs': 'projectedOuts',
  'lineup source': 'lineupSource',
  'lineup confidence': 'lineupConfidence',
  official: 'lineupSource',
  projected: 'lineupSource',
  mixed: 'lineupSource',
  'official lineup': 'lineupSource',
  'projected lineup': 'lineupSource',
  'mixed lineup': 'lineupSource',
  'opp bb': 'opponentWalkRate',
  'opponent bb': 'opponentWalkRate',
  'opponent walk rate': 'opponentWalkRate',
  'pitch cap': 'pitchCap',
  strikeouts: 'projectedKs',
  'projected strikeouts': 'projectedKs',
  'walk rate': 'bbRate',
  'strikeout rate': 'kRate',
  'pitcher walk rate': 'bbRate',
  era: 'era',
  er: 'er',
  whip: 'whip',
  fip: 'fip',
  xfip: 'xFip',
  'away sp': 'startingPitcher',
  'home sp': 'startingPitcher',
  'home plate ump': 'homePlateUmpire',
  'projected total': 'projectedTotalRuns',
  'game total': 'totalRuns',
  'game total runs': 'totalRuns',
  'away projected runs': 'projectedTotalRuns',
  'home projected runs': 'projectedTotalRuns',
  'total projected runs': 'projectedTotalRuns',
  'total runs': 'totalRuns',
  'projection confidence': 'projectionConfidence',
  delta: 'delta',
  live: 'live',
  'over 3.5': 'over35',
  'over 4.5': 'over45',
  over: 'over',
  under: 'under',
  push: 'push',
  'o3.5': 'over35',
  'o4.5': 'over45',
};

export const resolveGlossaryKey = (label: string): StatGlossaryKey | null =>
  GLOSSARY_ALIASES[normalize(label)] ?? null;

export const glossaryEntries = Object.entries(STAT_GLOSSARY)
  .map(([key, entry]) => ({
    key: key as StatGlossaryKey,
    ...entry,
  }))
  .sort((left, right) => left.label.localeCompare(right.label));
