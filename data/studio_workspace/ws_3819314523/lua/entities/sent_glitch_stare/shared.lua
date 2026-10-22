ENT.Base = "tbs_nextbot_base"
ENT.Type = "nextbot"

ENT.PrintName = "The Broken End"
ENT.Category = "Broken End"
ENT.Author = "Codex"
ENT.Spawnable = true
ENT.AdminOnly = false

function ENT:SetupDataTables()
    self:NetworkVar("String", 0, "GlitchMode")
    self:NetworkVar("Entity", 0, "TargetPlayer")
end
