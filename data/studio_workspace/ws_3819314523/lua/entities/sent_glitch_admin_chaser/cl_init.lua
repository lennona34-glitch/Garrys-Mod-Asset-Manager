include("shared.lua")

local material = Material("glitch_nextbot/stalker_runtime.png", "smooth noclamp")
local fallback = Material("sprites/light_glow02_add")

local function drawChaser(ent)
    local ply = LocalPlayer()
    if not IsValid(ply) or not IsValid(ent) then return end

    local normal = ply:GetPos() - ent:GetPos()
    normal.z = 0
    if normal:LengthSqr() <= 0.001 then
        normal = EyeAngles():Forward()
        normal.z = 0
    end
    normal:Normalize()

    local jitter = VectorRand() * 18
    local pos = ent:GetPos() + Vector(0, 0, 500 + math.sin(CurTime() * 48) * 6) + jitter
    render.SetMaterial(material:IsError() and fallback or material)
    render.DrawQuadEasy(pos, normal, 720, 1440, Color(255, 255, 255, 255), 180)
end

function ENT:Draw()
    drawChaser(self)
end

function ENT:DrawTranslucent()
    drawChaser(self)
end
