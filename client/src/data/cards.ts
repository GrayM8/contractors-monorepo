// Client-side card definitions (display data only — mirror of server data)

export interface ItemCardInfo {
  id: string;
  name: string;
  description: string;
}

export const ITEM_CARDS: ItemCardInfo[] = [
  { id: "vest",        name: "Kevlar Vest",     description: "+30 HP" },
  { id: "stims",       name: "Combat Stims",    description: "+20% speed" },
  { id: "ammo_crate",  name: "Ammo Crate",      description: "+20 ammo" },
  { id: "med_kit",     name: "Med Kit",          description: "+50 HP, -10% speed" },
  { id: "light_armor", name: "Light Armor",      description: "+15 HP, +5 ammo" },
  { id: "bandolier",   name: "Bandolier",        description: "+15 ammo, +10 HP" },
  { id: "adrenaline",  name: "Adrenaline Shot",  description: "+30% speed, -20 HP" },
  { id: "heavy_mag",   name: "Extended Mag",     description: "+30 ammo, -10% speed" },
];

export function getItemCardInfo(id: string): ItemCardInfo | undefined {
  return ITEM_CARDS.find((c) => c.id === id);
}

export interface ContractCardInfo {
  id: string;
  name: string;
  actionText: string;
  tier: number;
  forged: boolean;
  rewardText: string;
  penaltyText: string;
}

export const CONTRACT_CARDS: ContractCardInfo[] = [
  { id: "c_run_500",        name: "Cardio Day",         tier: 1, forged: false, actionText: "Move at least 500 distance",      rewardText: "+20% speed next round", penaltyText: "-50% ammo next round" },
  { id: "c_pacifist",       name: "Pacifist Run",       tier: 1, forged: false, actionText: "Deal zero damage to enemies",     rewardText: "+20% HP next round",    penaltyText: "Cards revealed next round" },
  { id: "c_spray",          name: "Suppressive Fire",   tier: 1, forged: false, actionText: "Spend at least 50 ammo",          rewardText: "+50% ammo next round",  penaltyText: "-50% ammo next round" },
  { id: "c_friendly_fire",  name: "Friendly Accident",  tier: 2, forged: false, actionText: "Deal 50+ friendly fire damage",   rewardText: "+20% HP next round",    penaltyText: "Cards revealed next round" },
  { id: "c_damage_target",  name: "Marked Man",         tier: 2, forged: false, actionText: "Deal 30+ damage to your target",  rewardText: "+50% ammo next round",  penaltyText: "-20% ammo next round" },
  { id: "c_kill_teammate",  name: "Traitor's Gambit",   tier: 3, forged: true,  actionText: "Kill any teammate",               rewardText: "+20% HP next round",    penaltyText: "Cards revealed next round" },
  { id: "c_kill_target",    name: "Assassin's Contract", tier: 3, forged: true, actionText: "Kill your assigned target",       rewardText: "+20% speed next round", penaltyText: "-50% ammo next round" },
];

export function getContractCardInfo(id: string): ContractCardInfo | undefined {
  return CONTRACT_CARDS.find((c) => c.id === id);
}
