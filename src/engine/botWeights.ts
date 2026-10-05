// The numbers the bot weighs a position with. Each side can play with its own set (the tuner plays one set against
// another); without one it uses the tuned set from botWeights.json, else these defaults.
import tuned from '../../data/bot-weights.json';
import type { PlayerId } from './types';

export const DEFAULT_W = {
  objective: 40, // value of holding an objective by a clear margin
  homeExpensive: 0.25, // how much an expensive unit cares for the home objective
  objDealerPts: 160, // damage dealers costing more than this care less for objectives
  cautionHolder: 0.35, cautionBrawler: 0.45, cautionOther: 1, // how much expected losses count
  dangerShots: 0.35, dangerMelee: 0.8, dangerUnseen: 0.3,
  pullBrawler: 0.6, pullRange: 0.4, pullHolder: 1.5, pullObjective: 0.35, pullDeliver: 0.6,
  claimBonus: 15, claimPull: 1.5,
  crowdTouch: 4, crowdNear: 1.5,
  charLonely: 0.8,
  chargeNonBrawler: 0.5,
  heavyStill: 1.1,
  advanceMargin: 3, // an Advance must beat a Normal move by this much
};
export type BotW = typeof DEFAULT_W;

const BASE: BotW = { ...DEFAULT_W, ...(tuned as Partial<BotW>) };
const per: Partial<Record<PlayerId, BotW>> = {};

/** Give one side its own weights (the tuner); undefined goes back to the tuned set. */
export function setBotWeights(p: PlayerId, w?: Partial<BotW>) {
  if (w) per[p] = { ...BASE, ...w }; else delete per[p];
}

export const W = (p: PlayerId): BotW => per[p] ?? BASE;
export const baseWeights = (): BotW => ({ ...BASE });
