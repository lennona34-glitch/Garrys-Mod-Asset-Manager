-- ─────────────────────────────────────────────────────────────────────────────
-- The Imposter — server brain: ENT methods, abilities, disguise, tasks.
-- ─────────────────────────────────────────────────────────────────────────────

-- DEFINE_BASECLASS only creates a FILE-LOCAL `BaseClass`, so the copy in shared.lua
-- isn't visible here. Re-fetch the termhunter parent so the overrides below (which
-- call BaseClass.TranslateActivity / SetupMotionType / OnTakeDamage) resolve.
local BaseClass = baseclass.Get( "terminator_nextbot" )


-- Hunters Glee compatibility: gate grab and scale stats when running inside HG.
-- engine.ActiveGamemode() is stable for the duration of a server session.
local function isHuntersGlee()
    return engine.ActiveGamemode() == "hunters_glee"
end

local function imposterGrabEnabled()
    return cv_grab_en:GetBool() and not isHuntersGlee()
end

-- A readable name for any entity (player nick / NPC targetname / class).
local function imposterEntName( ent )
    if not IsValid( ent ) then return "nil" end
    if ent:IsPlayer() then return ent:Nick() end
    if ent.GetName and ent:GetName() ~= "" then return ent:GetName() end
    return ent:GetClass()
end

-- Gated debug log: only prints while imposter_debug is on.
local function imposterDbg( self, fmt, ... )
    if not cv_debug:GetBool() then return end
    MsgN( string.format( "[Imposter #%d] " .. fmt, self:EntIndex(), ... ) )
end

-- Live-tunable held-body offset: where the ragdoll's chest attaches relative to
-- the imposter's hand. Dial in with imposter_hold_freeze 1.
-- imposter_status — prints every live Imposter and its current phase.
concommand.Add( "imposter_status", function()
    local found = 0
    for _, ent in ipairs( ents.FindByClass( IMPOSTER_CLASS_WILD ) ) do
        found = found + 1
        local phase  = ent.ImposterPhase or IMPOSTER_PHASE_ROAM
        local name   = IMPOSTER_PHASE_NAMES[ phase ] or "?"
        local target = IsValid( ent.ImposterTarget ) and imposterEntName( ent.ImposterTarget ) or "none"
        local track  = IsValid( ent.ImposterTrackTarget ) and imposterEntName( ent.ImposterTrackTarget ) or "none"
        MsgN( string.format( "[Imposter] #%d  entindex %d  phase %s (%d)  target %s  tracking %s",
            found, ent:EntIndex(), name, phase, target, track ) )

        -- Dump the grudge profiles so you can see WHY it prefers someone.
        if ent.ImposterProfiles and ent.ImposterScoreProfile then
            for who, p in pairs( ent.ImposterProfiles ) do
                if IsValid( who ) then
                    MsgN( string.format( "    %-20s score %6.1f  attacks %d  stalk %.0fs  lost %d",
                        imposterEntName( who ), ent:ImposterScoreProfile( who, p ),
                        p.attacks or 0, p.stalkTime or 0, p.lostCount or 0 ) )
                end
            end
        end
    end
    if found == 0 then MsgN( "[Imposter] none spawned" ) end
end )

-- ─── Target / wander helpers ──────────────────────────────────────────────────

-- Can the imposter actually see this entity? (world + props block the view, so it
-- can't see through walls). The basis for not being omniscient.
local function imposterCanSee( self, ent )
    if not IsValid( ent ) then return false end
    local eye = self:EyePos()
    local tr = util.TraceLine( {
        start  = eye,
        endpos = ent:WorldSpaceCenter(),
        filter = { self, ent },
        mask   = MASK_SHOT,
    } )
    if not tr.Hit or tr.Entity == ent then return true end
    -- second try toward the eyes, in case the centre is behind low cover
    tr = util.TraceLine( {
        start  = eye,
        endpos = ent.EyePos and ent:EyePos() or ent:GetPos(),
        filter = { self, ent },
        mask   = MASK_SHOT,
    } )
    return not tr.Hit or tr.Entity == ent
end

-- Respect the standard GMod ai_ignoreplayers convar: when set, the imposter
-- treats players as invisible for targeting purposes and falls back to NPCs only.
local cv_ai_ignoreplayers = GetConVar( "ai_ignoreplayers" )
local function imposterIgnorePlayers()
    return cv_ai_ignoreplayers and cv_ai_ignoreplayers:GetBool()
end

-- Pick someone to stalk: only prey the imposter can actually SEE within DETECT_RANGE.
-- Players are preferred over NPCs (unless ai_ignoreplayers is set); within the chosen
-- pool it picks the highest grudge score, so it fixates on whoever's wronged it most.
local function imposterPickTarget( self )
    local absorbed    = self.ImposterAbsorbed or {}
    local myPos       = self:GetPos()
    local range       = cv_aggro_dist:GetInt()
    local rangeSq     = range * range
    local ignorePlys  = imposterIgnorePlayers()
    local players, npcs = {}, {}

    if not ignorePlys then
        for _, ply in ipairs( player.GetAll() ) do
            if ply:Alive() and not absorbed[ ply ]
                and ply:GetPos():DistToSqr( myPos ) <= rangeSq
                and imposterCanSee( self, ply ) then
                players[ #players + 1 ] = ply
                self:ImposterNoteSeen( ply )
            end
        end
        for _, lp in ipairs( ents.FindByClass( "npc_lambdaplayer" ) ) do
            if IsValid( lp ) and lp:Alive() and not absorbed[ lp ]
                and lp:GetPos():DistToSqr( myPos ) <= rangeSq
                and imposterCanSee( self, lp ) then
                players[ #players + 1 ] = lp
                self:ImposterNoteSeen( lp )
            end
        end
    end

    for _, npc in ipairs( ents.FindByClass( "npc_*" ) ) do
        -- npc_* also matches npc_lambdaplayer; those are handled as player-like prey above.
        if IsValid( npc ) and not npc.IsLambdaPlayer and npc:Health() > 0 and not absorbed[ npc ]
            and npc:GetPos():DistToSqr( myPos ) <= rangeSq
            and imposterCanSee( self, npc ) then
            npcs[ #npcs + 1 ] = npc
            self:ImposterNoteSeen( npc )
        end
    end

    local pool = ( #players > 0 ) and players or npcs
    return self:ImposterBestByScore( pool )  -- nil when the pool is empty
end

-- Pick a random point in an adjacent navmesh area, for slow wandering.
-- True if a nav area is water (underwater attribute or its centre is in water) —
-- the imposter avoids these (it can't swim).
local function isWaterArea( area )
    if not IsValid( area ) then return true end
    if area.IsUnderwater and area:IsUnderwater() then return true end
    return bit.band( util.PointContents( area:GetCenter() + vector_up * 6 ), CONTENTS_WATER ) ~= 0
end

local function imposterPickWanderGoal( self )
    local myArea = navmesh.GetNearestNavArea( self:GetPos() )
    if not IsValid( myArea ) then return nil end

    local dry = {}
    for _, a in ipairs( myArea:GetAdjacentAreas() ) do
        if IsValid( a ) and not isWaterArea( a ) then dry[ #dry + 1 ] = a end
    end
    if #dry == 0 then
        return ( not isWaterArea( myArea ) ) and myArea:GetRandomPoint() or nil
    end

    return dry[ math.random( #dry ) ]:GetRandomPoint()
end

-- A broad patrol goal: a random dry, reachable nav area within ROAM_PATROL_RADIUS,
-- so roaming/disguised wandering ranges across the map like a player exploring
-- rather than ping-ponging between two adjacent areas.
local function imposterPickRoamGoal( self )
    -- Memory: sometimes head back toward where someone was recently seen, so the
    -- bot drifts toward activity instead of wandering at random.
    local recall = self.ImposterFreshSighting and self:ImposterFreshSighting()
    if recall and math.random() < SIGHTING_RECALL_CHANCE then
        local near = navmesh.Find( recall, SIGHTING_RECALL_SPREAD, 300, 300 )
        if near and #near > 0 then
            for _ = 1, 10 do
                local area = near[ math.random( #near ) ]
                if IsValid( area ) and not isWaterArea( area ) and self:areaIsReachable( area ) then
                    return area:GetRandomPoint()
                end
            end
        end
    end

    local areas = navmesh.Find( self:GetPos(), ROAM_PATROL_RADIUS, 400, 400 )
    if not areas or #areas == 0 then return imposterPickWanderGoal( self ) end

    for _ = 1, 12 do  -- a few tries to find a dry, reachable one
        local area = areas[ math.random( #areas ) ]
        if IsValid( area ) and not isWaterArea( area ) and self:areaIsReachable( area ) then
            return area:GetRandomPoint()
        end
    end
    return imposterPickWanderGoal( self )
end

-- Roam goal for the TRUE form: prefer a dry, reachable area that NO living player
-- can currently see, so the undisguised thing routes toward cover instead of
-- strolling through open sightlines. Honors sighting memory (search near the last
-- sighting sometimes), and falls back to a normal roam goal when nowhere is hidden.
local function imposterPickHiddenRoamGoal( self )
    local players = {}
    for _, ply in ipairs( player.GetAll() ) do
        if ply:Alive() then players[ #players + 1 ] = ply end
    end
    if #players == 0 then return imposterPickRoamGoal( self ) end  -- nobody to hide from

    -- Center the search on a remembered sighting sometimes (memory), else on us.
    local center, radius = self:GetPos(), ROAM_PATROL_RADIUS
    local recall = self.ImposterFreshSighting and self:ImposterFreshSighting()
    if recall and math.random() < SIGHTING_RECALL_CHANCE then
        center, radius = recall, SIGHTING_RECALL_SPREAD
    end

    local areas = navmesh.Find( center, radius, 400, 400 )
    if not areas or #areas == 0 then return imposterPickRoamGoal( self ) end

    local step   = math.max( 1, math.floor( #areas / 40 ) )  -- sample, don't trace every area
    local hidden = {}
    for i = 1, #areas, step do
        local area = areas[ i ]
        if IsValid( area ) and not isWaterArea( area ) and self:areaIsReachable( area ) then
            local p    = area:GetCenter() + Vector( 0, 0, 36 )
            local seen = false
            for _, ply in ipairs( players ) do
                local tr = util.TraceLine( {
                    start  = ply:EyePos(),
                    endpos = p,
                    filter = { ply, self },
                    mask   = MASK_SOLID_BRUSHONLY,
                } )
                if not tr.Hit then seen = true break end
            end
            if not seen then hidden[ #hidden + 1 ] = area end
        end
    end

    if #hidden > 0 then return hidden[ math.random( #hidden ) ]:GetRandomPoint() end
    return imposterPickRoamGoal( self )  -- nowhere hidden: take a normal goal
end

-- Where to blink in when teleporting after a far-off lead: a dry, reachable nav area
-- within a standoff band around the lead's position, preferring one the lead can't
-- see (so it materializes nearby but not literally in their face). Falls back to the
-- raw destination if nothing suitable turns up.
local function imposterPickTeleportSpot( self, destPos, target )
    if not destPos then return nil end
    local areas = navmesh.Find( destPos, TP_STANDOFF_MAX, 300, 300 )
    if not areas or #areas == 0 then return destPos end

    local eyes = IsValid( target ) and ( target.EyePos and target:EyePos() or target:GetPos() ) or nil
    local minSq, maxSq = TP_STANDOFF_MIN * TP_STANDOFF_MIN, TP_STANDOFF_MAX * TP_STANDOFF_MAX
    local anyOk

    for _ = 1, 30 do
        local area = areas[ math.random( #areas ) ]
        if IsValid( area ) and not isWaterArea( area ) and self:areaIsReachable( area ) then
            local pt = area:GetRandomPoint()
            local d2 = pt:DistToSqr( destPos )
            if d2 >= minSq and d2 <= maxSq then
                anyOk = anyOk or pt
                if not eyes then return pt end
                local tr = util.TraceLine( {
                    start  = eyes,
                    endpos = pt + Vector( 0, 0, 40 ),
                    filter = { self, target },
                    mask   = MASK_SOLID_BRUSHONLY,
                } )
                if tr.Hit then return pt end  -- hidden from the lead: ideal blink-in
            end
        end
    end

    return anyOk or destPos
end

-- A quick spark burst + screen shake at a blink endpoint (vanish or arrival).
local function imposterBlinkFx( pos )
    local ed = EffectData()
    ed:SetOrigin( pos )
    ed:SetMagnitude( 2 )
    ed:SetScale( 1 )
    ed:SetRadius( 18 )
    util.Effect( "Sparks", ed )
    util.ScreenShake( pos, 4, 80, 0.4, 600, true )
end

-- Find a secluded spot to drag a victim off to: a dry, reachable navmesh area as
-- far as possible from the NEAREST player, strongly preferring one no living player
-- can see. Two passes: best hidden spot, else best visible spot. nil = drain in place.
local function imposterFindSecludedSpot( self )
    local areas = navmesh.Find( self:GetPos(), SECLUDE_SEARCH_RADIUS, 400, 400 )
    if not areas or #areas == 0 then return nil end

    local players = {}
    for _, ply in ipairs( player.GetAll() ) do
        if ply:Alive() then players[ #players + 1 ] = ply end
    end

    local step = math.max( 1, math.floor( #areas / 50 ) )

    local bestHidden, bestHiddenSq
    local bestAny, bestAnySq

    for i = 1, #areas, step do
        local area = areas[ i ]
        if IsValid( area ) and not isWaterArea( area ) and self:areaIsReachable( area ) then
            local p = area:GetCenter() + Vector( 0, 0, 36 )

            -- maximize the distance to the CLOSEST player
            local minSq, hidden = math.huge, true
            for _, ply in ipairs( players ) do
                minSq = math.min( minSq, p:DistToSqr( ply:GetPos() ) )
                local tr = util.TraceLine( {
                    start  = ply:EyePos(),
                    endpos = p,
                    filter = { ply, self },
                    mask   = MASK_SOLID_BRUSHONLY,
                } )
                if not tr.Hit then hidden = false end
            end

            if minSq >= 800 * 800 then  -- comfortably away from everyone
                if hidden then
                    if not bestHiddenSq or minSq > bestHiddenSq then
                        bestHiddenSq, bestHidden = minSq, area:GetCenter()
                    end
                elseif not bestAnySq or minSq > bestAnySq then
                    bestAnySq, bestAny = minSq, area:GetCenter()
                end
            end
        end
    end

    return bestHidden or bestAny
end

local function imposterPickFleeGoal( self, threat )
    local myPos = self:GetPos()
    local threatPos = IsValid( threat ) and threat:GetPos() or ( myPos - self:GetForward() * 256 )
    local away = myPos - threatPos
    away.z = 0
    if away:LengthSqr() <= 1 then
        away = -self:GetForward()
        away.z = 0
    end
    away:Normalize()

    -- navmesh.Find is far cheaper than GetAllNavAreas on large maps (construct, etc.)
    local areas = navmesh.Find( myPos, FLEE_GOAL_DIST, 400, 400 )
    if not areas or #areas == 0 then
        return myPos + away * math.min( FLEE_GOAL_DIST, 1100 )
    end

    -- Score every candidate by direction-away + distance; skip water and too-close areas.
    local candidates = {}
    for _, area in ipairs( areas ) do
        if not IsValid( area ) or isWaterArea( area ) then continue end
        local center = area:GetCenter()
        local delta  = center - myPos
        delta.z = 0
        local distSqr = delta:LengthSqr()
        if distSqr < 220 * 220 then continue end
        local score = delta:GetNormalized():Dot( away ) * 1400 + math.min( math.sqrt( distSqr ), FLEE_GOAL_DIST )
        candidates[ #candidates + 1 ] = { area = area, score = score, center = center }
    end

    if #candidates == 0 then
        return myPos + away * math.min( FLEE_GOAL_DIST, 1100 )
    end

    table.sort( candidates, function( a, b ) return a.score > b.score end )

    -- LOS checks are expensive; only trace the top 20 candidates for a cover spot.
    local threatEye = threatPos + Vector( 0, 0, 64 )
    for i = 1, math.min( 20, #candidates ) do
        local c = candidates[ i ]
        local tr = util.TraceLine( {
            start  = threatEye,
            endpos = c.center + Vector( 0, 0, 36 ),
            filter = IsValid( threat ) and { threat, self } or { self },
            mask   = MASK_SOLID_BRUSHONLY,
        } )
        if tr.Hit then
            return c.area:GetRandomPoint()  -- geometry blocks the threat's view here
        end
    end

    return candidates[ 1 ].area:GetRandomPoint()  -- no cover found: best direction
end


-- True if any living player is actively looking at the imposter: they must be
-- roughly facing it (within ~60° half-FOV) AND have a clear LOS. Stricter than
-- imposterSeenByPlayer — used for the Weeping Angel freeze mechanic.
local function imposterWatchedByPlayer( self )
    local myCenter = self:WorldSpaceCenter()
    for _, ply in ipairs( player.GetAll() ) do
        if not ply:Alive() then continue end
        local eyePos = ply:EyePos()
        local toSelf = ( myCenter - eyePos ):GetNormalized()
        if ply:EyeAngles():Forward():Dot( toSelf ) < 0.5 then continue end  -- ~60° half-FOV
        local tr = util.TraceLine( {
            start  = eyePos,
            endpos = myCenter,
            filter = { ply, self },
            mask   = MASK_SOLID_BRUSHONLY,
        } )
        if not tr.Hit then return true end
    end
    return false
end

-- True if any living player has a clear (world-geometry) line of sight to the
-- imposter — the basis for "avoid being seen" / cloak-when-spotted.
local function imposterSeenByPlayer( self )
    local myCenter = self:WorldSpaceCenter()
    for _, ply in ipairs( player.GetAll() ) do
        if not ply:Alive() then continue end
        local tr = util.TraceLine( {
            start  = ply:EyePos(),
            endpos = myCenter,
            filter = { ply, self },
            mask   = MASK_SOLID_BRUSHONLY,
        } )
        if not tr.Hit then return true end
    end
    return false
end

-- ─── Special abilities (cooldown-based) ───────────────────────────────────────
-- The true-form imposter uses these proactively. Each has a cooldown, a condition,
-- and a use function — add more by appending to the table. The reactive flee runs
-- its own smoke+cloak, so abilities are suppressed during the FLEE phase.
local IMPOSTER_ABILITIES = {
    {   -- fade out when a player spots the true form, or when closing on a mark
        name     = "cloak",
        cooldown = 12,
        condition = function( self )
            if not cv_cloak_en:GetBool() then return false end
            local phase = self:ImposterGetPhase()
            if phase ~= IMPOSTER_PHASE_ROAM and phase ~= IMPOSTER_PHASE_STALK then return false end
            -- cloak the moment a player can see us, or when closing in on a mark
            if imposterSeenByPlayer( self ) then return true end
            local t = self.ImposterTarget
            return IsValid( t ) and self:GetRangeTo( t ) < 1200
        end,
        -- Execution lives in the "cloak" special action (see ENT.MySpecialActions); the
        -- ability layer just decides WHEN and routes through the standard action system.
        use = function( self ) self:TakeAction( "cloak" ) end,
    },
    {   -- slip into a self-made disguise (random playermodel) to lurk/approach unseen
        name     = "disguise",
        cooldown = 35,
        condition = function( self )
            if not cv_selfdisg_en:GetBool() then return false end
            -- Only from the true-form roam, and only while unwitnessed so the morph
            -- itself is never seen (it appears already-disguised when players find it).
            if self:ImposterGetPhase() ~= IMPOSTER_PHASE_ROAM then return false end
            if self:ImposterIsCloaked() then return false end
            return not imposterSeenByPlayer( self )
        end,
        use = function( self ) self:TakeAction( "disguise" ) end,
    },
}

-- True while cloaked, by an ability or while fleeing (the user's flee sets its own
-- ImposterFleeCloaked). The flicker reads this to render faint instead of opaque.
function ENT:ImposterIsCloaked()
    return self.ImposterFleeCloaked == true
        or ( self.ImposterCloakUntil ~= nil and CurTime() < self.ImposterCloakUntil )
end

-- ─── Ghost cloak (the cloak ability) ──────────────────────────────────────────
-- corpse1's materials ignore SetColor alpha, so instead we hide the real nextbot
-- and show a translucent prop_dynamic copy of its model. The copy is kept in sync
-- with the live animation each think. Lifetime is driven from AdditionalThink (not
-- a one-shot timer) so a refreshed cloak can never strand the bot invisible.
function ENT:ImposterStartGhostCloak( duration )
    self.ImposterGhostUntil = CurTime() + duration
    self.ImposterCloakUntil = CurTime() + duration  -- keep IsCloaked()/flicker in sync

    self:SetNoDraw( true )
    self:ImposterUpdateRelationships( self.ImposterDisguised )  -- set NPCs neutral while invisible

    if not IsValid( self.ImposterCloakProp ) then
        local ghost = ents.Create( "prop_dynamic" )
        if IsValid( ghost ) then
            ghost:SetModel( self:GetModel() )
            ghost:SetPos( self:GetPos() )
            ghost:SetAngles( self:GetAngles() )
            ghost:Spawn()
            ghost:Activate()
            ghost:SetParent( self )
            ghost:SetRenderMode( RENDERMODE_TRANSALPHA )
            ghost:SetColor( Color( 150, 165, 175, 25 ) )  -- 10% visible, ashen tint
            self.ImposterCloakProp = ghost
            self.ImposterGhostLastSeq = -1
        end
    end
end

function ENT:ImposterEndGhostCloak()
    self.ImposterGhostUntil = nil
    self:SetNoDraw( false )
    if IsValid( self.ImposterCloakProp ) then
        self.ImposterCloakProp:Remove()
    end
    self.ImposterCloakProp = nil
    self:ImposterUpdateRelationships( self.ImposterDisguised )  -- restore NPC targeting
end

-- Per-think upkeep: end the cloak once its time is up, otherwise mirror the live
-- animation (sequence + cycle) onto the frozen ghost so it doesn't T-pose.
function ENT:ImposterUpdateGhostCloak()
    if not self.ImposterGhostUntil then return end

    if CurTime() >= self.ImposterGhostUntil and not self.ImposterFleeCloaked then
        self:ImposterEndGhostCloak()
        return
    end

    local ghost = self.ImposterCloakProp
    if IsValid( ghost ) then
        local seq = self:GetSequence()
        if seq ~= self.ImposterGhostLastSeq then
            ghost:ResetSequence( seq )
            self.ImposterGhostLastSeq = seq
        end
    end
end

-- Tick the ability system: fire the first off-cooldown ability whose condition
-- holds, start its cooldown, and space the next attempt out. One at a time.
function ENT:ImposterThinkAbilities()
    if self:ImposterGetPhase() == IMPOSTER_PHASE_FLEE then return end  -- flee runs its own
    if CurTime() < ( self.ImposterNextAbility or 0 ) then return end
    self.ImposterNextAbility = CurTime() + 0.5

    self.ImposterAbilityCD = self.ImposterAbilityCD or {}
    for _, ab in ipairs( IMPOSTER_ABILITIES ) do
        if CurTime() >= ( self.ImposterAbilityCD[ ab.name ] or 0 ) and ab.condition( self ) then
            ab.use( self )
            -- Restless variant has sharper reflexes: abilities recharge 40% faster.
            local cdMul = self:ImposterIsRestless() and 0.6 or 1
            self.ImposterAbilityCD[ ab.name ] = CurTime() + ab.cooldown * cdMul
            self.ImposterNextAbility = CurTime() + 2  -- don't chain abilities instantly
            return
        end
    end
end

-- ─── Special actions (termhunter ENT.MySpecialActions framework) ──────────────
-- The imposter's discrete behaviours are declared as special actions so they run through
-- the base's standardized action system: the AI triggers them with self:TakeAction(name),
-- and (since the same svAction backs both) a player driving the bot could trigger them too.
-- Each svAction is the single execution point and self-gates on its enable convar, so the
-- toggle is respected no matter who triggers it (AI, console, or a driving player).
-- The DECISION of when to act stays in the ability/task logic that calls TakeAction.
ENT.MySpecialActions = {
    ["cloak"] = {
        name = "Cloak",
        svAction = function( _drive, _driver, bot )
            if not cv_cloak_en:GetBool() then return end
            bot:ImposterStartGhostCloak( 6 )
            bot:EmitSound( "items/nvg_on.wav", 65, 130, 0.6 )
            imposterDbg( bot, "cloak action - fading out" )
        end,
    },
    ["disguise"] = {
        name = "Self Disguise",
        svAction = function( _drive, _driver, bot )
            if not cv_selfdisg_en:GetBool() then return end
            if not bot:ImposterSelfDisguise() then return end
            -- Hand off whatever true-form movement task is running to the blend-in task.
            for _, t in ipairs( { "movement_roam", "movement_stalk", "movement_tracking", "movement_hunt" } ) do
                if bot:IsTaskActive( t ) then bot:TaskComplete( t ) end
            end
            if not bot:IsTaskActive( "movement_disguised" ) then
                bot:StartTask( "movement_disguised", "self-disguise power - lurking" )
            end
            imposterDbg( bot, "disguise action - blending in" )
        end,
    },
    ["teleport"] = {
        name = "Teleport Blink",
        svAction = function( _drive, _driver, bot )
            if not IMPOSTER_CFG.cv.teleport_en:GetBool() then return end
            bot:StartTask( "movement_teleport", "teleport action - blinking closer" )
        end,
    },
    ["playdead"] = {
        name = "Play Dead",
        svAction = function( _drive, _driver, bot )
            if not IMPOSTER_CFG.cv.playdead_en:GetBool() then return end
            bot:StartTask( "movement_playdead", "playdead action - dropping to ambush" )
        end,
    },
    ["grab"] = {
        name = "Grab Victim",
        svAction = function( _drive, _driver, bot )
            if not imposterGrabEnabled() then return end
            bot:StartTask( "movement_execute", "grab action - executing" )
        end,
    },
}

-- Faction mirroring: NPCs treat the imposter as a friend while it's disguised, and
-- as an enemy when it's in its true form. Rate-limited refresh (new NPCs spawn).
-- Which base-HL2 faction a class belongs to, for disguise relationship mimicry.
-- Anything unlisted is treated as factionless (other NPCs simply ignore the disguise).
local NPC_FACTION = {
    -- Player allies: citizens, rebels, medics (group03), and the named cast.
    npc_citizen = "ally", npc_alyx = "ally", npc_barney = "ally", npc_kleiner = "ally",
    npc_eli = "ally", npc_mossman = "ally", npc_gman = "ally", npc_monk = "ally",
    npc_magnusson = "ally", npc_vortigaunt = "ally", npc_dog = "ally", npc_fisherman = "ally",
    -- Combine.
    npc_combine_s = "combine", npc_metropolice = "combine", npc_manhack = "combine",
    npc_turret_floor = "combine", npc_turret_ceiling = "combine", npc_strider = "combine",
    npc_hunter = "combine", npc_rollermine = "combine", npc_combinegunship = "combine",
    npc_combinedropship = "combine", npc_cscanner = "combine", npc_clawscanner = "combine",
    npc_stalker = "combine", npc_sniper = "combine",
    -- Antlions.
    npc_antlion = "antlion", npc_antlionguard = "antlion", npc_antlion_worker = "antlion",
    -- Zombies / headcrabs.
    npc_zombie = "zombie", npc_fastzombie = "zombie", npc_fastzombie_torso = "zombie",
    npc_poisonzombie = "zombie", npc_zombine = "zombie", npc_zombie_torso = "zombie",
    npc_headcrab = "zombie", npc_headcrab_fast = "zombie", npc_headcrab_black = "zombie",
}

local function npcFactionOf( class )
    return class and NPC_FACTION[ class ] or nil
end

-- Pick a random player model "available on the server" for a self-initiated disguise:
-- prefer the full installed-playermodel list (player_manager) for variety, and fall
-- back to models currently worn by connected players if that's somehow empty.
local function imposterRandomPlayerModel()
    local models = {}
    local all = player_manager.AllValidModels()
    if istable( all ) then
        for _, mdl in pairs( all ) do
            if isstring( mdl ) and mdl ~= "" then models[ #models + 1 ] = mdl end
        end
    end
    if #models == 0 then
        for _, ply in ipairs( player.GetAll() ) do
            local m = ply:GetModel()
            if isstring( m ) and m ~= "" then models[ #models + 1 ] = m end
        end
    end
    if #models == 0 then return SELFDISG_FALLBACK_MODEL end
    return models[ math.random( #models ) ]
end

-- Set the player-like flag AND mirror it to clients (the HUD reads the NWBool to
-- decide whether to draw the nametag / voice popups — NPC disguises get neither).
function ENT:ImposterSetDisguiseIsPlayer( v )
    self.ImposterDisguiseIsPlayer = v
    self:SetNWBool( "ImposterDisguiseIsPlayer", v == true )
end

local DISG_REL_PRIORITY = 999

-- Sync how NPCs feel about the imposter — AND how the imposter's own AI feels about
-- them. The termhunter base re-derives both sides every think from its
-- `term_HardCodedRelations` table (GetDesiredEnemyRelationship reads it first), then
-- force-writes the NPC's disposition back. Per-entity relationships are last-write-wins,
-- so directly poking NPCs gets clobbered — the only durable fix is to feed the base the
-- relations we want through that table. Each entry is { ourDisp, theirDisp, priority }.
--   friendly == false → true form: restore the base defaults (NPCs hate the monster).
--   friendly == true, player disguise → blend in: every known NPC treats it as a friend.
--   friendly == true, NPC disguise → mimic the worn faction: same-faction NPCs are
--     friendly both ways, rival factions stay hostile to it (it ignores them so it can
--     keep hunting), unclassified NPCs fall back to base defaults.
function ENT:ImposterUpdateRelationships( friendly )
    -- Snapshot the base's hardcoded relations once so we can layer on top and restore.
    self.ImposterDefaultRelations = self.ImposterDefaultRelations or self.term_HardCodedRelations or {}

    local playerDisguise = friendly and self.ImposterDisguiseIsPlayer
    local worn           = friendly and ( not self.ImposterDisguiseIsPlayer ) and self.ImposterDisguiseFaction or nil
    -- While cloaked in true form the imposter is visually gone: neutralize NPC targeting
    -- so they don't chase an invisible entity (or remember it was there and keep shooting).
    local cloaked        = not friendly and self:ImposterIsCloaked()

    -- Rebuild the table the base reads from.
    local rel = {}
    for k, v in pairs( self.ImposterDefaultRelations ) do rel[ k ] = v end
    if friendly then
        for class, fac in pairs( NPC_FACTION ) do
            if playerDisguise then
                rel[ class ] = { D_LI, D_LI, DISG_REL_PRIORITY }
            elseif worn then
                rel[ class ] = ( fac == worn )
                    and { D_LI, D_LI, DISG_REL_PRIORITY }
                    or  { D_NU, D_HT, DISG_REL_PRIORITY }   -- it ignores rivals; they hate it
            end
        end
    elseif cloaked then
        -- Invisible: NPCs become neutral so they stop chasing and lose interest.
        for class in pairs( NPC_FACTION ) do
            rel[ class ] = { D_LI, D_NU, DISG_REL_PRIORITY }
        end
    end
    self.term_HardCodedRelations = rel

    -- Apply immediately to live NPCs too, so it doesn't wait for the base's next pass.
    for _, npc in ipairs( ents.FindByClass( "npc_*" ) ) do
        if not ( IsValid( npc ) and npc.AddEntityRelationship ) then continue end
        local disp = D_HT
        if playerDisguise then
            disp = D_LI
        elseif worn then
            local g = npcFactionOf( npc:GetClass() )
            disp = g and ( ( g == worn ) and D_LI or D_HT ) or D_NU
        elseif cloaked then
            disp = D_NU  -- invisible: NPCs lose interest
        end
        npc:AddEntityRelationship( self, disp, DISG_REL_PRIORITY )
    end

    -- Lambda Players use their own AI and never appear in npc_* results, so update
    -- them separately. Player disguise and cloak both need to make the imposter
    -- invisible/friendly to Lambda bots, same as to real NPCs.
    for _, lp in ipairs( ents.FindByClass( "npc_lambdaplayer" ) ) do
        if not IsValid( lp ) or not lp.AddEntityRelationship then continue end
        local disp = D_HT
        if playerDisguise then
            disp = D_LI   -- blending in as a player: Lambda bots treat it as a teammate
        elseif friendly then
            disp = D_NU   -- NPC disguise: Lambda bots ignore it (they don't know this NPC)
        elseif cloaked then
            disp = D_NU   -- invisible: Lambda bots lose interest and stop chasing
        end
        lp:AddEntityRelationship( self, disp, DISG_REL_PRIORITY )
    end
end

-- Lambda Players use their own targeting pipeline (Relations() → _LAMBDAPLAYERSEntityRelations
-- table keyed by class) that ignores AddEntityRelationship for nextbots. The only reliable
-- hook point is LambdaCanTarget: returning true blocks a Lambda from attacking the entity.
-- When the imposter is disguised it looks like a player or NPC — Lambdas should ignore it.
-- When it's in its true form (or enraged), Lambdas can target it normally.
if SERVER then
    hook.Add( "LambdaCanTarget", "ImposterNextbot.LambdaIgnoreDisguised", function( lambda, target )
        if not IsValid( target ) then return end
        if not string.StartWith( target:GetClass(), "nextbot_imposter" ) then return end
        if target.ImposterDisguised and not target.ImposterEnraged then
            return true  -- block: imposter looks like a person, not a threat
        end
    end )
end

-- Avoid other NPCs and nextbots: the imposter only fights players (its prey, via the
-- grudge/hunt system). For anything else that isn't player-like, force a mutual neutral
-- disposition so the base AI never picks it as an enemy — the imposter slips past the
-- map's other monsters instead of getting dragged into firefights, staying focused and
-- in character. Active disguise relations still win because the base resolves its
-- term_HardCodedRelations table BEFORE calling here, and we honor those by bailing when
-- one exists for the entity's class.
function ENT:GetDesiredEnemyRelationship( myTbl, ent, entsTbl, isFirst )
    if IsValid( ent ) and not ent:IsPlayer() and ( ent:IsNPC() or ent:IsNextBot() )
        and not ent.IsLambdaPlayer   -- lambda players are player-like prey (nextbots, class npc_lambdaplayer)
        and not ( myTbl.term_HardCodedRelations and myTbl.term_HardCodedRelations[ ent:GetClass() ] ) then
        -- Combine are the one faction that still hunts the exposed imposter on sight, and
        -- it fights back — a real threat. (A disguise still fools them: when disguised, the
        -- worn faction's classes carry a hardcoded relation, so we bail above and the base
        -- returns the friendly disguise disposition instead of reaching here.)
        if npcFactionOf( ent:GetClass() ) == "combine" then
            return D_HT, 1, D_HT
        end
        return D_NU, 1, D_NU
    end
    -- When disguised, the imposter looks like just another person — Lambda players should
    -- ignore it (D_NU) or treat it as a teammate (D_LI) rather than shooting on sight.
    if ent.IsLambdaPlayer and myTbl.ImposterDisguised then
        local rel = myTbl.ImposterDisguiseIsPlayer and D_LI or D_NU
        return rel, 1, rel
    end
    return BaseClass.GetDesiredEnemyRelationship( self, myTbl, ent, entsTbl, isFirst )
end

-- Enrage burns out: drop the frenzy, calm back to the true-form roam (so it can
-- start the whole cycle over rather than staying enraged forever).
function ENT:ImposterCalmDown()
    self.ImposterEnraged     = false
    self.ImposterEnrageUntil = nil
    self.RunSpeed            = self.ImposterNormalRun or self.RunSpeed
    self.ImposterTarget      = nil
    self:ImposterApplyTrueFormLook()
    self:ImposterUpdateRelationships( false )

    if self:IsTaskActive( "movement_enrage" ) then self:TaskComplete( "movement_enrage" ) end
    self:StartTask( "movement_roam", "enrage subsided - calming down" )
end

-- ─── Target memory (so it isn't omniscient) ───────────────────────────────────

-- Remember where a person was last seen. Roaming gravitates back toward these
-- spots, so the bot feels like it remembers activity instead of wandering blind.
function ENT:ImposterRecordSighting( pos )
    if not pos then return end
    self.ImposterSightings = self.ImposterSightings or {}
    local now = CurTime()

    -- Merge into a nearby existing sighting rather than stacking near-duplicates.
    for _, s in ipairs( self.ImposterSightings ) do
        if s.pos:DistToSqr( pos ) < 400 * 400 then
            s.pos, s.time = pos, now
            return
        end
    end

    table.insert( self.ImposterSightings, 1, { pos = pos, time = now } )
    self.ImposterSightings[ SIGHTING_MEMORY_MAX + 1 ] = nil  -- trim to the cap
end

-- The freshest non-stale remembered sighting, or nil if memory has gone cold.
function ENT:ImposterFreshSighting()
    local list = self.ImposterSightings
    if not list then return nil end
    local now = CurTime()
    for _, s in ipairs( list ) do
        if now - s.time <= SIGHTING_MEMORY_TIME then return s.pos end
    end
    return nil
end

-- Begin tracking a freshly-spotted target — seed the last-known position.
function ENT:ImposterBeginTracking( target )
    self.ImposterTarget       = target
    self.ImposterLastKnownPos = IsValid( target ) and target:GetPos() or nil
    self.ImposterLastSeen     = CurTime()
    if IsValid( target ) then self:ImposterRecordSighting( target:GetPos() ) end
end

-- Where the imposter BELIEVES the target is. Refreshes the memory only while it can
-- actually see the target; otherwise returns the last spot it saw them.
function ENT:ImposterKnownTargetPos()
    local t = self.ImposterTarget
    if not IsValid( t ) then return nil end
    if imposterCanSee( self, t ) then
        self.ImposterLastKnownPos = t:GetPos()
        self.ImposterLastSeen     = CurTime()
        self:ImposterRecordSighting( t:GetPos() )
    end
    return self.ImposterLastKnownPos
end

-- True once it hasn't laid eyes on the target for TARGET_LOST_TIME seconds.
function ENT:ImposterLostTarget()
    return not self.ImposterLastSeen or ( CurTime() - self.ImposterLastSeen ) > TARGET_LOST_TIME
end

-- True if the stalk target is gone (invalid or dead). Handles players vs NPCs.
local function targetIsLost( target )
    if not IsValid( target ) then return true end
    if target:IsPlayer() then return not target:Alive() end
    return target:Health() <= 0
end

-- Nearest living player or NPC to the imposter — used when enraged to keep finding
-- the next thing to kill.
local function imposterPickNearest( self )
    local myPos = self:GetPos()
    local best, bestD = nil, math.huge

    if not imposterIgnorePlayers() then
        for _, ply in ipairs( player.GetAll() ) do
            if ply:Alive() then
                local d = ply:GetPos():DistToSqr( myPos )
                if d < bestD then best, bestD = ply, d end
            end
        end
        for _, lp in ipairs( ents.FindByClass( "npc_lambdaplayer" ) ) do
            if IsValid( lp ) and lp:Alive() then
                local d = lp:GetPos():DistToSqr( myPos )
                if d < bestD then best, bestD = lp, d end
            end
        end
    end
    for _, npc in ipairs( ents.FindByClass( "npc_*" ) ) do
        if IsValid( npc ) and npc:Health() > 0 then
            local d = npc:GetPos():DistToSqr( myPos )
            if d < bestD then best, bestD = npc, d end
        end
    end

    return best
end

-- ─── Grudge profiles: WHO to fixate on (drives stalk marks & track leads) ─────
-- Each person we interact with gets a profile recording how they've treated us and
-- how invested we are in them. The highest score becomes the mark / track lead.

-- Lazy-get (or create) the interaction profile for an entity.
function ENT:ImposterProfile( ent )
    if not IsValid( ent ) then return nil end
    self.ImposterProfiles = self.ImposterProfiles or {}
    local p = self.ImposterProfiles[ ent ]
    if not p then
        p = { attacks = 0, stalkTime = 0, lostCount = 0,
              lastSeenPos = ent:GetPos(), lastSeenTime = CurTime() }
        self.ImposterProfiles[ ent ] = p
    end
    return p
end

-- The grudge score: attacks weigh heaviest (revenge), then stalk investment and
-- the number of times they've slipped away, plus a recency bonus that fades out.
-- Returns -1 for a profile that has gone stale (forgotten).
function ENT:ImposterScoreProfile( ent, p )
    p = p or ( self.ImposterProfiles and self.ImposterProfiles[ ent ] )
    if not p then return 0 end
    local age = CurTime() - ( p.lastSeenTime or 0 )
    if age > GRUDGE_MEMORY_TIME then return -1 end
    local recency = math.Clamp( 1 - age / GRUDGE_MEMORY_TIME, 0, 1 )
    return ( p.attacks    or 0 ) * GRUDGE_W_ATTACK
         + ( p.stalkTime  or 0 ) * GRUDGE_W_STALKSEC
         + ( p.lostCount  or 0 ) * GRUDGE_W_LOST
         + recency * GRUDGE_W_RECENT
end

-- Refresh memory on someone we currently see (builds grudge context passively).
function ENT:ImposterNoteSeen( ent )
    local p = self:ImposterProfile( ent )
    if not p then return end
    p.lastSeenPos  = ent:GetPos()
    p.lastSeenTime = CurTime()
    p.leadCooldown = nil  -- a fresh sighting revives them as a track lead
    self:ImposterRecordSighting( p.lastSeenPos )
end

-- Someone attacked us: bump the grudge and refresh where they are.
function ENT:ImposterNoteAttack( attacker )
    if not IsValid( attacker ) or not ( attacker:IsPlayer() or attacker:IsNPC() or attacker.IsLambdaPlayer ) then return end
    local p = self:ImposterProfile( attacker )
    if not p then return end
    p.attacks      = ( p.attacks or 0 ) + 1
    p.lastSeenPos  = attacker:GetPos()
    p.lastSeenTime = CurTime()
    imposterDbg( self, "grudge +1 vs %s (attacks=%d, score=%.0f)",
        imposterEntName( attacker ), p.attacks, self:ImposterScoreProfile( attacker, p ) )
end

-- We lost sight of someone we cared about — they become "the one that got away".
function ENT:ImposterNoteLost( ent )
    local p = IsValid( ent ) and self.ImposterProfiles and self.ImposterProfiles[ ent ]
    if not p then return end
    p.lostCount    = ( p.lostCount or 0 ) + 1
    p.lastSeenTime = CurTime()  -- keep them fresh enough to track right after losing them
    imposterDbg( self, "lost %s (lostCount=%d) - will try to track", imposterEntName( ent ), p.lostCount )
end

-- Highest grudge score among a list of currently-visible candidates. A tiny
-- proximity tiebreak keeps brand-new (all-zero) candidates from being arbitrary.
function ENT:ImposterBestByScore( list )
    local myPos = self:GetPos()
    local best, bestScore
    for _, ent in ipairs( list ) do
        if IsValid( ent ) then
            local score = self:ImposterScoreProfile( ent ) - ent:GetPos():Distance( myPos ) * 0.01
            if not bestScore or score > bestScore then best, bestScore = ent, score end
        end
    end
    return best
end

-- The best OUT-OF-SIGHT person to go hunt down by their last-known trail. Prunes
-- dead/absorbed profiles as it goes. Returns the entity and where we last saw them.
function ENT:ImposterPickTrackLead()
    if not cv_tracking_en:GetBool() then return nil end  -- master tracking toggle: no memory pursuit
    if not self.ImposterProfiles then return nil end
    local now      = CurTime()
    local absorbed = self.ImposterAbsorbed or {}
    local best, bestScore, bestPos

    for ent, p in pairs( self.ImposterProfiles ) do
        if not IsValid( ent ) or absorbed[ ent ] or targetIsLost( ent ) then
            if not IsValid( ent ) or absorbed[ ent ] then self.ImposterProfiles[ ent ] = nil end
        elseif ( p.leadCooldown and now < p.leadCooldown )
            or imposterCanSee( self, ent )       -- if we can see them, that's stalk's job
            or not p.lastSeenPos then
            -- not a trackable lead right now
        else
            local score = self:ImposterScoreProfile( ent, p )
            if score >= 0 and ( not bestScore or score > bestScore ) then
                best, bestScore, bestPos = ent, score, p.lastSeenPos
            end
        end
    end

    return best, bestPos
end

-- ─── Senses: hearing + scent trail ────────────────────────────────────────────
-- Shared scent trail: every living player drops fading breadcrumbs. Recorded ONCE
-- globally (not per-bot) on a shared timer, so cost is flat no matter how many bots.
local imposterBreadcrumbs = {}   -- [player] = array (newest-first) of { pos=, time= }
local imposterNextCrumb   = 0

local function imposterDropCrumbs()
    local now = CurTime()

    -- Drop trails for players who left.
    for ply in pairs( imposterBreadcrumbs ) do
        if not IsValid( ply ) then imposterBreadcrumbs[ ply ] = nil end
    end

    local function dropTrail( ent )
        if not ent:Alive() then return end
        local trail = imposterBreadcrumbs[ ent ]
        if not trail then trail = {}; imposterBreadcrumbs[ ent ] = trail end
        for i = #trail, 1, -1 do
            if now - trail[ i ].time > BREADCRUMB_LIFETIME then trail[ i ] = nil end
        end
        table.insert( trail, 1, { pos = ent:GetPos(), time = now } )
        trail[ BREADCRUMB_MAX + 1 ] = nil
    end

    for _, ply in ipairs( player.GetAll() ) do dropTrail( ply ) end
    for _, lp  in ipairs( ents.FindByClass( "npc_lambdaplayer" ) ) do
        if IsValid( lp ) then dropTrail( lp ) end
    end
end

if SERVER then
    -- Lay down the scent on a shared cadence.
    hook.Add( "Think", "Imposter.Breadcrumbs", function()
        if CurTime() < imposterNextCrumb then return end
        imposterNextCrumb = CurTime() + BREADCRUMB_INTERVAL
        imposterDropCrumbs()
    end )

    -- Gunfire is LOUD: every imposter within earshot gets a noise ping at the shooter,
    -- even through walls. This is the single biggest "where are you" signal.
    hook.Add( "EntityFireBullets", "Imposter.HearGunfire", function( ent, data )
        local pos = data.Src or ( IsValid( ent ) and ent:GetPos() ) or nil
        if not pos then return end
        local distSq = HEAR_GUNFIRE_DIST * HEAR_GUNFIRE_DIST
        for _, bot in ipairs( ents.FindByClass( IMPOSTER_CLASS_WILD ) ) do
            if IsValid( bot ) and bot ~= ent
                and bot:GetPos():DistToSqr( pos ) <= distSq then
                bot:ImposterHearNoise( pos, IsValid( ent ) and ent or nil, "gunfire" )
            end
        end
    end )
end

-- React to a heard noise at `pos` from `source`. Requires NO line of sight — that's
-- the whole point: it lets the bot hunt someone it can only hear. Refreshes memory so
-- hearing feeds straight into the sighting/grudge/track systems already in place.
function ENT:ImposterHearNoise( pos, source, label )
    if not pos then return end
    local phase = self:ImposterGetPhase()

    -- Deaf while pretending or otherwise committed — it shouldn't flinch at every shot.
    if self.ImposterDisguised
        or phase == IMPOSTER_PHASE_EXECUTE  or phase == IMPOSTER_PHASE_ABSORB
        or phase == IMPOSTER_PHASE_FLEE     or phase == IMPOSTER_PHASE_PLAYDEAD
        or phase == IMPOSTER_PHASE_TELEPORT then
        return
    end

    -- Always lay down a sighting — roaming gravitates toward remembered activity.
    self:ImposterRecordSighting( pos )

    -- If we know this source, believe they're at the noise now (no sight needed). This
    -- updates the profile's lastSeenPos, which is exactly what TRACKING re-reads each
    -- tick for its goal AND what ImposterPickTrackLead uses to promote a roamer to a
    -- tracker — so hearing alone can start and steer a hunt.
    if IsValid( source ) and ( source:IsPlayer() or source:IsNPC() ) then
        local p = self:ImposterProfile( source )
        if p then
            p.lastSeenPos  = pos
            p.lastSeenTime = CurTime()
            p.leadCooldown = nil   -- a fresh noise revives them as a track lead
        end
    end

    -- Throttle the LOGGED reaction (the memory refresh above is cheap and always on).
    if CurTime() < ( self.ImposterNextHearReact or 0 ) then return end
    self.ImposterNextHearReact = CurTime() + HEAR_REACT_COOLDOWN

    imposterDbg( self, "heard %s from %s at %s%s", label or "a noise",
        IsValid( source ) and imposterEntName( source ) or "?", tostring( pos ),
        ( phase == IMPOSTER_PHASE_TRACKING and source == self.ImposterTrackTarget )
            and " (my lead - homing in)" or "" )
end

-- Per-bot footstep listening: a player moving fast (and not crouched) within earshot
-- is heard. Crouch-walking is silent, so sneaking actually works. Throttled.
function ENT:ImposterListenForFootsteps()
    if CurTime() < ( self.ImposterNextListen or 0 ) then return end
    self.ImposterNextListen = CurTime() + HEAR_POLL_INTERVAL

    local myPos  = self:GetPos()
    local distSq = HEAR_FOOTSTEP_DIST * HEAR_FOOTSTEP_DIST
    for _, ply in ipairs( player.GetAll() ) do
        if ply == self or not ply:Alive() then continue end
        if ply:Crouching() then continue end            -- crouch = silent
        local vel   = ply:GetVelocity()
        local speed = Vector( vel.x, vel.y, 0 ):Length()
        if speed < HEAR_RUN_SPEED then continue end       -- walking is quiet enough
        if ply:GetPos():DistToSqr( myPos ) > distSq then continue end
        self:ImposterHearNoise( ply:GetPos(), ply, "footsteps" )
    end
    for _, lp in ipairs( ents.FindByClass( "npc_lambdaplayer" ) ) do
        if not IsValid( lp ) or not lp:Alive() then continue end
        local vel   = lp:GetVelocity()
        local speed = Vector( vel.x, vel.y, 0 ):Length()
        if speed < HEAR_RUN_SPEED then continue end
        if lp:GetPos():DistToSqr( myPos ) > distSq then continue end
        self:ImposterHearNoise( lp:GetPos(), lp, "footsteps" )
    end
end

-- Sniff the scent trail of `lead`: if one of their fading breadcrumbs is within range,
-- return the next-FRESHER crumb to move toward (tracing their route forward in time).
-- Returns a position, or nil if no trail is within scent range. This is what makes
-- tracking follow the path they actually fled along, not beeline to one stale point.
function ENT:ImposterSniffTrail( lead )
    if not IsValid( lead ) then return nil end
    local trail = imposterBreadcrumbs[ lead ]
    if not trail or #trail == 0 then return nil end

    local now     = CurTime()
    local myPos   = self:GetPos()
    local sniffSq = BREADCRUMB_SNIFF * BREADCRUMB_SNIFF

    -- Find the freshest crumb we're standing close enough to pick up.
    local nearestIdx, nearestD
    for i, c in ipairs( trail ) do
        if now - c.time <= BREADCRUMB_LIFETIME then
            local d = c.pos:DistToSqr( myPos )
            if d <= sniffSq and ( not nearestD or d < nearestD ) then
                nearestIdx, nearestD = i, d
            end
        end
    end
    if not nearestIdx then return nil end

    -- Step toward the next-fresher crumb (lower index = newer); if we're already on the
    -- newest, head straight for it.
    return trail[ math.max( 1, nearestIdx - 1 ) ].pos
end

-- Weapons the imposter holds while disguised as a player (a deception tell — a real
-- player would be armed). `class` is the termhunter weapon that drives the correct
-- hold-type pose; `world` is the world model we bonemerge so the weapon is visible
-- (the term weapon's own model doesn't render reliably on a disguised model).
local DISGUISE_WEAPONS = {
    { class = "weapon_crowbar_term",        world = "models/weapons/w_crowbar.mdl" },
    { class = "weapon_physcannon_imposter", world = "models/weapons/w_physics.mdl" },
    { class = "weapon_pistol_term",         world = "models/weapons/w_pistol.mdl" },
    { class = "weapon_smg1_term",           world = "models/weapons/w_smg1.mdl" },
}

-- Name-corruption tell: glitch a victim name into a subtly-wrong impostor name —
-- leetspeak some letters and shuffle runs of digits (flapjack123 -> f1apj4ck213).
local LEET = {
    a = "4", e = "3", i = "1", o = "0", s = "5", l = "1", t = "7", g = "9", b = "8",
    A = "4", E = "3", I = "1", O = "0", S = "5", L = "1", T = "7", G = "9", B = "8",
}

local function shuffleDigits( run )
    local t = {}
    for i = 1, #run do t[ i ] = run:sub( i, i ) end
    for i = #t, 2, -1 do  -- Fisher–Yates
        local j = math.random( i )
        t[ i ], t[ j ] = t[ j ], t[ i ]
    end
    return table.concat( t )
end

local function imposterCorruptName( name )
    if not name or name == "" then return "?" end

    -- Shuffle any run of 2+ digits.
    name = ( name:gsub( "%d%d+", shuffleDigits ) )

    -- Leetspeak ~55% of the eligible letters, so each disguise glitches differently.
    local out = {}
    for i = 1, #name do
        local c   = name:sub( i, i )
        local sub = LEET[ c ]
        out[ i ] = ( sub and math.random() < 0.55 ) and sub or c
    end
    return table.concat( out )
end

-- Isolation check: true if no OTHER living player within ISOLATION_RADIUS has a
-- clear (world-geometry) line of sight to the target. This is the "nobody's
-- watching" half of the strike condition. Only world brushes block LOS, so props
-- don't grant false cover.
local function isTargetIsolated( self, target )
    if not IsValid( target ) then return false end

    local tpos  = target:GetPos() + Vector( 0, 0, 40 )
    local radSq = ISOLATION_RADIUS * ISOLATION_RADIUS

    for _, ply in ipairs( player.GetAll() ) do
        if ply == target or not ply:Alive() then continue end
        if ply:GetPos():DistToSqr( target:GetPos() ) > radSq then continue end

        local tr = util.TraceLine( {
            start  = ply:EyePos(),
            endpos = tpos,
            filter = { ply, target, self },
            mask   = MASK_SOLID_BRUSHONLY,
        } )
        if not tr.Hit then return false end  -- this witness can see the mark
    end

    return true
end

-- True when the target is NOT looking toward the imposter — the "your back is
-- turned" half of the strike condition.
local function targetLookingAway( self, target )
    local fwd
    if target:IsPlayer() or target.EyeAngles then
        fwd = target:EyeAngles():Forward()
    else
        fwd = target:GetForward()
    end

    local toImposter = ( self:GetPos() - target:GetPos() ):GetNormalized()
    return fwd:Dot( toImposter ) < LOOKAWAY_DOT
end

-- Motion-type → activity maps for the two model families. Built lazily at runtime
-- because the TERMINATOR_NEXTBOT_MOTIONTYPE_* enums come from the base addon and
-- may not exist yet when this file is first parsed.
local ANIM_PLAYER, ANIM_NPC
local function buildAnimMaps()
    if ANIM_PLAYER then return end
    ANIM_PLAYER = {
        [TERMINATOR_NEXTBOT_MOTIONTYPE_IDLE]       = ACT_MP_STAND_IDLE,
        [TERMINATOR_NEXTBOT_MOTIONTYPE_MOVE]       = ACT_MP_RUN,
        [TERMINATOR_NEXTBOT_MOTIONTYPE_RUN]        = ACT_MP_RUN,
        [TERMINATOR_NEXTBOT_MOTIONTYPE_WALK]       = ACT_MP_WALK,
        [TERMINATOR_NEXTBOT_MOTIONTYPE_CROUCH]     = ACT_MP_CROUCH_IDLE,
        [TERMINATOR_NEXTBOT_MOTIONTYPE_CROUCHWALK] = ACT_MP_CROUCHWALK,
        [TERMINATOR_NEXTBOT_MOTIONTYPE_JUMPING]    = ACT_MP_JUMP,
        [TERMINATOR_NEXTBOT_MOTIONTYPE_SWIMMING]   = ACT_MP_SWIM,
    }
    ANIM_NPC = {
        [TERMINATOR_NEXTBOT_MOTIONTYPE_IDLE]       = ACT_IDLE,
        [TERMINATOR_NEXTBOT_MOTIONTYPE_MOVE]       = ACT_RUN,
        [TERMINATOR_NEXTBOT_MOTIONTYPE_RUN]        = ACT_RUN,
        [TERMINATOR_NEXTBOT_MOTIONTYPE_WALK]       = ACT_WALK,
        [TERMINATOR_NEXTBOT_MOTIONTYPE_CROUCH]     = ACT_IDLE,
        [TERMINATOR_NEXTBOT_MOTIONTYPE_CROUCHWALK] = ACT_WALK,
        [TERMINATOR_NEXTBOT_MOTIONTYPE_JUMPING]    = ACT_JUMP,
        [TERMINATOR_NEXTBOT_MOTIONTYPE_SWIMMING]   = ACT_IDLE,
    }
end

-- NPC models vary in which activities they actually ship sequences for (a citizen
-- runs on ACT_RUN, a combine soldier may only have ACT_WALK/ACT_RUN_ALL, etc). Using
-- a fixed activity that the model lacks makes the bot T-pose. So per motion type we
-- list candidates in preference order and probe the live model for the first that
-- resolves to a real sequence. Falls back to ACT_IDLE (every model has it).
-- Lazy — built on first call so TERMINATOR_NEXTBOT_MOTIONTYPE_* enums are ready. Keyed by
-- weapon-hold type ("unarmed"/"rifle"/"pistol"/"shotgun") so an absorbed NPC animates with
-- the hold that matches the weapon it actually carried.
local NPC_ACT_CANDIDATES

local function buildNPCActCandidates()
    if NPC_ACT_CANDIDATES then return end
    -- Pack only the activity enums that actually EXIST. Some listed here (e.g.
    -- ACT_RUN_ALL / ACT_WALK_ALL) aren't defined in GMod and come through as nil — and
    -- a nil hole makes `ipairs` stop early, so every candidate AFTER the hole was never
    -- probed. That truncation is why classic/poison zombies (whose move is ACT_WALK,
    -- sitting after a nil ACT_RUN_ALL) never resolved and the disguise was refused,
    -- while fast zombies happened to work because their move (ACT_RUN) was first.
    local function cands( ... )
        local t, n = {}, select( "#", ... )
        for i = 1, n do
            local a = select( i, ... )
            if a then t[ #t + 1 ] = a end
        end
        return t
    end

    -- Non-locomotion motion types are the same regardless of which weapon is held, so build
    -- them once and reuse. (CROUCHWALK gets a weapon-specific override below where one exists.)
    local crouch     = cands( ACT_COVER_LOW, ACT_CROUCHIDLE, ACT_IDLE )
    local crouchwalk = cands( ACT_RUN_CROUCH, ACT_WALK_CROUCH, ACT_WALK, ACT_RUN )
    local jump       = cands( ACT_JUMP, ACT_GLIDE, ACT_IDLE )
    local swim       = cands( ACT_SWIM, ACT_IDLE )

    -- Assemble one motion→candidates table. `move` is shared by MOVE and RUN; `cw` overrides
    -- the generic crouchwalk for hold types that ship a crouch-walk-with-weapon sequence.
    local function set( idle, move, walk, cw )
        return {
            [TERMINATOR_NEXTBOT_MOTIONTYPE_IDLE]       = idle,
            [TERMINATOR_NEXTBOT_MOTIONTYPE_MOVE]       = move,
            [TERMINATOR_NEXTBOT_MOTIONTYPE_RUN]        = move,
            [TERMINATOR_NEXTBOT_MOTIONTYPE_WALK]       = walk,
            [TERMINATOR_NEXTBOT_MOTIONTYPE_CROUCH]     = crouch,
            [TERMINATOR_NEXTBOT_MOTIONTYPE_CROUCHWALK] = cw or crouchwalk,
            [TERMINATOR_NEXTBOT_MOTIONTYPE_JUMPING]    = jump,
            [TERMINATOR_NEXTBOT_MOTIONTYPE_SWIMMING]   = swim,
        }
    end

    -- HL2 humanoids (combine, metrocop, armed rebels/citizens) animate movement on the
    -- WEAPON-HOLD activities, not plain ACT_WALK/ACT_RUN — playing the bare ones gives the
    -- stiff/sliding-leg glitch. Each hold prefers its own variants, then falls back to the
    -- rifle hold (most models ship it) and finally the plain activities so nothing regresses.
    NPC_ACT_CANDIDATES = {
        -- Unarmed: plain locomotion (citizens, zombies, vorts, unarmed rebels).
        unarmed = set(
            cands( ACT_IDLE, ACT_IDLE_ANGRY ),
            cands( ACT_RUN, ACT_RUN_ALL, ACT_WALK, ACT_WALK_ALL ),
            cands( ACT_WALK, ACT_WALK_ALL, ACT_RUN, ACT_RUN_ALL )
        ),
        -- Rifle/SMG/AR2 (and the catch-all for any other long gun).
        rifle = set(
            cands( ACT_IDLE_ANGRY_SMG1, ACT_IDLE_ANGRY_AR2, ACT_IDLE_SMG1, ACT_IDLE_ANGRY, ACT_IDLE ),
            cands( ACT_RUN_RIFLE, ACT_RUN_AIM_RIFLE, ACT_WALK_RIFLE, ACT_WALK_AIM_RIFLE, ACT_RUN, ACT_WALK ),
            cands( ACT_WALK_RIFLE, ACT_WALK_AIM_RIFLE, ACT_RUN_RIFLE, ACT_RUN_AIM_RIFLE, ACT_WALK, ACT_RUN ),
            cands( ACT_WALK_CROUCH_RIFLE, ACT_RUN_CROUCH_RIFLE, ACT_RUN_CROUCH, ACT_WALK_CROUCH, ACT_WALK, ACT_RUN )
        ),
        -- Pistol / .357 — the one-handed hold reads completely different from a rifle.
        pistol = set(
            cands( ACT_IDLE_ANGRY_PISTOL, ACT_IDLE_PISTOL, ACT_IDLE_ANGRY, ACT_IDLE ),
            cands( ACT_RUN_PISTOL, ACT_RUN_AIM_PISTOL, ACT_WALK_PISTOL, ACT_WALK_AIM_PISTOL, ACT_RUN_RIFLE, ACT_RUN, ACT_WALK ),
            cands( ACT_WALK_PISTOL, ACT_WALK_AIM_PISTOL, ACT_RUN_PISTOL, ACT_RUN_AIM_PISTOL, ACT_WALK_RIFLE, ACT_WALK, ACT_RUN )
        ),
        -- Shotgun — distinct cradle hold; fall back to rifle if the model lacks it.
        shotgun = set(
            cands( ACT_IDLE_ANGRY_SHOTGUN, ACT_IDLE_SHOTGUN, ACT_IDLE_ANGRY, ACT_IDLE ),
            cands( ACT_RUN_AIM_SHOTGUN, ACT_RUN_SHOTGUN, ACT_WALK_AIM_SHOTGUN, ACT_WALK_SHOTGUN, ACT_RUN_RIFLE, ACT_RUN, ACT_WALK ),
            cands( ACT_WALK_AIM_SHOTGUN, ACT_WALK_SHOTGUN, ACT_RUN_AIM_SHOTGUN, ACT_RUN_SHOTGUN, ACT_WALK_RIFLE, ACT_WALK, ACT_RUN )
        ),
    }
end

-- Classify an absorbed NPC's world-model weapon path into a hold type so the disguise picks
-- the matching arm pose. Anything armed but unrecognised defaults to the rifle hold (the most
-- common and the one most models ship). Returns nil for unarmed.
local function imposterWeaponHoldType( model )
    if not model or model == "" then return nil end
    model = string.lower( model )
    if string.find( model, "pistol", 1, true ) or string.find( model, "357", 1, true ) then
        return "pistol"
    elseif string.find( model, "shotgun", 1, true ) then
        return "shotgun"
    end
    return "rifle"  -- smg1, ar2, crossbow, rpg, and any other long gun
end

-- Build a motion→activity map for whatever model is *currently set on `ent`*, keeping only
-- activities the model has a real sequence for. `holdType` ("rifle"/"pistol"/"shotgun"/nil)
-- selects the weapon-hold variant set (HL2 humanoids glitch on the bare walk/run). Returns
-- the map plus whether the model can actually locomote (has a valid idle and a valid move
-- animation) — the latter gates whether the imposter can convincingly wear this NPC at all.
local function imposterResolveNPCAnims( ent, holdType )
    buildNPCActCandidates()
    local candidateSet = NPC_ACT_CANDIDATES[ holdType or "unarmed" ] or NPC_ACT_CANDIDATES.unarmed
    local map = {}
    for motion, cands in pairs( candidateSet ) do
        for _, act in ipairs( cands ) do
            if act and ent:SelectWeightedSequence( act ) > 0 then map[ motion ] = act; break end
        end
    end

    -- A model is wearable if it resolves at least one real locomotion activity (a move OR
    -- an idle). The old gate required BOTH a clean idle AND a clean move, which wrongly
    -- rejected NPCs whose models bind only one of them under the probed enums (classic and
    -- poison zombies hit this — fast zombies happen to have the fuller set). Anything that
    -- resolves neither (turrets, props) is still refused.
    local moveAct = map[ TERMINATOR_NEXTBOT_MOTIONTYPE_MOVE ]
    local idleAct = map[ TERMINATOR_NEXTBOT_MOTIONTYPE_IDLE ]
    local primary = moveAct or idleAct
    if not primary then return map, false end

    -- Fill any motion types the model lacks with the best thing we DID find, so it animates
    -- (e.g. a zombie with only a walk uses it as its idle too — a restless shamble, not a
    -- T-pose) instead of falling through to a sequence the model doesn't have.
    map[ TERMINATOR_NEXTBOT_MOTIONTYPE_IDLE ] = idleAct or moveAct
    for motion in pairs( NPC_ACT_CANDIDATES ) do
        map[ motion ] = map[ motion ] or primary
    end
    return map, true
end


-- Create a controlled ragdoll clone of the victim — the body the imposter holds.
local function createHeldRagdoll( victim )
    if not IsValid( victim ) then return end

    local rag = ents.Create( "prop_ragdoll" )
    if not IsValid( rag ) then return end

    rag:SetModel( victim:GetModel() )
    rag:SetPos( victim:GetPos() )
    rag:SetAngles( victim:GetAngles() )
    rag:SetSkin( victim:GetSkin() or 0 )
    rag:SetColor( victim:GetColor() )
    rag:SetRenderMode( victim:GetRenderMode() )
    rag:SetMaterial( victim:GetMaterial() or "" )
    rag:Spawn()
    rag:Activate()

    if victim.GetBodyGroups then
        for _, bg in ipairs( victim:GetBodyGroups() ) do
            rag:SetBodygroup( bg.id, victim:GetBodygroup( bg.id ) )
        end
    end

    -- Debris collides only with the world, never the imposter — without this the
    -- body is teleported into the imposter each tick and the impact force kills it.
    local copiedPhys = {}
    if victim.GetBoneCount and victim.GetBonePosition then
        for bone = 0, victim:GetBoneCount() - 1 do
            local physBone = rag:TranslateBoneToPhysBone( bone )
            if physBone and physBone >= 0 and not copiedPhys[ physBone ] then
                local phys = rag:GetPhysicsObjectNum( physBone )
                local pos, ang = victim:GetBonePosition( bone )
                if IsValid( phys ) and pos and ang then
                    phys:SetPos( pos )
                    phys:SetAngles( ang )
                    copiedPhys[ physBone ] = true
                end
            end
        end
    end

    rag:SetCollisionGroup( COLLISION_GROUP_DEBRIS_TRIGGER )
    rag:SetMoveType( MOVETYPE_VPHYSICS )

    for index = 0, rag:GetPhysicsObjectCount() - 1 do
        local phys = rag:GetPhysicsObjectNum( index )
        if IsValid( phys ) then
            phys:EnableMotion( true )
            if phys.EnableDrag then phys:EnableDrag( true ) end
            phys:SetVelocity( vector_origin )
            if phys.SetAngleVelocity then phys:SetAngleVelocity( vector_origin ) end
            phys:Wake()
        end
    end

    return rag
end

-- Position a held ragdoll so its neck/head anchor sits at `pos` (Homelander-style).
-- On the FIRST call we translate the WHOLE ragdoll (and every physobj) by the delta
-- so the body keeps its pose and lands at the hand as one piece — without this the
-- anchor snaps to the hand while the other bones are still at the spawn point and
-- the constraints violently stretch/fling the body. The anchor is kept KINEMATIC
-- (EnableMotion false) so re-pinning it each tick imparts no velocity; the rest
-- stay dynamic and dangle.
local function findAttachmentPos( ent, names )
    for _, name in ipairs( names ) do
        local id = ent:LookupAttachment( name )
        if id and id > 0 then
            local at = ent:GetAttachment( id )
            if at and at.Pos then return at.Pos end
        end
    end
end

local function findBonePos( ent, names )
    for _, name in ipairs( names ) do
        local id = ent:LookupBone( name )
        if id then
            local pos = ent:GetBonePosition( id )
            if pos and pos:DistToSqr( ent:GetPos() ) > 1 then return pos end
        end
    end
end

-- World position where the imposter holds the body: its actual right hand
-- (attachment, else bone), plus a small live-tunable offset in the imposter's
-- aim space so the body can be nudged into the grip.
local IMPOSTER_GRAB_CAMERA_NET = "ImposterNextBot.GrabCamera"
local IMPOSTER_RIGHT_HAND_ATTACHMENTS = {
    "anim_attachment_RH",
    "anim_attachment_RH_2",
    "anim_attachment_R",
    "right_hand",
    "righthand",
}
local IMPOSTER_RIGHT_HAND_BONES = {
    "ValveBiped.Bip01_R_Hand",
}
-- Anchored at the foot/ankle so the body is dragged along the ground by a leg.
local IMPOSTER_GRAB_ANCHOR_BONES = {
    "ValveBiped.Bip01_R_Foot",
    "ValveBiped.Bip01_L_Foot",
    "ValveBiped.Bip01_R_Calf",
    "ValveBiped.Bip01_L_Calf",
}

-- Disintegrate an entity with the combine dissolve effect.
local function disintegrateEntity( ent )
    if not IsValid( ent ) then return end

    ent:SetName( "imposter_dissolve_" .. ent:EntIndex() )

    local dis = ents.Create( "env_entity_dissolver" )
    if not IsValid( dis ) then SafeRemoveEntity( ent ) return end

    dis:SetKeyValue( "dissolvetype", "0" )
    dis:SetKeyValue( "magnitude", "0" )
    dis:SetKeyValue( "target", ent:GetName() )
    dis:Spawn()
    dis:Activate()
    dis:Fire( "Dissolve", ent:GetName(), 0 )
    dis:Fire( "Kill", "", 0.1 )
end

function ENT:SendImposterGrabCamera( target, enabled )
    if not IsValid( target ) or not target:IsPlayer() then return end

    net.Start( IMPOSTER_GRAB_CAMERA_NET )
        net.WriteBool( enabled == true )
        if enabled then
            net.WriteEntity( self.ImposterGrabRagdoll or NULL )
            net.WriteEntity( self )
        end
    net.Send( target )
end

function ENT:GetImposterGrabHandPos()
    -- The imposter's actual right hand — the victim's foot (the grab anchor) is
    -- pinned here, so the hand grips the foot, the leg raises, and the rest of the
    -- body droops and drags along the ground.
    local handPos = findAttachmentPos( self, IMPOSTER_RIGHT_HAND_ATTACHMENTS )
        or findBonePos( self, IMPOSTER_RIGHT_HAND_BONES )

    if handPos then return handPos end

    return self:WorldSpaceCenter() + self:GetForward() * 18 + vector_up * 4
end

function ENT:FindImposterGrabRagdollAnchorPhysics( ragdoll )
    if not IsValid( ragdoll ) then return end

    for _, boneName in ipairs( IMPOSTER_GRAB_ANCHOR_BONES ) do
        local bone = ragdoll:LookupBone( boneName )
        if bone then
            local physBone = ragdoll:TranslateBoneToPhysBone( bone )
            if physBone and physBone >= 0 then
                local phys = ragdoll:GetPhysicsObjectNum( physBone )
                if IsValid( phys ) then
                    return phys, physBone
                end
            end
        end
    end

    -- Fallback: the LOWEST physobj (closest to a foot) so we drag, not lift.
    local bestPhys
    local bestIndex
    local bestHeight = math.huge
    for index = 0, ragdoll:GetPhysicsObjectCount() - 1 do
        local phys = ragdoll:GetPhysicsObjectNum( index )
        if IsValid( phys ) then
            local pos = phys:GetPos()
            if pos and pos.z < bestHeight then
                bestHeight = pos.z
                bestPhys = phys
                bestIndex = index
            end
        end
    end

    return bestPhys, bestIndex
end

function ENT:PrepareImposterGrabRagdollPhysics( ragdoll )
    if not IsValid( ragdoll ) then return end

    local anchorPhys, anchorIndex = self:FindImposterGrabRagdollAnchorPhysics( ragdoll )
    self.ImposterGrabRagdollAnchorPhysIndex = anchorIndex
    self.ImposterGrabRagdollPinnedOnce = false

    for index = 0, ragdoll:GetPhysicsObjectCount() - 1 do
        local phys = ragdoll:GetPhysicsObjectNum( index )
        if IsValid( phys ) then
            phys:EnableMotion( phys ~= anchorPhys )
            phys:SetVelocity( vector_origin )
            if phys.SetAngleVelocity then phys:SetAngleVelocity( vector_origin ) end
            phys:Wake()
        end
    end
end

function ENT:PositionImposterGrabRagdoll()
    local ragdoll = self.ImposterGrabRagdoll
    if not IsValid( ragdoll ) then return false end

    local handPos = self:GetImposterGrabHandPos()
    local anchorIndex = self.ImposterGrabRagdollAnchorPhysIndex
    local anchorPhys = anchorIndex and ragdoll:GetPhysicsObjectNum( anchorIndex )
    if not IsValid( anchorPhys ) then
        anchorPhys, anchorIndex = self:FindImposterGrabRagdollAnchorPhysics( ragdoll )
        self.ImposterGrabRagdollAnchorPhysIndex = anchorIndex
    end
    if not IsValid( anchorPhys ) then
        ragdoll:SetPos( handPos )
        return true
    end

    local count = ragdoll:GetPhysicsObjectCount()
    if not self.ImposterGrabRagdollPinnedOnce then
        local delta = handPos - anchorPhys:GetPos()
        ragdoll:SetPos( ragdoll:GetPos() + delta )

        for index = 0, count - 1 do
            local phys = ragdoll:GetPhysicsObjectNum( index )
            if IsValid( phys ) then
                phys:SetPos( phys:GetPos() + delta )
                phys:SetVelocity( vector_origin )
                if phys.SetAngleVelocity then phys:SetAngleVelocity( vector_origin ) end
            end
        end

        self.ImposterGrabRagdollPinnedOnce = true
    end

    for index = 0, count - 1 do
        local phys = ragdoll:GetPhysicsObjectNum( index )
        if IsValid( phys ) then
            phys:EnableMotion( index ~= anchorIndex )
            phys:Wake()
        end
    end

    anchorPhys:SetPos( handPos )
    anchorPhys:SetVelocity( vector_origin )
    if anchorPhys.SetAngleVelocity then anchorPhys:SetAngleVelocity( vector_origin ) end
    anchorPhys:Wake()
    return true
end

function ENT:StoreImposterGrabTargetState( target )
    if not IsValid( target ) then return end

    return {
        moveType = target.GetMoveType and target:GetMoveType() or nil,
        collisionGroup = target.GetCollisionGroup and target:GetCollisionGroup() or nil,
        noDraw = target.GetNoDraw and target:GetNoDraw() or false,
        effects = target.GetEffects and target:GetEffects() or nil,
        drawShadow = true,
        notSolid = target.IsSolid and not target:IsSolid() or false,
        frozen = target:IsPlayer() and target:IsFrozen() or false,
    }
end

function ENT:RestoreImposterGrabTargetState( target, state )
    if not IsValid( target ) or not state then return end

    if state.moveType ~= nil and target.SetMoveType then target:SetMoveType( state.moveType ) end
    if state.collisionGroup ~= nil and target.SetCollisionGroup then target:SetCollisionGroup( state.collisionGroup ) end
    if target.SetNoDraw then target:SetNoDraw( state.noDraw == true ) end
    if state.effects ~= nil and target.SetEffects then
        target:SetEffects( state.effects )
    elseif target.RemoveEffects then
        target:RemoveEffects( EF_NODRAW )
    end
    if target.DrawShadow then target:DrawShadow( state.drawShadow ~= false ) end
    if target.SetNotSolid then target:SetNotSolid( state.notSolid == true ) end

    if target:IsPlayer() then
        target:Freeze( state.frozen == true )
        target:DrawViewModel( true )
        if target.DrawWorldModel then target:DrawWorldModel( true ) end
        self:SendImposterGrabCamera( target, false )
    elseif target:IsNPC() then
        if target.ClearSchedule then pcall( target.ClearSchedule, target ) end
    elseif target.IsLambdaPlayer then
        -- Released without being absorbed: undo the freeze + godmode we applied.
        self:UnsuppressImposterGrabbedLambda( target )
    end
end

-- Lambda Players are nextbots. When grabbed they go fully INERT — like a player or NPC
-- victim: limp, hidden, carried as the clone body, then absorbed. They must NOT keep
-- moving or shooting. Just freezing isn't enough: their pathing locomotion (MoveToPos) is
-- gated by IsDisabled(), but combat strafe/dodge (ApproachDir's Tick hook) and the engine's
-- post-think velocity application are NOT — so we hard-stop the locomotion every tick AND
-- clear their combat. Re-asserted each tick in MaintainImposterGrabTarget.
function ENT:SuppressImposterGrabbedLambda( target )
    if not IsValid( target ) or not target.IsLambdaPlayer then return end

    if isfunction( target.Lock ) then
        pcall( target.Lock, target )                 -- l_isfrozen + l_godmode
    else
        if isfunction( target.Freeze ) then pcall( target.Freeze, target, true ) end
        target.l_godmode = true
    end

    -- Hard-stop locomotion: abort any move loop, zero loco velocity, push the move-wait
    -- timer so the gated approach stays skipped too.
    if isfunction( target.CancelMovement )  then pcall( target.CancelMovement, target ) end
    if isfunction( target.WaitWhileMoving ) then pcall( target.WaitWhileMoving, target, 1 ) end
    local loco = target.loco
    if IsValid( loco ) then
        loco:SetVelocity( vector_origin )
        if isfunction( loco.SetDesiredSpeed ) then loco:SetDesiredSpeed( 0 ) end
    end

    -- Stop it shooting: drop its enemy (ENT:Combat bails with no enemy; the Think firing
    -- block needs a valid enemy), leave combat state, and push the weapon cooldown so even
    -- a stray UseWeapon early-returns.
    if isfunction( target.SetEnemy ) then pcall( target.SetEnemy, target, NULL ) end
    if isfunction( target.SetState ) then pcall( target.SetState, target ) end
    if isfunction( target.SetIsReloading ) then pcall( target.SetIsReloading, target, false ) end
    target.l_WeaponUseCooldown = CurTime() + 5

    -- One-time: Lambda models are drawn CLIENTSIDE; a server SetNoDraw doesn't hide them
    -- (their ENT:Draw just calls DrawModel). ClientSideNoDraw broadcasts a net msg telling
    -- clients to SetNoDraw the entity — THE way to hide a Lambda, so only the limp clone
    -- ragdoll shows. It's a net broadcast, so do it once (not every tick).
    if not target.ImposterGrabPinned then
        target.ImposterGrabPinned = true
        if isfunction( target.ClientSideNoDraw ) then
            pcall( target.ClientSideNoDraw, target, target, true )
        end
    end
end

-- Undo the grab suppression if a Lambda escapes (grab aborted/released), so it doesn't
-- stay frozen + invincible forever.
function ENT:UnsuppressImposterGrabbedLambda( target )
    if not IsValid( target ) or not target.IsLambdaPlayer then return end
    -- Restore the clientside draw we suppressed (only if we actually pinned it).
    if target.ImposterGrabPinned and isfunction( target.ClientSideNoDraw ) then
        pcall( target.ClientSideNoDraw, target, target, false )
    end
    target.ImposterGrabPinned = nil
    if isfunction( target.UnLock ) then
        pcall( target.UnLock, target )               -- clears l_isfrozen + l_godmode
    else
        if isfunction( target.Freeze ) then pcall( target.Freeze, target, false ) end
        target.l_godmode = false
    end
end

function ENT:HideImposterGrabTarget( target )
    if not IsValid( target ) then return end

    if target.SetMoveType then target:SetMoveType( MOVETYPE_NONE ) end
    if target.SetCollisionGroup then target:SetCollisionGroup( COLLISION_GROUP_IN_VEHICLE ) end
    if target.SetNoDraw then target:SetNoDraw( true ) end
    if target.AddEffects then target:AddEffects( EF_NODRAW ) end
    if target.DrawShadow then target:DrawShadow( false ) end
    if target.SetNotSolid then target:SetNotSolid( true ) end

    if target:IsPlayer() then
        target:Freeze( true )
        target:DrawViewModel( false )
        if target.DrawWorldModel then target:DrawWorldModel( false ) end
    elseif target.IsLambdaPlayer then
        -- Lambda players are nextbots with their own AI: stop locomotion AND combat.
        if target.StopMoving then pcall( target.StopMoving, target ) end
        if target.DrawWorldModel then target:DrawWorldModel( false ) end
        self:SuppressImposterGrabbedLambda( target )
    elseif target:IsNPC() then
        if target.StopMoving then pcall( target.StopMoving, target ) end
        if target.ClearSchedule then pcall( target.ClearSchedule, target ) end
        if target.SetNPCState and NPC_STATE_SCRIPT then pcall( target.SetNPCState, target, NPC_STATE_SCRIPT ) end
    end
end

function ENT:MaintainImposterGrabTarget()
    local target = self.ImposterGrabTarget
    local ragdoll = self.ImposterGrabRagdoll
    if not IsValid( target ) or targetIsLost( target ) or not IsValid( ragdoll ) then
        return false
    end

    if not self:PositionImposterGrabRagdoll() then return false end

    target:SetPos( ragdoll:GetPos() )
    if target.SetVelocity then target:SetVelocity( -target:GetVelocity() ) end
    if target.SetLocalVelocity then target:SetLocalVelocity( vector_origin ) end

    if target:IsNPC() or target.IsLambdaPlayer then
        -- Re-apply the full hide every tick: Lambda's own AI can undo SetNoDraw/MOVETYPE_NONE
        -- each frame, so we have to keep forcing it (same reason NPCs need this each tick).
        self:HideImposterGrabTarget( target )
    end

    return true
end

-- Disarm the victim the instant they're grabbed — their weapon clatters to the floor.
-- Players use Player:DropWeapon; NPCs are best-effort (pcall guards models whose base
-- lacks a drop). The disguise still carries the weapon: its model was already snapshotted
-- (NPCs) or is freshly equipped (players) before the body is dropped.
function ENT:DisarmImposterGrabTarget( target )
    if not IsValid( target ) or not isfunction( target.GetActiveWeapon ) then return end

    local wep = target:GetActiveWeapon()
    if not IsValid( wep ) or not isfunction( target.DropWeapon ) then return end

    pcall( target.DropWeapon, target, wep )
end

function ENT:BeginImposterGrabTarget( target )
    if not IsValid( target ) or targetIsLost( target ) then return false end
    if target.ImposterIsGrabbed then return false end  -- already held by another imposter

    local ragdoll = createHeldRagdoll( target )
    if not IsValid( ragdoll ) then return false end

    -- Drop their weapon at their real position before we hide/relocate them.
    self:DisarmImposterGrabTarget( target )

    target.ImposterIsGrabbed = true
    self.ImposterGrabTarget = target
    self.ImposterGrabRagdoll = ragdoll
    self.ImposterGrabTargetState = self:StoreImposterGrabTargetState( target )
    self.ImposterGrabDamage = 0  -- fresh accumulator for grab-flee threshold
    self:PrepareImposterGrabRagdollPhysics( ragdoll )
    self:HideImposterGrabTarget( target )
    self:PositionImposterGrabRagdoll()

    if target:IsPlayer() then
        self:SendImposterGrabCamera( target, true )
    end

    self:CallOnRemove( "Imposter.ReleaseGrab", function( ent )
        if ent.ReleaseImposterGrab then ent:ReleaseImposterGrab( true ) end
    end )

    return true
end

-- Release the held clone ragdoll so it drops as the persistent body (used for players
-- and Lambda Players — the posed clone, on debris collision, won't slam the imposter).
-- SILENTLY remove a killed player's own death ragdoll. The imposter already holds a posed
-- clone of the victim (createHeldRagdoll) which gets the visible absorb dissolve, so the
-- engine's automatic death ragdoll is redundant — leaving it produces a SECOND body. We
-- retry because the engine creates it a frame or two after the kill, and freeze it first
-- so it can't slam the imposter in the frame before removal. No dissolver here (that would
-- be a second dissolve effect) — just delete it.
function ENT:RemoveImposterPlayerDeathRagdoll( ply )
    if not IsValid( ply ) or not ply.GetRagdollEntity then return end

    local function tryRemove()
        if not IsValid( ply ) or not ply.GetRagdollEntity then return end
        local rd = ply:GetRagdollEntity()
        if not IsValid( rd ) or rd.ImposterStripped then return end
        rd.ImposterStripped = true

        rd:SetCollisionGroup( COLLISION_GROUP_DEBRIS )
        for i = 0, rd:GetPhysicsObjectCount() - 1 do
            local phys = rd:GetPhysicsObjectNum( i )
            if IsValid( phys ) then
                phys:EnableMotion( false )
                phys:SetVelocity( vector_origin )
            end
        end
        SafeRemoveEntity( rd )
    end

    tryRemove()
    for _, d in ipairs( { 0, 0.05, 0.15, 0.3 } ) do
        timer.Simple( d, tryRemove )
    end
end

function ENT:ConsumeImposterGrabTarget()
    local target  = self.ImposterGrabTarget
    local ragdoll = self.ImposterGrabRagdoll
    local isLambda = IsValid( target ) and target.IsLambdaPlayer == true

    if IsValid( target ) then
        if target:IsPlayer() then
            -- Real player. FULLY restore their state first so the respawned player isn't
            -- left frozen / invisible / non-solid — that leftover state was the cause of
            -- "can't respawn until I restart". Note SetNoDraw and the EF_NODRAW effect are
            -- separate; both must be cleared.
            target:Freeze( false )
            if target.SetMoveType then target:SetMoveType( MOVETYPE_WALK ) end
            if target.SetCollisionGroup then target:SetCollisionGroup( COLLISION_GROUP_PLAYER ) end
            if target.RemoveEffects then target:RemoveEffects( EF_NODRAW ) end
            target:SetNoDraw( false )
            target:SetNotSolid( false )
            if target.DrawShadow then target:DrawShadow( true ) end
            target:DrawViewModel( true )
            if target.DrawWorldModel then target:DrawWorldModel( true ) end
            self:SendImposterGrabCamera( target, false )

            -- Kill with damage rather than KillSilent: KillSilent routes to
            -- GM:PlayerSilentDeath and skips the normal death/respawn setup (the real
            -- reason respawn broke). Lethal damage runs GM:PlayerDeath, credits the
            -- imposter, and lets the player respawn normally.
            local dmg = DamageInfo()
            dmg:SetAttacker( self )
            dmg:SetInflictor( self )
            dmg:SetDamage( ( target:Health() or 100 ) + 1000 )
            dmg:SetDamageType( DMG_SLASH )
            target:TakeDamageInfo( dmg )
            if target:Alive() then target:Kill() end

            -- The damage kill spawns the player's OWN death ragdoll — a second body next
            -- to the held clone. Silently remove it (the held clone, dissolved below, is
            -- the one visible body that gets the absorb effect).
            self:RemoveImposterPlayerDeathRagdoll( target )
            -- The held clone dissolves below — exactly one body for an absorbed real player.
        elseif isLambda then
            -- Lambda Player: the imposter absorbed them, so leave nothing behind (like a
            -- real player). Defensively strip any ragdoll their own death system spawned
            -- (godmode during the grab should prevent it), then remove the entity. The held
            -- clone dissolves below — the absorb effect.
            if isfunction( target.GetRagdollEntity ) then
                local lrd = target:GetRagdollEntity()
                if IsValid( lrd ) then SafeRemoveEntity( lrd ) end
            end
            target:Remove()
        else
            if IsValid( ragdoll ) and target.SetPos then
                target:SetPos( ragdoll:GetPos() )
            end
            self:RestoreImposterGrabTargetState( target, self.ImposterGrabTargetState )
            target:Remove()
        end
    end

    -- The victim was consumed, so the held clone dissolves (the absorb effect) — players,
    -- Lambda Players and NPCs alike leave no leftover body.
    if IsValid( ragdoll ) then
        disintegrateEntity( ragdoll )
    end

    if IsValid( target ) then target.ImposterIsGrabbed = nil end
    self.ImposterGrabTarget = nil
    self.ImposterGrabRagdoll = nil
    self.ImposterGrabTargetState = nil
    self.ImposterGrabRagdollAnchorPhysIndex = nil
    self.ImposterGrabRagdollPinnedOnce = nil
end

function ENT:ReleaseImposterGrab( restoreTarget )
    local target = self.ImposterGrabTarget
    local ragdoll = self.ImposterGrabRagdoll
    local state = self.ImposterGrabTargetState

    if IsValid( target ) then target.ImposterIsGrabbed = nil end
    self.ImposterGrabTarget = nil
    self.ImposterGrabRagdoll = nil
    self.ImposterGrabTargetState = nil
    self.ImposterGrabRagdollAnchorPhysIndex = nil
    self.ImposterGrabRagdollPinnedOnce = nil

    -- Releasing (not consuming) a Lambda always frees it from the grab suppression, even
    -- when we don't restore the rest of its state (e.g. the imposter itself was removed) —
    -- otherwise it'd be stuck frozen + invincible.
    if IsValid( target ) and target.IsLambdaPlayer then
        self:UnsuppressImposterGrabbedLambda( target )
    end

    if IsValid( target ) and restoreTarget ~= false then
        if IsValid( ragdoll ) and target.SetPos then
            target:SetPos( ragdoll:GetPos() )
        end
        self:RestoreImposterGrabTargetState( target, state )
    elseif IsValid( target ) and target:IsPlayer() then
        self:SendImposterGrabCamera( target, false )
    end

    if IsValid( ragdoll ) then
        ragdoll:Remove()
    end
end

-- ─── State machine: phase accessors ───────────────────────────────────────────

-- Variant flag: the "restless" imposter is more agitated and aggressive — it prowls at
-- a jog instead of a slow creep, re-scans for prey more often, and spends less time
-- blending in before hunting again. Set true by the restless variant entity.
function ENT:ImposterIsRestless()
    return self.ImposterRestless == true
end

function ENT:ImposterGetPhase()
    return self.ImposterPhase or IMPOSTER_PHASE_ROAM
end

function ENT:ImposterSetPhase( phase )
    if self.ImposterPhase == phase then return end

    local from = self.ImposterPhase
    self.ImposterPhase = phase
    self:SetNWInt( "ImposterPhase", phase )  -- mirrored to clients for the HUD overlay

    if cv_debug:GetBool() then
        MsgN( string.format( "[Imposter] %d: %s -> %s",
            self:EntIndex(),
            IMPOSTER_PHASE_NAMES[ from ]  or "nil",
            IMPOSTER_PHASE_NAMES[ phase ] or "?" ) )
    end
end

-- ─── Combat suppression ───────────────────────────────────────────────────────

-- The imposter never acquires a base-AI enemy; ALL combat (stalk/hunt/execute and
-- the enrage strikes) is driven manually by our tasks. Returning false keeps the
-- stock terminator combat brain dormant so it never fights our task control.
function ENT:ShouldBeEnemy( ... )
    return false
end

-- The imposter never scavenges world weapons (it spawns with fists).
function ENT:CanPickupWeapon()
    return false
end

-- ─── Initialize ───────────────────────────────────────────────────────────────

function ENT:AdditionalInitialize()
    self.ImposterAbsorbed = {}    -- [ent] = true for everyone we've already absorbed
    self.ImposterSightings = {}   -- recent {pos,time} where people were last seen (memory)
    self.ImposterProfiles = {}    -- [ent] = grudge profile (attacks/stalkTime/lostCount/…)
    self.ImposterTrackTarget = nil -- the lead we're actively tracking down (TRACKING phase)
    self.ImposterTarget   = nil   -- entity we're currently stalking/hunting
    self:SetNWString( "ImposterTrackName", "" )
    self.ImposterVictim   = nil   -- entity we've absorbed / are disguised as
    self.ImposterDisguised = false -- true while wearing a victim's identity
    self:ImposterSetDisguiseIsPlayer( nil )  -- networked: gates HUD nametag/voice
    self.ImposterEnraged   = false -- true once exposed (Phase 6)
    self.ImposterNormalRun  = self.RunSpeed   -- base run speed, restored after a disguise jog
    self.ImposterNormalWalk = self.WalkSpeed  -- base walk speed, restored after an NPC-disguise walk

    -- Grace period: don't fire cloak/smoke the instant it spawns just because the
    -- player who spawned it is staring at it. Let it settle and start roaming first.
    self.ImposterNextAbility = CurTime() + 8

    -- Killable, but tanky. The termhunter base's "metal skeleton" (DoMetallicDamage)
    -- makes most weapons do 0–1 damage, which reads as invincibility. Turn it off so
    -- normal weapons hurt it, then lean on a high health pool + a flat resist
    -- (ImposterDamageScale, applied in OnTakeDamage) so it still takes real effort.
    self.DoMetallicDamage   = false
    self.ImposterDamageScale = self.ImposterDamageScale or 0.35  -- ~65% resist (variant can override)

    -- Apply settings: health from convar (clamped to entity's valid range).
    self:SetMaxHealth( cv_health:GetInt() )
    self:SetHealth( cv_health:GetInt() )
    self.SpawnHealth = cv_health:GetInt()

    -- Hunters Glee: one imposter in a wave-round game against armed players.
    -- Reduce stats so it's a real threat but not an unkillable wipe machine.
    if isHuntersGlee() then
        self.ImposterHGMode = true
        local hp = math.floor( cv_health:GetInt() * 0.6 )
        self:SetMaxHealth( hp )
        self:SetHealth( hp )
        self.SpawnHealth        = hp
        self.ImposterNormalRun  = math.floor( self.ImposterNormalRun  * 0.75 )
        self.ImposterNormalWalk = math.floor( self.ImposterNormalWalk * 0.75 )
        self.RunSpeed           = self.ImposterNormalRun
        self.WalkSpeed          = self.ImposterNormalWalk
    end

    self:SetModel( TRUE_FORM_MODEL )
    self:ImposterApplyAnimsFor( true )   -- corpse1 is a PLAYER model now (animates)
    self:ImposterRestoreTrueWeapon()
    self:ImposterApplyTrueFormLook()     -- ashen tint
    self:ImposterUpdateRelationships( false )  -- true form: NPCs are hostile to it

    self:CallOnRemove( "Imposter.StopFlee", function( ent )
        if ent.ImposterStopFlee then ent:ImposterStopFlee() end
    end )
    self:CallOnRemove( "Imposter.StopVoice", function( ent )
        if ent.ImposterStopVoice then ent:ImposterStopVoice() end
    end )

    self:ImposterSetPhase( IMPOSTER_PHASE_ROAM )

    -- TEMP load-verification banner (remove after confirming reload). If you DON'T see
    -- this in console when a bot spawns, the new Lua isn't being compiled — full map
    -- reload required (entity classes are compiled once at map load).
end

-- The "wrong"/corpse look for the true (undisguised) form: a cold, ashen tint.
-- The render-flicker on top of it is done in AdditionalThink.
function ENT:ImposterApplyTrueFormLook()
    self:SetRenderMode( RENDERMODE_TRANSALPHA )
    self:SetColor( Color( 158, 172, 178, 255 ) )
end

-- ─── Reaching the victim (the kill seam) ──────────────────────────────────────

-- Called by movement_hunt the instant the imposter reaches the victim: kick off
-- the execute → absorb → disguise sequence.
function ENT:ImposterReachVictim( victim )
    self:TaskComplete( "movement_hunt" )

    if not IsValid( victim ) then
        self.ImposterTarget = nil
        self:StartTask( "movement_roam", "victim vanished at the last second" )
        return
    end

    if imposterGrabEnabled() then
        self:TakeAction( "grab" )
    else
        self:StartTask( "movement_killstrike", "got them - striking to kill" )
    end
end

-- Set the motion-type activity map to match the disguise model. Player models use
-- the ACT_MP_* map; NPC models use the ACT_* map and must NOT hold the fists (the
-- weapon-driven ACT_HL2MP_* translation would T-pose an NPC model).
-- Apply the right activity set for the model the imposter is wearing. For NPC models
-- we resolve activities against the live model so it never T-poses; returns false when
-- the model can't locomote (no idle/move sequences) so the caller can refuse the form.
function ENT:ImposterApplyAnimsFor( isPlayerModel, holdType )
    buildAnimMaps()

    if isPlayerModel then
        self.MotionTypeActivities = ANIM_PLAYER
        self:StartActivity( ACT_RESET )
        return true
    end

    local map, canAnimate = imposterResolveNPCAnims( self, holdType )
    self.MotionTypeActivities = map
    if self:HasWeapon() then self:DropWeapon( true ) end
    self:StartActivity( ACT_RESET )
    return canAnimate
end

-- Player-model forms (true form + player/self disguise) defer to the BASE TranslateActivity,
-- which routes the activity through the held weapon's own TranslateActivity → the real
-- termhunter weapon/fist poses (ACT_HL2MP_RUN_FIST, _PISTOL, etc.), exactly like a normal
-- termhunter bot (see terminator_nextbot_fakeply). Only the absorbed-NPC MODEL disguise needs
-- special handling: NPC models lack the player ACT_HL2MP_* sequences and have no held lua
-- weapon, so we pass the raw NPC activity (ACT_RUN/ACT_WALK/ACT_IDLE, from ANIM_NPC) straight
-- through to the model instead of letting the base resolve it to a player pose it can't play.
function ENT:TranslateActivity( act )
    if act and self.ImposterDisguised
        and not self.ImposterWearingPlayerModel and not self.ImposterDisguiseIsPlayer then
        return act
    end
    return BaseClass.TranslateActivity( self, act )
end

-- The base's SetupMotionType derives motion type purely from instantaneous loco speed
-- thresholds. Near a boundary the speed oscillates between zones (e.g. WALK 0-100 vs MOVE
-- 101-201) every tick, which flips the motion activity back and forth; SetupActivity only
-- (re)StartActivity's on a change, so that oscillation re-issues the activity constantly
-- and the animation freezes mid-stride. Stabilise it: whenever we're moving and NOT
-- deliberately running, force the WALK type (a single, stable activity). Running falls
-- through to the base, where MOVE and RUN map to the SAME activity so there's no flip.
-- This covers tasks that set ShouldWalk AND those that set neither (the latter previously
-- fell back to the flickery threshold path — the cause of the occasional walk glitch).
function ENT:SetupMotionType( myTbl )
    if myTbl.IsMoving( self ) and not myTbl.IsCrouching( self )
        and not myTbl.IsSwimming( self, myTbl ) and not myTbl.IsJumping( self, myTbl ) then
        if not myTbl.ShouldRun( self, myTbl ) then
            myTbl.SetMotionType( self, TERMINATOR_NEXTBOT_MOTIONTYPE_WALK )
            return
        end
    end
    BaseClass.SetupMotionType( self, myTbl )
end

-- Give the disguised (player-model) imposter a held weapon so it reads as a real,
-- armed player. Removing a term weapon fires its term_unset_hasweapon callback, so
-- SafeRemove cleans up the bot's weapon bookkeeping for us.
function ENT:ImposterClearDisguiseWeapon()
    if IsValid( self.ImposterWeapon )      then SafeRemoveEntity( self.ImposterWeapon )      end
    if IsValid( self.ImposterWeaponModel ) then SafeRemoveEntity( self.ImposterWeaponModel ) end
    self.ImposterWeapon      = nil
    self.ImposterWeaponModel = nil
end

function ENT:ImposterEquipDisguiseWeapon()
    self:ImposterClearDisguiseWeapon()
    if self:HasWeapon() then self:DropWeapon( true ) end  -- ditch the true-form fists

    local pick = DISGUISE_WEAPONS[ math.random( #DISGUISE_WEAPONS ) ]

    -- Hold the term weapon for the correct pose, but hide its (unreliable) model.
    self:Give( pick.class )
    self.ImposterWeapon = self:GetActiveWeapon()
    if IsValid( self.ImposterWeapon ) then self.ImposterWeapon:SetNoDraw( true ) end

    -- Show the real world model bonemerged to the bot, exactly like termhunter does
    -- (lua/weapons + weapons.lua: SetParent + EF_BONEMERGE). IMPORTANT: Spawn() must
    -- come BEFORE parenting/bonemerging, otherwise the merge fails and the model
    -- drops to the feet. The w_*.mdl models carry a ValveBiped.Bip01_R_Hand bone that
    -- the merge aligns to the bot's hand.
    local wm = ents.Create( "prop_dynamic" )
    if IsValid( wm ) then
        wm:SetModel( pick.world )
        wm:SetPos( self:GetPos() )
        wm:Spawn()
        wm:Activate()
        wm:AddSolidFlags( FSOLID_NOT_SOLID )
        wm:SetMoveType( MOVETYPE_NONE )
        wm:SetParent( self )
        wm:AddEffects( EF_BONEMERGE )
        wm:SetTransmitWithParent( true )
        self.ImposterWeaponModel = wm
    end
end

-- Carry the disguised NPC's actual weapon: just the bonemerged world model in the hand.
-- Unlike the player path we DON'T give a term weapon — that would force the ACT_HL2MP_*
-- weapon pose and T-pose the NPC model. NPC locomotion already animates with the hands
-- in roughly the right place, and the merged w_*.mdl rides the R_Hand bone.
function ENT:ImposterEquipNPCWeapon( model )
    self:ImposterClearDisguiseWeapon()
    if not model or model == "" then return end  -- the NPC was unarmed

    local wm = ents.Create( "prop_dynamic" )
    if not IsValid( wm ) then return end
    wm:SetModel( model )
    wm:SetPos( self:GetPos() )
    wm:Spawn()
    wm:Activate()
    wm:AddSolidFlags( FSOLID_NOT_SOLID )
    wm:SetMoveType( MOVETYPE_NONE )
    wm:SetParent( self )
    wm:AddEffects( EF_BONEMERGE )
    wm:SetTransmitWithParent( true )
    self.ImposterWeaponModel = wm
end

-- Strip the disguise weapon and restore the true-form fists.
function ENT:ImposterRestoreTrueWeapon()
    self:ImposterClearDisguiseWeapon()

    local model = string.lower( self:GetModel() or "" )
    if not string.StartWith( model, "models/player/" ) then
        if self:HasWeapon() then self:DropWeapon( true ) end
        return
    end

    if self.TERM_FISTS and not self:HasWeapon() then
        self:Give( self.TERM_FISTS )
    end
end

-- Snapshot the victim's identity into self.ImposterSnapshot (model/skin/bodygroups/colour/
-- name/weapon). Pulled out of ImposterBeginAbsorb so the Lambda fast-path can snapshot
-- without running the held-body grab.
function ENT:ImposterSnapshotVictim( victim )
    if not IsValid( victim ) then return end

    local isPly    = victim:IsPlayer()
    local isLambda = victim.IsLambdaPlayer == true
    -- "player-like" = a real player OR a Lambda Player: both get the voice/HUD name tells.
    local playerLike = isPly or isLambda

    local snap = {
        isPly        = isPly,
        isPlayerLike = playerLike,
        class        = victim:GetClass(),
        model        = victim:GetModel(),
        skin         = victim:GetSkin() or 0,
        bodygroups   = {},
        victimHealth = victim:Health(),
        victimEnt    = playerLike and victim or nil,
        playerColor  = playerLike and (
            ( victim.GetPlayerColor and victim:GetPlayerColor() )
            or ( victim.GetPlyColor and victim:GetPlyColor() )
        ) or nil,
    }
    if victim.GetBodyGroups then
        for _, bg in ipairs( victim:GetBodyGroups() ) do
            snap.bodygroups[ bg.id ] = victim:GetBodygroup( bg.id )
        end
    end
    if not isPly and victim.GetActiveWeapon then
        local wep = victim:GetActiveWeapon()
        if IsValid( wep ) then snap.weaponModel = wep:GetModel() end
    end
    if isPly then
        snap.name = victim:Nick()
        snap.steamid = victim:SteamID64() or ""
    elseif isLambda then
        snap.name = ( victim.Nick and victim:Nick() )
            or ( victim.GetName and victim:GetName() ~= "" and victim:GetName() )
            or "Lambda Player"
        snap.steamid = ""
    elseif victim.GetName and victim:GetName() ~= "" then
        snap.name = victim:GetName()
    else
        snap.name = victim:GetClass()
    end

    self.ImposterSnapshot = snap
    return snap
end

-- Lambda fast-path: the held-body grab never worked cleanly for Lambda nextbots, so we
-- skip it entirely. Snapshot the identity, dissolve the live Lambda (its own death code
-- handles the DMG_DISSOLVE effect + a single body, and routes through LambdaOnKilled so
-- it does NOT engine-recreate), then disguise. No held clone, no carry, no duplicate body.
function ENT:ImposterAbsorbLambdaInstant( victim )
    if not IsValid( victim ) then return false end

    self:ImposterSnapshotVictim( victim )

    -- Make sure it's actually killable (we may have godmoded it elsewhere), mark it so the
    -- engine OnKilled->Recreate guard can't fire, then dissolve it. The DMG_DISSOLVE routes
    -- through Lambda's own LambdaOnKilled, which spawns ONE serverside ragdoll that dissolves
    -- (the visible effect); the now-dead Lambda entity is invisible (its Draw() bails when
    -- dead), so there's a single dissolving body and no recreation.
    victim.l_godmode = false
    victim.l_internalkilled = true
    disintegrateEntity( victim )

    -- Defensive: if the dissolver didn't remove the (now dead, invisible) Lambda entity,
    -- clean it up so it can't linger.
    timer.Simple( 0.3, function() if IsValid( victim ) then SafeRemoveEntity( victim ) end end )

    return self:ImposterFinishDisguise()
end

-- Grab-time: snapshot the victim's identity and start the controlled held body.
-- The original target stays alive but hidden until the absorb completes.
function ENT:ImposterBeginAbsorb( victim )
    if not IsValid( victim ) then return end

    -- Snapshot identity BEFORE we disturb the victim.
    self:ImposterSnapshotVictim( victim )

    if not self:BeginImposterGrabTarget( victim ) then return end
    return self.ImposterGrabRagdoll
end

-- Finish-time: apply the snapshotted identity to the imposter and go disguised.
-- Returns true if the disguise took. NPC forms that can't animate are refused (the
-- victim is still consumed, but the imposter reverts to its true form rather than
-- T-posing). Returns false in that case so the caller routes back to roaming.
function ENT:ImposterFinishDisguise()
    local snap = self.ImposterSnapshot
    if not snap then return false end

    -- Glitch burst fires AS the model begins swapping, so the audio covers the transition.
    self:EmitSound( IMPOSTER_DISGUISE_SOUND, 80, math.random( 90, 115 ) )

    self:SetColor( color_white )
    self:SetRenderMode( RENDERMODE_NORMAL )
    self:SetModel( snap.model )
    self:SetSkin( snap.skin )
    for id, val in pairs( snap.bodygroups ) do
        self:SetBodygroup( id, val )
    end

    -- player-like victims (real players + Lambda Players) drive the voice/HUD tells.
    local isPlayerLike = snap.isPlayerLike
    -- Which ANIMATION path to use is about the MODEL, not the tells: a self-disguise's
    -- silent "NPC" flavour still wears a player model (snap.playerModel), so it animates
    -- through the player path even though it isn't player-like.
    local usePlayerAnims = snap.playerModel or isPlayerLike
    -- An NPC model that carried a weapon needs the matching weapon-hold locomotion activities,
    -- or it glitches/poses wrong on the bare walk/run (HL2 combine/metrocop/rebel animate on
    -- the rifle/pistol/shotgun-hold variants). Pick the hold from the weapon it actually held.
    -- Player models route through their own animset, so this is moot for them.
    local holdType = ( not usePlayerAnims ) and imposterWeaponHoldType( snap.weaponModel ) or nil

    -- If the form can't locomote, don't wear it — restore the true form and bail.
    if not self:ImposterApplyAnimsFor( usePlayerAnims, holdType ) then
        self.ImposterSnapshot         = nil
        self.ImposterVictim           = NULL
        self.ImposterDisguised        = false
        self.ImposterWearingPlayerModel = nil
        self:ImposterSetDisguiseIsPlayer( nil )
        self.ImposterDisguiseFaction  = nil
        self:SetNWString( "ImposterVictimName", "" )
        self:SetNWString( "ImposterCorruptName", "" )
        self:SetNWString( "ImposterVictimSteamID", "" )
        self:SetNWEntity( "ImposterDisguiseVictim", NULL )
        self:SetModel( TRUE_FORM_MODEL )
        self:SetSkin( 0 )
        self:ImposterApplyAnimsFor( true )
        self:ImposterRestoreTrueWeapon()
        self:ImposterApplyTrueFormLook()
        self:ImposterUpdateRelationships( false )
        return false
    end

    self:SetNWString( "ImposterVictimName", snap.name )
    -- The glitched-name "text effect" is the tell for absorbed identities; a fabricated
    -- self-disguise (snap.noCorrupt) shows its plain name ("Anonymous") with no glitch.
    self:SetNWString( "ImposterCorruptName", snap.noCorrupt and "" or imposterCorruptName( snap.name ) )
    -- Only player-like disguises carry a steamid (drives the voice-popup avatar); NPCs
    -- get a blank so the client never tries to render a player voice panel for them.
    self:SetNWString( "ImposterVictimSteamID", isPlayerLike and ( snap.steamid or "" ) or "" )

    -- Dopple-style player info: network the live victim entity (so the disguise tracks
    -- their CURRENT player colour even after they respawn) plus a snapshot fallback.
    -- ENT:GetPlayerColor (shared.lua) reads these to tint the worn playermodel correctly.
    self:SetNWEntity( "ImposterDisguiseVictim", ( isPlayerLike and IsValid( snap.victimEnt ) ) and snap.victimEnt or NULL )
    -- Fall back to the engine matproxy's own default colour (so a self-disguise with no
    -- real victim looks like a normal default-coloured player, not stark white/black).
    self:SetNWVector( "ImposterDisguisePlayerColor", snap.playerColor or Vector( 62 / 255, 88 / 255, 106 / 255 ) )

    -- A player MODEL (real/Lambda victim, or any self-disguise) holds a proper term
    -- weapon for the correct hold pose; a real NPC model bonemerges whatever weapon
    -- model the NPC actually had (or nothing, if unarmed).
    if usePlayerAnims then
        self:ImposterEquipDisguiseWeapon()
    else
        self:ImposterEquipNPCWeapon( snap.weaponModel )
    end

    -- Absorbing the victim restores health equal to what they had — the imposter gets
    -- tougher with every kill, rewarding it for successfully completing the sequence.
    if snap.victimHealth and snap.victimHealth > 0 then
        local newHp = self:Health() + snap.victimHealth
        self:SetMaxHealth( math.max( self:GetMaxHealth(), newHp ) )
        self:SetHealth( newHp )
    end

    self.ImposterVictim          = NULL
    self.ImposterDisguised       = true
    self.ImposterWearingPlayerModel = usePlayerAnims  -- gates the NPC-model anim passthrough
    self:ImposterSetDisguiseIsPlayer( isPlayerLike )  -- gates voice/HUD tells + nametag
    -- NPC faction we're wearing (nil for player-like) — drives relationship mimicry.
    self.ImposterDisguiseFaction = ( not isPlayerLike ) and npcFactionOf( snap.class ) or nil
    -- Voice schedule: player-like disguises talk with mock-noise sessions + voice icon;
    -- NPC disguises play ambient lines from NPC_VOICELINE_TABLE if the class has an entry.
    -- Only player-like disguises "talk"; NPC disguises stay quiet (no voice popups/userid).
    self.ImposterNextVoice = isPlayerLike and ( CurTime() + math.Rand( 3, 8 ) ) or math.huge
    self:ImposterUpdateRelationships( true )  -- now "one of them" — NPCs treat it as a friend
    self:ImposterSetPhase( IMPOSTER_PHASE_DISGUISED )
    return true
end

-- Self-initiated disguise: fabricate an identity from a random installed playermodel,
-- with NO victim, so the imposter can lurk/track in plain sight. Two flavours chosen at
-- random: a "player" (shows a plain "Anonymous" nametag — no glitch text — talks, and is
-- treated as a player) or a silent "NPC" (no nametag/voice, blends into a humanoid NPC
-- faction). Both wear a player model so they animate cleanly. Returns true if it took.
function ENT:ImposterSelfDisguise()
    local model = imposterRandomPlayerModel()
    if not model then return false end
    util.PrecacheModel( model )

    local asNPC = math.random() < SELFDISG_NPC_CHANCE
    local snap = {
        isPly        = false,
        isPlayerLike = not asNPC,   -- the "player" flavour gets the nametag/voice tells
        playerModel  = true,        -- both flavours wear a player model → player anim path
        model        = model,
        skin         = 0,
        bodygroups   = {},
    }
    if asNPC then
        -- Borrow a humanoid faction to blend with (class only drives the faction lookup).
        snap.class = SELFDISG_NPC_CLASSES[ math.random( #SELFDISG_NPC_CLASSES ) ]
        snap.name  = ""             -- never shown — NPC disguises have no nametag
    else
        snap.noCorrupt = true       -- plain "Anonymous", no glitch text effect
        snap.name      = "Anonymous"
        snap.steamid   = ""          -- no real player → popup uses the model's spawnicon
    end

    self.ImposterSnapshot = snap
    self.ImposterVictim   = NULL
    return self:ImposterFinishDisguise()
end

-- Shared ragdoll dissolve: play the HL2 energy-dissolve effect on a prop_ragdoll and
-- then clean it up. Used by the kill-strike and the corpse-absorb paths.
function ENT:ImposterDissolveRagdoll( rd )
    if not IsValid( rd ) then return end
    rd:SetCollisionGroup( COLLISION_GROUP_DEBRIS )
    local tname = "imp_rd_" .. rd:EntIndex()
    rd:SetName( tname )
    local diss = ents.Create( "env_entity_dissolver" )
    if IsValid( diss ) then
        diss:SetPos( rd:GetPos() )
        diss:SetKeyValue( "dissolvetype", "0" )
        diss:Spawn()
        diss:Activate()
        diss:Fire( "Dissolve", tname, 0 )
        timer.Simple( 2, function()
            if IsValid( diss ) then diss:Remove() end
            if IsValid( rd )   then SafeRemoveEntity( rd ) end
        end )
    else
        timer.Simple( 0.5, function()
            if IsValid( rd ) then SafeRemoveEntity( rd ) end
        end )
    end
end

-- Find the closest prop_ragdoll within `radius` units of `pos` (excluding imposter's own
-- ragdolls) and dissolve it. Used when the kill target is an NPC/Lambda that doesn't
-- have GetRagdollEntity — we find the fresh body by proximity to the death spot.
function ENT:ImposterDissolveNearbyRagdoll( pos, radius )
    radius = radius or 300
    local best, bestDist = nil, radius
    for _, rd in ipairs( ents.FindByClass( "prop_ragdoll" ) ) do
        if not IsValid( rd ) then continue end
        if rd == self.ImposterRagdoll or rd == self.ImposterGrabRagdoll then continue end
        local d = rd:GetPos():Distance( pos )
        if d < bestDist then best, bestDist = rd, d end
    end
    self:ImposterDissolveRagdoll( best )
end

-- Silently absorb a prop_ragdoll: snapshot its model/skin/bodygroups, apply the
-- disguise, then dissolve the ragdoll so the body vanishes as if consumed.
-- Returns false if the ragdoll has no usable model or the form can't animate.
function ENT:ImposterAbsorbCorpse( ragdoll )
    if not IsValid( ragdoll ) then return false end
    local model = ragdoll:GetModel()
    if not model or model == "" then return false end
    util.PrecacheModel( model )

    -- Player-path models animate as players; everything else tries NPC anims.
    local isPlayerModel = string.find( model:lower(), "models/player/", 1, true ) ~= nil

    local bgs = {}
    for i = 0, ragdoll:GetNumBodyGroups() - 1 do
        bgs[ i ] = ragdoll:GetBodygroup( i )
    end

    self.ImposterSnapshot = {
        isPly        = false,
        isPlayerLike = false,   -- dead body: no nametag, no voice
        playerModel  = isPlayerModel,
        model        = model,
        skin         = ragdoll:GetSkin(),
        bodygroups   = bgs,
        class        = "npc_citizen",   -- generic faction for isolation math
        name         = "",
    }
    self.ImposterVictim = NULL

    if not self:ImposterFinishDisguise() then return false end

    self:ImposterDissolveRagdoll( ragdoll )
    return true
end

-- If the victim escapes/vanishes mid-execute, clean up and go back to roaming.
function ENT:ImposterAbortExecute()
    self.PreventShooting = nil
    self:ReleaseImposterGrab( true )
    self.ImposterTarget = nil
    self:ImposterApplyAnimsFor( true )     -- reset animation map (player model / ANIM_PLAYER)
    self:ImposterRestoreTrueWeapon()       -- re-equip fists so walk + punch animations work
    self:ImposterApplyTrueFormLook()       -- back to the ashen corpse, not plain white
    self:TaskComplete( "movement_execute" )
    self:StartTask( "movement_roam", "execute aborted" )
end

-- While disguised, spoof the victim's name to anything that asks (HUD/targetID).
function ENT:Nick()
    if self:ImposterGetPhase() ~= IMPOSTER_PHASE_DISGUISED then return end
    local n = self:GetNWString( "ImposterVictimName", "" )
    if n ~= "" then return n end
end

-- ─── Expose & enrage (Phase 6) ────────────────────────────────────────────────

-- A single enraged strike: a real fist punch from the terminator fists it carries in
-- true form. Faces + aims at the target so the punch trace lands, then fires the held
-- weapon's primary attack (DMG_CLUB, its own swing animation + hit sound). Falls back
-- to a guaranteed manual club hit only if the fists somehow aren't equipped.
function ENT:ImposterEnrageStrike( target, damage )
    if not IsValid( target ) then return end
    damage = damage or ENRAGE_DAMAGE
    if self.ImposterHGMode then damage = math.floor( damage * 0.6 ) end

    local shootPos    = self:GetShootPos()
    local targetCenter = target:WorldSpaceCenter()

    -- Body faces target horizontally (looks natural on a humanoid model).
    local bodyDir = target:GetPos() - self:GetPos()
    bodyDir.z = 0
    if bodyDir:LengthSqr() > 0 then self:SetAngles( bodyDir:Angle() ) end
    if self.SetEyeTarget then self:SetEyeTarget( targetCenter ) end

    -- Make sure the fists are actually in hand (true form holds them).
    if self.TERM_FISTS and not self:HasWeapon() then self:Give( self.TERM_FISTS ) end

    local wep      = self:GetActiveWeapon()
    local hasFists = ( self.IsFists and self:IsFists() ) or ( IsValid( wep ) and wep:GetClass() == self.TERM_FISTS )

    if hasFists and IsValid( wep ) then
        -- DoRangeGesture is what the base calls after every WeaponPrimaryAttack — it runs
        -- TranslateActivity(ACT_MP_ATTACK_STAND_PRIMARYFIRE) → DoGesture, which is the
        -- correct HL2MP punch gesture for this player model. SetAnimation/AddGesture do
        -- not work here because the base drives animation through its gesture/activity system.
        self:DoRangeGesture()
        -- Tilt aim to target center so the weapon trace lands, then fire for damage.
        local aimDir = ( targetCenter - shootPos ):GetNormalized()
        self:SetAngles( aimDir:Angle() )
        self.FistDamageMul = damage / 45
        if wep.PrimaryAttack then wep:PrimaryAttack() end
        return
    end

    -- Fallback: no fists in hand — connect manually with a club hit so enrage still bites.
    self:EmitSound( "physics/body/body_medium_impact_hard" .. math.random( 6 ) .. ".wav", 75, math.random( 90, 105 ) )
    local dmg = DamageInfo()
    dmg:SetAttacker( self )
    dmg:SetInflictor( self )
    dmg:SetDamage( damage )
    dmg:SetDamageType( DMG_CLUB )
    dmg:SetDamagePosition( targetCenter )
    dmg:SetDamageForce( ( targetCenter - self:GetPos() ):GetNormalized() * 4000 + Vector( 0, 0, 1500 ) )
    target:TakeDamageInfo( dmg )
end

function ENT:ImposterSetFleeCloak( enabled )
    enabled = enabled == true

    if enabled then
        if self.ImposterFleeCloaked then return end

        self.ImposterFleeCloaked = true
        self.ImposterFleeOldColor = self:GetColor()
        self.ImposterFleeOldRenderMode = self:GetRenderMode()

        local oldColor = self.ImposterFleeOldColor or color_white
        self:SetRenderMode( RENDERMODE_TRANSALPHA )
        self:SetColor( Color( oldColor.r, oldColor.g, oldColor.b, FLEE_CLOAK_ALPHA ) )
        self:ImposterUpdateRelationships( self.ImposterDisguised )  -- neutralize NPCs while fleeing
        return
    end

    if not self.ImposterFleeCloaked then return end

    self.ImposterFleeCloaked = false
    self:SetRenderMode( self.ImposterFleeOldRenderMode or RENDERMODE_NORMAL )
    self:SetColor( self.ImposterFleeOldColor or color_white )
    self.ImposterFleeOldColor = nil
    self.ImposterFleeOldRenderMode = nil
    self:ImposterUpdateRelationships( self.ImposterDisguised )  -- restore NPC targeting
end

function ENT:ImposterStartFlee( threat )
    if not cv_flee_en:GetBool() then return false end
    if self.ImposterEnraged or self.ImposterDisguised then return false end
    if self:ImposterGetPhase() == IMPOSTER_PHASE_PLAYDEAD then return false end  -- ragdoll handles it
    if self:ImposterGetPhase() == IMPOSTER_PHASE_FLEE then
        self.ImposterFleeThreat = threat
        self.ImposterFleeUntil = math.max( self.ImposterFleeUntil or 0, CurTime() + FLEE_DURATION * 0.55 )
        return true
    end

    self.ImposterFleeThreat = threat
    self.ImposterFleeUntil = CurTime() + FLEE_DURATION
    self.ImposterTarget = nil
    self.ImposterOldRunSpeed = self.ImposterOldRunSpeed or self.RunSpeed
    self.RunSpeed = FLEE_RUN_SPEED

    -- Drop any active ghost cloak so flee's own cloak renders on the real (now
    -- visible again) entity instead of fighting the hidden ghost copy.
    self:ImposterEndGhostCloak()

    self:ImposterSetFleeCloak( true )
    self:EmitSound( sndPick( IMPOSTER_CFG.snd.flee ), 75, 130, 0.55 )
    print( "[Imposter] Flee smoke + cloak activated at " .. tostring( self:GetPos() ) )

    self:SetNoDraw( false )      -- never let a forced exit mid-blink strand us invisible…
    self:SetModelScale( 1, 0 )   -- …or shrunken
    for _, t in ipairs( { "movement_roam", "movement_stalk", "movement_hunt", "movement_killstrike", "movement_disguised", "movement_playdead", "movement_tracking", "movement_teleport", "movement_corpse_approach" } ) do
        if self:IsTaskActive( t ) then self:TaskComplete( t ) end
    end

    self:ImposterSetPhase( IMPOSTER_PHASE_FLEE )
    if not self:IsTaskActive( "movement_flee" ) then
        self:StartTask( "movement_flee", "hurt while roaming - fleeing" )
    end

    return true
end

function ENT:ImposterStopFlee()
    self:ImposterSetFleeCloak( false )
    self.ImposterFleeThreat = nil
    self.ImposterFleeUntil = nil

    if self.ImposterOldRunSpeed then
        self.RunSpeed = self.ImposterOldRunSpeed
        self.ImposterOldRunSpeed = nil
    end
end

-- Exposed: strip the disguise back to true form, play the distortion, and enrage.
function ENT:ImposterRevealTrueForm( attacker )
    if self.ImposterEnraged then return end

    self:ImposterStopFlee()

    -- Strip impersonation data.
    self.ImposterDisguised        = false
    self.ImposterSnapshot         = nil
    self.ImposterVictim           = NULL
    self.ImposterWearingPlayerModel = nil
    self:ImposterSetDisguiseIsPlayer( nil )
    self.ImposterDisguiseFaction  = nil
    self.ImposterNextVoice = math.huge
    self:ImposterStopVoice()
    self:SetNWString( "ImposterVictimName", "" )
    self:SetNWString( "ImposterCorruptName", "" )
    self:SetNWString( "ImposterVictimSteamID", "" )
    self:SetNWEntity( "ImposterDisguiseVictim", NULL )

    -- Revert to the true form.
    self.WalkSpeed = self.ImposterNormalWalk or self.WalkSpeed  -- undo disguise walk pace
    self.RunSpeed  = self.ImposterNormalRun  or self.RunSpeed   -- defensive base reset (enrage overrides next)
    self:SetModel( TRUE_FORM_MODEL )
    self:SetSkin( 0 )
    self:ImposterApplyAnimsFor( true )
    self:ImposterRestoreTrueWeapon()
    self:ImposterApplyTrueFormLook()  -- ashen corpse tint
    self:ImposterUpdateRelationships( false )  -- back to a monster — NPCs turn on it

    -- Distortion FX — the jumpscare reveal sting.
    self:EmitSound( IMPOSTER_REVEAL_SOUND, 72, 100 )
    util.ScreenShake( self:GetPos(), 6, 90, 0.5, 900, true )

    -- Enrage: faster, lethal, immediately fixated on whoever's nearest. Burns out
    -- after ENRAGE_DURATION, then ImposterCalmDown returns it to roaming.
    -- Restless variant sprints harder and stays enraged longer.
    local restless = self:ImposterIsRestless()
    self.ImposterEnraged     = true
    self.ImposterEnrageUntil = CurTime() + ( restless and ENRAGE_DURATION * 1.4 or ENRAGE_DURATION )
    self.RunSpeed            = restless and 720 or ENRAGE_RUN_SPEED
    if IsValid( attacker ) and ( attacker:IsPlayer() or attacker:IsNPC() ) then
        self.ImposterTarget = attacker
    else
        self.ImposterTarget = imposterPickNearest( self )
    end

    -- Switch to the enrage task now (coroutine-safe: we just edit the task set).
    self:SetNoDraw( false )      -- defensive: never inherit a mid-blink hidden/shrunken state
    self:SetModelScale( 1, 0 )
    for _, t in ipairs( { "movement_disguised", "movement_stalk", "movement_hunt", "movement_killstrike", "movement_roam", "movement_flee", "movement_playdead", "movement_tracking", "movement_teleport", "movement_corpse_approach" } ) do
        if self:IsTaskActive( t ) then self:TaskComplete( t ) end
    end
    if not self:IsTaskActive( "movement_enrage" ) then
        self:StartTask( "movement_enrage", "exposed - enraged" )
    end
end

-- Quietly shed the disguise back to the true form WITHOUT enraging — used when a
-- disguised imposter decides to hunt again. Unlike ImposterRevealTrueForm there's no
-- jumpscare, no screen shake and no frenzy: it just stops pretending so it can hunt
-- as the monster. (Damage-triggered exposure still routes through ImposterRevealTrueForm.)
function ENT:ImposterDropDisguise()
    if not self.ImposterDisguised then return end

    self.ImposterDisguised = false
    self.ImposterSnapshot  = nil
    self.ImposterVictim    = NULL
    self.ImposterWearingPlayerModel = nil
    self:ImposterSetDisguiseIsPlayer( nil )
    self.ImposterDisguiseFaction = nil
    self.ImposterNextVoice = math.huge
    self:ImposterStopVoice()
    self.WalkSpeed = self.ImposterNormalWalk or self.WalkSpeed  -- undo disguise walk pace
    self.RunSpeed  = self.ImposterNormalRun  or self.RunSpeed   -- defensive base reset (roam re-applies jog)
    self:SetNWString( "ImposterVictimName", "" )
    self:SetNWString( "ImposterCorruptName", "" )
    self:SetNWString( "ImposterVictimSteamID", "" )
    self:SetNWEntity( "ImposterDisguiseVictim", NULL )

    -- Glitch burst fires as the model starts reverting, same timing logic as ImposterFinishDisguise.
    self:EmitSound( IMPOSTER_DISGUISE_SOUND, 72, math.random( 75, 95 ) )
    self:SetModel( TRUE_FORM_MODEL )
    self:SetSkin( 0 )
    self:ImposterApplyAnimsFor( true )
    self:ImposterRestoreTrueWeapon()
    self:ImposterApplyTrueFormLook()           -- back to the ashen corpse
    self:ImposterUpdateRelationships( false )  -- shedding the disguise turns NPCs hostile again
end

-- Set the right movement pace for the current disguise. The player and NPC disguises are
-- handled SEPARATELY: both WALK (the walk anim scales cleanly; driving the sprint anim at a
-- slow speed caused the gliding-lunge glitch), but at distinct speeds, and their animation
-- maps already differ (ANIM_PLAYER → ACT_MP_WALK vs ANIM_NPC → ACT_WALK, set in
-- ImposterApplyAnimsFor). Lives OUTSIDE DoCustomTasks so referencing the speed constants
-- doesn't count against that function's 60-upvalue limit.
function ENT:ImposterApplyDisguiseMovement()
    if self.ImposterDisguiseIsPlayer then
        self.RunSpeed = DISGUISE_JOG_SPEED   -- player jog: base plays the run/move weapon pose
    else
        self.WalkSpeed = DISGUISE_NPC_WALK   -- deliberate NPC amble (NPC walk anim)
    end
end

-- Reveal trigger: any damage taken while impersonating exposes the imposter.
function ENT:OnTakeDamage( dmg )
    local attacker = dmg and dmg:GetAttacker() or NULL
    local phase = self:ImposterGetPhase()

    -- Ragdolls (our own playdead/held-body props included) can never damage the imposter.
    -- Physics impact damage puts the ragdoll as GetInflictor(), not GetAttacker(), so check both.
    local inflictor = dmg and dmg:GetInflictor() or NULL
    if ( IsValid( attacker ) and attacker:GetClass() == "prop_ragdoll" )
        or ( IsValid( inflictor ) and inflictor:GetClass() == "prop_ragdoll" ) then return end

    -- Ragdoll mods may replace the standard prop_ragdoll class with prop_physics or custom
    -- classes, so the check above won't catch them. DMG_CRUSH with no player/NPC attacker
    -- is the signature of an unowned physics object colliding with us — block that too.
    if dmg and bit.band( dmg:GetDamageType(), DMG_CRUSH ) ~= 0
        and not ( IsValid( attacker ) and ( attacker:IsPlayer() or attacker:IsNPC() ) ) then
        return
    end

    -- Tanky-but-killable: flat resist on every incoming hit (the metal-skeleton
    -- resist is disabled, so this is what keeps it from melting to a single mag).
    if dmg and self.ImposterDamageScale then
        dmg:ScaleDamage( self.ImposterDamageScale )
    end

    -- Remember who hurt us — this is the heaviest input to the grudge score, so the
    -- thing fixates on people who shoot it once it gets a chance to come back around.
    -- Lambda players have IsPlayer()==false and IsNPC()==false, so check explicitly.
    if IsValid( attacker ) and attacker ~= self
        and ( attacker:IsPlayer() or attacker:IsNPC() or attacker.IsLambdaPlayer ) then
        self:ImposterNoteAttack( attacker )
    end

    if not self.ImposterDisguised
        and not self.ImposterEnraged
        and ( phase == IMPOSTER_PHASE_ROAM or phase == IMPOSTER_PHASE_STALK or phase == IMPOSTER_PHASE_TRACKING )
        and IsValid( attacker )
        and attacker ~= self then
        if attacker.IsLambdaPlayer then
            -- Lambda attacked us: skip the flee response and immediately hunt them down.
            self:ImposterBeginTracking( attacker )
            for _, t in ipairs( { "movement_roam", "movement_stalk", "movement_tracking", "movement_teleport" } ) do
                if self:IsTaskActive( t ) then self:TaskComplete( t ) end
            end
            self:ImposterSetPhase( IMPOSTER_PHASE_HUNT )
            if not self:IsTaskActive( "movement_hunt" ) then
                self:StartTask( "movement_hunt", "lambda attacked - hunting" )
            end
        elseif math.random() < ATTACK_COUNTER_CHANCE then
            -- Rare snap: instead of fleeing, it turns and hunts whoever shot it.
            self:ImposterBeginTracking( attacker )
            for _, t in ipairs( { "movement_roam", "movement_stalk", "movement_tracking", "movement_teleport" } ) do
                if self:IsTaskActive( t ) then self:TaskComplete( t ) end
            end
            self:ImposterSetPhase( IMPOSTER_PHASE_HUNT )
            if not self:IsTaskActive( "movement_hunt" ) then
                self:StartTask( "movement_hunt", "counter-attacked - hunting" )
            end
        else
            self:ImposterStartFlee( attacker )
        end
    end

    -- Committed to a kill but taking a real beating → abort and flee. It commits
    -- through chip damage (so it isn't scared off by one shot) but bails once the
    -- cumulative hit this hunt crosses HUNT_FLEE_DAMAGE.
    -- Lambda players are exempt: the imposter never retreats from them mid-hunt.
    if phase == IMPOSTER_PHASE_HUNT
        and not self.ImposterDisguised and not self.ImposterEnraged
        and IsValid( attacker ) and attacker ~= self
        and not attacker.IsLambdaPlayer then
        self.ImposterHuntDamage = ( self.ImposterHuntDamage or 0 ) + ( dmg and dmg:GetDamage() or 0 )
        if self.ImposterHuntDamage >= HUNT_FLEE_DAMAGE then
            self.ImposterTarget    = nil
            self.ImposterHuntUntil = CurTime() + HUNT_COOLDOWN
            self:ImposterStartFlee( attacker )  -- this completes movement_hunt itself
        end
    end

    -- Holding a victim but taking a beating → drop them and flee.
    if ( phase == IMPOSTER_PHASE_EXECUTE or phase == IMPOSTER_PHASE_ABSORB )
        and not self.ImposterEnraged
        and IsValid( self.ImposterGrabTarget )  -- only when actually holding someone
        and IsValid( attacker ) and attacker ~= self then
        self.ImposterGrabDamage = ( self.ImposterGrabDamage or 0 ) + ( dmg and dmg:GetDamage() or 0 )
        if self.ImposterGrabDamage >= GRAB_FLEE_DAMAGE then
            self.ImposterGrabDamage = nil
            self:ImposterAbortExecute()
            self:ImposterStartFlee( attacker )
        end
    end

    -- No-grab kill strike taking a beating → abort and flee (no victim to release).
    if phase == IMPOSTER_PHASE_EXECUTE and not imposterGrabEnabled()
        and not self.ImposterEnraged
        and IsValid( attacker ) and attacker ~= self then
        self.ImposterKillStrikeDamage = ( self.ImposterKillStrikeDamage or 0 ) + ( dmg and dmg:GetDamage() or 0 )
        if self.ImposterKillStrikeDamage >= HUNT_FLEE_DAMAGE then
            self.ImposterKillStrikeDamage = nil
            self.ImposterSnapshot = nil
            self.ImposterTarget   = nil
            self:ImposterSetPhase( IMPOSTER_PHASE_ROAM )
            if self:IsTaskActive( "movement_killstrike" ) then self:TaskComplete( "movement_killstrike" ) end
            self:ImposterStartFlee( attacker )
        end
    end

    -- Lambda players hitting a disguised imposter should NOT reveal it — they're AI bots
    -- that "see" the imposter as a teammate (or neutral). Only real players and NPCs can
    -- see through the disguise by shooting it.
    if self.ImposterDisguised
        and not self.ImposterEnraged
        and phase ~= IMPOSTER_PHASE_EXECUTE
        and not ( IsValid( attacker ) and attacker.IsLambdaPlayer ) then
        self:ImposterRevealTrueForm( attacker )
    end

    if BaseClass and BaseClass.OnTakeDamage then
        return BaseClass.OnTakeDamage( self, dmg )
    end
end

-- HL2 player models blend their leg movement through the move_x/move_y pose params
-- (citizen-style models use a single move_yaw instead). The termhunter base only sets
-- the upper-body aim params, never these — so when the body faces one way and the bot
-- moves another (most visibly while holding a weapon and aiming at a target), the legs
-- keep playing a straight-ahead run blend and look broken. Feed the params from the
-- real velocity so the legs match the actual movement direction, in any disguise/weapon.
function ENT:ImposterUpdateMovePose()
    local vel   = self:GetVelocity()
    local speed = vel:Length2D()

    if speed < 1 then
        self:SetPoseParameter( "move_x", 0 )
        self:SetPoseParameter( "move_y", 0 )
        self:SetPoseParameter( "move_yaw", 0 )
        return
    end

    local ang  = self:GetAngles()
    local norm = math.max( self.RunSpeed or 200, 1 )

    -- HL2MP models: forward/back on move_x, strafe on move_y, normalized to run speed.
    self:SetPoseParameter( "move_x", math.Clamp( vel:Dot( ang:Forward() ) / norm, -1, 1 ) )
    self:SetPoseParameter( "move_y", math.Clamp( vel:Dot( ang:Right() )   / norm, -1, 1 ) )

    -- Citizen-style models: a single yaw of motion relative to facing (no-op otherwise).
    self:SetPoseParameter( "move_yaw", math.NormalizeAngle( vel:Angle().y - ang.y ) )
end

function ENT:AdditionalThink( myTbl )
    local phase = self:ImposterGetPhase()

    -- Drive the player-model leg blend so it doesn't glitch while strafing/aiming: player
    -- forms (true form, player/self disguise) hold a weapon with the upper body aiming
    -- independently while the legs strafe, which needs the move_x/move_y blend fed each tick.
    --
    -- NPC-model disguises are DELIBERATELY skipped. They animate through their resolved
    -- full-body locomotion activity (ACT_WALK_RIFLE / ACT_RUN_RIFLE etc.) and face their
    -- travel direction via the loco, so the legs already play a clean forward walk. Driving
    -- move_yaw on top only fights that activity — as the loco's facing wobbles while pathing,
    -- the blend shifts every frame and the legs visibly hitch. Let the activity do the work.
    local wearingNPCModel = self.ImposterDisguised
        and not self.ImposterDisguiseIsPlayer and not self.ImposterWearingPlayerModel
    if not wearingNPCModel then
        self:ImposterUpdateMovePose()
    end

    -- Always tick the ghost cloak so it self-heals (and animates) regardless of
    -- phase — this is what guarantees the bot can never get stuck invisible.
    self:ImposterUpdateGhostCloak()

    -- Keep NPC factions in sync (friendly while disguised, hostile in true form),
    -- catching any NPCs that spawned since the last change.
    if CurTime() >= ( self.ImposterNextRelationship or 0 ) then
        self.ImposterNextRelationship = CurTime() + 3
        self:ImposterUpdateRelationships( self.ImposterDisguised )
    end

    -- Keep the debug overlay's "target:" line in sync with whoever it's fixated on
    -- (the active stalk/hunt mark, else the track lead while actually tracking).
    local fixate = IsValid( self.ImposterTarget ) and self.ImposterTarget
        or ( phase == IMPOSTER_PHASE_TRACKING and IsValid( self.ImposterTrackTarget ) and self.ImposterTrackTarget or nil )
    self:SetNWString( "ImposterTrackName", fixate and imposterEntName( fixate ) or "" )

    if phase == IMPOSTER_PHASE_DISGUISED then
        if self.ImposterDisguiseIsPlayer then
            self:ImposterVoiceThink()
        end
    elseif not self.ImposterDisguised and phase ~= IMPOSTER_PHASE_EXECUTE
        and phase ~= IMPOSTER_PHASE_TELEPORT then  -- mid-blink: leave draw state to the task
        self:ImposterTrueFormFlicker()
        self:ImposterThinkAbilities()
        if cv_hear_en:GetBool() then
            self:ImposterListenForFootsteps()  -- hear sprinting prey it can't see
        end
    end
end

-- Stop any in-progress voice sound. Safe to call at any time (reveal, despawn, re-disguise).
function ENT:ImposterStopVoice()
    if self.ImposterVoicePatch then
        self.ImposterVoicePatch:Stop()
        self.ImposterVoicePatch = nil
    end
end

-- Voice tell while disguised. Two branches:
--   • Player disguise — loops MockNoises.mp3 via CreateSound (per-entity patch, so two
--     imposters can both talk without their StopSound calls interfering), then sends the
--     net message to show the voice icon on clients.
--   • NPC disguise   — plays a single ambient line from NPC_VOICELINE_TABLE, no icon.
function ENT:ImposterVoiceThink()
    local now = CurTime()
    if now < ( self.ImposterNextVoice or 0 ) then return end

    if self.ImposterDisguiseIsPlayer then
        local pitch   = ( math.random() < 0.5 ) and math.random( 88, 94 ) or math.random( 106, 112 )
        local session = math.random( 5, 11 )
        local file    = MOCK_NOISE_FILES_SV[ math.random( #MOCK_NOISE_FILES_SV ) ]

        -- CreateSound returns a per-entity CSoundPatch: Stop() only affects THIS patch,
        -- so multiple imposters playing the same file never silence each other.
        self:ImposterStopVoice()
        local snd = CreateSound( self, file )
        snd:ChangePitch( pitch, 0 )
        snd:Play()
        self.ImposterVoicePatch = snd

        local ent = self
        timer.Simple( session, function()
            if IsValid( ent ) and ent.ImposterVoicePatch == snd then
                ent:ImposterStopVoice()
            end
        end )

        net.Start( "imposter_voice" )
            net.WriteEntity( self )
            net.WriteUInt( session, 8 )
        net.Broadcast()

        self.ImposterNextVoice = now + session + math.Rand( 4, 9 )

    end
end

-- True-form tell: a subtle, glitchy ashen flicker on the undisguised corpse so it
-- never looks quite right. Rate-limited; varies brightness with occasional alpha dips.
function ENT:ImposterTrueFormFlicker()
    if CurTime() < ( self.ImposterNextFlicker or 0 ) then return end
    self.ImposterNextFlicker = CurTime() + math.Rand( 0.1, 0.3 )

    -- While cloaked (ability or fleeing) render faint and glitchy — this also keeps
    -- the flicker from overwriting the cloak alpha each tick.
    if self:ImposterIsCloaked() then
        self:SetRenderMode( RENDERMODE_TRANSALPHA )
        self:SetColor( Color( 150, 165, 175, math.random( 12, 45 ) ) )  -- clearly faded out
        return
    end

    local b = math.random( 145, 175 )
    local a = ( math.random() < 0.18 ) and math.random( 110, 200 ) or 255  -- occasional dip
    self:SetColor( Color( b, b + 12, b + 18, a ) )
end

-- Tracking arrival logic: called when we may have reached the current track goal but
-- the target isn't there. Works through adjacent areas (multi-sweep), then remembered
-- sightings, before giving up. Mutates data.GoalPos / SweepQueue / SightingIdx.
-- Returns true to keep pursuing, false when the trail is fully exhausted (the task
-- should fall back to roam). Lives outside DoCustomTasks so its constant references
-- (SIGHTING_MEMORY_TIME / TRACK_LEAD_COOLDOWN / TRACK_ARRIVE_DIST) don't count against
-- that function's 60-upvalue limit.
function ENT:ImposterTrackArrival( data, lead, p )
    -- Not close enough to the goal yet → keep heading there.
    if data.GoalPos and self:GetPos():Distance( data.GoalPos ) >= TRACK_ARRIVE_DIST then
        return true
    end

    -- Build the sweep queue on first arrival (all adjacent areas, shuffled).
    if not data.SweepQueue then
        local near = navmesh.GetNearestNavArea( data.GoalPos or self:GetPos() )
        data.SweepQueue = {}
        if IsValid( near ) then
            local adj = near:GetAdjacentAreas()
            if adj then
                for i = #adj, 2, -1 do
                    local j = math.random( i )
                    adj[i], adj[j] = adj[j], adj[i]
                end
                for _, a in ipairs( adj ) do
                    table.insert( data.SweepQueue, a:GetRandomPoint() )
                end
            end
        end
        imposterDbg( self, "arrived at lead area - sweeping %d adjacent areas", #data.SweepQueue )
    end

    -- Pop the next sweep target.
    if #data.SweepQueue > 0 then
        data.GoalPos = table.remove( data.SweepQueue, 1 )
        self:InvalidatePath( "sweep next area" )
        return true
    end

    -- Sweep exhausted → try each remembered sighting in order.
    local sightings  = self.ImposterSightings
    data.SightingIdx = ( data.SightingIdx or 0 ) + 1
    local sighting   = sightings and sightings[ data.SightingIdx ]
    if sighting and ( CurTime() - sighting.time ) < SIGHTING_MEMORY_TIME then
        data.GoalPos    = sighting.pos
        data.SweepQueue = nil   -- rebuild the sweep queue when we arrive there
        imposterDbg( self, "sweep done - following sighting #%d at %s",
            data.SightingIdx, tostring( sighting.pos ) )
        self:InvalidatePath( "sighting fallback" )
        return true
    end

    -- All leads and sightings exhausted → give up this target.
    self:ImposterNoteLost( lead )
    if p then p.leadCooldown = CurTime() + TRACK_LEAD_COOLDOWN end
    return false
end

-- ─── Brain: custom task list ──────────────────────────────────────────────────

-- DoCustomTasks is handed the already-populated default task list. We KEEP all of
-- it (so any task the base infrastructure starts still resolves) and only override
-- the movement router plus add our two new movement tasks.
function ENT:DoCustomTasks( defaultTasks )

    -- Central router: completes itself and starts the movement task matching the
    -- current phase. Movement tasks hand back here (or directly to each other)
    -- when they're done. StartsOnInitialize so it kicks the brain off on spawn.
    defaultTasks["movement_handler"] = {
        StartsOnInitialize        = true,
        StopsWhenPlayerControlled = true,
        BehaveUpdateMotion = function( self, data )
            local phase = self:ImposterGetPhase()
            self:TaskComplete( "movement_handler" )

            if self.ImposterEnraged then
                self:StartTask( "movement_enrage", "routing to enrage" )
            elseif phase == IMPOSTER_PHASE_FLEE then
                self:StartTask( "movement_flee", "routing to flee" )
            elseif phase == IMPOSTER_PHASE_PLAYDEAD then
                self:StartTask( "movement_playdead", "routing to playdead" )
            elseif phase == IMPOSTER_PHASE_DISGUISED then
                self:StartTask( "movement_disguised", "routing to disguised" )
            elseif phase == IMPOSTER_PHASE_HUNT and IsValid( self.ImposterTarget ) then
                self:StartTask( "movement_hunt", "routing to hunt" )
            elseif phase == IMPOSTER_PHASE_STALK and IsValid( self.ImposterTarget ) then
                self:StartTask( "movement_stalk", "routing to stalk" )
            elseif phase == IMPOSTER_PHASE_TRACKING then
                self:StartTask( "movement_tracking", "routing to tracking" )
            elseif phase == IMPOSTER_PHASE_TELEPORT then
                self:StartTask( "movement_teleport", "routing to teleport" )
            else
                self:StartTask( "movement_roam", "routing to roam" )
            end
        end,
    }

    -- Returns true if any living player or hostile NPC is within range of the imposter.
    local function imposterHostilesNearby( self, range )
        local rangeSq = range * range
        local myPos   = self:GetPos()
        if not imposterIgnorePlayers() then
            for _, ply in ipairs( player.GetAll() ) do
                if ply:Alive() and ply:GetPos():DistToSqr( myPos ) <= rangeSq then return true end
            end
            for _, lp in ipairs( ents.FindByClass( "npc_lambdaplayer" ) ) do
                if IsValid( lp ) and lp:Alive() and lp:GetPos():DistToSqr( myPos ) <= rangeSq then return true end
            end
        end
        for _, npc in ipairs( ents.FindByClass( "npc_*" ) ) do
            if IsValid( npc ) and npc:Health() > 0 and npc:GetPos():DistToSqr( myPos ) <= rangeSq then return true end
        end
        return false
    end

    -- PLAYDEAD: hide as a ragdoll of itself. Ambushes anyone who comes to investigate;
    -- flees if the ragdoll is shot; gives up and roams if nobody comes.
    defaultTasks["movement_playdead"] = {
        OnStart = function( self, data )
            self:ImposterSetPhase( IMPOSTER_PHASE_PLAYDEAD )
            self:SetNoDraw( true )
            self:SetNotSolid( true )  -- prevent ragdoll physics objects from crushing the bot

            local rag = ents.Create( "prop_ragdoll" )
            if IsValid( rag ) then
                rag:SetModel( self:GetModel() )
                rag:SetPos( self:GetPos() )
                rag:SetAngles( self:GetAngles() )
                rag:SetSkin( self:GetSkin() or 0 )
                rag:SetColor( self:GetColor() )
                rag:SetRenderMode( self:GetRenderMode() )
                rag:Spawn()
                rag:Activate()
                -- DEBRIS: collides with world only, not with the hidden bot entity.
                -- Bullets still hit it (MASK_SHOT includes CONTENTS_DEBRIS).
                rag:SetCollisionGroup( COLLISION_GROUP_DEBRIS )
                -- Small collapse impulse so it falls naturally
                for i = 0, rag:GetPhysicsObjectCount() - 1 do
                    local phys = rag:GetPhysicsObjectNum( i )
                    if IsValid( phys ) then
                        phys:SetVelocity( self:GetForward() * -30 + Vector( 0, 0, -20 ) )
                        phys:Wake()
                    end
                end
            end

            data.Ragdoll    = rag
            data.AbandonAt  = CurTime() + PLAYDEAD_TIMEOUT
            data.SettleAt   = CurTime() + 1.5  -- ignore physics until ragdoll settles
        end,
        BehaveUpdateMotion = function( self, data )
            local rag = data.Ragdoll

            -- Ragdoll got externally removed or timeout reached → quietly get up.
            if not IsValid( rag ) or CurTime() >= data.AbandonAt then
                self:SetNotSolid( false )
                self:SetNoDraw( false )
                if IsValid( rag ) then rag:Remove() end
                self:TaskComplete( "movement_playdead" )
                self:StartTask( "movement_roam", "playdead timeout" )
                return
            end

            local ragPos = rag:GetPos()

            -- After settling: check if ragdoll was shot (physics disturbed).
            if CurTime() >= data.SettleAt then
                for i = 0, rag:GetPhysicsObjectCount() - 1 do
                    local phys = rag:GetPhysicsObjectNum( i )
                    if IsValid( phys ) and phys:GetVelocity():Length() > PLAYDEAD_DISTURB_SPD then
                        -- Shot — burst out and flee
                        self:SetNotSolid( false )
                        self:SetNoDraw( false )
                        rag:Remove()
                        self.ImposterPlayDeadCooldown = CurTime() + PLAYDEAD_COOLDOWN
                        local _s = IMPOSTER_CFG.snd.playdead_shot; self:EmitSound( _s[ math.random( #_s ) ], 80, 130, 0.7 )
                        self:TaskComplete( "movement_playdead" )
                        -- Phase must leave PLAYDEAD before ImposterStartFlee, otherwise
                        -- its PLAYDEAD guard returns false and no task starts (bot freezes).
                        self:ImposterSetPhase( IMPOSTER_PHASE_ROAM )
                        self:ImposterStartFlee( self.ImposterFleeThreat )
                        return
                    end
                end
            end

            -- Check if anyone is close enough to trigger the ambush.
            local function checkApproach( ent )
                if not IsValid( ent ) then return false end
                if ent:GetPos():DistToSqr( ragPos ) > PLAYDEAD_REVEAL_DIST * PLAYDEAD_REVEAL_DIST then return false end
                self:SetNotSolid( false )
                self:SetNoDraw( false )
                rag:Remove()
                self.ImposterPlayDeadCooldown = CurTime() + PLAYDEAD_COOLDOWN
                local _s = IMPOSTER_CFG.snd.ambush; self:EmitSound( _s[ math.random( #_s ) ], 90, 100, 1 )
                self.ImposterTarget = ent
                -- Instant lunge: snap to melee range so movement_execute grabs
                -- immediately rather than waiting for the hunt pathfinder to close in.
                local toEnt = ent:GetPos() - self:GetPos()
                toEnt.z = 0
                if toEnt:Length() > HUNT_MELEE_RANGE then
                    self:SetPos( ent:GetPos() - toEnt:GetNormalized() * ( HUNT_MELEE_RANGE * 0.6 ) )
                end
                self:TaskComplete( "movement_playdead" )
                if imposterGrabEnabled() then
                    self:TakeAction( "grab" )
                else
                    self:StartTask( "movement_killstrike", "playdead ambush - no-grab strike" )
                end
                return true
            end

            for _, ply in ipairs( player.GetAll() ) do
                if ply:Alive() and checkApproach( ply ) then return end
            end
            for _, npc in ipairs( ents.FindByClass( "npc_*" ) ) do
                if IsValid( npc ) and npc:Health() > 0 and checkApproach( npc ) then return end
            end
        end,
        ShouldWalk = function( self, data ) return false end,
        ShouldRun  = function( self, data ) return false end,
    }

    -- ROAM: wander the map at a brisk jog looking for a target. On finding one, hand off
    -- to the stalk task.
    defaultTasks["movement_roam"] = {
        OnStart = function( self, data )
            self:ImposterSetPhase( IMPOSTER_PHASE_ROAM )
            self.ImposterTarget = nil
            -- Brisk jog while prowling: restless prowls at full sprint, the base form jogs.
            self.RunSpeed = self:ImposterIsRestless() and ( self.ImposterNormalRun or self.RunSpeed ) or ROAM_JOG_SPEED
            data.NextTargetPick = CurTime() + math.Rand( 2, 4 )
            data.NextWanderGoal = 0
            data.GoalPos        = nil
        end,
        BehaveUpdateMotion = function( self, data )
            -- 1) Periodically look for someone to stalk. If nobody's in sight but we
            -- have a grudge lead to chase down, switch to TRACKING and hunt their trail.
            -- Restless variant re-scans roughly twice as often (it's hungry).
            if CurTime() >= data.NextTargetPick then
                data.NextTargetPick = CurTime() + ( self:ImposterIsRestless() and ROAM_REPICK_DELAY * 0.5 or ROAM_REPICK_DELAY )
                local target = imposterPickTarget( self )
                if IsValid( target ) then
                    self:ImposterBeginTracking( target )
                    self:TaskComplete( "movement_roam" )
                    self:StartTask( "movement_stalk", "found someone to stalk" )
                    return
                end

                if CurTime() >= ( self.ImposterNextTrack or 0 ) then
                    local lead = self:ImposterPickTrackLead()
                    if IsValid( lead ) then
                        self:TaskComplete( "movement_roam" )
                        self:StartTask( "movement_tracking", "no one in sight - tracking a lead" )
                        return
                    end
                end
            end

            -- 2) Proactive playdead: if a nearby player spots us while we're just
            -- wandering, occasionally drop and play dead to lure them in rather than
            -- waiting to be attacked.
            if IMPOSTER_CFG.cv.playdead_en:GetBool() and CurTime() >= ( data.NextPlayDeadCheck or 0 ) then
                data.NextPlayDeadCheck = CurTime() + 2.5
                local cdOk = not self.ImposterPlayDeadCooldown or CurTime() >= self.ImposterPlayDeadCooldown
                if cdOk and imposterHostilesNearby( self, 800 ) and imposterSeenByPlayer( self )
                    and not imposterWatchedByPlayer( self )
                    and math.random() < 0.45 then
                    self:TaskComplete( "movement_roam" )
                    self:TakeAction( "playdead" )
                    return
                end
            end

            -- 3) Corpse scan: notice a nearby prop_ragdoll and walk over to absorb it.
            if cv_ragdoll_disg_en:GetBool()
                and CurTime() >= ( self.ImposterNextCorpseAbsorb or 0 )
                and CurTime() >= ( data.NextCorpseScan or 0 ) then
                data.NextCorpseScan = CurTime() + 2
                local best, bestDist = nil, CORPSE_DETECT_RANGE + 1
                for _, rd in ipairs( ents.FindByClass( "prop_ragdoll" ) ) do
                    if IsValid( rd ) and rd ~= self.ImposterRagdoll and rd ~= self.ImposterGrabRagdoll then
                        local d = self:GetRangeTo( rd )
                        if d < bestDist then best, bestDist = rd, d end
                    end
                end
                if IsValid( best ) then
                    self.ImposterCorpseTarget = best
                    self:TaskComplete( "movement_roam" )
                    self:StartTask( "movement_corpse_approach", "noticed a corpse" )
                    return
                end
            end

            -- 4) Caught in the open: the true form fears being seen. If a player has
            -- a clear line on us, cut the current goal short and duck toward cover.
            -- (The cloak ability fires in parallel from AdditionalThink.)
            if CurTime() >= ( data.NextSeenCheck or 0 ) and CurTime() >= ( data.DuckUntil or 0 ) then
                data.NextSeenCheck = CurTime() + 0.5
                if imposterSeenByPlayer( self ) then
                    local hide = imposterPickHiddenRoamGoal( self )
                    if hide then
                        data.GoalPos    = hide
                        data.DuckUntil  = CurTime() + 2.5  -- commit to the cover run, don't re-duck instantly
                        self:InvalidatePath( "ducking out of sight" )
                        self:SetupPathShell( data.GoalPos )
                    end
                end
            end

            -- 4) Patrol the map looking for prey, routing toward spots no player can
            -- see (true-form path avoidance). It won't pick fights — it flees if hit.
            local myPos = self:GetPos()
            if not data.GoalPos
                or myPos:Distance( data.GoalPos ) < WANDER_ARRIVE_DIST
                or CurTime() >= data.NextWanderGoal then
                data.NextWanderGoal = CurTime() + math.Rand( WANDER_GOAL_MIN, WANDER_GOAL_MAX )
                data.GoalPos = imposterPickHiddenRoamGoal( self )
            end

            if data.GoalPos and self:primaryPathInvalidOrOutdated( data.GoalPos ) then
                self:InvalidatePath( "new roam path" )
                self:SetupPathShell( data.GoalPos )
            end

            if self:primaryPathIsValid() then
                self:ControlPath2( true )
            end
        end,
        -- Prowl at a jog (ShouldRun lets SetupSpeed use the ROAM_JOG_SPEED set in OnStart;
        -- restless uses full RunSpeed). The run/move anim shows the raised fists.
        ShouldWalk = function( self, data ) return false end,
        ShouldRun  = function( self, data ) return true end,
    }

    -- CORPSE APPROACH: actively walks toward a nearby prop_ragdoll to absorb its model.
    -- Triggered by movement_roam when a ragdoll is detected within CORPSE_DETECT_RANGE.
    defaultTasks["movement_corpse_approach"] = {
        OnStart = function( self, data )
            self:ImposterSetPhase( IMPOSTER_PHASE_ROAM )
            data.AbandonAt = CurTime() + 15
        end,
        BehaveUpdateMotion = function( self, data )
            local rd = self.ImposterCorpseTarget

            if not IsValid( rd ) then
                self.ImposterCorpseTarget = nil
                self:TaskFail( "movement_corpse_approach" )
                self:StartTask( "movement_roam", "corpse disappeared" )
                return
            end

            if CurTime() >= data.AbandonAt then
                self.ImposterCorpseTarget = nil
                self:TaskFail( "movement_corpse_approach" )
                self:StartTask( "movement_roam", "corpse approach timed out" )
                return
            end

            -- Close enough — absorb.
            if self:GetRangeTo( rd ) <= CORPSE_ABSORB_RANGE then
                local absorbed = self:ImposterAbsorbCorpse( rd )
                self.ImposterCorpseTarget    = nil
                self.ImposterNextCorpseAbsorb = CurTime() + CORPSE_ABSORB_CD
                self:TaskComplete( "movement_corpse_approach" )
                if absorbed then
                    self:StartTask( "movement_disguised", "absorbed corpse - going disguised" )
                else
                    self:StartTask( "movement_roam", "corpse model unusable - back to roam" )
                end
                return
            end

            -- Pathfind toward the ragdoll.
            local goalPos = rd:GetPos()
            if self:primaryPathInvalidOrOutdated( goalPos ) then
                self:InvalidatePath( "closing on corpse" )
                self:SetupPathShell( goalPos )
            end
            if self:primaryPathIsValid() then
                self:ControlPath2( true )
            end
        end,
        ShouldWalk = function( self, data ) return true end,
        ShouldRun  = function( self, data ) return false end,
    }

    -- TRACKING: nobody's in sight, but it has a grudge lead. Move to that person's
    -- last-known position to re-acquire them. Re-acquire LOS → stalk. Reach the spot
    -- without finding them → sweep an adjacent area once, then mark the lead exhausted
    -- and fall back to roam. Times out so it never tracks a ghost forever.
    defaultTasks["movement_tracking"] = {
        OnStart = function( self, data )
            self:ImposterSetPhase( IMPOSTER_PHASE_TRACKING )
            self.RunSpeed = TRACK_RUN_SPEED or self.ImposterNormalRun or self.RunSpeed

            local lead, leadPos = self:ImposterPickTrackLead()
            self.ImposterTrackTarget = lead
            data.GoalPos      = leadPos
            data.AbandonAt    = CurTime() + TRACK_TIMEOUT
            data.SweepQueue   = nil   -- populated lazily on first arrival
            data.SightingIdx  = nil   -- index into ImposterSightings for fallback patrol

            -- After a teleport blink we effectively start fresh near the target:
            -- reset the abandon clock so the blink travel time isn't counted.
            if self.ImposterTeleportJustLanded then
                self.ImposterTeleportJustLanded = nil
                data.AbandonAt = CurTime() + TRACK_TIMEOUT
            end

            if IsValid( lead ) then
                imposterDbg( self, "TRACKING %s toward %s (score %.0f)",
                    imposterEntName( lead ), tostring( leadPos ),
                    self:ImposterScoreProfile( lead ) )
            end
        end,
        BehaveUpdateMotion = function( self, data )
            local lead = self.ImposterTrackTarget

            local function backToRoam( reason )
                self.ImposterTrackTarget = nil
                self.ImposterNextTrack   = CurTime() + TRACK_RETRY_DELAY  -- don't re-enter instantly
                self:TaskComplete( "movement_tracking" )
                self:StartTask( "movement_roam", reason )
            end

            -- Lead died/vanished or we gave it too long → give up.
            if not IsValid( lead ) or targetIsLost( lead ) or CurTime() >= data.AbandonAt then
                backToRoam( "track lead gone - back to roaming" )
                return
            end

            -- While tracking, anyone we can SEE (the lead or someone new and juicier)
            -- promotes straight to a stalk. The grudge picker chooses among the visible.
            -- Rate-limited: the picker LOS-traces every candidate, no need per tick.
            if CurTime() >= ( data.NextSee or 0 ) then
                data.NextSee = CurTime() + 0.25
                local seen = imposterPickTarget( self )
                if IsValid( seen ) then
                    self.ImposterTrackTarget = nil
                    self:ImposterBeginTracking( seen )
                    imposterDbg( self, "re-acquired %s while tracking - stalking", imposterEntName( seen ) )
                    self:TaskComplete( "movement_tracking" )
                    self:StartTask( "movement_stalk", "track re-acquired - stalking" )
                    return
                end
            end

            -- If we can directly see the lead but the grudge picker didn't return them
            -- (e.g. out of DETECT_RANGE), refresh the goal to their live position.
            local p = self.ImposterProfiles and self.ImposterProfiles[ lead ]
            if p then data.GoalPos = p.lastSeenPos end

            -- Scent: if their fading trail passes near us, follow it FORWARD along the
            -- route they took rather than beelining to one stale spot. Overrides the
            -- last-seen goal and resets the sweep, since we have a live lead to chase.
            if IMPOSTER_CFG.cv.scent_en:GetBool() then
                local scent = self:ImposterSniffTrail( lead )
                if scent then
                    data.GoalPos    = scent
                    data.SweepQueue = nil
                    if CurTime() >= ( data.NextScentDbg or 0 ) then
                        data.NextScentDbg = CurTime() + 2
                        imposterDbg( self, "on the scent of %s - following trail", imposterEntName( lead ) )
                    end
                end
            end

            -- Too far to bother chasing on foot → blink to them. Stand, vanish, and
            -- materialize near the lead (movement_teleport), then resume the track.
            if IMPOSTER_CFG.cv.teleport_en:GetBool()
                and data.GoalPos and CurTime() >= ( self.ImposterTeleportCD or 0 )
                and self:GetPos():Distance( data.GoalPos ) > TRACK_TELEPORT_DIST then
                local spot = imposterPickTeleportSpot( self, data.GoalPos, lead )
                if spot then
                    self.ImposterTeleportDest = spot
                    self:TaskComplete( "movement_tracking" )
                    self:TakeAction( "teleport" )
                    return
                end
            end

            -- Reached the goal but target not found: work through all adjacent areas
            -- one at a time (multi-sweep), then fall back to remembered sighting
            -- positions before giving up. (Extracted to a method to keep DoCustomTasks
            -- under the per-function upvalue limit.)
            if not self:ImposterTrackArrival( data, lead, p ) then
                backToRoam( "trail cold - back to roaming" )
                return
            end

            if data.GoalPos and self:primaryPathInvalidOrOutdated( data.GoalPos ) then
                self:InvalidatePath( "new tracking path" )
                self:SetupPathShell( data.GoalPos )
            end
            if self:primaryPathIsValid() then
                self:ControlPath2( true )
            end
        end,
        -- A purposeful pursuit: jog, don't slow-walk.
        ShouldWalk = function( self, data ) return false end,
        ShouldRun  = function( self, data ) return true end,
    }

    -- TELEPORT: the Mario-64 blink. Three stages: wind up standing still, vanish at
    -- the origin and snap to the destination while invisible, then materialize and
    -- reactivate (hand back to tracking). It holds completely still the whole time.
    defaultTasks["movement_teleport"] = {
        OnStart = function( self, data )
            self:ImposterSetPhase( IMPOSTER_PHASE_TELEPORT )
            self:InvalidatePath( "teleport - standing still" )

            data.stage      = "windup"
            data.stageUntil = CurTime() + TP_WINDUP_TIME
            data.dest       = self.ImposterTeleportDest

            -- Face the destination as a tell, then charge up in place.
            if data.dest then
                local dir = data.dest - self:GetPos()
                dir.z = 0
                if dir:LengthSqr() > 1 then self:SetAngles( dir:Angle() ) end
            end
            self:EmitSound( "ambient/levels/labs/teleport_pre_charge1.wav", 75, 100, 0.7 )
        end,
        BehaveUpdateMotion = function( self, data )
            local now = CurTime()

            -- 1) WINDUP: stand still and charge. At the end, vanish and snap to the dest.
            if data.stage == "windup" then
                if now >= data.stageUntil then
                    imposterBlinkFx( self:WorldSpaceCenter() )
                    self:EmitSound( "ambient/machines/teleport4.wav", 80, 100 )
                    self:SetNoDraw( true )

                    local dest = data.dest or self:GetPos()
                    self:SetPos( dest + Vector( 0, 0, 5 ) )
                    if self.loco and self.loco.ClearStuck then self.loco:ClearStuck() end
                    self:InvalidatePath( "teleported" )

                    data.stage      = "gone"
                    data.stageUntil = now + TP_GONE_TIME
                end
                return
            end

            -- 2) GONE: fully invisible at the destination for a beat.
            if data.stage == "gone" then
                if now >= data.stageUntil then
                    self:SetNoDraw( false )
                    self:SetModelScale( 0.6, 0 )  -- pop in from small → full during materialize
                    imposterBlinkFx( self:WorldSpaceCenter() )
                    self:EmitSound( "ambient/machines/teleport3.wav", 80, 100 )

                    data.stage      = "materialize"
                    data.stageUntil = now + TP_MATERIALIZE_TIME
                end
                return
            end

            -- 3) MATERIALIZE: lock in (scale up), then reactivate back into tracking.
            local frac = math.Clamp( 1 - ( data.stageUntil - now ) / TP_MATERIALIZE_TIME, 0, 1 )
            self:SetModelScale( Lerp( frac, 0.6, 1 ), 0 )

            if now >= data.stageUntil then
                self:SetModelScale( 1, 0 )
                self.ImposterTeleportDest      = nil
                self.ImposterTeleportCD        = now + TRACK_TELEPORT_CD
                self.ImposterTeleportJustLanded = true   -- tracking will reset its timeout
                self:TaskComplete( "movement_teleport" )
                self:StartTask( "movement_tracking", "teleport complete - reactivating" )
            end
        end,
        -- Dead still for the entire blink.
        ShouldWalk = function( self, data ) return false end,
        ShouldRun  = function( self, data ) return false end,
    }

    -- FLEE: if the imposter is attacked before committing to a kill, it smokes,
    -- cloaks, and sprints away instead of standing there like a normal brawler.
    defaultTasks["movement_flee"] = {
        OnStart = function( self, data )
            self:ImposterSetPhase( IMPOSTER_PHASE_FLEE )
            self:ImposterSetFleeCloak( true )
            data.NextRepath = 0
            data.GoalPos = nil
            data.FleeUntil = self.ImposterFleeUntil or ( CurTime() + FLEE_DURATION )
        end,
        BehaveUpdateMotion = function( self, data )
            local now = CurTime()
            if now >= ( self.ImposterFleeUntil or data.FleeUntil or now ) then
                local threat = self.ImposterFleeThreat  -- save before StopFlee clears it
                self:ImposterStopFlee()
                self:TaskComplete( "movement_flee" )

                local cdOk   = not self.ImposterPlayDeadCooldown or now >= self.ImposterPlayDeadCooldown
                local watched = imposterWatchedByPlayer( self )

                if not self.ImposterEnraged and cdOk
                    and imposterHostilesNearby( self, PLAYDEAD_HOSTILE_RANGE ) then
                    -- Flee is over — drop to a ragdoll near the attacker to bait an investigation.
                    -- No "not watched" check here: a chasing player always has eyes on the imposter,
                    -- so that gate would permanently block this. The surprise still works even if seen.
                    self:TakeAction( "playdead" )
                elseif not watched and IsValid( threat ) and not targetIsLost( threat ) then
                    -- Out of sight and the threat is still alive: shadow them back.
                    self:ImposterBeginTracking( threat )
                    self:StartTask( "movement_stalk", "flee complete - stalking attacker" )
                else
                    self:StartTask( "movement_roam", "flee complete" )
                end
                return
            end

            -- Re-pick a flee destination on a timer or when we've arrived.
            if now >= ( data.NextRepath or 0 )
                or not data.GoalPos
                or self:GetPos():Distance( data.GoalPos ) < WANDER_ARRIVE_DIST then
                data.NextRepath = now + FLEE_REPATH_TIME
                data.GoalPos = imposterPickFleeGoal( self, self.ImposterFleeThreat )
            end

            -- Always keep the path to the current goal valid (like roam/hunt do),
            -- so a stale or failed path doesn't leave the bot standing in place.
            if data.GoalPos then
                if self:primaryPathInvalidOrOutdated( data.GoalPos ) then
                    self:InvalidatePath( "new flee path" )
                    self:SetupPathShell( data.GoalPos )
                end
                if self:primaryPathIsValid() then
                    self:ControlPath2( true )
                end
            end
        end,
        ShouldWalk = function( self, data ) return false end,
        ShouldRun  = function( self, data ) return true end,
    }

    -- STALK: shadow the target, hanging back at STALK_FOLLOW_DIST. Bails back to
    -- roaming if the target dies, gets too far, or the stalk goes stale. (The
    -- isolation check that escalates to HUNT is added in the next step.)
    defaultTasks["movement_stalk"] = {
        OnStart = function( self, data )
            self:ImposterSetPhase( IMPOSTER_PHASE_STALK )
            self.RunSpeed     = self.ImposterNormalRun or self.RunSpeed  -- undo any disguise jog
            data.StaleAt      = CurTime() + STALK_STALE_TIME
            data.NextIsoCheck = 0
            data.NextPresence = CurTime() + math.Rand( STALK_PRESENCE_MIN, STALK_PRESENCE_MAX )
            data.LastStalkTick = CurTime()
            data.GoalPos      = nil
        end,
        -- Isolation/exposure check (the LOS raycast loop): rate-limited, and when
        -- the mark is close, isolated, and looking away, we commit to the ambush.
        BehaveUpdatePriority = function( self, data )
            if CurTime() < data.NextIsoCheck then return end
            data.NextIsoCheck = CurTime() + 0.33

            local target = self.ImposterTarget
            if not IsValid( target ) then return end
            if self.ImposterHuntUntil and CurTime() < self.ImposterHuntUntil then return end  -- hunt on cooldown
            if not imposterCanSee( self, target ) then return end  -- only strike what it can see
            if self:GetRangeTo( target ) > STALK_COMMIT_DIST then return end
            if not isTargetIsolated( self, target ) then return end
            if not targetLookingAway( self, target ) then return end

            self:TaskComplete( "movement_stalk" )
            self:StartTask( "movement_hunt", "mark is isolated and not looking - strike" )
        end,
        BehaveUpdateMotion = function( self, data )
            local target   = self.ImposterTarget
            local knownPos = self:ImposterKnownTargetPos()  -- only refreshes while it can see them

            -- Give up if the mark died, we lost sight of them too long, they got too
            -- far, or the stalk went stale. If they merely slipped away (still alive),
            -- log the loss and switch to TRACKING to hunt their trail rather than
            -- shrugging it off back to an aimless roam.
            if targetIsLost( target )
                or not knownPos
                or self:ImposterLostTarget()
                or self:GetPos():Distance( knownPos ) > STALK_MAX_DIST
                or CurTime() >= data.StaleAt then
                local lostMark = target
                self.ImposterTarget = nil
                self:TaskFail( "movement_stalk" )
                if not targetIsLost( lostMark ) and cv_tracking_en:GetBool() then
                    self:ImposterNoteLost( lostMark )
                    self:StartTask( "movement_tracking", "lost my mark - tracking the trail" )
                else
                    self:StartTask( "movement_roam", "mark is dead/gone - back to roaming" )
                end
                return
            end

            -- Accrue stalk investment on this mark (a heavier grudge → re-prioritized
            -- later). Clamp the per-tick delta so a hitch can't inflate it.
            local p = self:ImposterProfile( target )
            if p then
                p.stalkTime = ( p.stalkTime or 0 ) + math.min( CurTime() - ( data.LastStalkTick or CurTime() ), 0.5 )
            end
            data.LastStalkTick = CurTime()

            -- Ambient "presence": a phantom footstep/creak from a random point AROUND
            -- the mark (not our real position), so they feel watched before they can
            -- place where the thing is. Fires even while frozen below.
            if CurTime() >= ( data.NextPresence or 0 ) then
                data.NextPresence = CurTime() + math.Rand( STALK_PRESENCE_MIN, STALK_PRESENCE_MAX )
                local a   = math.Rand( 0, 2 * math.pi )
                local pos = target:WorldSpaceCenter()
                    + Vector( math.cos( a ), math.sin( a ), 0 ) * STALK_PRESENCE_DIST
                local snd = STALK_PRESENCE_SOUNDS[ math.random( #STALK_PRESENCE_SOUNDS ) ]
                sound.Play( snd, pos, 60, math.random( 85, 100 ), 0.6 )
            end

            -- Always face the target while stalking.
            self:SetEyeTarget( target:WorldSpaceCenter() )

            -- Weeping Angel: freeze when any player looks directly at us (with a
            -- patience-snap lunge after STARE_BREAK_TIME), OR when the stalk target
            -- itself turns to face us — freeze only, no lunge, since NPCs don't have
            -- the same "staring contest" dynamic as human players.
            local watched        = imposterWatchedByPlayer( self )
            local targetFacingUs = not targetLookingAway( self, target )

            if watched or targetFacingUs then
                data.WasWatched = true

                if watched then
                    -- Count stare time only while a human player is actively watching.
                    data.StaredSince = data.StaredSince or CurTime()
                    if CurTime() - data.StaredSince >= STARE_BREAK_TIME then
                        -- Patience snapped — jumpscare, speed boost, commit to hunt
                        local _s = IMPOSTER_CFG.snd.ambush; self:EmitSound( _s[ math.random( #_s ) ], 90, 100, 1 )
                        self:TaskComplete( "movement_stalk" )
                        self:StartTask( "movement_hunt", "stared too long - snapping" )
                        timer.Simple( 0, function()
                            if not IsValid( self ) then return end
                            self.RunSpeed = ( self.ImposterNormalRun or self.RunSpeed ) * LUNGE_SPEED_MULT
                            timer.Simple( LUNGE_DURATION, function()
                                if not IsValid( self ) then return end
                                if self.ImposterDisguised then
                                    self:ImposterApplyDisguiseMovement()
                                else
                                    self.RunSpeed = self.ImposterNormalRun or self.RunSpeed
                                end
                            end )
                        end )
                    end
                else
                    -- Target facing us but no player watching: freeze, reset stare timer.
                    data.StaredSince = nil
                end
                return
            end
            if data.WasWatched then
                data.WasWatched  = false
                data.StaredSince = nil
                self:EmitSound( "physics/body/body_medium_impact_soft1.wav", 50, math.random( 70, 90 ), 0.35 )
            end

            -- Creep toward where we last saw them when farther than our follow dist.
            if self:GetPos():Distance( knownPos ) > STALK_FOLLOW_DIST then
                data.GoalPos = knownPos

                if self:primaryPathInvalidOrOutdated( data.GoalPos ) then
                    self:InvalidatePath( "new stalk path" )
                    self:SetupPathShell( data.GoalPos )
                end

                if self:primaryPathIsValid() then
                    self:ControlPath2( true )
                end
            end
        end,
        ShouldWalk = function( self, data ) return true end,
        ShouldRun  = function( self, data )
            -- Break into a jog only if the mark is pulling away, so we don't lose them.
            local target = self.ImposterTarget
            return IsValid( target )
                and self:GetRangeTo( target ) > STALK_FOLLOW_DIST * 2
                and self:canDoRun()
        end,
    }

    -- HUNT: a committed sprint straight at the victim. On reaching melee range it
    -- fires ImposterReachVictim (the kill seam). Bails back to roam if the victim
    -- dies, gets too far, or the hunt drags on past HUNT_TIMEOUT.
    defaultTasks["movement_hunt"] = {
        OnStart = function( self, data )
            self:ImposterSetPhase( IMPOSTER_PHASE_HUNT )
            -- Drop any disguise and abort ghost-cloak so the lunge emerges without
            -- warning — what looked like a bystander suddenly sprints at the target.
            if self.ImposterDisguised then
                self:ImposterDropDisguise()
            end
            if not self.ImposterFleeCloaked and self.ImposterCloakUntil
                and CurTime() < self.ImposterCloakUntil then
                self:ImposterEndGhostCloak()
                self.ImposterCloakUntil = nil
            end
            self.RunSpeed   = self.ImposterNormalRun or self.RunSpeed  -- full sprint for the ambush
            data.GoalPos    = nil
            data.AbandonAt  = CurTime() + HUNT_TIMEOUT
            self.ImposterHuntDamage = 0  -- reset the break-off-and-flee damage counter
        end,
        BehaveUpdateMotion = function( self, data )
            local target   = self.ImposterTarget
            local knownPos = self:ImposterKnownTargetPos()

            -- Couldn't catch them in time → give up, with a cooldown before the next
            -- attempt, and retreat (flee in true form, or blend back in if disguised).
            if not targetIsLost( target ) and knownPos and CurTime() >= data.AbandonAt then
                local fleeFrom = target
                self.ImposterTarget    = nil
                self.ImposterHuntUntil = CurTime() + HUNT_COOLDOWN
                self:TaskFail( "movement_hunt" )
                if not self:ImposterStartFlee( fleeFrom ) then
                    self:StartTask( self.ImposterDisguised and "movement_disguised" or "movement_roam",
                        "couldn't catch them - backing off" )
                end
                return
            end

            -- Target gone, lost for good, or its trail led too far → back off. If they
            -- got away alive in true form, track the trail; disguised, blend back in.
            if targetIsLost( target ) or not knownPos or self:ImposterLostTarget()
                or self:GetPos():Distance( knownPos ) > STALK_MAX_DIST then
                local lostMark = target
                self.ImposterTarget = nil
                self:TaskFail( "movement_hunt" )
                if not targetIsLost( lostMark ) and not self.ImposterDisguised and cv_tracking_en:GetBool() then
                    self:ImposterNoteLost( lostMark )
                    self:StartTask( "movement_tracking", "lost the kill - tracking the trail" )
                else
                    self:StartTask( self.ImposterDisguised and "movement_disguised" or "movement_roam",
                        "lost the kill" )
                end
                return
            end

            -- Actually next to them — hand off to the kill seam.
            if self:GetRangeTo( target ) <= HUNT_MELEE_RANGE then
                self:ImposterReachVictim( target )
                return
            end

            -- If we've arrived at the last known position but the target broke LOS,
            -- peek into an adjacent nav area rather than standing still waiting for
            -- TARGET_LOST_TIME to fire. The existing timer still acts as the final
            -- give-up; this just makes the search feel active.
            local canSeeTarget = imposterCanSee( self, target )
            if canSeeTarget then
                data.SearchGoal = nil  -- re-acquired: clear any pending sweep waypoint
            elseif self:GetPos():Distance( knownPos ) < WANDER_ARRIVE_DIST * 2 then
                if not data.SearchGoal or self:GetPos():Distance( data.SearchGoal ) < WANDER_ARRIVE_DIST then
                    local near = navmesh.GetNearestNavArea( knownPos )
                    if IsValid( near ) then
                        local adj = near:GetAdjacentAreas()
                        data.SearchGoal = ( adj and #adj > 0 )
                            and adj[ math.random( #adj ) ]:GetRandomPoint()
                            or  near:GetRandomPoint()
                    end
                end
            end

            -- Sprint to the sweep waypoint while searching, otherwise the last known pos.
            data.GoalPos = ( not canSeeTarget and data.SearchGoal ) and data.SearchGoal or knownPos
            if self:primaryPathInvalidOrOutdated( data.GoalPos ) then
                self:InvalidatePath( "new hunt path" )
                self:SetupPathShell( data.GoalPos )
            end
            if self:primaryPathIsValid() then
                self:ControlPath2( true )
            end
        end,
        -- The ambush is a flat-out sprint.
        ShouldWalk = function( self, data ) return false end,
        ShouldRun  = function( self, data ) return true end,
    }

    -- KILLSTRIKE (no-grab mode): close-range striking until the target dies, then instant
    -- absorb. The snapshot is taken before the first hit so identity is captured while the
    -- victim is still alive. No held body — the target dies normally and leaves a ragdoll
    -- which is cleaned up for players.
    defaultTasks["movement_killstrike"] = {
        OnStart = function( self, data )
            self:ImposterSetPhase( IMPOSTER_PHASE_EXECUTE )
            self.ImposterKillStrikeDamage = 0
            data.NextHit   = 0
            data.AbandonAt = CurTime() + HUNT_TIMEOUT
            -- Snapshot identity now while the victim is alive and queryable.
            local target = self.ImposterTarget
            if IsValid( target ) then
                self:ImposterSnapshotVictim( target )
            end
        end,
        BehaveUpdateMotion = function( self, data )
            local target = self.ImposterTarget

            -- Target died — absorb them using the pre-death snapshot.
            if targetIsLost( target ) then
                self.ImposterKillStrikeDamage = nil
                self:TaskComplete( "movement_killstrike" )

                -- Dissolve the death ragdoll. Players use GetRagdollEntity(); NPC/Lambda
                -- ragdolls don't have that, so we find them by proximity to the death spot.
                if IsValid( target ) then
                    if target:IsPlayer() then
                        timer.Simple( 0.05, function()
                            if not IsValid( target ) or not target.GetRagdollEntity then return end
                            self:ImposterDissolveRagdoll( target:GetRagdollEntity() )
                        end )
                    else
                        local deathPos = target:GetPos()
                        timer.Simple( 0.15, function()
                            self:ImposterDissolveNearbyRagdoll( deathPos )
                        end )
                    end
                end

                local disguised = self:ImposterFinishDisguise()
                self:StartTask( disguised and "movement_disguised" or "movement_roam",
                    disguised and "killstrike absorbed - disguised" or "killstrike absorbed - form unusable" )
                return
            end

            -- Timed out — give up.
            if CurTime() >= data.AbandonAt then
                self.ImposterKillStrikeDamage = nil
                self.ImposterSnapshot = nil
                self.ImposterTarget   = nil
                self:TaskFail( "movement_killstrike" )
                self:StartTask( "movement_roam", "killstrike timed out" )
                return
            end

            -- In melee range: strike.
            if self:GetRangeTo( target ) <= HUNT_MELEE_RANGE then
                if CurTime() >= data.NextHit then
                    data.NextHit = CurTime() + KILLSTRIKE_INTERVAL
                    self:ImposterEnrageStrike( target, KILLSTRIKE_DAMAGE )
                end
            else
                -- Chase.
                local knownPos = self:ImposterKnownTargetPos()
                if knownPos then
                    if self:primaryPathInvalidOrOutdated( knownPos ) then
                        self:InvalidatePath( "killstrike chase" )
                        self:SetupPathShell( knownPos )
                    end
                    if self:primaryPathIsValid() then self:ControlPath2( true ) end
                end
            end
        end,
        ShouldWalk = function( self, data ) return false end,
        ShouldRun  = function( self, data ) return true end,
    }

    -- EXECUTE: the grab → hold → absorb sequence. Both parties are pinned; the
    -- victim is lifted in front of the imposter, drained, then ImposterAbsorbInto
    -- swaps the imposter into them and leaves a corpse.
    defaultTasks["movement_execute"] = {
        OnStart = function( self, data )
            self:ImposterSetPhase( IMPOSTER_PHASE_EXECUTE )

            local victim = self.ImposterTarget
            if not IsValid( victim ) then return end  -- motion update will abort

            -- Face the victim (horizontal only).
            local dir = victim:GetPos() - self:GetPos()
            dir.z = 0
            if dir:LengthSqr() > 0 then self:SetAngles( dir:Angle() ) end

            -- Lambda Players skip the whole grab/carry/hold sequence: dissolve them on the
            -- spot and disguise immediately (no held clone, no duplicate ragdoll).
            if victim.IsLambdaPlayer then
                local disguised = self:ImposterAbsorbLambdaInstant( victim )
                self.ImposterTarget = nil
                self:TaskComplete( "movement_execute" )
                self:StartTask( disguised and "movement_disguised" or "movement_roam",
                    disguised and "absorbed lambda - now one of them" or "absorbed lambda - form unusable" )
                return
            end

            -- Snapshot identity, spawn the held ragdoll, and hide the original.
            data.ragdoll = self:ImposterBeginAbsorb( victim )

            -- Don't punch/attack while hauling someone off.
            self.PreventShooting = true

            -- Start dragging immediately (no standing-around-in-place). Stage machine:
            -- carry (drag to a hidden spot) -> drain (transform). If there's nowhere
            -- private, drain where we stand.
            data.absorbSound = false
            data.carrySpot   = imposterFindSecludedSpot( self )
            if data.carrySpot then
                data.stage      = "carry"
                data.carryUntil = CurTime() + EXEC_CARRY_MAX
            else
                data.stage      = "drain"
                data.stageUntil = CurTime() + EXEC_ABSORB_TIME
            end

            local _s = IMPOSTER_CFG.snd.enrage_hit; self:EmitSound( _s[ math.random( #_s ) ], 80, 95 )
        end,
        BehaveUpdateMotion = function( self, data )
            -- Keep the body in hand the whole time (works while moving too).
            if not self:MaintainImposterGrabTarget() then
                self:ImposterAbortExecute()
                return
            end

            local now = CurTime()

            -- 1) CARRY: drag the body off to the secluded spot (or give up on timeout).
            if data.stage == "carry" then
                local spot = data.carrySpot
                if not spot or self:GetPos():Distance( spot ) < EXEC_CARRY_ARRIVE or now >= data.carryUntil then
                    data.stage      = "drain"
                    data.stageUntil = now + EXEC_ABSORB_TIME
                    return
                end
                if self:primaryPathInvalidOrOutdated( spot ) then
                    self:InvalidatePath( "carry path" )
                    self:SetupPathShell( spot )
                end
                if self:primaryPathIsValid() then self:ControlPath2( true ) end
                return
            end

            -- 3) DRAIN: stand and drain, cold colour-shift, then transform.
            local af = math.Clamp( 1 - ( data.stageUntil - now ) / EXEC_ABSORB_TIME, 0, 1 )
            self:SetColor( Color(
                math.floor( Lerp( af, 255, 140 ) ),
                math.floor( Lerp( af, 255, 150 ) ),
                255 ) )
            data.absorbSound = true  -- flag kept so logic reads cleanly; sound removed

            if now >= data.stageUntil then
                self.PreventShooting = nil
                self:ConsumeImposterGrabTarget()
                local disguised = self:ImposterFinishDisguise()
                self:TaskComplete( "movement_execute" )
                if disguised then
                    self:StartTask( "movement_disguised", "absorbed - now one of them" )
                else
                    -- Couldn't wear that form (e.g. a non-humanoid NPC): consumed it but
                    -- stay in true form and go back to hunting.
                    self:StartTask( "movement_roam", "absorbed but form unusable - staying true" )
                end
            end
        end,
        -- Sprint while carrying the body; otherwise stand/lift in place.
        ShouldWalk = function( self, data ) return data.stage ~= "carry" end,
        ShouldRun  = function( self, data ) return data.stage == "carry" end,
    }

    -- DISGUISED: blend in by wandering as the victim, then after a while pick a new
    -- mark and slip back into the hunt (still wearing this disguise until the next
    -- absorb). Reveal-on-damage and the deception tells come in later steps.
    defaultTasks["movement_disguised"] = {
        OnStart = function( self, data )
            self:ImposterSetPhase( IMPOSTER_PHASE_DISGUISED )
            self:ImposterApplyDisguiseMovement()  -- jog (player disguise) / slow walk (NPC disguise)
            data.GoalPos  = nil
            -- Restless blends in for far less time before slipping back into the hunt.
            local blendMul = self:ImposterIsRestless() and 0.4 or 1
            data.RehuntAt  = CurTime() + math.Rand( DISGUISE_BLEND_MIN, DISGUISE_BLEND_MAX ) * blendMul
        end,
        BehaveUpdateMotion = function( self, data )
            -- After blending in, look for the next victim. Committing to the hunt means
            -- shedding the disguise — it stalks/strikes as the true form, not in costume.
            if CurTime() >= data.RehuntAt then
                local target = imposterPickTarget( self )
                if IsValid( target ) then
                    self:ImposterDropDisguise()
                    self:ImposterBeginTracking( target )
                    self:TaskComplete( "movement_disguised" )
                    self:StartTask( "movement_stalk", "done blending - dropping cover to hunt" )
                    return
                end
                data.RehuntAt = CurTime() + math.Rand( 8, 15 )
            end

            -- Wander the map like a normal survivor exploring — pick a new broad goal
            -- the moment the current one is reached so there's no standing-still gap.
            local myPos = self:GetPos()
            if not data.GoalPos or myPos:Distance( data.GoalPos ) < WANDER_ARRIVE_DIST then
                local goal = imposterPickRoamGoal( self )
                if goal then data.GoalPos = goal end
            end

            if data.GoalPos and self:primaryPathInvalidOrOutdated( data.GoalPos ) then
                self:InvalidatePath( "new disguised path" )
                self:SetupPathShell( data.GoalPos )
            end

            if self:primaryPathIsValid() then
                self:ControlPath2( true )
            end
        end,
        -- SEPARATE per disguise: a player jogs (ShouldRun → base run/move weapon pose at
        -- DISGUISE_JOG_SPEED, reads like a real survivor); an NPC ambles (ShouldWalk → NPC
        -- walk anim at DISGUISE_NPC_WALK).
        ShouldWalk = function( self, data ) return not ( self.ImposterDisguiseIsPlayer == true ) end,
        ShouldRun  = function( self, data ) return self.ImposterDisguiseIsPlayer == true end,
    }

    -- ENRAGE: exposed and lethal. Sprint to the nearest living thing and strike it
    -- on repeat, re-targeting when one dies. Never disguises again. Prowls if there's
    -- nobody left.
    defaultTasks["movement_enrage"] = {
        OnStart = function( self, data )
            self:ImposterSetPhase( IMPOSTER_PHASE_ENRAGE )
            data.NextHit = 0
            data.GoalPos = nil
            if targetIsLost( self.ImposterTarget ) then
                self.ImposterTarget = imposterPickNearest( self )
            end
        end,
        BehaveUpdateMotion = function( self, data )
            -- Enrage burns out — calm back down to roaming.
            if self.ImposterEnrageUntil and CurTime() >= self.ImposterEnrageUntil then
                self:ImposterCalmDown()
                return
            end

            local target = self.ImposterTarget
            if targetIsLost( target ) then
                self.ImposterTarget = imposterPickNearest( self )
                target = self.ImposterTarget
            end

            -- Nobody left to kill — prowl.
            if not IsValid( target ) then
                local myPos = self:GetPos()
                if not data.GoalPos
                    or myPos:Distance( data.GoalPos ) < WANDER_ARRIVE_DIST
                    or CurTime() >= ( data.NextWanderGoal or 0 ) then
                    data.NextWanderGoal = CurTime() + math.Rand( 3, 6 )
                    local goal = imposterPickWanderGoal( self )
                    if goal then data.GoalPos = goal end
                end
                if data.GoalPos and self:primaryPathInvalidOrOutdated( data.GoalPos ) then
                    self:InvalidatePath( "enrage prowl" )
                    self:SetupPathShell( data.GoalPos )
                end
                if self:primaryPathIsValid() then self:ControlPath2( true ) end
                return
            end

            -- In reach: keep striking. Otherwise sprint at them.
            -- Restless swings faster; base pacing preserved for the patient form.
            if self:GetRangeTo( target ) <= ENRAGE_MELEE_RANGE then
                if CurTime() >= data.NextHit then
                    data.NextHit = CurTime() + ( self:ImposterIsRestless() and 0.35 or ENRAGE_HIT_COOLDOWN )
                    self:ImposterEnrageStrike( target )
                end
            else
                data.GoalPos = target:GetPos()
                if self:primaryPathInvalidOrOutdated( data.GoalPos ) then
                    self:InvalidatePath( "enrage chase" )
                    self:SetupPathShell( data.GoalPos )
                end
                if self:primaryPathIsValid() then self:ControlPath2( true ) end
            end
        end,
        ShouldWalk = function( self, data ) return false end,
        ShouldRun  = function( self, data ) return true end,
    }
end
