-- ─────────────────────────────────────────────────────────────────────────────
-- The Imposter — server configuration: all tuneable constants and convars.
-- This is the primary file to edit when adjusting gameplay values.
-- ─────────────────────────────────────────────────────────────────────────────

util.AddNetworkString( "ImposterNextBot.GrabCamera" )
util.AddNetworkString( "imposter_voice" )

-- ─── Tuning ───────────────────────────────────────────────────────────────────

STALK_FOLLOW_DIST = 400    -- hang back roughly this far behind the mark
STALK_MAX_DIST    = 2000   -- give up the stalk if they get this far away
STALK_STALE_TIME  = 20     -- give up the stalk after this many seconds
STALK_COMMIT_DIST = 800    -- only consider striking once this close to the mark
ROAM_REPICK_DELAY = 4      -- seconds between target-search attempts while roaming
WANDER_GOAL_MIN   = 6      -- min/max seconds before picking a new wander goal
WANDER_GOAL_MAX   = 12
WANDER_ARRIVE_DIST = 80    -- consider a wander goal reached within this distance
ROAM_PATROL_RADIUS = 2600  -- how far to roam/wander for a goal (explore like a player)

DETECT_RANGE      = 3000   -- only notice prey it can actually see within this range
TARGET_LOST_TIME  = 6      -- lose a mark this long after last laying eyes on it

ISOLATION_RADIUS  = 1100   -- other players within this that can see the mark block the kill
LOOKAWAY_DOT      = 0.3    -- mark counts as "looking away" when eye-forward·toImposter < this
HUNT_MELEE_RANGE  = 80     -- distance at which the ambush reaches the victim
HUNT_TIMEOUT      = 8      -- abandon a hunt that takes longer than this
HUNT_COOLDOWN     = 12     -- after a failed hunt, don't commit to another for this long
HUNT_FLEE_DAMAGE      = 60   -- cumulative damage during a single hunt that makes it break off and flee
ATTACK_COUNTER_CHANCE = 0.18 -- chance it snaps into a hunt instead of fleeing when hit out of cover
GRAB_FLEE_DAMAGE  = 80     -- cumulative damage while holding a victim that makes it drop them and flee
KILLSTRIKE_DAMAGE   = 30   -- damage per hit when grab is disabled (no-grab mode)
KILLSTRIKE_INTERVAL = 0.5  -- seconds between kill-strike hits
HUNT_SEARCH_TIME  = 5      -- extra seconds to sweep adjacent areas after reaching last known pos
STARE_BREAK_TIME  = 3      -- seconds of staring before it snaps into hunt with a lunge
LUNGE_SPEED_MULT  = 1.75   -- RunSpeed multiplier for the post-snap lunge burst
LUNGE_DURATION    = 3      -- how long the speed boost lasts

EXEC_GRAB_TIME    = 0.8    -- seconds spent raising the body off the ground
EXEC_HOLD_TIME    = 0.5    -- seconds held aloft before the drain begins
EXEC_ABSORB_TIME  = 1.6    -- seconds of draining before the transform completes
EXEC_CARRY_MAX    = 12     -- max seconds spent carrying the body to a hidden spot
EXEC_CARRY_ARRIVE = 110    -- considered "arrived" at the secluded spot within this
SECLUDE_SEARCH_RADIUS = 3500  -- how far to look for a secluded spot to carry the body
-- (Arm pose + held-body offsets are live-tunable convars — see Dev tooling below.)

DISGUISE_BLEND_MIN = 18    -- min/max seconds blending in before hunting again
DISGUISE_BLEND_MAX = 35
-- Disguise paces, kept SEPARATE per type. The PLAYER disguise jogs at a player-like pace
-- (set on RunSpeed + ShouldRun, so the base plays the run/move weapon pose like a real
-- survivor); the NPC disguise ambles deliberately (WalkSpeed + ShouldWalk, NPC walk anim).
DISGUISE_JOG_SPEED = 240  -- player disguise: player-like jog
-- NPC disguise: deliberate NPC walk. Kept low on purpose — HL2 NPC walk anims play at a
-- fixed rate tuned to ~90 u/s, so a faster loco speed slides the feet and glitches the legs.
DISGUISE_NPC_WALK  = 90

-- True-form roam pace: a brisk jog (RunSpeed during ROAM), faster than the old slow
-- creep but short of the full hunt/flee sprint. Tune to taste.
ROAM_JOG_SPEED     = 280

-- Self-initiated disguise (no victim): the "disguise" power (see IMPOSTER_ABILITIES)
-- fabricates an identity from a random installed playermodel so it can lurk/track in
-- plain sight. Cooldown/condition live on the ability; these tune the disguise itself.
SELFDISG_NPC_CHANCE = 0.5  -- chance for the silent NPC-faction blend vs the "player" form
SELFDISG_FALLBACK_MODEL = "models/player/Group01/male_07.mdl"
-- The two humanoid factions a playermodel could plausibly belong to (class only drives
-- the faction lookup for the silent NPC-blend disguise; never shown to anyone).
SELFDISG_NPC_CLASSES = { "npc_citizen", "npc_combine_s" }

-- Corpse absorption: during roam the imposter notices a nearby prop_ragdoll, walks over
-- to it, and silently absorbs it. DETECT range triggers the approach; ABSORB range is
-- how close it must get before the actual absorption fires.
CORPSE_DETECT_RANGE = 900   -- scan radius while roaming (triggers approach task)
CORPSE_ABSORB_RANGE = 110   -- must be this close to actually absorb
CORPSE_ABSORB_CD    = 30    -- seconds before it can absorb another corpse

-- ─── Horror flavor ────────────────────────────────────────────────────────────
-- Memory: the true form remembers where it last saw people and drifts back toward
-- that activity, so roaming feels purposeful (it "remembers you") not random.
SIGHTING_MEMORY_TIME   = 45    -- seconds a remembered sighting stays fresh
SIGHTING_MEMORY_MAX    = 3     -- how many recent sightings to keep
SIGHTING_RECALL_CHANCE = 0.55  -- chance a roam goal heads back toward a sighting
SIGHTING_RECALL_SPREAD = 700   -- search radius around a remembered sighting

-- Ambient "presence": phantom footsteps/creaks near the mark while stalking, so
-- the player feels watched before they can pin down where the thing actually is.
STALK_PRESENCE_MIN  = 5     -- min/max seconds between phantom sounds
STALK_PRESENCE_MAX  = 11
STALK_PRESENCE_DIST = 260   -- how far from the mark the phantom sound originates
STALK_PRESENCE_SOUNDS = {
    "physics/wood/wood_strain1.wav",
    "physics/wood/wood_strain2.wav",
    "physics/wood/wood_strain3.wav",
    "player/footsteps/concrete1.wav",
    "player/footsteps/concrete2.wav",
    "player/footsteps/concrete3.wav",
    "ambient/voices/citizen_distress1.wav",
    "ambient/voices/citizen_distress2.wav",
    "npc/barnacle/barnacle_crunch1.wav",
}

-- ─── Sound variety + feature-toggle bundle ────────────────────────────────────
-- All sound arrays AND the three convars used INSIDE DoCustomTasks live in one
-- table so they count as a single upvalue against the per-function 60-upvalue
-- limit. sndPick stays as a module-level helper for use in ENT methods that sit
-- outside DoCustomTasks; inside DoCustomTasks use IMPOSTER_CFG.snd directly.
function sndPick( t ) return t[ math.random( #t ) ] end

-- ─── Senses: hearing + scent trail (helps it FIND a target it can't see) ───────
-- Hearing: loud events (gunfire) and fast movement (sprinting footsteps) betray a
-- position even through walls. Crouch-walking is silent. A heard noise refreshes the
-- source's last-known position so tracking/roam can chase someone never even seen.
HEAR_GUNFIRE_DIST   = 3500   -- a gunshot is heard out to here
HEAR_FOOTSTEP_DIST  = 1100   -- sprinting footsteps are heard out to here
HEAR_RUN_SPEED      = 180    -- horizontal speed above this counts as "loud" movement
HEAR_POLL_INTERVAL  = 0.3    -- how often each bot listens for footsteps
HEAR_REACT_COOLDOWN = 1.5    -- min seconds between logged reactions (per bot)

-- Scent trail: every living player drops a fading breadcrumb on a shared timer. While
-- tracking, the bot sniffs out the freshest crumb near it and follows the trail FORWARD
-- in time — tracing the actual route the target fled along, not one stale last-seen dot.
BREADCRUMB_INTERVAL = 1.25   -- seconds between dropped crumbs (shared, all players)
BREADCRUMB_LIFETIME = 14     -- a crumb expires this long after being dropped
BREADCRUMB_MAX      = 10     -- crumbs kept per player (oldest dropped past this)
BREADCRUMB_SNIFF    = 900    -- the bot only picks up a trail within this of a crumb

-- True (undisguised) form model — what the imposter reverts to when exposed.
TRUE_FORM_MODEL  = "models/player/corpse1.mdl"

-- Custom one-shot sounds (files live in addon's sound/ folder). NOTE: paths MUST be
-- lowercase to match the actual files — Workshop GMA packing lowercases filenames and is
-- case-sensitive, so "Jumpscare.wav" etc. silently fail to play once published.
IMPOSTER_DISGUISE_SOUND = "disguisesound.mp3"
IMPOSTER_REVEAL_SOUND   = "jumpscarereveal.wav"
MOCK_NOISE_FILES_SV     = { "mocknoises.mp3", "mocknoises2.mp3", "mocknoises3.mp3", "mocknoises4.mp3" }
if SERVER then
    util.PrecacheSound( IMPOSTER_DISGUISE_SOUND )
    util.PrecacheSound( IMPOSTER_REVEAL_SOUND )
    for _, f in ipairs( MOCK_NOISE_FILES_SV ) do
        util.PrecacheSound( f )
    end
end


-- Escape behavior: if damaged before it commits to a kill, it plays weak and runs.
FLEE_DURATION     = 7.5
FLEE_RUN_SPEED    = 640
FLEE_REPATH_TIME  = 0.35
FLEE_GOAL_DIST    = 1900
FLEE_CLOAK_ALPHA  = 65

PLAYDEAD_HOSTILE_RANGE = 1200  -- hostiles must be within this for playdead to trigger
PLAYDEAD_REVEAL_DIST   = 180   -- entity this close to the ragdoll triggers the ambush
PLAYDEAD_DISTURB_SPD   = 80    -- ragdoll physobj speed above this means it was shot
PLAYDEAD_TIMEOUT       = 20    -- give up and roam if nobody investigates
PLAYDEAD_COOLDOWN      = 40    -- seconds before it can play dead again after a reveal

-- Enrage (Phase 6): when exposed, the imposter drops the act and goes lethal.
ENRAGE_RUN_SPEED  = 600   -- sprint speed while enraged
ENRAGE_MELEE_RANGE = 90   -- reach for an enraged strike
ENRAGE_HIT_COOLDOWN = 0.55 -- seconds between strikes
ENRAGE_DAMAGE     = 55    -- damage per strike (boosted)
ENRAGE_DURATION   = 25    -- enrage burns out after this many seconds, then it calms

-- ─── Grudge / tracking (Phase 9) ──────────────────────────────────────────────
-- Per-target interaction memory drives WHO it fixates on. Score weights below;
-- the highest-scoring known person becomes the mark / track lead.
GRUDGE_W_ATTACK    = 60    -- per time this person has attacked us (the grudge)
GRUDGE_W_STALKSEC  = 1.5   -- per second already invested stalking them
GRUDGE_W_LOST      = 22    -- per time they slipped our sight (the one that got away)
GRUDGE_W_RECENT    = 30    -- bonus for a fresh sighting, fades over GRUDGE_MEMORY_TIME
GRUDGE_MEMORY_TIME = 90    -- forget a profile this long after last contact
TRACK_TIMEOUT      = 14    -- abandon a track that drags on past this
TRACK_ARRIVE_DIST  = 120   -- "reached the lead" within this distance
TRACK_RUN_SPEED    = nil   -- (uses normal run speed; set to override)
TRACK_RETRY_DELAY  = 6     -- after a track gives up, don't re-enter for this long
TRACK_LEAD_COOLDOWN = 15   -- after exhausting a lead, skip that profile this long

-- Teleport blink (Phase 10): when a track lead is too far, it stands, vanishes, and
-- reappears near them — Mario-64-style: wind up in place, blink out, materialize in,
-- then reactivate. Closes huge gaps so distance never saves you for long.
TRACK_TELEPORT_DIST = 2400  -- blink only when the lead is at least this far away
TRACK_TELEPORT_CD   = 9     -- min seconds between blinks
TP_WINDUP_TIME      = 0.9   -- stand-still wind-up before vanishing
TP_GONE_TIME        = 0.4   -- time spent fully gone, mid-blink
TP_MATERIALIZE_TIME = 0.75  -- materialize/lock-in time before it reactivates
TP_STANDOFF_MIN     = 280   -- reappear no closer than this to the lead
TP_STANDOFF_MAX     = 1100  -- and no farther than this

-- ─── Settings (server convars, read at spawn/think) ──────────────────────────
-- All convars are FCVAR_ARCHIVE so they persist across server restarts.
-- Change them with "imposter_<name> <value>" in console.
local REP = bit.bor( FCVAR_ARCHIVE, FCVAR_REPLICATED )
cv_health      = CreateConVar( "imposter_health",       "350",  REP, "Starting health for each Imposter nextbot.",                          1, 5000 )
cv_aggro_dist  = CreateConVar( "imposter_detect_range", "3000", REP, "How far (units) the Imposter can spot targets.",                      64, 8000 )
cv_flee_en     = CreateConVar( "imposter_flee_enable",  "1",    REP, "Allow the Imposter to flee when hurt (1=on, 0=off).",                  0, 1 )
cv_playdead_en = CreateConVar( "imposter_playdead_enable","1",  REP, "Allow the Imposter to play dead as a ragdoll (1=on, 0=off).",          0, 1 )
cv_teleport_en = CreateConVar( "imposter_teleport_enable","1",  REP, "Allow the Imposter to teleport when a tracked target is far away.",    0, 1 )
cv_hear_en     = CreateConVar( "imposter_hearing_enable","1",   REP, "Allow the Imposter to hear footsteps and gunfire (1=on, 0=off).",      0, 1 )
cv_scent_en      = CreateConVar( "imposter_scent_enable",    "1", REP, "Allow the Imposter to follow breadcrumb scent trails (1=on, 0=off).", 0, 1 )
cv_tracking_en   = CreateConVar( "imposter_tracking_enable", "1", REP, "Allow the Imposter to pursue targets it can't see (memory/scent/hearing). Off = only chases what it directly sees.", 0, 1 )
cv_selfdisg_en   = CreateConVar( "imposter_selfdisg_enable", "1", REP, "Allow the Imposter to self-disguise as a random playermodel (1=on, 0=off).", 0, 1 )
cv_grab_en       = CreateConVar( "imposter_grab_enable",     "1", REP, "Allow the Imposter to grab victims (0=no-grab: strikes until dead then instant-absorbs).", 0, 1 )
cv_ragdoll_disg_en = CreateConVar( "imposter_ragdoll_disg_enable", "1", REP, "Allow the Imposter to absorb nearby prop_ragdolls and assume their model.", 0, 1 )
cv_cloak_en        = CreateConVar( "imposter_cloak_enable",     "1", REP, "Allow the Imposter to ghost-cloak (fade out) when spotted or closing in.", 0, 1 )

-- Populate the bundle declared above. Must come AFTER CreateConVar calls so the
-- convar objects exist. Sound tables that are used INSIDE DoCustomTasks live here
-- so they consume one upvalue (IMPOSTER_CFG) instead of one each. Sound tables
-- used only in ENT methods outside DoCustomTasks use sndPick() directly.
IMPOSTER_CFG = {
    snd = {
        flee          = { "npc/fast_zombie/fz_scream1.wav", "npc/fast_zombie/fz_scream2.wav",
                          "npc/fast_zombie/pain1.wav",      "npc/fast_zombie/pain2.wav" },
        expose        = { "npc/fast_zombie/fz_scream3.wav",
                          "ambient/levels/labs/electric_explosion4.wav",
                          "npc/fast_zombie/fz_run_alert.wav" },
        ambush        = { "jumpscare.wav", "npc/fast_zombie/fz_run_alert.wav" },
        playdead_shot = { "npc/fast_zombie/fz_scream2.wav", "npc/fast_zombie/pain1.wav" },
        enrage_hit    = { "npc/fast_zombie/claw_strike1.wav", "npc/fast_zombie/claw_strike2.wav",
                          "npc/fast_zombie/claw_strike3.wav" },
    },
    cv = {
        playdead_en = cv_playdead_en,
        teleport_en = cv_teleport_en,
        scent_en    = cv_scent_en,
    },
}

-- ─── Dev tooling ──────────────────────────────────────────────────────────────

-- Flip this on to log phase transitions and show the live overlay above each
-- bot. Replicated so the clientside overlay can read the same value.
cv_debug = CreateConVar( "imposter_debug", "0",
    bit.bor( FCVAR_ARCHIVE, FCVAR_REPLICATED ),
    "Show live Imposter nextbot phase overlay and log phase transitions." )

-- ─── Settings application (options menu → server) ─────────────────────────────
-- All Imposter convars are FCVAR_REPLICATED so the client can READ them for the options
-- panel — which also makes them read-only on the client, so the panel can't write them
-- directly. The panel runs this server concommand instead; it applies the change server-side.
-- Works on listen AND dedicated servers (admins/host only), unlike clientside convar binding.

-- Whitelist: only these convars may be set through the menu (name → clamp bounds).
local IMPOSTER_SETTING_BOUNDS = {
    imposter_health              = { 1, 5000 },
    imposter_detect_range        = { 64, 8000 },
    imposter_grab_enable         = { 0, 1 },
    imposter_teleport_enable     = { 0, 1 },
    imposter_hearing_enable      = { 0, 1 },
    imposter_scent_enable        = { 0, 1 },
    imposter_tracking_enable     = { 0, 1 },
    imposter_selfdisg_enable     = { 0, 1 },
    imposter_ragdoll_disg_enable = { 0, 1 },
    imposter_playdead_enable     = { 0, 1 },
    imposter_flee_enable         = { 0, 1 },
    imposter_cloak_enable        = { 0, 1 },
    imposter_debug               = { 0, 1 },
}

concommand.Add( "imposter_set", function( ply, _, args )
    -- Allow the listen-server host / admins. An invalid ply means rcon/server console.
    if IsValid( ply ) and not ply:IsAdmin() then return end

    local name   = args[ 1 ]
    local value  = tonumber( args[ 2 ] )
    local bounds = name and IMPOSTER_SETTING_BOUNDS[ name ]
    if not bounds or not value then return end

    local cv = GetConVar( name )
    if not cv then return end
    value = math.Clamp( value, bounds[ 1 ], bounds[ 2 ] )
    cv:SetFloat( value )
    print( string.format( "[Imposter] %s set to %s by %s",
        name, tostring( value ), IsValid( ply ) and ply:Nick() or "server" ) )
end )
