AddCSLuaFile("shared.lua")
AddCSLuaFile("cl_init.lua")
include("shared.lua")

function ENT:Initialize()
    if not TBS_ENTITY_BASE or not TBS_ENTITY_BASE.IsReady or not TBS_ENTITY_BASE.IsReady() or not self.TBSSetupSpriteBody then
        self:Remove()
        return
    end

    self:TBSSetupSpriteBody(MOVETYPE_NONE)
end

function ENT:Think()
    local target = self:GetTargetPlayer()
    if not IsValid(target) or not target:Alive() then
        self:Remove()
        return
    end

    self:TBSFaceTarget(target)

    if self:GetPos():DistToSqr(target:GetPos()) <= 220 * 220 then
        self:Remove()
        return
    end

    self:NextThink(CurTime() + 0.08)
    return true
end
