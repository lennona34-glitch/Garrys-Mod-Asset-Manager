AddCSLuaFile("shared.lua")
AddCSLuaFile("cl_init.lua")
include("shared.lua")

function ENT:Initialize()
    if not TBS_ENTITY_BASE or not TBS_ENTITY_BASE.IsReady or not TBS_ENTITY_BASE.IsReady() or not self.TBSSetupSpriteBody then
        self:Remove()
        return
    end

    self:TBSSetupSpriteBody(MOVETYPE_STEP)

    if self.loco then
        self.loco:SetDesiredSpeed(480)
        self.loco:SetAcceleration(1400)
        self.loco:SetDeceleration(1400)
        self.loco:SetStepHeight(35)
        self.loco:SetJumpHeight(58)
    end
end

function ENT:RunBehaviour()
    while true do
        local target = self:GetTargetPlayer()
        if not IsValid(target) or not target:Alive() then
            coroutine.wait(0.15)
        else
            local path = Path("Follow")
            path:SetMinLookAheadDistance(300)
            path:SetGoalTolerance(20)
            path:Compute(self, target:GetPos())

            while IsValid(target) and target:Alive() do
                self:TBSFaceTarget(target)

                if self:GetPos():DistToSqr(target:GetPos()) <= 95 * 95 then
                    if target.GodDisable then
                        target:GodDisable()
                    end
                    target:Kill()
                    self:Remove()
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
        end
    end
end
