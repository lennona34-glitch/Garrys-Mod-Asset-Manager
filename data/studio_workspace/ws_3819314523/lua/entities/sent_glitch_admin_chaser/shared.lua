ENT.Base = "tbs_nextbot_base"
ENT.Type = "nextbot"

ENT.PrintName = "The Broken End - Simple Chaser"
ENT.Category = "Broken End"
ENT.Spawnable = true
ENT.AdminOnly = true

function ENT:SetupDataTables()
    self:NetworkVar("Entity", 0, "TargetPlayer")
end
