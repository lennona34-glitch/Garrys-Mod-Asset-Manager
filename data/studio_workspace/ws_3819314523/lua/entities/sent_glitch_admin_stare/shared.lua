ENT.Base = "tbs_nextbot_base"
ENT.Type = "nextbot"

ENT.PrintName = "The Broken End - Private Stare"
ENT.Category = "Broken End"
ENT.Spawnable = false
ENT.AdminOnly = true

function ENT:SetupDataTables()
    self:NetworkVar("Entity", 0, "TargetPlayer")
end
