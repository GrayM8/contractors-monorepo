// ── Item Cards ───────────────────────────────────────────────
// Items only modify hp/ammo/speed for MVP. No new mechanics.

export interface ItemCard {
  id: string;
  name: string;
  description: string;
  hpBonus: number;      // flat added to base HP
  ammoBonus: number;    // flat added to base ammo
  speedMul: number;     // multiplier (1 = no change)
}

export const ITEM_CARDS: ItemCard[] = [
  { id: "vest",        name: "Kevlar Vest",     description: "+30 HP",             hpBonus: 30,  ammoBonus: 0,   speedMul: 1    },
  { id: "stims",       name: "Combat Stims",    description: "+20% speed",         hpBonus: 0,   ammoBonus: 0,   speedMul: 1.2  },
  { id: "ammo_crate",  name: "Ammo Crate",      description: "+20 ammo",           hpBonus: 0,   ammoBonus: 20,  speedMul: 1    },
  { id: "med_kit",     name: "Med Kit",          description: "+50 HP, -10% speed", hpBonus: 50,  ammoBonus: 0,   speedMul: 0.9  },
  { id: "light_armor", name: "Light Armor",      description: "+15 HP, +5 ammo",    hpBonus: 15,  ammoBonus: 5,   speedMul: 1    },
  { id: "bandolier",   name: "Bandolier",        description: "+15 ammo, +10 HP",   hpBonus: 10,  ammoBonus: 15,  speedMul: 1    },
  { id: "adrenaline",  name: "Adrenaline Shot",  description: "+30% speed, -20 HP", hpBonus: -20, ammoBonus: 0,   speedMul: 1.3  },
  { id: "heavy_mag",   name: "Extended Mag",     description: "+30 ammo, -10% speed", hpBonus: 0, ammoBonus: 30,  speedMul: 0.9  },
];

export function getItemCard(id: string): ItemCard | undefined {
  return ITEM_CARDS.find((c) => c.id === id);
}

// ── Contract Cards ───────────────────────────────────────────

export type ContractTier = 1 | 2 | 3;

export type ContractConditionType =
  | "MOVE_DISTANCE"     // distanceMoved >= threshold
  | "ENEMY_DAMAGE_ZERO" // enemyDamage == 0 (pacifist)
  | "AMMO_SPENT"        // ammoSpent >= threshold
  | "FRIENDLY_FIRE"     // friendlyFireDamage >= threshold
  | "DAMAGE_TARGET"     // damage dealt to specific target >= threshold
  | "KILL_TEAMMATE"     // killed any teammate (kills >= 1)
  | "KILL_TARGET";      // killed the specific assigned target

export type ContractRewardType = "HP_BOOST" | "AMMO_BOOST" | "SPEED_BOOST";
export type ContractPenaltyType = "AMMO_CUT" | "REVEAL_CARDS" | "SLOT_REDUCTION";

export interface ContractCard {
  id: string;
  tier: ContractTier;
  name: string;
  actionText: string;     // shown to the player during fight
  conditionType: ContractConditionType;
  threshold: number;      // 0 for boolean conditions like KILL_TEAMMATE
  needsTarget: boolean;   // requires a random target assigned at deal time
  rewardType: ContractRewardType;
  rewardValue: number;    // multiplier delta: 0.2 means +20%
  penaltyType: ContractPenaltyType;
  penaltyValue: number;
  forged: boolean;        // if true, cannot refuse
}

export const CONTRACT_CARDS: ContractCard[] = [
  // ── Tier 1 ──
  {
    id: "c_run_500", tier: 1, name: "Cardio Day",
    actionText: "Move at least 500 distance",
    conditionType: "MOVE_DISTANCE", threshold: 500, needsTarget: false,
    rewardType: "SPEED_BOOST", rewardValue: 0.2,
    penaltyType: "AMMO_CUT", penaltyValue: 0.5,
    forged: false,
  },
  {
    id: "c_pacifist", tier: 1, name: "Pacifist Run",
    actionText: "Deal zero damage to enemies",
    conditionType: "ENEMY_DAMAGE_ZERO", threshold: 0, needsTarget: false,
    rewardType: "HP_BOOST", rewardValue: 0.2,
    penaltyType: "REVEAL_CARDS", penaltyValue: 1,
    forged: false,
  },
  {
    id: "c_spray", tier: 1, name: "Suppressive Fire",
    actionText: "Spend at least 50 ammo",
    conditionType: "AMMO_SPENT", threshold: 50, needsTarget: false,
    rewardType: "AMMO_BOOST", rewardValue: 0.5,
    penaltyType: "AMMO_CUT", penaltyValue: 0.5,
    forged: false,
  },
  // ── Tier 2 ──
  {
    id: "c_friendly_fire", tier: 2, name: "Friendly Accident",
    actionText: "Deal 50+ friendly fire damage",
    conditionType: "FRIENDLY_FIRE", threshold: 50, needsTarget: false,
    rewardType: "HP_BOOST", rewardValue: 0.2,
    penaltyType: "REVEAL_CARDS", penaltyValue: 1,
    forged: false,
  },
  {
    id: "c_damage_target", tier: 2, name: "Marked Man",
    actionText: "Deal 30+ damage to your target",
    conditionType: "DAMAGE_TARGET", threshold: 30, needsTarget: true,
    rewardType: "AMMO_BOOST", rewardValue: 0.5,
    penaltyType: "SLOT_REDUCTION", penaltyValue: 1,
    forged: false,
  },
  // ── Tier 3 ──
  {
    id: "c_kill_teammate", tier: 3, name: "Traitor's Gambit",
    actionText: "Kill any teammate",
    conditionType: "KILL_TEAMMATE", threshold: 0, needsTarget: false,
    rewardType: "HP_BOOST", rewardValue: 0.2,
    penaltyType: "REVEAL_CARDS", penaltyValue: 1,
    forged: true,
  },
  {
    id: "c_kill_target", tier: 3, name: "Assassin's Contract",
    actionText: "Kill your assigned target",
    conditionType: "KILL_TARGET", threshold: 0, needsTarget: true,
    rewardType: "SPEED_BOOST", rewardValue: 0.2,
    penaltyType: "AMMO_CUT", penaltyValue: 0.5,
    forged: true,
  },
];

export function getContractCard(id: string): ContractCard | undefined {
  return CONTRACT_CARDS.find((c) => c.id === id);
}

// ── Tier selection by round ──────────────────────────────────

export function getAvailableTiers(roundNumber: number): ContractTier[] {
  if (roundNumber <= 3) return [1];
  if (roundNumber <= 6) return [1, 2];
  return [1, 2, 3];
}

/** Pick a random contract from allowed tiers, with heavy Tier3 weighting in late rounds */
export function pickRandomContract(roundNumber: number): ContractCard {
  const tiers = getAvailableTiers(roundNumber);
  const pool = CONTRACT_CARDS.filter((c) => tiers.includes(c.tier));

  if (roundNumber >= 7) {
    // 60% chance tier 3, 25% tier 2, 15% tier 1
    const roll = Math.random();
    const tier3 = pool.filter((c) => c.tier === 3);
    const tier2 = pool.filter((c) => c.tier === 2);
    const tier1 = pool.filter((c) => c.tier === 1);
    if (roll < 0.6 && tier3.length > 0) return tier3[Math.floor(Math.random() * tier3.length)];
    if (roll < 0.85 && tier2.length > 0) return tier2[Math.floor(Math.random() * tier2.length)];
    if (tier1.length > 0) return tier1[Math.floor(Math.random() * tier1.length)];
  }

  return pool[Math.floor(Math.random() * pool.length)];
}

/** Pick N random unique item cards */
export function dealItemCards(count: number): ItemCard[] {
  const shuffled = [...ITEM_CARDS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}
