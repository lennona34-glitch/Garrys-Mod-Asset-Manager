-- ─────────────────────────────────────────────────────────────────────────────
-- The Imposter — server entry point.
-- ─────────────────────────────────────────────────────────────────────────────

AddCSLuaFile( "cl_init.lua" )  -- send the client HUD/render code to clients
AddCSLuaFile( "shared.lua" )   -- and the shared metadata they need to register
include( "shared.lua" )        -- ENT.Base / Type / models / phase enums (both realms)

include( "sv_config.lua" )  -- tuning constants + convars (edit this to configure)
include( "sv_core.lua" )    -- ENT methods, ability system, disguise, tasks
