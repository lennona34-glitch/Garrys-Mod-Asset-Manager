local rainLoop
local chaseLoop
local burstUntil = 0
local burstSquares = {}
local chaseActive = false
local deathLocked = false
local deathLockStart = 0
local fakeErrorAt = 0
local fakeErrorVisible = false
local fadeStart = 0
local fadeDuration = 0
local nullJumpscareUntil = 0
local nullSpritePos
local nullLookPos
local missingBaseNoticeUntil = 0
local missingBaseFadeSeconds = 1.2
local missingBaseNoticeDuration = 5

local blurMaterial = Material("pp/blurscreen")
local overlayMaterial = Material("glitch_nextbot/chase_overlay_sheet.png", "smooth noclamp")
local nullSpriteMaterial = Material("glitch_nextbot/null_jumpscare_runtime.png", "smooth noclamp")
local overlayFrames = 31
local overlayCols = 8
local overlayRows = 4
local overlayFps = 12

local function playLoop(existing, soundPath)
    local ply = LocalPlayer()
    if not IsValid(ply) then return existing end

    if existing then
        existing:Stop()
    end

    local snd = CreateSound(ply, soundPath)
    if snd then
        snd:Play()
    end

    return snd
end

local function stopLoop(loop)
    if loop then
        loop:Stop()
    end
end

local function buildBurstSquares()
    burstSquares = {}

    for i = 1, math.random(35, 58) do
        burstSquares[i] = {
            x = math.Rand(0, ScrW()),
            y = math.Rand(0, ScrH()),
            w = math.Rand(12, 90),
            h = math.Rand(12, 90),
            a = math.Rand(190, 255)
        }
    end
end

local function startBurst(duration)
    burstUntil = CurTime() + math.max(duration or 2, 0.05)
    buildBurstSquares()
end

local function drawBurst()
    if CurTime() >= burstUntil then
        burstSquares = {}
        return
    end

    for _, sq in ipairs(burstSquares) do
        surface.SetDrawColor(0, 0, 0, sq.a)
        surface.DrawRect(sq.x, sq.y, sq.w, sq.h)
    end
end

local function drawScreenBlur(strength)
    if blurMaterial:IsError() then return end

    surface.SetDrawColor(255, 255, 255, 255)
    surface.SetMaterial(blurMaterial)

    for i = 1, 3 do
        blurMaterial:SetFloat("$blur", (strength or 6) * i)
        blurMaterial:Recompute()
        render.UpdateScreenEffectTexture()
        surface.DrawTexturedRect(0, 0, ScrW(), ScrH())
    end
end

local function startNullJumpscare()
    local ply = LocalPlayer()
    if not IsValid(ply) then return end

    local forward = EyeAngles():Forward()
    forward.z = 0

    if forward:LengthSqr() <= 0.001 then
        forward = ply:GetForward()
        forward.z = 0
    end

    forward:Normalize()

    nullJumpscareUntil = CurTime() + 2
    nullSpritePos = ply:GetPos() + forward * 520 + Vector(0, 0, 46)
    nullLookPos = nullSpritePos + Vector(0, 0, 18)

    surface.PlaySound("glitch_nextbot/null_jumpscare.wav")
    startBurst(2)
end

local function nullJumpscareActive()
    return CurTime() < nullJumpscareUntil and nullSpritePos ~= nil and nullLookPos ~= nil
end

local function drawChaseOverlay()
    if not chaseActive then return end

    local frame = math.floor(CurTime() * overlayFps) % overlayFrames
    local col = frame % overlayCols
    local row = math.floor(frame / overlayCols)

    surface.SetMaterial(overlayMaterial)
    surface.SetDrawColor(255, 255, 255, 255)
    surface.DrawTexturedRectUV(0, 0, ScrW(), ScrH(), col / overlayCols, row / overlayRows, (col + 1) / overlayCols, (row + 1) / overlayRows)

    for _ = 1, 7 do
        surface.SetDrawColor(0, 0, 0, math.random(145, 235))
        surface.DrawRect(0, math.Rand(0, ScrH()), ScrW(), math.random(2, 7))
    end
end

local function drawDeathLock(allowBlur)
    if not deathLocked then return end

    if allowBlur then
        local ramp = math.Clamp((CurTime() - deathLockStart) / 0.6, 0, 1)
        drawScreenBlur(3 + ramp * 5)
    end

    surface.SetDrawColor(10, 10, 10, 150)
    surface.DrawRect(0, 0, ScrW(), ScrH())

    if CurTime() >= fakeErrorAt then
        fakeErrorVisible = true
    end

    if not fakeErrorVisible then return end

    local w = math.min(520, ScrW() - 40)
    local h = 118
    local x = (ScrW() - w) * 0.5
    local y = (ScrH() - h) * 0.5

    surface.SetDrawColor(240, 243, 247, 255)
    surface.DrawRect(x, y, w, h)
    surface.SetDrawColor(225, 229, 235, 255)
    surface.DrawRect(x, y, w, 38)
    surface.SetDrawColor(40, 40, 40, 255)
    surface.DrawOutlinedRect(x, y, w, h, 1)

    draw.SimpleText("LWJGL Alert", "DermaDefault", x + 34, y + 19, Color(20, 20, 20), TEXT_ALIGN_LEFT, TEXT_ALIGN_CENTER)
    draw.SimpleText("_", "DermaDefault", x + w - 122, y + 14, Color(20, 20, 20), TEXT_ALIGN_CENTER, TEXT_ALIGN_CENTER)
    draw.SimpleText("[]", "DermaDefault", x + w - 80, y + 18, Color(150, 150, 150), TEXT_ALIGN_CENTER, TEXT_ALIGN_CENTER)
    draw.SimpleText("X", "DermaDefault", x + w - 32, y + 19, Color(20, 20, 20), TEXT_ALIGN_CENTER, TEXT_ALIGN_CENTER)
    draw.SimpleText("Server has been terminated, Please rejoin", "DermaLarge", x + 18, y + 78, Color(25, 25, 25), TEXT_ALIGN_LEFT, TEXT_ALIGN_CENTER)
end

local function drawSkyFade()
    if fadeDuration <= 0 then return end

    local elapsed = CurTime() - fadeStart
    if elapsed >= fadeDuration then
        fadeDuration = 0
        return
    end

    local half = fadeDuration * 0.5
    local alpha = elapsed < half and elapsed / half or 1 - ((elapsed - half) / half)
    surface.SetDrawColor(0, 0, 0, math.Clamp(alpha, 0, 1) * 255)
    surface.DrawRect(0, 0, ScrW(), ScrH())
end

local function drawMissingBaseNotice()
    local remaining = missingBaseNoticeUntil - CurTime()
    if remaining <= 0 then return end

    local alpha = 255
    if remaining < missingBaseFadeSeconds then
        alpha = math.floor(255 * math.Clamp(remaining / missingBaseFadeSeconds, 0, 1))
    end

    local w = math.min(540, ScrW() - 32)
    local h = 104
    local x = math.floor((ScrW() - w) * 0.5)
    local y = math.floor(ScrH() * 0.14)

    draw.RoundedBox(6, x, y, w, h, Color(14, 14, 18, alpha))
    surface.SetDrawColor(190, 26, 30, alpha)
    surface.DrawRect(x, y, 6, h)
    surface.SetDrawColor(70, 70, 76, alpha)
    surface.DrawOutlinedRect(x, y, w, h, 1)
    draw.SimpleText("THE BROKEN END", "DermaLarge", x + 24, y + 30, Color(232, 232, 232, alpha), TEXT_ALIGN_LEFT, TEXT_ALIGN_CENTER)
    draw.SimpleText("TBS Entity Base is not installed, Please install it", "DermaDefaultBold", x + 24, y + 70, Color(255, 82, 82, alpha), TEXT_ALIGN_LEFT, TEXT_ALIGN_CENTER)
end

local function showMissingBaseNotice()
    missingBaseNoticeUntil = CurTime() + missingBaseNoticeDuration
end

local function drawAllEffects(allowBlur)
    drawChaseOverlay()
    drawBurst()
    drawDeathLock(allowBlur)
    drawSkyFade()
end

hook.Add("HUDPaint", "gsn_draw_effects", function()
    drawAllEffects(true)
end)

hook.Add("PostRenderVGUI", "gsn_draw_effects_over_vgui", function()
    drawAllEffects(false)
    drawMissingBaseNotice()
end)

hook.Add("PostDrawTranslucentRenderables", "gsn_draw_null_jumpscare_sprite", function()
    if not nullJumpscareActive() then return end

    local ply = LocalPlayer()
    if not IsValid(ply) then return end

    local normal = ply:GetPos() - nullSpritePos
    normal.z = 0

    if normal:LengthSqr() <= 0.001 then
        normal = EyeAngles():Forward()
        normal.z = 0
    end

    normal:Normalize()
    render.SetMaterial(nullSpriteMaterial)
    render.DrawQuadEasy(nullSpritePos, normal, 96, 192, Color(255, 255, 255, 255), 180)
end)

net.Receive("gsn_world_state", function()
    local active = net.ReadBool()
    if active then
        rainLoop = playLoop(rainLoop, "glitch_nextbot/rain_loop.wav")
    else
        stopLoop(rainLoop)
        rainLoop = nil
    end
end)

net.Receive("gsn_black_burst", function()
    local soundPath = net.ReadString()
    local duration = net.ReadFloat()

    if soundPath ~= "" then
        surface.PlaySound(soundPath)
    end

    startBurst(duration)
end)

net.Receive("gsn_chase_start", function()
    chaseActive = true
    chaseLoop = playLoop(chaseLoop, "glitch_nextbot/chase_loop.wav")
end)

net.Receive("gsn_chase_end", function()
    chaseActive = false
    stopLoop(chaseLoop)
    chaseLoop = nil
end)

net.Receive("gsn_death_lock", function()
    chaseActive = false
    deathLocked = true
    deathLockStart = CurTime()
    fakeErrorVisible = false
    fakeErrorAt = CurTime() + 3
    stopLoop(chaseLoop)
    chaseLoop = nil

    timer.Simple(3, function()
        if deathLocked then
            surface.PlaySound("glitch_nextbot/error_popup.wav")
        end
    end)
end)

net.Receive("gsn_chat_red", function()
    chat.AddText(Color(255, 30, 30), net.ReadString())
end)

net.Receive("gsn_skybox_fade", function()
    fadeDuration = net.ReadFloat()
    fadeStart = CurTime()
end)

net.Receive("gsn_null_jumpscare", startNullJumpscare)

net.Receive("gsn_missing_entity_base", function()
    showMissingBaseNotice()
end)

hook.Add("InitPostEntity", "gsn_check_missing_entity_base", function()
    timer.Simple(3, function()
        local installed = TBS_ENTITY_BASE
            and TBS_ENTITY_BASE.IsReady
            and TBS_ENTITY_BASE.IsReady()

        if not installed then
            showMissingBaseNotice()
        end
    end)
end)

hook.Add("CreateMove", "gsn_lock_controls", function(cmd)
    if nullJumpscareActive() then
        local ply = LocalPlayer()
        if IsValid(ply) then
            cmd:SetViewAngles((nullLookPos - ply:EyePos()):Angle())
            cmd:SetMouseX(0)
            cmd:SetMouseY(0)
        end
    end

    if not deathLocked then return end

    cmd:SetMouseX(0)
    cmd:SetMouseY(0)
end)

hook.Add("PlayerBindPress", "gsn_block_binds", function(_, bind)
    if not deathLocked then return end
    if bind == "cancelselect" or bind == "toggleconsole" then return end

    return true
end)

hook.Add("CalcView", "gsn_null_jumpscare_view", function(_, pos, _, fov)
    if not nullJumpscareActive() then return end

    return {
        origin = pos,
        angles = (nullLookPos - pos):Angle(),
        fov = fov,
        drawviewer = false
    }
end)
