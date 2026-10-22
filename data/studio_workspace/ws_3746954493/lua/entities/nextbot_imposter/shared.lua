-- ─────────────────────────────────────────────────────────────────────────────
-- The Imposter — shared metadata and constants (loaded on both client + server).
-- ─────────────────────────────────────────────────────────────────────────────

ENT.Base      = "terminator_nextbot"
DEFINE_BASECLASS( ENT.Base )

ENT.PrintName = "The Imposter"
ENT.Author    = "ElegantChudWaffle"
ENT.Category  = "Imposter Nextbot"   -- Entities-tab category (shows the custom thumbnail)
ENT.Spawnable = true

-- True (undisguised) form: an ordinary-looking citizen. Must be a PLAYER model
-- (models/player/...) — the termhunter base translates activities through the held
-- weapon into ACT_HL2MP_* player animations; NPC models lack those and T-pose.
ENT.Models      = { "models/player/corpse1.mdl" }
ENT.SpawnHealth = 250
ENT.CanSwim     = false   -- never wade into water (pathing penalizes underwater areas)

list.Set( "NPC", "nextbot_imposter", {
    Name     = ENT.PrintName,
    Class    = "nextbot_imposter",
    Category = "Imposter Nextbot",
    Author   = ENT.Author,
    Weapons  = { "weapon_terminatorfists_term" },
} )

-- Matches every imposter variant (base + restless + any future ones).
-- ents.FindByClass honours the trailing *.
IMPOSTER_CLASS_WILD = "nextbot_imposter*"
function isImposterClass( ent )
    return IsValid( ent ) and string.StartWith( ent:GetClass(), "nextbot_imposter" )
end

-- ─── Phase enum (shared so client HUD can read it) ────────────────────────────

IMPOSTER_PHASE_ROAM      = 0  -- wandering as a suspicious nobody, looking for a target
IMPOSTER_PHASE_STALK     = 1  -- shadowing a chosen target, waiting for isolation
IMPOSTER_PHASE_HUNT      = 2  -- closing in for the kill
IMPOSTER_PHASE_EXECUTE   = 3  -- brief kill animation, target pinned
IMPOSTER_PHASE_ABSORB    = 4  -- absorption animation, copying the victim
IMPOSTER_PHASE_DISGUISED = 5  -- walking around wearing the victim's identity
IMPOSTER_PHASE_ENRAGE    = 6  -- exposed: true form, fast and lethal, no more pretense
IMPOSTER_PHASE_FLEE      = 7  -- attacked while unnoticed: panic, cloak, and escape
IMPOSTER_PHASE_PLAYDEAD  = 8  -- playing possum: hidden as a ragdoll, waiting to ambush
IMPOSTER_PHASE_TRACKING  = 9  -- no one in sight: hunting down a grudge target's last trail
IMPOSTER_PHASE_TELEPORT  = 10 -- blinking across the map to close on a far-off lead

IMPOSTER_PHASE_NAMES = {
    [IMPOSTER_PHASE_ROAM]      = "ROAM",
    [IMPOSTER_PHASE_STALK]     = "STALK",
    [IMPOSTER_PHASE_HUNT]      = "HUNT",
    [IMPOSTER_PHASE_EXECUTE]   = "EXECUTE",
    [IMPOSTER_PHASE_ABSORB]    = "ABSORB",
    [IMPOSTER_PHASE_DISGUISED] = "DISGUISED",
    [IMPOSTER_PHASE_ENRAGE]    = "ENRAGE",
    [IMPOSTER_PHASE_FLEE]      = "FLEE",
    [IMPOSTER_PHASE_PLAYDEAD]  = "PLAYDEAD",
    [IMPOSTER_PHASE_TRACKING]  = "TRACKING",
    [IMPOSTER_PHASE_TELEPORT]  = "TELEPORT",
}

-- ─── Dopple-style player info (shared: the matproxy runs client-side) ──────────
-- When the imposter wears a player disguise, the worn playermodel's clothing colour
-- comes from the engine "PlayerColor" matproxy, which calls ENT:GetPlayerColor. We
-- prefer the LIVE absorbed victim's entity (so the disguise tracks their current colour
-- even after they respawn), then a colour snapshotted at absorb time. For anything that
-- isn't a player disguise (incl. the true form, itself a player model) we return the
-- exact fallback the engine matproxy uses, so those render unchanged.
function ENT:GetPlayerColor()
    local fallback = Vector( 62 / 255, 88 / 255, 106 / 255 )

    if not self:GetNWBool( "ImposterDisguiseIsPlayer", false ) then return fallback end

    local victim = self:GetNWEntity( "ImposterDisguiseVictim", NULL )
    if IsValid( victim ) and victim.GetPlayerColor then
        local c = victim:GetPlayerColor()
        if isvector( c ) then return c end
    end

    return self:GetNWVector( "ImposterDisguisePlayerColor", fallback )
end
