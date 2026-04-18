export const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
};

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const parseNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
};

export const parseDecimal = (value: unknown, fallback = 0): number => {
  const parsed = parseNumber(value, fallback);
  return Math.abs(parsed) > 1 ? parsed / 100 : parsed;
};

export const parseInningsPitched = (value: unknown): number => {
  const innings = String(value ?? '0');
  const [whole, partial] = innings.split('.');
  const outs = partial === '1' ? 1 : partial === '2' ? 2 : 0;

  return Number.parseInt(whole ?? '0', 10) + outs / 3;
};

export const scaleToScore = (value: number, min: number, max: number): number => {
  if (max <= min) {
    return 50;
  }

  return clamp(((value - min) / (max - min)) * 100, 0, 100);
};

export const inverseScaleToScore = (value: number, min: number, max: number): number =>
  100 - scaleToScore(value, min, max);

export const average = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

export interface ParkEventFactors {
  parkFactor: number;
  hitFactor: number;
  singleFactor: number;
  doubleFactor: number;
  tripleFactor: number;
  homeRunFactor: number;
  walkFactor: number;
  strikeoutFactor: number;
}

interface ParkBiasBlueprint {
  parkFactor: number;
  homeRunFactor: number;
  leftHandHomeRunDelta?: number;
  rightHandHomeRunDelta?: number;
  leftHandHitDelta?: number;
  rightHandHitDelta?: number;
  doubleFactor?: number;
  tripleFactor?: number;
  walkFactor?: number;
  strikeoutFactor?: number;
}

export interface ParkFactorProfile {
  overall: ParkEventFactors;
  vsLeft: ParkEventFactors;
  vsRight: ParkEventFactors;
}

const buildParkEventFactors = (
  parkFactor: number,
  homeRunFactor: number,
  overrides: Partial<ParkEventFactors> = {},
): ParkEventFactors => ({
  parkFactor,
  hitFactor: overrides.hitFactor ?? Math.round(parkFactor * 0.72 + homeRunFactor * 0.28),
  singleFactor: overrides.singleFactor ?? Math.round(parkFactor * 0.82 + 18),
  doubleFactor: overrides.doubleFactor ?? Math.round(parkFactor * 0.58 + homeRunFactor * 0.22 + 20),
  tripleFactor: overrides.tripleFactor ?? Math.round(parkFactor * 0.64 + (200 - homeRunFactor) * 0.24 + 12),
  homeRunFactor,
  walkFactor: overrides.walkFactor ?? Math.round(parkFactor * 0.22 + 78),
  strikeoutFactor: overrides.strikeoutFactor ?? Math.round((200 - parkFactor) * 0.16 + 84),
});

const parkFactorBlueprints: Record<string, ParkBiasBlueprint> = {
  ARI: { parkFactor: 102, homeRunFactor: 101, leftHandHomeRunDelta: 1, rightHandHomeRunDelta: 0, doubleFactor: 101, tripleFactor: 100, walkFactor: 101, strikeoutFactor: 99 },
  ATL: { parkFactor: 103, homeRunFactor: 108, leftHandHomeRunDelta: 3, rightHandHomeRunDelta: 1, doubleFactor: 100, tripleFactor: 95, walkFactor: 101, strikeoutFactor: 98 },
  BAL: { parkFactor: 100, homeRunFactor: 103, leftHandHomeRunDelta: -2, rightHandHomeRunDelta: 2, doubleFactor: 101, tripleFactor: 94, walkFactor: 100, strikeoutFactor: 99 },
  BOS: { parkFactor: 106, homeRunFactor: 99, leftHandHomeRunDelta: 4, rightHandHomeRunDelta: -6, leftHandHitDelta: -1, rightHandHitDelta: 4, doubleFactor: 118, tripleFactor: 103, walkFactor: 101, strikeoutFactor: 97 },
  CHC: { parkFactor: 101, homeRunFactor: 97, leftHandHomeRunDelta: -1, rightHandHomeRunDelta: -1, doubleFactor: 101, tripleFactor: 96, walkFactor: 100, strikeoutFactor: 100 },
  CWS: { parkFactor: 98, homeRunFactor: 101, leftHandHomeRunDelta: 1, rightHandHomeRunDelta: 1, doubleFactor: 98, tripleFactor: 94, walkFactor: 98, strikeoutFactor: 101 },
  CIN: { parkFactor: 106, homeRunFactor: 111, leftHandHomeRunDelta: 4, rightHandHomeRunDelta: 2, doubleFactor: 102, tripleFactor: 97, walkFactor: 102, strikeoutFactor: 97 },
  CLE: { parkFactor: 98, homeRunFactor: 96, leftHandHomeRunDelta: -1, rightHandHomeRunDelta: -2, doubleFactor: 97, tripleFactor: 96, walkFactor: 99, strikeoutFactor: 100 },
  COL: { parkFactor: 115, homeRunFactor: 118, leftHandHomeRunDelta: 1, rightHandHomeRunDelta: 1, doubleFactor: 119, tripleFactor: 126, walkFactor: 103, strikeoutFactor: 92 },
  DET: { parkFactor: 97, homeRunFactor: 94, leftHandHomeRunDelta: 1, rightHandHomeRunDelta: -2, doubleFactor: 103, tripleFactor: 104, walkFactor: 99, strikeoutFactor: 101 },
  HOU: { parkFactor: 100, homeRunFactor: 100, leftHandHomeRunDelta: 5, rightHandHomeRunDelta: -3, doubleFactor: 98, tripleFactor: 92, walkFactor: 99, strikeoutFactor: 100 },
  KC: { parkFactor: 98, homeRunFactor: 94, leftHandHomeRunDelta: -1, rightHandHomeRunDelta: -2, doubleFactor: 104, tripleFactor: 108, walkFactor: 98, strikeoutFactor: 101 },
  LAA: { parkFactor: 99, homeRunFactor: 104, leftHandHomeRunDelta: 1, rightHandHomeRunDelta: 2, doubleFactor: 99, tripleFactor: 94, walkFactor: 99, strikeoutFactor: 100 },
  LAD: { parkFactor: 100, homeRunFactor: 102, leftHandHomeRunDelta: 2, rightHandHomeRunDelta: 0, doubleFactor: 98, tripleFactor: 94, walkFactor: 99, strikeoutFactor: 99 },
  MIA: { parkFactor: 95, homeRunFactor: 92, leftHandHomeRunDelta: 0, rightHandHomeRunDelta: -1, doubleFactor: 97, tripleFactor: 98, walkFactor: 97, strikeoutFactor: 102 },
  MIL: { parkFactor: 100, homeRunFactor: 103, leftHandHomeRunDelta: 1, rightHandHomeRunDelta: 1, doubleFactor: 99, tripleFactor: 95, walkFactor: 100, strikeoutFactor: 99 },
  MIN: { parkFactor: 100, homeRunFactor: 101, leftHandHomeRunDelta: 2, rightHandHomeRunDelta: 0, doubleFactor: 100, tripleFactor: 96, walkFactor: 100, strikeoutFactor: 99 },
  NYM: { parkFactor: 98, homeRunFactor: 97, leftHandHomeRunDelta: 1, rightHandHomeRunDelta: -1, doubleFactor: 97, tripleFactor: 94, walkFactor: 99, strikeoutFactor: 100 },
  NYY: { parkFactor: 104, homeRunFactor: 108, leftHandHomeRunDelta: 9, rightHandHomeRunDelta: -5, leftHandHitDelta: 1, rightHandHitDelta: -2, doubleFactor: 97, tripleFactor: 88, walkFactor: 101, strikeoutFactor: 97 },
  ATH: { parkFactor: 95, homeRunFactor: 93, leftHandHomeRunDelta: 0, rightHandHomeRunDelta: -1, doubleFactor: 96, tripleFactor: 97, walkFactor: 98, strikeoutFactor: 101 },
  OAK: { parkFactor: 95, homeRunFactor: 93, leftHandHomeRunDelta: 0, rightHandHomeRunDelta: -1, doubleFactor: 96, tripleFactor: 97, walkFactor: 98, strikeoutFactor: 101 },
  PHI: { parkFactor: 104, homeRunFactor: 112, leftHandHomeRunDelta: 4, rightHandHomeRunDelta: 2, doubleFactor: 101, tripleFactor: 92, walkFactor: 101, strikeoutFactor: 97 },
  PIT: { parkFactor: 98, homeRunFactor: 95, leftHandHomeRunDelta: 2, rightHandHomeRunDelta: -2, leftHandHitDelta: -1, rightHandHitDelta: 1, doubleFactor: 103, tripleFactor: 101, walkFactor: 99, strikeoutFactor: 100 },
  SD: { parkFactor: 96, homeRunFactor: 94, leftHandHomeRunDelta: 1, rightHandHomeRunDelta: -1, doubleFactor: 98, tripleFactor: 95, walkFactor: 99, strikeoutFactor: 101 },
  SEA: { parkFactor: 95, homeRunFactor: 92, leftHandHomeRunDelta: 2, rightHandHomeRunDelta: -3, doubleFactor: 97, tripleFactor: 95, walkFactor: 98, strikeoutFactor: 102 },
  SF: { parkFactor: 95, homeRunFactor: 88, leftHandHomeRunDelta: 4, rightHandHomeRunDelta: -7, leftHandHitDelta: 0, rightHandHitDelta: -2, doubleFactor: 101, tripleFactor: 104, walkFactor: 99, strikeoutFactor: 102 },
  STL: { parkFactor: 99, homeRunFactor: 95, leftHandHomeRunDelta: 0, rightHandHomeRunDelta: -1, doubleFactor: 99, tripleFactor: 95, walkFactor: 99, strikeoutFactor: 100 },
  TB: { parkFactor: 97, homeRunFactor: 95, leftHandHomeRunDelta: 0, rightHandHomeRunDelta: -1, doubleFactor: 97, tripleFactor: 93, walkFactor: 99, strikeoutFactor: 101 },
  TEX: { parkFactor: 99, homeRunFactor: 97, leftHandHomeRunDelta: 1, rightHandHomeRunDelta: 0, doubleFactor: 98, tripleFactor: 94, walkFactor: 99, strikeoutFactor: 100 },
  TOR: { parkFactor: 101, homeRunFactor: 104, leftHandHomeRunDelta: 2, rightHandHomeRunDelta: 1, doubleFactor: 100, tripleFactor: 94, walkFactor: 100, strikeoutFactor: 99 },
  WAS: { parkFactor: 100, homeRunFactor: 102, leftHandHomeRunDelta: 3, rightHandHomeRunDelta: 0, doubleFactor: 101, tripleFactor: 95, walkFactor: 100, strikeoutFactor: 99 },
};

const toParkFactorProfile = (blueprint: ParkBiasBlueprint): ParkFactorProfile => {
  const overall = buildParkEventFactors(blueprint.parkFactor, blueprint.homeRunFactor, {
    doubleFactor: blueprint.doubleFactor,
    tripleFactor: blueprint.tripleFactor,
    walkFactor: blueprint.walkFactor,
    strikeoutFactor: blueprint.strikeoutFactor,
  });
  const vsLeft = buildParkEventFactors(
    clamp(blueprint.parkFactor + (blueprint.leftHandHitDelta ?? 0), 85, 125),
    clamp(blueprint.homeRunFactor + (blueprint.leftHandHomeRunDelta ?? 0), 75, 135),
    {
      hitFactor: clamp(overall.hitFactor + (blueprint.leftHandHitDelta ?? 0), 85, 125),
      singleFactor: clamp(overall.singleFactor + Math.round((blueprint.leftHandHitDelta ?? 0) * 0.8), 85, 125),
      doubleFactor: clamp(overall.doubleFactor + Math.round((blueprint.leftHandHitDelta ?? 0) * 0.5), 85, 130),
      tripleFactor: overall.tripleFactor,
      walkFactor: overall.walkFactor,
      strikeoutFactor: overall.strikeoutFactor,
    },
  );
  const vsRight = buildParkEventFactors(
    clamp(blueprint.parkFactor + (blueprint.rightHandHitDelta ?? 0), 85, 125),
    clamp(blueprint.homeRunFactor + (blueprint.rightHandHomeRunDelta ?? 0), 75, 135),
    {
      hitFactor: clamp(overall.hitFactor + (blueprint.rightHandHitDelta ?? 0), 85, 125),
      singleFactor: clamp(overall.singleFactor + Math.round((blueprint.rightHandHitDelta ?? 0) * 0.8), 85, 125),
      doubleFactor: clamp(overall.doubleFactor + Math.round((blueprint.rightHandHitDelta ?? 0) * 0.5), 85, 130),
      tripleFactor: overall.tripleFactor,
      walkFactor: overall.walkFactor,
      strikeoutFactor: overall.strikeoutFactor,
    },
  );

  return {
    overall,
    vsLeft,
    vsRight,
  };
};

export const parkFactorProfilesByHomeTeam: Record<string, ParkFactorProfile> = Object.fromEntries(
  Object.entries(parkFactorBlueprints).map(([team, blueprint]) => [
    team,
    toParkFactorProfile(blueprint),
  ]),
) as Record<string, ParkFactorProfile>;

export const parkFactorsByHomeTeam: Record<string, { parkFactor: number; homeRunFactor: number }> = Object.fromEntries(
  Object.entries(parkFactorProfilesByHomeTeam).map(([team, profile]) => [
    team,
    {
      parkFactor: profile.overall.parkFactor,
      homeRunFactor: profile.overall.homeRunFactor,
    },
  ]),
) as Record<string, { parkFactor: number; homeRunFactor: number }>;

export const resolveHandednessParkFactors = (
  homeTeamAbbreviation: string,
  batterHandedness: 'L' | 'R' | 'S' | 'U',
): ParkEventFactors => {
  const profile = parkFactorProfilesByHomeTeam[homeTeamAbbreviation];

  if (!profile) {
    return buildParkEventFactors(100, 100);
  }

  if (batterHandedness === 'L') {
    return profile.vsLeft;
  }

  if (batterHandedness === 'R') {
    return profile.vsRight;
  }

  if (batterHandedness === 'S') {
    return {
      parkFactor: Math.round((profile.vsLeft.parkFactor + profile.vsRight.parkFactor) / 2),
      hitFactor: Math.round((profile.vsLeft.hitFactor + profile.vsRight.hitFactor) / 2),
      singleFactor: Math.round((profile.vsLeft.singleFactor + profile.vsRight.singleFactor) / 2),
      doubleFactor: Math.round((profile.vsLeft.doubleFactor + profile.vsRight.doubleFactor) / 2),
      tripleFactor: Math.round((profile.vsLeft.tripleFactor + profile.vsRight.tripleFactor) / 2),
      homeRunFactor: Math.round((profile.vsLeft.homeRunFactor + profile.vsRight.homeRunFactor) / 2),
      walkFactor: Math.round((profile.vsLeft.walkFactor + profile.vsRight.walkFactor) / 2),
      strikeoutFactor: Math.round((profile.vsLeft.strikeoutFactor + profile.vsRight.strikeoutFactor) / 2),
    };
  }

  return profile.overall;
};
