-- ─────────────────────────────────────────────────────────────────────────────
-- The Imposter (Restless) — shared metadata (both client + server).
-- ─────────────────────────────────────────────────────────────────────────────

ENT.Base      = "nextbot_imposter"
DEFINE_BASECLASS( ENT.Base )

ENT.PrintName = "The Imposter (Restless)"
ENT.Author    = "ElegantChudWaffle"
ENT.Category  = "Imposter Nextbot"
ENT.Spawnable = true

-- Quicker than the base imposter (termhunter default RunSpeed is 320). Captured into
-- ImposterNormalRun by the base AdditionalInitialize, so every "normal run" uses it.
ENT.RunSpeed  = 360

list.Set( "NPC", "nextbot_imposter_restless", {
    Name     = ENT.PrintName,
    Class    = "nextbot_imposter_restless",
    Category = "Imposter Nextbot",
    Author   = ENT.Author,
    Weapons  = { "weapon_terminatorfists_term" },
} )
