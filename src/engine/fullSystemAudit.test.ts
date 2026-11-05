import { describe, expect, it } from 'vitest';
import {
  MISSIONS,
  primaryFor,
  secondaryById,
  dispositionById,
  layoutsFor,
  RULES,
  type DispositionId,
} from './config';
import {
  canCrossDense,
  blockingWalls,
} from './pathing';
import { weaponFx } from './weaponFx';
import { stratagemBlock } from '../rules-engine/stratagems';
import {
  discardSecondary,
  armyPoints,
  reservesPoints,
} from './game';
import { secondaryDead } from './secondaries';
import type { GameState, ModelState, StratagemData, WeaponProfileData } from './types';

describe('Full System & Gameplay Audit — End-to-End Player Experience', () => {
  describe('1. Movement & Terrain Rules Audit (Infantry, Beast, Vehicles)', () => {
    it('INFANTRY and BEAST keywords move through dense ruin walls, while VEHICLES are blocked', () => {
      const beastModel = { id: 'm-beast', keywords: ['BEAST'], r: 0.5 } as unknown as ModelState;
      const beastPluralModel = { id: 'm-beasts', keywords: ['BEASTS'], r: 0.5 } as unknown as ModelState;
      const infantryModel = { id: 'm-infantry', keywords: ['INFANTRY'], r: 0.5 } as unknown as ModelState;
      const vehicleModel = { id: 'm-tank', keywords: ['VEHICLE'], r: 2.0 } as unknown as ModelState;
      const monsterModel = { id: 'm-monster', keywords: ['MONSTER'], r: 1.8 } as unknown as ModelState;

      // canCrossDense check
      expect(canCrossDense(beastModel)).toBe(true);
      expect(canCrossDense(beastPluralModel)).toBe(true);
      expect(canCrossDense(infantryModel)).toBe(true);
      expect(canCrossDense(vehicleModel)).toBe(false);
      expect(canCrossDense(monsterModel)).toBe(false);

      // blockingWalls check against dense terrain
      const s = {
        terrain: [
          { category: 'dense', height: 4, walls: [{ a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }] },
        ],
        units: [],
      } as unknown as GameState;

      expect(blockingWalls(s, beastModel)).toHaveLength(0);
      expect(blockingWalls(s, beastPluralModel)).toHaveLength(0);
      expect(blockingWalls(s, infantryModel)).toHaveLength(0);
      expect(blockingWalls(s, vehicleModel)).toHaveLength(1);
      expect(blockingWalls(s, monsterModel)).toHaveLength(1);
    });
  });

  describe('2. Weapon FX & Arrow Projectile Audit', () => {
    it('Bows (Fatecaster greatbow, Dart-bow) map to arrow projectile FX instead of psychic', () => {
      const fatecasterProf: WeaponProfileData = {
        name: 'Fatecaster greatbow',
        range: 30,
        A: '2',
        skill: 3,
        S: 5,
        AP: -2,
        D: '2',
        abilities: ['ignores cover', 'lethal hits', 'precision'],
      };
      expect(weaponFx('Fatecaster greatbow', fatecasterProf, false)).toBe('arrow');

      const dartBowProf: WeaponProfileData = {
        name: 'Dart-bow and tri-blade',
        range: 24,
        A: 'D3+1',
        skill: 3,
        S: 4,
        AP: 0,
        D: '2',
        abilities: [],
      };
      expect(weaponFx('Dart-bow and tri-blade', dartBowProf, false)).toBe('arrow');

      // Verify that genuine psychic weapons still correctly map to psychic
      const psychicProf: WeaponProfileData = {
        name: 'Smite',
        range: 24,
        A: 'D6',
        skill: 3,
        S: 6,
        AP: -1,
        D: 'D3',
        abilities: ['psychic'],
      };
      expect(weaponFx('Smite', psychicProf, false)).toBe('psychic');
    });
  });

  describe('3. Strategic Reserves Point Limits Audit', () => {
    it('Stratagems and redeploys strictly enforce Strategic Reserves cap (50% army points)', () => {
      const s = {
        phase: 'fight',
        round: 2,
        active: 1,
        log: [],
        players: [
          { name: 'P0', factionId: 'TS', cp: 3, detachments: [] },
          { name: 'P1', factionId: 'SM', cp: 3, detachments: [] },
        ],
        units: [
          // Total army: 1000 pts. Cap = 500 pts.
          { id: 'u1', owner: 0, pts: 520, keywords: ['MONSTER', 'SCINTILLATING LEGIONS'], factionKeywords: ['THOUSAND SONS'], status: 'board', buffs: [], models: [{ id: 'm1', wounds: 18, dead: false }] },
          { id: 'u2', owner: 0, pts: 480, keywords: ['INFANTRY'], factionKeywords: ['THOUSAND SONS'], status: 'board', buffs: [], models: [{ id: 'm2', wounds: 1, dead: false }] },
        ],
      } as unknown as GameState;

      const glimmershift: StratagemData = {
        id: 'glimmershift-portal',
        name: 'GLIMMERSHIFT PORTAL',
        cp: 1,
        type: 'Strategic Ploy',
        phase: 'fight',
        turn: 'opponent',
        text: 'Remove those units from the battlefield and place them into Strategic Reserves.',
      };

      // Army is 1000 pts, cap is 500 pts. Unit 1 is 520 pts -> must block!
      const blockReason = stratagemBlock(s, 0, glimmershift, s.units[0], { react: true });
      expect(blockReason).toContain('Strategic Reserves limit reached');

      // Unit 2 is 480 pts (<= 500 cap). It should be allowed!
      const allowReason = stratagemBlock(s, 0, glimmershift, s.units[1], { react: true });
      expect(allowReason).toBeNull();
    });
  });

  describe('4. Secondary Mission Discard & Redraw Audit', () => {
    it('Unachievable tactical secondaries discard and immediately redraw without waiting', () => {
      const s = {
        round: 2,
        active: 0,
        phase: 'shooting',
        log: [],
        fx: [],
        players: [
          {
            name: 'P0',
            cp: 1,
            secMode: 'tactical',
            secActive: ['assassination'],
            secDeck: ['no-prisoners'],
            sec: {},
          },
          {
            name: 'P1',
            cp: 1,
            secMode: 'tactical',
            secActive: [],
            secDeck: [],
            sec: {},
          },
        ],
        units: [
          { id: 'f1', owner: 0, status: 'board', models: [{ id: 'fm1', dead: false, profile: { M: 6 } }] },
          { id: 'e1', owner: 1, status: 'board', models: [{ id: 'em1', isCharacter: false, dead: false }] },
        ],
        objectives: [],
      } as unknown as GameState;

      // Enemy has no character alive -> Assassination is impossible (dead)
      expect(secondaryDead(s, 0, 'assassination')).toBe(true);

      // Discarding Assassination draws replacement instantly
      discardSecondary(s, 0, 'assassination');

      expect(s.players[0].secActive).not.toContain('assassination');
      expect(s.players[0].secActive).toContain('no-prisoners');
      expect(s.players[0].cp).toBe(2); // In your own turn, tactical discard awards +1 CP in sim mode
    });
  });

  describe('5. Tabletop Companion Matchup & Mission Scoring Logic Audit', () => {
    it('Every disposition pair has an official Primary Mission with structured scoring rules', () => {
      const dispositions: DispositionId[] = [
        'take-and-hold',
        'purge-the-foe',
        'disruption',
        'reconnaissance',
        'priority-assets',
      ];

      for (const d1 of dispositions) {
        for (const d2 of dispositions) {
          const primary = primaryFor(d1, d2);
          expect(primary).toBeDefined();
          expect(primary.name).toBeTruthy();
          expect(primary.scoring.length).toBeGreaterThan(0);

          for (const rule of primary.scoring) {
            expect(rule.text).toBeTruthy();
            const maxVp = rule.vp > 0 ? rule.vp : Math.max(...(rule.tiers ?? []).map((t) => t[1]));
            expect(maxVp).toBeGreaterThan(0);
          }

          // Verify official layouts exist for this matchup
          const layouts = layoutsFor(d1, d2);
          expect(layouts.length).toBeGreaterThan(0);
        }
      }
    });

    it('Secondary mission cards have valid descriptions, timing, and positive VP caps', () => {
      for (const card of MISSIONS.secondaries) {
        expect(card.id).toBeTruthy();
        expect(card.name).toBeTruthy();
        expect(card.when).toBeTruthy();
        expect(card.text).toBeTruthy();
        expect(card.auto.length).toBeGreaterThan(0);
        for (const auto of card.auto) {
          const maxVp = auto.vp > 0 ? auto.vp : Math.max(...(auto.tiers ?? []).map((t) => t[1]));
          expect(maxVp).toBeGreaterThan(0);
        }
      }
    });
  });
});
