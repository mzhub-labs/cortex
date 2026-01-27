/**
 * Memory decay utilities for cortex.
 * Prevents the "stalker effect" by forgetting irrelevant facts over time.
 */

import type { MemoryFact } from "../types";

export interface DecayConfig {
  /** Enable automatic decay */
  enabled?: boolean;
  /** Default TTL for facts in days (null = never expire) */
  defaultTtlDays?: number | null;
  /** TTL for low-weight facts (confidence < 0.5) in days */
  lowWeightTtlDays?: number;
  /** Predicates that should never decay (e.g., NAME, ALLERGY) */
  permanentPredicates?: string[];
  /** Predicates that should decay quickly (e.g., WEARING, CURRENT_MOOD) */
  ephemeralPredicates?: string[];
  /** TTL for ephemeral predicates in hours */
  ephemeralTtlHours?: number;
  /** Minimum reinforcement count to become "permanent" */
  reinforcementThreshold?: number;
}

export interface FactWithDecay extends MemoryFact {
  /** Number of times this fact has been reinforced (mentioned again) */
  reinforcementCount?: number;
  /** Last time the fact was reinforced */
  lastReinforcedAt?: Date;
  /** Calculated decay weight (0-1, where 0 = should be deleted) */
  decayWeight?: number;
  /** Calculated expiry time */
  expiresAt?: Date | null;
}

/**
 * Default permanent predicates that should never decay
 */
const DEFAULT_PERMANENT_PREDICATES = [
  "NAME",
  "FULL_NAME",
  "ALLERGY",
  "MEDICAL_CONDITION",
  "BIRTHDAY",
  "BIRTH_DATE",
  "EMAIL",
  "PHONE",
  "ADDRESS",
  "LANGUAGE",
  "TIMEZONE",
];

/**
 * Default ephemeral predicates that decay quickly
 */
const DEFAULT_EPHEMERAL_PREDICATES = [
  "WEARING",
  "CURRENT_MOOD",
  "CURRENT_ACTIVITY",
  "CURRENT_LOCATION",
  "CURRENTLY",
  "RIGHT_NOW",
  "TODAY",
  "FEELING",
];

/**
 * Decay manager for memory facts
 */
export class DecayManager {
  private config: Required<DecayConfig>;

  constructor(config: DecayConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      defaultTtlDays: config.defaultTtlDays ?? 90, // 3 months
      lowWeightTtlDays: config.lowWeightTtlDays ?? 7, // 1 week
      permanentPredicates: [
        ...DEFAULT_PERMANENT_PREDICATES,
        ...(config.permanentPredicates ?? []),
      ],
      ephemeralPredicates: [
        ...DEFAULT_EPHEMERAL_PREDICATES,
        ...(config.ephemeralPredicates ?? []),
      ],
      ephemeralTtlHours: config.ephemeralTtlHours ?? 24, // 1 day
      reinforcementThreshold: config.reinforcementThreshold ?? 3,
    };
  }

  /**
   * Calculate decay weight for a fact (0-1, where 0 = should be deleted)
   */
  calculateDecayWeight(fact: FactWithDecay): number {
    if (!this.config.enabled) return 1;

    const predicateUpper = fact.predicate.toUpperCase();

    // Permanent facts never decay
    if (this.config.permanentPredicates.includes(predicateUpper)) {
      return 1;
    }

    // Well-reinforced facts don't decay
    const reinforcements = fact.reinforcementCount ?? 0;
    if (reinforcements >= this.config.reinforcementThreshold) {
      return 1;
    }

    const now = Date.now();
    const createdAt = fact.createdAt.getTime();
    const lastReinforced = fact.lastReinforcedAt?.getTime() ?? createdAt;
    const ageMs = now - lastReinforced;

    // Ephemeral facts decay very quickly
    if (this.config.ephemeralPredicates.includes(predicateUpper)) {
      const ttlMs = this.config.ephemeralTtlHours * 60 * 60 * 1000;
      const weight = Math.max(0, 1 - ageMs / ttlMs);
      return weight;
    }

    // Low confidence facts decay faster
    const confidence = fact.confidence ?? 0.8;
    const ttlDays =
      confidence < 0.5
        ? this.config.lowWeightTtlDays
        : this.config.defaultTtlDays;

    if (ttlDays === null) return 1; // Never expires

    const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
    const weight = Math.max(0, 1 - ageMs / ttlMs);

    // Boost weight based on reinforcement count
    const reinforcementBoost = Math.min(0.5, reinforcements * 0.1);

    return Math.min(1, weight + reinforcementBoost);
  }

  /**
   * Calculate expiry date for a fact
   */
  calculateExpiryDate(fact: FactWithDecay): Date | null {
    if (!this.config.enabled) return null;

    const predicateUpper = fact.predicate.toUpperCase();

    // Permanent facts never expire
    if (this.config.permanentPredicates.includes(predicateUpper)) {
      return null;
    }

    // Well-reinforced facts don't expire
    const reinforcements = fact.reinforcementCount ?? 0;
    if (reinforcements >= this.config.reinforcementThreshold) {
      return null;
    }

    const lastReinforced = fact.lastReinforcedAt ?? fact.createdAt;

    // Ephemeral facts
    if (this.config.ephemeralPredicates.includes(predicateUpper)) {
      return new Date(
        lastReinforced.getTime() +
          this.config.ephemeralTtlHours * 60 * 60 * 1000,
      );
    }

    // Regular facts
    const confidence = fact.confidence ?? 0.8;
    const ttlDays =
      confidence < 0.5
        ? this.config.lowWeightTtlDays
        : this.config.defaultTtlDays;

    if (ttlDays === null) return null;

    return new Date(lastReinforced.getTime() + ttlDays * 24 * 60 * 60 * 1000);
  }

  /**
   * Check if a fact should be pruned
   */
  shouldPrune(fact: FactWithDecay): boolean {
    if (!this.config.enabled) return false;

    const weight = this.calculateDecayWeight(fact);
    if (weight <= 0) return true;

    const expiresAt = this.calculateExpiryDate(fact);
    if (expiresAt && expiresAt.getTime() < Date.now()) return true;

    return false;
  }

  /**
   * Filter facts by decay weight threshold
   */
  filterByWeight(
    facts: FactWithDecay[],
    minWeight: number = 0.1,
  ): FactWithDecay[] {
    return facts.filter((fact) => {
      const weight = this.calculateDecayWeight(fact);
      return weight >= minWeight;
    });
  }

  /**
   * Get facts that should be pruned
   */
  getFactsToPrune(facts: FactWithDecay[]): FactWithDecay[] {
    return facts.filter((fact) => this.shouldPrune(fact));
  }

  /**
   * Check if a predicate is permanent (never decays)
   */
  isPermanent(predicate: string): boolean {
    return this.config.permanentPredicates.includes(predicate.toUpperCase());
  }

  /**
   * Check if a predicate is ephemeral (decays quickly)
   */
  isEphemeral(predicate: string): boolean {
    return this.config.ephemeralPredicates.includes(predicate.toUpperCase());
  }

  /**
   * Add a predicate to permanent list
   */
  addPermanentPredicate(predicate: string): void {
    const upper = predicate.toUpperCase();
    if (!this.config.permanentPredicates.includes(upper)) {
      this.config.permanentPredicates.push(upper);
    }
  }

  /**
   * Add a predicate to ephemeral list
   */
  addEphemeralPredicate(predicate: string): void {
    const upper = predicate.toUpperCase();
    if (!this.config.ephemeralPredicates.includes(upper)) {
      this.config.ephemeralPredicates.push(upper);
    }
  }
}
