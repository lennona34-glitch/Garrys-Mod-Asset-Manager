-- ─────────────────────────────────────────────────────────────────────────────
-- Registers the Imposter NPCs in the spawnmenu "NPCs" tab.
--
-- This lives in lua/autorun/ (not the entities' shared.lua) on purpose: the NPC
-- tab is populated purely client-side from list.Get("NPC"), and folder-entity
-- shared.lua files don't reliably execute in the client realm here. autorun runs
-- unconditionally on both client and server, independent of entity load order.
-- ─────────────────────────────────────────────────────────────────────────────

local IMPOSTER_NPCS = {
    {
        class     = "nextbot_imposter",
        name      = "The Imposter",
    },
    {
        class     = "nextbot_imposter_restless",
        name      = "The Imposter (Restless)",
    },
}

for _, npc in ipairs( IMPOSTER_NPCS ) do
    list.Set( "NPC", npc.class, {
        Name     = npc.name,
        Class    = npc.class,
        Category = "Imposter Nextbot",
        Author   = "ElegantChudWaffle",
        Weapons  = { "weapon_terminatorfists_term" },
    } )

    if CLIENT then
        language.Add( npc.class, npc.name )
    end
end
