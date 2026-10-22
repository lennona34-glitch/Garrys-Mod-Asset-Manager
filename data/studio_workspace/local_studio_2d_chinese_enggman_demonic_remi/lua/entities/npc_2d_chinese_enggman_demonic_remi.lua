AddCSLuaFile()

ENT.Base = "base_nextbot"
ENT.PhysgunDisabled = true
ENT.AutomaticFrameAdvance = false

local SPRITE_SIZE = 128
local CHASE_SPEED = 350
local JUMP_HEIGHT = 100

util.PrecacheSound("npc_2d_chinese_enggman_demonic_remi/panic.mp3")

util.PrecacheSound("npc_2d_chinese_enggman_demonic_remi/pieceofcake.mp3")

local IsValid = IsValid

if SERVER then

local npc_2d_chinese_enggman_demonic_remi_acquire_distance = CreateConVar("npc_2d_chinese_enggman_demonic_remi_acquire_distance", 2500, FCVAR_NONE, "Maximum chase distance")
local npc_2d_chinese_enggman_demonic_remi_attack_distance = CreateConVar("npc_2d_chinese_enggman_demonic_remi_attack_distance", 80, FCVAR_NONE, "Attack reach")
local npc_2d_chinese_enggman_demonic_remi_attack_interval = CreateConVar("npc_2d_chinese_enggman_demonic_remi_attack_interval", 0.2, FCVAR_NONE, "Attack delay")
local npc_2d_chinese_enggman_demonic_remi_attack_force = CreateConVar("npc_2d_chinese_enggman_demonic_remi_attack_force", 550, FCVAR_NONE, "Attack knockback force")
local npc_2d_chinese_enggman_demonic_remi_smash_props = CreateConVar("npc_2d_chinese_enggman_demonic_remi_smash_props", 0, FCVAR_NONE, "Smash through props")

function ENT:Initialize()
    if game.SinglePlayer() then
        self:SetModel("models/props_c17/oildrum001.mdl")
    else
        self:SetModel("models/props_c17/oildrum001.mdl")
    end
    self:SetNoDraw(false)
    self:DrawShadow(false)
    self:SetSolidMask(MASK_NPCSOLID_BRUSHONLY)
    self:SetCollisionGroup(COLLISION_GROUP_INTERACTIVE_DEBRIS)

    self.loco:SetStepHeight(36)
    self.loco:SetDeathDropHeight(800)
    self.loco:SetDesiredSpeed(CHASE_SPEED)
    self.loco:SetAcceleration(650)
    self.loco:SetDeceleration(650)
    self.loco:SetJumpHeight(JUMP_HEIGHT)

    self.LastAttack = 0
    self.LastTaunt = 0
    self.LastJump = 0
end

function ENT:OnInjured(dmg)
    dmg:SetDamage(0)
end

function ENT:FindNearestTarget()
    local myPos = self:GetPos()
    local maxDistSqr = math.pow(npc_2d_chinese_enggman_demonic_remi_acquire_distance:GetFloat(), 2)
    local bestTarget = nil
    local bestDistSqr = maxDistSqr

    for _, ply in ipairs(player.GetAll()) do
        if IsValid(ply) and ply:Alive() and not ply:IsFlagSet(FL_NOTARGET) then
            local d = myPos:DistToSqr(ply:GetPos())
            if d < bestDistSqr then
                bestDistSqr = d
                bestTarget = ply
            end
        end
    end
    return bestTarget
end

function ENT:AttackNearbyTargets()
    if CurTime() - self.LastAttack < npc_2d_chinese_enggman_demonic_remi_attack_interval:GetFloat() then return end
    local myPos = self:GetPos()
    local reach = npc_2d_chinese_enggman_demonic_remi_attack_distance:GetFloat()
    local force = npc_2d_chinese_enggman_demonic_remi_attack_force:GetFloat()
    local hitAnyone = false

    for _, ent in ipairs(ents.FindInSphere(myPos, reach)) do
        if IsValid(ent) and ent ~= self then
            if ent:IsPlayer() and ent:Alive() then
                local dmg = DamageInfo()
                dmg:SetAttacker(self)
                dmg:SetInflictor(self)
                dmg:SetDamage(250)
                dmg:SetDamageType(DMG_CLUB)
                dmg:SetDamageForce(((ent:GetPos() - myPos):GetNormalized() + Vector(0, 0, 0.5)) * force * 50)
                ent:TakeDamageInfo(dmg)
                ent:SetVelocity(((ent:GetPos() - myPos):GetNormalized() + Vector(0, 0, 0.45)) * force)
                hitAnyone = true
            elseif npc_2d_chinese_enggman_demonic_remi_smash_props:GetBool() and ent:GetMoveType() == MOVETYPE_VPHYSICS then
                local phys = ent:GetPhysicsObject()
                if IsValid(phys) then
                    constraint.RemoveAll(ent)
                    phys:EnableMotion(true)
                    phys:Wake()
                    phys:ApplyForceCenter(((ent:GetPos() - myPos):GetNormalized() + Vector(0, 0, 0.35)) * force * phys:GetMass())
                end
                if ent:GetClass() == "prop_door_rotating" or ent:GetClass() == "func_door_rotating" or ent:GetClass() == "func_door" then
                    ent:Fire("Unlock", "", 0)
                    ent:Fire("Open", "", 0.01)
                end
            end
        end
    end

    if hitAnyone then
        self.LastAttack = CurTime()
        if CurTime() - self.LastTaunt > 1.5 then self:EmitSound("npc_2d_chinese_enggman_demonic_remi/pieceofcake.mp3", 350, 100) self.LastTaunt = CurTime() end
    end
end

function ENT:RunBehaviour()
    while true do
        local target = self:FindNearestTarget()
        if IsValid(target) then
            local path = Path("Follow")
            path:SetMinLookAheadDistance(300)
            path:SetGoalTolerance(25)
            path:Compute(self, target:GetPos())

            local repathTime = CurTime() + 0.15
            while path:IsValid() and IsValid(target) and target:Alive() do
                if CurTime() > repathTime then
                    path:Compute(self, target:GetPos())
                    repathTime = CurTime() + 0.15
                end
                path:Update(self)
                self:AttackNearbyTargets()

                -- Occasional leap if target is high or stuck
                if JUMP_HEIGHT > 0 and self.loco:IsOnGround() and (target:GetPos().z - self:GetPos().z > 90) and CurTime() - self.LastJump > 2.2 then
                    self.loco:Jump()
                    self.LastJump = CurTime()
                    
                end

                if self.loco:IsStuck() then
                    self:HandleStuck()
                end
                coroutine.yield()
            end
        else
            coroutine.wait(0.25)
        end
        coroutine.yield()
    end
end

else -- CLIENT --

killicon.Add("npc_2d_chinese_enggman_demonic_remi", "npc_2d_chinese_enggman_demonic_remi/npc_2d_chinese_enggman_demonic_remi", color_white)
language.Add("npc_2d_chinese_enggman_demonic_remi", "chinese_enggman_demonic (Remix) (Remix)")

ENT.RenderGroup = RENDERGROUP_TRANSLUCENT

local spriteMaterial = Material("npc_2d_chinese_enggman_demonic_remi/npc_2d_chinese_enggman_demonic_remi.png", "nocull smooth mips")
local drawOffset = Vector(0, 0, 64)

function ENT:Initialize()
    self:SetRenderBounds(
        Vector(-64, -64, 0),
        Vector(64, 64, 128),
        Vector(8, 8, 8)
    )
end

function ENT:RenderOverride()
    render.SetMaterial(spriteMaterial)
    render.DrawSprite(self:GetPos() + drawOffset, 128, 128)
end

function ENT:DrawTranslucent()
    self:RenderOverride()
end


local panicMusic = nil
local lastPanic = 0
local MUSIC_CUTOFF_DISTANCE = 1200
local MUSIC_PANIC_DISTANCE = 200

local function updatePanicMusic()
    local bots = ents.FindByClass("npc_2d_chinese_enggman_demonic_remi")
    if #bots == 0 or not IsValid(LocalPlayer()) then
        if panicMusic then panicMusic:Stop() end
        return
    end

    if not panicMusic then
        panicMusic = CreateSound(LocalPlayer(), "npc_2d_chinese_enggman_demonic_remi/panic.mp3")
        panicMusic:Stop()
    end

    local plyPos = LocalPlayer():GetPos()
    local bestScore = 0
    for _, bot in ipairs(bots) do
        if IsValid(bot) then
            local dist = plyPos:Distance(bot:GetPos())
            if dist < MUSIC_CUTOFF_DISTANCE then
                local score = (MUSIC_CUTOFF_DISTANCE - dist) / (MUSIC_CUTOFF_DISTANCE - MUSIC_PANIC_DISTANCE)
                if score > bestScore then bestScore = score end
            end
        end
    end

    local vol = math.Clamp(bestScore, 0, 1)
    if vol > 0 then
        if CurTime() - lastPanic >= 2 then
            panicMusic:Play()
        end
        lastPanic = CurTime()
        panicMusic:Play()
        panicMusic:ChangeVolume( math.max(0.02, vol), 0 )
    elseif CurTime() - lastPanic >= 2 then
        panicMusic:Stop()
    end
end

timer.Create("npc_2d_chinese_enggman_demonic_remi_PanicMusicTimer", 0.05, 0, updatePanicMusic)


end

list.Set("NPC", "npc_2d_chinese_enggman_demonic_remi", {
    Name = "chinese_enggman_demonic (Remix) (Remix)",
    Class = "npc_2d_chinese_enggman_demonic_remi",
    Category = "Nextbot",
    AdminOnly = false
})
