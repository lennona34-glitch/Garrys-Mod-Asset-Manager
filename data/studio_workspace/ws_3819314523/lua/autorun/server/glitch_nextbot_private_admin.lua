AddCSLuaFile("autorun/client/glitch_nextbot_admin_menu.lua")

util.AddNetworkString("gsn_private_admin_action_v2")
util.AddNetworkString("gsn_null_jumpscare")
util.AddNetworkString("gsn_missing_entity_base")

resource.AddFile("materials/glitch_nextbot/admin_stare.png")
resource.AddFile("materials/glitch_nextbot/admin_stare_runtime.png")
resource.AddFile("materials/glitch_nextbot/stalker.png")
resource.AddFile("materials/glitch_nextbot/stalker_runtime.png")

local OWNER_STEAMID64 = "76561198980455975"

local function baseReady()
    return TBS_ENTITY_BASE and TBS_ENTITY_BASE.IsReady and TBS_ENTITY_BASE.IsReady()
end

local function isOwner(ply)
    return IsValid(ply) and ply:SteamID64() == OWNER_STEAMID64
end

local function groundPosition(pos)
    local trace = util.TraceHull({
        start = pos + Vector(0, 0, 160),
        endpos = pos - Vector(0, 0, 700),
        mins = Vector(-20, -20, 0),
        maxs = Vector(20, 20, 90),
        mask = MASK_PLAYERSOLID
    })

    return trace.Hit and (trace.HitPos + Vector(0, 0, 4)) or pos
end

local function horizontalForward(ply)
    local direction = ply:EyeAngles():Forward()
    direction.z = 0
    if direction:LengthSqr() <= 0.001 then
        direction = ply:GetForward()
        direction.z = 0
    end
    direction:Normalize()
    return direction
end

local function spawnPrivateStare(ply)
    local forward = horizontalForward(ply)
    local position = groundPosition(ply:GetPos() + forward * 520 + Vector(0, 0, 64))
    local ent = ents.Create("sent_glitch_admin_stare")
    if not IsValid(ent) then return end

    ent:SetPos(position)
    ent:SetAngles(Angle(0, (ply:EyePos() - position):Angle().y, 0))
    ent:Spawn()
    ent:Activate()
    ent:SetTargetPlayer(ply)
end

local function spawnChaserRing(ply)
    local center = ply:GetPos()
    local radius = 520

    for i = 1, 5 do
        local angle = math.rad((i - 1) * 72)
        local offset = Vector(math.cos(angle) * radius, math.sin(angle) * radius, 64)
        local position = groundPosition(center + offset)
        local ent = ents.Create("sent_glitch_admin_chaser")
        if IsValid(ent) then
            ent:SetPos(position)
            ent:SetAngles(Angle(0, (ply:EyePos() - position):Angle().y, 0))
            ent:Spawn()
            ent:Activate()
            ent:SetTargetPlayer(ply)
        end
    end
end

net.Receive("gsn_private_admin_action_v2", function(_, ply)
    if not isOwner(ply) then return end
    if not baseReady() then
        net.Start("gsn_missing_entity_base")
        net.Send(ply)
        return
    end

    local action = net.ReadString()
    if action == "spawn_private_stare" then
        spawnPrivateStare(ply)
    elseif action == "spawn_five_simple_chasers" then
        spawnChaserRing(ply)
    elseif action == "null_jumpscare_all" then
        net.Start("gsn_null_jumpscare")
        net.Broadcast()
    end
end)
