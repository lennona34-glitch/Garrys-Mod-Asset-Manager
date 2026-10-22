include("shared.lua")

local material = Material("glitch_nextbot/admin_stare_runtime.png", "smooth noclamp")
local fallback = Material("sprites/light_glow02_add")

local function drawPrivateStare(ent)
    local ply = LocalPlayer()
    if not IsValid(ply) or not IsValid(ent) then return end

    local normal = ply:GetPos() - ent:GetPos()
    normal.z = 0
    if normal:LengthSqr() <= 0.001 then
        normal = EyeAngles():Forward()
        normal.z = 0
    end
    normal:Normalize()

    local pos = ent:GetPos() + Vector(0, 0, 390)
    render.SetMaterial(material:IsError() and fallback or material)
    render.DrawQuadEasy(pos, normal, 560, 1120, Color(255, 255, 255, 255), 180)
end

function ENT:Draw()
    drawPrivateStare(self)
end

function ENT:DrawTranslucent()
    drawPrivateStare(self)
end
