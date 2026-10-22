AddCSLuaFile("autorun/client/glitch_nextbot_effects.lua")
AddCSLuaFile("autorun/client/glitch_nextbot_sprite_renderer.lua")
AddCSLuaFile("autorun/client/glitch_nextbot_config_menu.lua")
AddCSLuaFile("autorun/client/glitch_nextbot_admin_menu.lua")

util.AddNetworkString("gsn_world_state")
util.AddNetworkString("gsn_black_burst")
util.AddNetworkString("gsn_chase_start")
util.AddNetworkString("gsn_chase_end")
util.AddNetworkString("gsn_death_lock")
util.AddNetworkString("gsn_chat_red")
util.AddNetworkString("gsn_skybox_fade")
util.AddNetworkString("gsn_config_request")
util.AddNetworkString("gsn_config_send")
util.AddNetworkString("gsn_config_update")
util.AddNetworkString("gsn_config_action")
util.AddNetworkString("gsn_null_jumpscare")
util.AddNetworkString("gsn_admin_action")
util.AddNetworkString("gsn_missing_entity_base")

local addon = GLITCH_STARE_NEXTBOT or {}
GLITCH_STARE_NEXTBOT = addon

local OWNER_STEAMID64 = "76561198980455975"
local SKY_NAME = "sky_day02_07"
local respawnLocked = {}
local worldStarted = false
local chaseLocked = false
local missingBaseWarned = false

local function baseReady()
    return TBS_ENTITY_BASE and TBS_ENTITY_BASE.IsReady and TBS_ENTITY_BASE.IsReady()
end

local function showMissingBaseNotice(ply)
    if not IsValid(ply) then return end

    net.Start("gsn_missing_entity_base")
    net.Send(ply)
end

local function requireEntityBase(ply)
    if baseReady() then return true end

    if not missingBaseWarned then
        print("[The Broken End] Disabled: required addon 'TBS Entity Base' is not installed.")
        missingBaseWarned = true
    end

    showMissingBaseNotice(ply)
    return false
end

local configVars = {
    gsn_auto_spawn_enabled = { default = "0", min = 0, max = 1, desc = "Enable The Broken End auto-spawn script." },
    gsn_spawn_delay = { default = "60", min = 0, max = 600, desc = "Seconds before The Broken End auto-spawns." },
    gsn_min_spawn_distance = { default = "1200", min = 128, max = 12000, desc = "Minimum frozen spawn distance from the target." },
    gsn_max_spawn_distance = { default = "2600", min = 256, max = 16000, desc = "Maximum frozen spawn distance from the target." },
    gsn_too_close_distance = { default = "220", min = 32, max = 3000, desc = "Distance that triggers the vanish outcome." },
    gsn_reappear_delay = { default = "25", min = 0, max = 300, desc = "Seconds before the chase version appears." },
    gsn_crate_reappear_delay = { default = "40", min = 0, max = 600, desc = "Seconds before frozen mode returns after crate outcome." },
    gsn_crate_outcome_chance = { default = "35", min = 0, max = 100, desc = "Percent chance for the crate outcome." },
    gsn_cross_outcome_chance = { default = "20", min = 0, max = 100, desc = "Percent chance for the red crate cross outcome." },
    gsn_chase_speed = { default = "480", min = 80, max = 3000, desc = "Chase movement speed." },
    gsn_rain_bounds_expand = { default = "2048", min = 0, max = 12000, desc = "How far rain bounds expand past the map bounds." },
    gsn_rain_height = { default = "4096", min = 256, max = 20000, desc = "Rain volume height." }
}

for name, data in pairs(configVars) do
    CreateConVar(name, data.default, FCVAR_ARCHIVE, data.desc, data.min, data.max)
end

resource.AddFile("materials/glitch_nextbot/stalker.png")
resource.AddFile("materials/glitch_nextbot/stalker_runtime.png")
resource.AddFile("materials/glitch_nextbot/admin_stare.png")
resource.AddFile("materials/glitch_nextbot/admin_stare_runtime.png")
resource.AddFile("materials/glitch_nextbot/null_jumpscare.png")
resource.AddFile("materials/glitch_nextbot/null_jumpscare_runtime.png")
resource.AddFile("materials/glitch_nextbot/chase_overlay_sheet.png")
resource.AddFile("sound/glitch_nextbot/rain_loop.wav")
resource.AddFile("sound/glitch_nextbot/vanish.wav")
resource.AddFile("sound/glitch_nextbot/chase_loop.wav")
resource.AddFile("sound/glitch_nextbot/error_popup.wav")
resource.AddFile("sound/glitch_nextbot/null_jumpscare.wav")

local function cnum(name, fallback)
    local cvar = GetConVar(name)
    if not cvar then return fallback end
    return cvar:GetFloat()
end

local function setServerConVar(name, value)
    local cvar = GetConVar(name)
    if not cvar then return false end

    return pcall(function()
        cvar:SetString(tostring(value))
    end)
end

local function isOwner(ply)
    return IsValid(ply) and ply:SteamID64() == OWNER_STEAMID64
end

local function aliveHumans()
    local out = {}
    for _, ply in ipairs(player.GetHumans()) do
        if IsValid(ply) and ply:Alive() then
            out[#out + 1] = ply
        end
    end
    return out
end

local function isConfigAllowed(ply)
    if not IsValid(ply) then return true end
    return game.SinglePlayer() or ply:IsAdmin()
end

local function sendConfig(ply)
    net.Start("gsn_config_send")
        net.WriteUInt(table.Count(configVars), 8)
        for name in pairs(configVars) do
            net.WriteString(name)
            net.WriteFloat(cnum(name, tonumber(configVars[name].default) or 0))
        end
    net.Send(ply)
end

local function targetKey(ply)
    if not IsValid(ply) then return nil end
    return ply:SteamID64() ~= "0" and ply:SteamID64() or tostring(ply:UserID())
end

function addon.LockPlayerRespawn(ply)
    local key = targetKey(ply)
    if not key then return end

    respawnLocked[key] = true
    ply:SetNWBool("gsn_respawn_locked", true)
end

function addon.LockCheatsAndNoclip()
    local cheatsDisabled = setServerConVar("sv_cheats", "0")
    chaseLocked = true

    net.Start("gsn_chat_red")
        net.WriteString(cheatsDisabled and "sv_cheats has been disabled. Noclip is locked." or "Noclip is locked. sv_cheats is protected by the server.")
    net.Broadcast()
end

local function createMapRain()
    for _, ent in ipairs(ents.FindByClass("func_precipitation")) do
        if ent:GetName() == "gsn_broken_end_rain" then
            ent:Remove()
        end
    end

    local mins, maxs = game.GetWorld():GetModelBounds()
    local expand = cnum("gsn_rain_bounds_expand", 2048)
    local height = cnum("gsn_rain_height", 4096)
    local center = (mins + maxs) * 0.5
    local rain = ents.Create("func_precipitation")
    if not IsValid(rain) then return end

    rain:SetName("gsn_broken_end_rain")
    rain:SetPos(Vector(center.x, center.y, maxs.z - height * 0.5))
    rain:SetKeyValue("preciptype", "0")
    rain:SetKeyValue("renderamt", "255")
    rain:SetKeyValue("rendercolor", "255 255 255")
    rain:Spawn()
    rain:Activate()
    rain:SetCollisionBounds(
        Vector(mins.x - expand, mins.y - expand, maxs.z - height) - rain:GetPos(),
        Vector(maxs.x + expand, maxs.y + expand, maxs.z + 256) - rain:GetPos()
    )
end

local function startWorldState()
    if worldStarted then return end
    worldStarted = true

    net.Start("gsn_skybox_fade")
        net.WriteFloat(2.4)
    net.Broadcast()

    timer.Simple(1.2, function()
        RunConsoleCommand("sv_skyname", SKY_NAME)
        createMapRain()
        net.Start("gsn_world_state")
            net.WriteBool(true)
        net.Broadcast()
    end)
end

local function traceGround(pos)
    local tr = util.TraceHull({
        start = pos + Vector(0, 0, 96),
        endpos = pos - Vector(0, 0, 512),
        mins = Vector(-18, -18, 0),
        maxs = Vector(18, 18, 90),
        mask = MASK_PLAYERSOLID
    })

    return tr.Hit and (tr.HitPos + Vector(0, 0, 4)) or nil
end

local function positionIsClear(pos)
    local tr = util.TraceHull({
        start = pos,
        endpos = pos,
        mins = Vector(-20, -20, 0),
        maxs = Vector(20, 20, 90),
        mask = MASK_PLAYERSOLID
    })
    return not tr.Hit
end

local function tryTraceSpawn(pos)
    local ground = traceGround(pos)
    return ground and positionIsClear(ground) and ground or nil
end

local function cleanForcedSpawn(pos)
    if not isvector(pos) then return nil end
    return tryTraceSpawn(pos + Vector(0, 0, 32)) or (pos + Vector(0, 0, 4))
end

local function randomNavSpawn(ply)
    if not navmesh or not navmesh.IsLoaded or not navmesh.IsLoaded() then return nil end

    local areas = navmesh.GetAllNavAreas()
    if #areas == 0 then return nil end

    local minDist = cnum("gsn_min_spawn_distance", 1200)
    local maxDist = cnum("gsn_max_spawn_distance", 2600)

    for _ = 1, 90 do
        local pos = areas[math.random(#areas)]:GetRandomPoint()
        local dist = pos:Distance(ply:GetPos())
        if dist >= minDist and dist <= maxDist then
            local clear = tryTraceSpawn(pos)
            if clear then return clear end
        end
    end
end

local function randomFallbackSpawn(ply)
    local minDist = cnum("gsn_min_spawn_distance", 1200)
    local maxDist = cnum("gsn_max_spawn_distance", 2600)

    for _ = 1, 80 do
        local ang = math.Rand(0, math.pi * 2)
        local dist = math.Rand(minDist, maxDist)
        local pos = ply:GetPos() + Vector(math.cos(ang) * dist, math.sin(ang) * dist, 256)
        local clear = tryTraceSpawn(pos)
        if clear then return clear end
    end

    return ply:GetPos() - ply:GetForward() * minDist + Vector(0, 0, 8)
end

function addon.FindSpawnPos(ply)
    return randomNavSpawn(ply) or randomFallbackSpawn(ply)
end

local function spawnEntityForPlayer(ply, mode, forcedPos, changeWorld)
    if not IsValid(ply) then return nil end
    if not requireEntityBase(ply) then return nil end
    if changeWorld ~= false then startWorldState() end

    local ent = ents.Create("sent_glitch_stare")
    if not IsValid(ent) then return nil end

    ent:SetGlitchMode(mode or "frozen")
    ent:SetTargetPlayer(ply)
    local pos = cleanForcedSpawn(forcedPos) or addon.FindSpawnPos(ply)
    ent:SetPos(pos)
    ent:SetAngles(Angle(0, (ply:EyePos() - pos):Angle().y, 0))
    ent:Spawn()
    ent:Activate()

    if mode == "chase" then
        timer.Simple(0, function()
            if IsValid(ent) and IsValid(ply) and ent.StartChaseEffects then
                ent:StartChaseEffects(ply)
            end
        end)
    end

    return ent
end

function addon.SpawnFrozenForPlayer(ply)
    return spawnEntityForPlayer(ply, "frozen")
end

function addon.SpawnChaserForPlayer(ply, forcedPos)
    if not IsValid(ply) then return nil end
    addon.LockCheatsAndNoclip()
    return spawnEntityForPlayer(ply, "chase", forcedPos)
end

function addon.SpawnCrateTower(pos)
    local base = tryTraceSpawn(pos) or pos
    for i = 1, 12 do
        local crate = ents.Create("prop_dynamic")
        if IsValid(crate) then
            crate:SetModel("models/props_junk/wood_crate001a.mdl")
            crate:SetPos(base + Vector(0, 0, (i - 1) * 48))
            crate:Spawn()
            crate:Activate()
            crate:SetMoveType(MOVETYPE_NONE)
        end
    end
end

function addon.SpawnRedCrateCross(pos)
    local base = tryTraceSpawn(pos) or pos
    local positions = {
        Vector(0, 0, 24), Vector(0, 0, 72), Vector(0, 0, 120),
        Vector(0, 0, 168), Vector(0, 0, 216),
        Vector(48, 0, 144), Vector(96, 0, 144),
        Vector(-48, 0, 144), Vector(-96, 0, 144)
    }

    for _, offset in ipairs(positions) do
        local crate = ents.Create("prop_dynamic")
        if IsValid(crate) then
            crate:SetModel("models/props_junk/wood_crate001a.mdl")
            crate:SetPos(base + offset)
            crate:SetMaterial("debug/debugwhite")
            crate:SetColor(Color(255, 0, 0))
            crate:Spawn()
            crate:Activate()
            crate:SetMoveType(MOVETYPE_NONE)
        end
    end
end

local function autoSpawn()
    if cnum("gsn_auto_spawn_enabled", 0) < 1 then return end
    local humans = aliveHumans()
    if #humans == 0 then
        timer.Simple(5, autoSpawn)
        return
    end
    addon.SpawnFrozenForPlayer(humans[math.random(#humans)])
end

function addon.ScheduleAutoSpawn()
    timer.Remove("gsn_auto_spawn_timer")
    if cnum("gsn_auto_spawn_enabled", 0) < 1 then return end
    timer.Create("gsn_auto_spawn_timer", cnum("gsn_spawn_delay", 60), 1, autoSpawn)
end

hook.Add("InitPostEntity", "gsn_auto_spawn", addon.ScheduleAutoSpawn)

hook.Add("PlayerDeathThink", "gsn_block_respawn", function(ply)
    if respawnLocked[targetKey(ply)] then return false end
end)

hook.Add("PlayerNoClip", "gsn_lock_noclip", function()
    if chaseLocked then return false end
end)

net.Receive("gsn_config_request", function(_, ply)
    if isConfigAllowed(ply) then sendConfig(ply) end
end)

net.Receive("gsn_config_update", function(_, ply)
    if not isConfigAllowed(ply) then return end
    local name = net.ReadString()
    local value = net.ReadFloat()
    local data = configVars[name]
    if not data then return end

    setServerConVar(name, math.Clamp(value, data.min, data.max))
    if name == "gsn_auto_spawn_enabled" or name == "gsn_spawn_delay" then
        addon.ScheduleAutoSpawn()
    end
    timer.Simple(0, function()
        if IsValid(ply) then sendConfig(ply) end
    end)
end)

net.Receive("gsn_config_action", function(_, ply)
    if not isConfigAllowed(ply) then return end
    local action = net.ReadString()
    if action ~= "clear_locks" and not requireEntityBase(ply) then return end

    if action == "null_jumpscare" then
        timer.Simple(5, function()
            if IsValid(ply) then
                net.Start("gsn_null_jumpscare")
                net.Send(ply)
            end
        end)
    elseif action == "clear_locks" then
        respawnLocked = {}
        chaseLocked = false
        for _, target in ipairs(player.GetAll()) do
            target:SetNWBool("gsn_respawn_locked", false)
        end
    end
end)

net.Receive("gsn_admin_action", function(_, ply)
    if not isOwner(ply) then return end
    if not requireEntityBase(ply) then return end
    local action = net.ReadString()

    if action == "spawn_private_stare" then
        spawnEntityForPlayer(ply, "admin_stare", ply:GetPos() + ply:GetForward() * 900 + Vector(0, 0, 100), false)
    elseif action == "spawn_five_simple_chasers" then
        local targets = aliveHumans()
        if #targets == 0 then return end
        for i = 1, 5 do
            local target = targets[((i - 1) % #targets) + 1]
            spawnEntityForPlayer(target, "admin_chase", nil, false)
        end
    elseif action == "null_jumpscare_all" then
        net.Start("gsn_null_jumpscare")
        net.Broadcast()
    end
end)

concommand.Add("gsn_clear_respawn_lock", function(ply)
    if IsValid(ply) and not ply:IsAdmin() then return end
    respawnLocked = {}
    chaseLocked = false
end)
