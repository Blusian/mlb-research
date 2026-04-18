export const hitterWeights = {
  overall: {
    splitSkill: 0.19,
    power: 0.14,
    discipline: 0.1,
    contactQuality: 0.16,
    recentForm: 0.15,
    pitcherVulnerability: 0.14,
    parkBoost: 0.05,
    lineupContext: 0.07,
  },
  homeRun: {
    power: 0.28,
    barrel: 0.24,
    hardHit: 0.16,
    pitcherPowerAllowed: 0.18,
    homeRunParkBoost: 0.14,
  },
  floor: {
    contact: 0.24,
    discipline: 0.18,
    recentForm: 0.18,
    lineupContext: 0.18,
    pitcherVulnerability: 0.12,
    parkBoost: 0.1,
  },
  risk: {
    strikeoutRisk: 0.34,
    lineupVolatility: 0.18,
    weakSplit: 0.2,
    weakForm: 0.16,
    pitcherDifficulty: 0.12,
  },
} as const;

export const pitcherWeights = {
  overall: {
    strikeoutSkill: 0.2,
    control: 0.16,
    contactSuppression: 0.16,
    recentForm: 0.16,
    workload: 0.12,
    matchup: 0.12,
    environment: 0.08,
  },
  strikeoutUpside: {
    strikeoutSkill: 0.36,
    swingMiss: 0.24,
    opponentStrikeouts: 0.24,
    workload: 0.16,
  },
  safety: {
    control: 0.24,
    contactSuppression: 0.24,
    recentForm: 0.18,
    workload: 0.18,
    environment: 0.16,
  },
  blowupRisk: {
    hardHitAllowed: 0.24,
    barrelAllowed: 0.24,
    walkRisk: 0.2,
    opponentPower: 0.18,
    environmentRisk: 0.14,
  },
} as const;
