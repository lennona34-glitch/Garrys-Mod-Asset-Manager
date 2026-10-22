AddCSLuaFile("shared.lua")
AddCSLuaFile("cl_init.lua")
include("shared.lua")

local vanishSound = "glitch_nextbot/vanish.wav"

local function baseReady()
    return TBS_ENTITY_BASE and TBS_ENTITY_BASE.IsReady and TBS_ENTITY_BASE.IsReady()
end

local function getCvar(name, fallback)
    local cvar = GetConVar(name)
    if not cvar then return fallback end
    return cvar:GetFloat()
end

local function faceEntity(ent, target)
    if not IsValid(ent) or not IsValid(target) or not ent.TBSFaceTarget then return end
    ent:TBSFaceTarget(target)
end

function ENT:Initialize()
    if not baseReady() or not self.TBSSetupSpriteBody then
        self:Remove()
        return
    end

    self:TBSSetupSpriteBody(MOVETYPE_STEP)

    if self:GetGlitchMode() == "" then
        self:SetGlitchMode("frozen")
    end

    if self.loco then
        self.loco:SetStepHeight(35)
        self.loco:SetAcceleration(1400)
        self.loco:SetDeceleration(1400)
        self.loco:SetJumpHeight(58)
        self.loco:SetDesiredSpeed(getCvar("gsn_chase_speed", 480))
    end

    timer.Simple(0, function()
        if not IsValid(self) or self:GetGlitchMode() ~= "chase" then return end

        local target = self:GetTargetPlayer()
        if not IsValid(target) then
            target = self:FindClosestPlayer()
            self:SetTargetPlayer(target)
        end

        self:StartChaseEffects(target)
    end)
end

function ENT:FindClosestPlayer()
    if not self.TBSFindClosestPlayer then return nil end
    return self:TBSFindClosestPlayer()
end

function ENT:Think()
    local mode = self:GetGlitchMode()
    if mode ~= "frozen" and mode ~= "admin_stare" then return end

    local target = self:GetTargetPlayer()
    if not IsValid(target) or not target:Alive() then
        target = self:FindClosestPlayer()
        self:SetTargetPlayer(target)
    end

    if IsValid(target) then
        faceEntity(self, target)

        local tooClose = getCvar("gsn_too_close_distance", 220)
        if self:GetPos():DistToSqr(target:GetPos()) <= tooClose * tooClose then
            self:TriggerTooClose(target)
            return
        end
    end

    self:NextThink(CurTime() + 0.08)
    return true
end

function ENT:TriggerTooClose(ply)
    if self.Triggered then return end
    self.Triggered = true

    if self:GetGlitchMode() == "admin_stare" then
        self:Remove()
        return
    end

    local disappearPos = self:GetPos()
    local roll = math.random(1, 100)
    local crossChance = getCvar("gsn_cross_outcome_chance", 20)
    local crateChance = getCvar("gsn_crate_outcome_chance", 35)
    local crossOutcome = roll <= crossChance
    local crateOutcome = not crossOutcome and roll <= crossChance + crateChance

    net.Start("gsn_black_burst")
        net.WriteString(vanishSound)
        net.WriteFloat((crateOutcome or crossOutcome) and 2 or 2.6)
    net.Send(ply)

    self:Remove()

    if crossOutcome then
        if GLITCH_STARE_NEXTBOT and GLITCH_STARE_NEXTBOT.SpawnRedCrateCross then
            GLITCH_STARE_NEXTBOT.SpawnRedCrateCross(disappearPos)
        end

        timer.Simple(getCvar("gsn_crate_reappear_delay", 40), function()
            if IsValid(ply) and GLITCH_STARE_NEXTBOT then
                GLITCH_STARE_NEXTBOT.SpawnFrozenForPlayer(ply)
            end
        end)

        return
    end

    if crateOutcome then
        if GLITCH_STARE_NEXTBOT and GLITCH_STARE_NEXTBOT.SpawnCrateTower then
            GLITCH_STARE_NEXTBOT.SpawnCrateTower(disappearPos)
        end

        timer.Simple(getCvar("gsn_crate_reappear_delay", 40), function()
            if IsValid(ply) and GLITCH_STARE_NEXTBOT then
                GLITCH_STARE_NEXTBOT.SpawnFrozenForPlayer(ply)
            end
        end)

        return
    end

    timer.Simple(getCvar("gsn_reappear_delay", 25), function()
        if IsValid(ply) and GLITCH_STARE_NEXTBOT then
            GLITCH_STARE_NEXTBOT.SpawnChaserForPlayer(ply, disappearPos)
        end
    end)
end

function ENT:RunBehaviour()
    while true do
        if self:GetGlitchMode() == "chase" or self:GetGlitchMode() == "admin_chase" then
            self:ChaseBehaviour()
        else
            coroutine.wait(0.25)
        end
    end
end

function ENT:StartChaseEffects(target)
    if self.ChaseEffectsStarted or not IsValid(target) then return end
    self.ChaseEffectsStarted = true

    net.Start("gsn_chase_start")
    net.Send(target)
end

function ENT:StopChaseEffects(target)
    if not IsValid(target) then return end

    net.Start("gsn_chase_end")
    net.Send(target)
end

function ENT:KillTarget(ply)
    if self.KilledTarget or not IsValid(ply) then return end
    self.KilledTarget = true

    if GLITCH_STARE_NEXTBOT and GLITCH_STARE_NEXTBOT.LockPlayerRespawn then
        GLITCH_STARE_NEXTBOT.LockPlayerRespawn(ply)
    end

    net.Start("gsn_death_lock")
    net.Send(ply)

    self:StopChaseEffects(ply)

    if ply.GodDisable then
        ply:GodDisable()
    end

    ply:SetHealth(1)
    ply:Kill()

    timer.Simple(0, function()
        if IsValid(ply) and ply:Alive() then
            ply:Kill()
        end
    end)
end

function ENT:KillTargetSimple(ply)
    if not IsValid(ply) then return end

    if ply.GodDisable then
        ply:GodDisable()
    end

    ply:SetHealth(1)
    ply:Kill()
end

function ENT:ChaseBehaviour()
    local simpleChase = self:GetGlitchMode() == "admin_chase"
    local target = self:GetTargetPlayer()
    if not IsValid(target) or not target:Alive() then
        target = self:FindClosestPlayer()
        self:SetTargetPlayer(target)
    end

    if not IsValid(target) then
        coroutine.wait(0.2)
        return
    end

    if not simpleChase then
        self:StartChaseEffects(target)
    end

    if self.loco then
        self.loco:SetDesiredSpeed(getCvar("gsn_chase_speed", 480))
    end

    local path = Path("Follow")
    path:SetMinLookAheadDistance(300)
    path:SetGoalTolerance(20)
    path:Compute(self, target:GetPos())

    while IsValid(target) and target:Alive() and (self:GetGlitchMode() == "chase" or self:GetGlitchMode() == "admin_chase") do
        faceEntity(self, target)

        if self:GetPos():DistToSqr(target:GetPos()) <= 95 * 95 then
            if simpleChase then
                self:KillTargetSimple(target)
            else
                self:KillTarget(target)
            end
            return
        end

        if not path:IsValid() or path:GetAge() > 0.35 then
            path:Compute(self, target:GetPos())
        end

        if path:IsValid() then
            path:Update(self)
        end

        coroutine.yield()
    end

    if not simpleChase then
        self:StopChaseEffects(target)
    end
end

function ENT:OnRemove()
    local target = self:GetTargetPlayer()
    if self:GetGlitchMode() == "chase" and IsValid(target) and not self.KilledTarget then
        self:StopChaseEffects(target)
    end
end
