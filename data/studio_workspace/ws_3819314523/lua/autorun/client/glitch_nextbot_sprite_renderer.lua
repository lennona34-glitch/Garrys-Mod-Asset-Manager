local spriteMaterial = Material("glitch_nextbot/stalker_runtime.png", "smooth noclamp")
local adminStareMaterial = Material("glitch_nextbot/admin_stare_runtime.png", "smooth noclamp")
local fallbackMaterial = Material("sprites/light_glow02_add")

local function drawUprightSprite(pos, normal, w, h, color)
    render.DrawQuadEasy(pos, normal, w, h, color, 180)
end

local function drawOne(ent)
    local ply = LocalPlayer()
    if not IsValid(ply) or not IsValid(ent) then return end

    local mode = ent.GetGlitchMode and ent:GetGlitchMode() or "frozen"
    local isChase = mode == "chase" or mode == "admin_chase"
    local isAdminStare = mode == "admin_stare"
    local w = isAdminStare and 560 or (isChase and 720 or 560)
    local h = isAdminStare and 1120 or (isChase and 1440 or 1120)
    local baseLift = isAdminStare and 390 or (isChase and 500 or 390)
    local shake = isAdminStare and 4 or (isChase and 18 or 9)
    local jitter = VectorRand() * shake
    local pulse = math.sin(CurTime() * 48) * 6
    local pos = ent:GetPos() + Vector(0, 0, baseLift + pulse) + jitter
    local normal = ply:GetPos() - ent:GetPos()
    normal.z = 0

    if normal:LengthSqr() <= 0.001 then
        normal = EyeAngles():Forward()
        normal.z = 0
    end

    normal:Normalize()
    render.SetBlend(1)

    local material = isAdminStare and adminStareMaterial or spriteMaterial
    if material:IsError() then
        render.SetMaterial(fallbackMaterial)
        drawUprightSprite(pos, normal, w, h, Color(255, 0, 0, 255))
    else
        render.SetMaterial(material)
        drawUprightSprite(pos, normal, w, h, Color(255, 255, 255, 255))
    end

    render.SetBlend(1)
end

hook.Add("PostDrawTranslucentRenderables", "gsn_draw_nextbot_sprites", function()
    for _, ent in ipairs(ents.FindByClass("sent_glitch_stare")) do
        drawOne(ent)
    end
end)

concommand.Add("gsn_debug_sprite", function()
    print("[The Broken End] sprite material error:", spriteMaterial:IsError())
    print("[The Broken End] admin stare material error:", adminStareMaterial:IsError())
    print("[The Broken End] visible client entities:", #ents.FindByClass("sent_glitch_stare"))
end)
