-- ─────────────────────────────────────────────────────────────────────────────
-- The Imposter — client-side HUD, voice popups, and options panel.
-- ─────────────────────────────────────────────────────────────────────────────

include( "shared.lua" )  -- ENT.Base / PrintName / Type / phase enums (loader runs only cl_init on clients)

-- Mirrors of the shared.lua globals — defined as locals here so hook closures
-- always capture a concrete value regardless of when shared.lua ran.
local IMPOSTER_CLASS_WILD    = "nextbot_imposter*"
local IMPOSTER_PHASE_ROAM      = 0
local IMPOSTER_PHASE_STALK     = 1
local IMPOSTER_PHASE_HUNT      = 2
local IMPOSTER_PHASE_EXECUTE   = 3
local IMPOSTER_PHASE_ABSORB    = 4
local IMPOSTER_PHASE_DISGUISED = 5
local IMPOSTER_PHASE_ENRAGE    = 6
local IMPOSTER_PHASE_FLEE      = 7
local IMPOSTER_PHASE_PLAYDEAD  = 8
local IMPOSTER_PHASE_TRACKING  = 9
local IMPOSTER_PHASE_TELEPORT  = 10

local IMPOSTER_PHASE_NAMES = {
    [0]  = "ROAM",
    [1]  = "STALK",
    [2]  = "HUNT",
    [3]  = "EXECUTE",
    [4]  = "ABSORB",
    [5]  = "DISGUISED",
    [6]  = "ENRAGE",
    [7]  = "FLEE",
    [8]  = "PLAYDEAD",
    [9]  = "TRACKING",
    [10] = "TELEPORT",
}

local function isImposterClass( ent )
    return IsValid( ent ) and string.StartWith( ent:GetClass(), "nextbot_imposter" )
end

language.Add( "nextbot_imposter", ENT.PrintName )

-- ─── Voice playback (clientside, looped for the talk session) ────────────────
-- Each "talk" loops MockNoises.mp3 for a session (so a short clip still reads as
-- sustained voice chat). The icon shows for the whole session; its green level is
-- driven by the real audio channel.
local imposterVoices = {}  -- [ent] = { endTime = n }

local function imposterTalking( ent )
    local d = imposterVoices[ ent ]
    return d ~= nil and CurTime() < d.endTime
end

local function imposterVoiceVolume( ent )
    if not imposterVoices[ ent ] then return 0 end
    -- Fake a voice-activity pulse since sound is played server-side via EmitSound
    return math.abs( math.sin( CurTime() * 7 ) ) * 0.6 + 0.15
end

net.Receive( "imposter_voice", function()
    local ent     = net.ReadEntity()
    local session = net.ReadUInt( 8 )
    if not IsValid( ent ) then return end
    imposterVoices[ ent ] = { endTime = CurTime() + session }
end )

hook.Add( "Think", "imposter_voice_cleanup", function()
    local now = CurTime()
    for ent, d in pairs( imposterVoices ) do
        if not IsValid( ent ) or now >= d.endTime
            or ent:GetNWInt( "ImposterPhase", IMPOSTER_PHASE_ROAM ) ~= IMPOSTER_PHASE_DISGUISED then
            imposterVoices[ ent ] = nil
        end
    end
end )

net.Receive( "ImposterNextBot.GrabCamera", function()
    if not net.ReadBool() then
        ImposterNextBotGrabCamera = nil
        return
    end

    ImposterNextBotGrabCamera = {
        ragdoll = net.ReadEntity(),
        bot = net.ReadEntity(),
    }
end )

-- If the imposter bot is deleted mid-grab (e.g. via console or admin), clear the
-- locked camera immediately so the player doesn't get stuck.
hook.Add( "EntityRemoved", "ImposterNextBot.GrabCamera", function( ent )
    if ImposterNextBotGrabCamera and ent == ImposterNextBotGrabCamera.bot then
        ImposterNextBotGrabCamera = nil
    end
end )

hook.Add( "CalcView", "ImposterNextBot.GrabCamera", function( ply, origin, angles, fov )
    if not ImposterNextBotGrabCamera then return end

    local ragdoll = ImposterNextBotGrabCamera.ragdoll
    local bot = ImposterNextBotGrabCamera.bot
    if not IsValid( ragdoll ) or not IsValid( bot ) then
        ImposterNextBotGrabCamera = nil
        return
    end

    local focus = ragdoll:WorldSpaceCenter()
    local headBone = ragdoll:LookupBone( "ValveBiped.Bip01_Head1" )
    if headBone then
        local headPos = ragdoll:GetBonePosition( headBone )
        if headPos and headPos ~= vector_origin then focus = headPos end
    end

    local away = IsValid( bot ) and ( focus - bot:WorldSpaceCenter() ) or -angles:Forward()
    away.z = 0
    if away:LengthSqr() <= 0.001 then
        away = -angles:Forward()
        away.z = 0
    end
    away:Normalize()

    local wantedPos = focus + away * 150 + vector_up * 55
    local trace = util.TraceHull( {
        start = focus,
        endpos = wantedPos,
        mins = Vector( -4, -4, -4 ),
        maxs = Vector( 4, 4, 4 ),
        filter = { ply, ragdoll, bot },
        mask = MASK_SOLID,
    } )
    local viewPos = trace.Hit and ( trace.HitPos + trace.HitNormal * 4 ) or wantedPos

    return {
        origin = viewPos,
        angles = ( focus - viewPos ):Angle(),
        fov = fov,
        drawviewer = true,
    }
end )

-- Live debug overlay: a floating phase label above every Imposter, redrawn
-- each frame while imposter_debug is on.
hook.Add( "HUDPaint", "imposter_DebugOverlay", function()
    local cv = GetConVar( "imposter_debug" )
    if not cv or not cv:GetBool() then return end

    for _, ent in ipairs( ents.FindByClass( IMPOSTER_CLASS_WILD ) ) do
        if not IsValid( ent ) then continue end

        local scr = ( ent:GetPos() + Vector( 0, 0, 80 ) ):ToScreen()
        if not scr.visible then continue end

        local phase = ent:GetNWInt( "ImposterPhase", IMPOSTER_PHASE_ROAM )
        local name  = IMPOSTER_PHASE_NAMES[ phase ] or "?"
        local text  = string.format( "Imposter #%d\nphase: %s (%d)",
            ent:EntIndex(), name, phase )

        local track = ent:GetNWString( "ImposterTrackName", "" )
        if track ~= "" then text = text .. "\ntarget: " .. track end

        draw.DrawText( text, "DermaDefaultBold", scr.x + 1, scr.y + 1,
            Color( 0, 0, 0, 200 ), TEXT_ALIGN_CENTER )
        draw.DrawText( text, "DermaDefaultBold", scr.x, scr.y,
            Color( 120, 230, 120, 255 ), TEXT_ALIGN_CENTER )
    end
end )

-- ─── Disguise tells: native-style name/health targetID + voice icon ───────────
-- Matches the look of Lambda Players (which mirrors GMod's native player HUD):
-- name + health% drawn near screen-centre with the engine TargetID/ChatFont, and
-- the real voice icon (voice/icntlk_pl) floating over the head in 3D2D.

surface.CreateFont( "ImposterDisplayName", { font = "TargetID", size = 24, weight = 0, antialias = true } )
surface.CreateFont( "ImposterHealthFont", { font = "ChatFont", size = 22, weight = 0, antialias = true } )

local function imposterDisplayName( ent )
    -- The glitched name, shown steadily (the corruption itself is the tell).
    local corrupt = ent:GetNWString( "ImposterCorruptName", "" )
    if corrupt ~= "" then return corrupt end
    return ent:GetNWString( "ImposterVictimName", "?" )
end

-- Name + health, GMod-targetID-style, when looking at a disguised imposter.
hook.Add( "HUDPaint", "imposter_NameDisplay", function()
    local lp = LocalPlayer()
    if not IsValid( lp ) then return end

    local ent = lp:GetEyeTrace().Entity
    if not isImposterClass( ent ) then return end
    if ent:GetNWInt( "ImposterPhase", IMPOSTER_PHASE_ROAM ) ~= IMPOSTER_PHASE_DISGUISED then return end
    if not ent:GetNWBool( "ImposterDisguiseIsPlayer", false ) then return end  -- NPC disguises have no nametag

    local sw, sh = ScrW(), ScrH()
    local name = imposterDisplayName( ent )
    local hp   = math.Round( math.Clamp( ent:Health() / math.max( ent:GetMaxHealth(), 1 ), 0, 1 ) * 100 )

    draw.DrawText( name, "ImposterDisplayName", sw / 2, sh / 1.95, color_white, TEXT_ALIGN_CENTER )
    draw.DrawText( hp .. "%", "ImposterHealthFont", sw / 2, sh / 1.87 + 4, color_white, TEXT_ALIGN_CENTER )
end )

-- The real voice icon, floating clear above the head while "talking". Drawn in
-- the translucent pass as a camera-facing 3D2D quad, raised above the head mesh
-- (drawing it right at the head gets it occluded) and scaled up to read clearly.
local voiceicon = Material( "voice/icntlk_pl" )

hook.Add( "PostDrawTranslucentRenderables", "imposter_VoiceIcon", function( _, drawingSkybox )
    if drawingSkybox then return end

    for _, ent in ipairs( ents.FindByClass( IMPOSTER_CLASS_WILD ) ) do
        if not IsValid( ent ) then continue end
        if ent:GetNWInt( "ImposterPhase", IMPOSTER_PHASE_ROAM ) ~= IMPOSTER_PHASE_DISGUISED then continue end
        if not imposterTalking( ent ) then continue end

        -- A bit above the very top of the model so it never clips into the head.
        local top = ent:OBBMaxs().z
        local pos = ent:GetPos() + Vector( 0, 0, top + 14 )

        local ang = EyeAngles()
        ang:RotateAroundAxis( ang:Up(), -90 )
        ang:RotateAroundAxis( ang:Forward(), 90 )

        cam.Start3D2D( pos, ang, 0.6 )
            surface.SetDrawColor( 255, 255, 255, 255 )
            surface.SetMaterial( voiceicon )
            surface.DrawTexturedRect( -16, -16, 32, 32 )
        cam.End3D2D()
    end
end )

-- ─── Bottom-right voice-chat popups (native VoiceNotify style, à la Lambda) ───
-- A rounded box with the model's spawnicon, the impersonated name, and a
-- volume-reactive green fill. We have no BASS channel (EmitSound), so the volume
-- is a faked pulse while talking; it fades out after the clip. Stacks above any
-- real player voice panels (g_VoicePanelList).
local genericAvatar = Material( "icon16/user.png" )
local function imposterAvatar( ent )
    local model = ent:GetModel() or ""
    if ent.ImposterAvatarModel ~= model then
        ent.ImposterAvatarModel = model
        local mat = Material( "spawnicons/" .. string.gsub( model, "%.mdl$", "" ) .. ".png" )
        ent.ImposterAvatarMat = ( mat and not mat:IsError() ) and mat or genericAvatar
    end
    return ent.ImposterAvatarMat or genericAvatar
end

-- Cache one AvatarImage panel per SteamID so the popup can show the real player's
-- Steam profile picture (player victims only; NPCs fall back to the spawnicon).
local avatarPanels = {}
local function getImposterAvatarPanel( steamid )
    if steamid == "" or steamid == "0" then return nil end
    local p = avatarPanels[ steamid ]
    if IsValid( p ) then return p end

    p = vgui.Create( "AvatarImage" )
    if not IsValid( p ) then return nil end
    p:SetSize( 32, 32 )
    p:SetSteamID( steamid, 32 )
    -- Painted manually so it's skipped in the normal VGUI pass; it must stay VISIBLE
    -- for PaintManual() to actually draw (an invisible panel paints nothing). Parked
    -- offscreen so it never flashes in the corner before its first manual paint.
    p:SetPaintedManually( true )
    p:SetMouseInputEnabled( false )
    p:SetPos( -100, -100 )
    avatarPanels[ steamid ] = p
    return p
end

local popupBase = Color( 255, 255, 255, 255 )
local popupVol  = Color( 0, 255, 0, 240 )

-- The popup only shows when the local player is close enough to actually hear the
-- voice (server plays it at sound level 75 ≈ a normal speaking voice). Beyond this
-- the chatter would be inaudible, so the icon would be a giveaway you couldn't justify.
local IMPOSTER_VOICE_HEAR_DIST    = 1400
local IMPOSTER_VOICE_HEAR_DISTSQR = IMPOSTER_VOICE_HEAR_DIST * IMPOSTER_VOICE_HEAR_DIST

hook.Add( "HUDPaint", "imposter_VoicePopups", function()
    local now   = CurTime()
    local items = {}

    local lp     = LocalPlayer()
    local earPos = IsValid( lp ) and lp:EyePos() or nil

    for _, ent in ipairs( ents.FindByClass( IMPOSTER_CLASS_WILD ) ) do
        if not IsValid( ent ) then continue end
        if ent:GetNWInt( "ImposterPhase", IMPOSTER_PHASE_ROAM ) ~= IMPOSTER_PHASE_DISGUISED then continue end
        if not ent:GetNWBool( "ImposterDisguiseIsPlayer", false ) then continue end  -- NPC disguises stay silent
        -- Only when within earshot of the local player.
        if earPos and earPos:DistToSqr( ent:WorldSpaceCenter() ) > IMPOSTER_VOICE_HEAR_DISTSQR then continue end

        local talking = imposterTalking( ent )
        if talking then ent.ImposterCLLastTalk = now end
        local last  = ent.ImposterCLLastTalk or 0
        local alpha = talking and 1 or math.Clamp( 1 - ( now - last ), 0, 1 )  -- 1s fade
        if alpha <= 0 then continue end

        items[ #items + 1 ] = { ent = ent, alpha = alpha, talking = talking }
    end
    if #items == 0 then return end

    surface.SetFont( "GModNotify" )
    local drawX = ScrW() - 298
    local drawY = ScrH() - 142
    if ispanel( g_VoicePanelList ) then
        drawY = drawY - 44 * #g_VoicePanelList:GetChildren()
    end

    for _, item in ipairs( items ) do
        local ent, alpha = item.ent, item.alpha

        -- Volume-reactive green box, driven by the real audio channel level.
        local vol = item.talking and ( 0.4 + 0.6 * imposterVoiceVolume( ent ) ) or 0
        popupVol.g = math.floor( 255 * vol )
        popupVol.a = math.floor( alpha * 240 )
        draw.RoundedBox( 4, drawX, drawY, 246, 40, popupVol )

        -- Avatar: the victim's real Steam profile picture for player disguises,
        -- otherwise the disguise model's spawnicon.
        popupBase.a = math.floor( alpha * 255 )
        local pfp = getImposterAvatarPanel( ent:GetNWString( "ImposterVictimSteamID", "" ) )
        if pfp then
            pfp:SetPos( drawX + 4, drawY + 4 )
            pfp:SetAlpha( math.floor( alpha * 255 ) )
            pfp:PaintManual()
        else
            surface.SetDrawColor( popupBase )
            surface.SetMaterial( imposterAvatar( ent ) )
            surface.DrawTexturedRect( drawX + 4, drawY + 4, 32, 32 )
        end

        -- Impersonated name (same flicker as the targetID).
        local name = imposterDisplayName( ent )
        local tw   = surface.GetTextSize( name )
        if tw > 200 then name = string.sub( name, 0, ( #name * ( 202.5 / tw ) ) - 3 ) .. "..." end
        draw.SimpleText( name, "GModNotify", drawX + 43.5, drawY + 20, popupBase, TEXT_ALIGN_LEFT, TEXT_ALIGN_CENTER )

        drawY = drawY - 44
    end
end )

-- ─── Options menu settings panel (Q → Options → Imposter Nextbot) ────────────
-- The Imposter convars are FCVAR_REPLICATED (so we can read their live values here), which
-- makes them read-only clientside — binding controls to them via Command silently fails to
-- apply. So each control READS from the convar and pushes changes through the "imposter_set"
-- server concommand; the server validates (admin-gated) and applies. Works on listen and
-- dedicated servers alike.
local function imposterSendSetting( cvar, value )
    RunConsoleCommand( "imposter_set", cvar, tostring( value ) )
end

hook.Add( "PopulateToolMenu", "ImposterNextbot.SettingsTab", function()
    spawnmenu.AddToolMenuOption( "Options", "Imposter Nextbot", "ImposterSettings",
        "Imposter Nextbot", "", "", function( panel )
            panel:ClearControls()

            panel:AddControl( "Header", { Text = "Imposter Nextbot",
                Description = "Health applies on next spawn. All other settings take effect immediately. Host/admin only." } )

            local function section( text )
                local lbl = vgui.Create( "DLabel" )
                lbl:SetText( text )
                lbl:SetFont( "DermaDefaultBold" )
                lbl:SetTextColor( Color( 30, 30, 30 ) )
                lbl:SetTall( 22 )
                lbl:SetContentAlignment( 4 )
                panel:AddItem( lbl )
            end

            local function spacer()
                local sp = vgui.Create( "DPanel" )
                sp:SetTall( 6 )
                sp:SetPaintBackground( false )
                panel:AddItem( sp )
            end

            local function checkbox( label, cvar )
                local cb = vgui.Create( "DCheckBoxLabel" )
                cb:SetText( label )
                cb:SetDark( true )
                local cv = GetConVar( cvar )
                cb:SetChecked( cv and cv:GetBool() or false )
                cb.OnChange = function( _, val )
                    imposterSendSetting( cvar, val and 1 or 0 )
                end
                panel:AddItem( cb )
            end

            local function slider( label, cvar, min, max )
                local s = vgui.Create( "DNumSlider" )
                s:SetText( label )
                s:SetMin( min )
                s:SetMax( max )
                s:SetDecimals( 0 )
                s:SetDark( true )
                local cv = GetConVar( cvar )
                s:SetValue( cv and cv:GetFloat() or min )
                -- OnValueChanged fires continuously while dragging, so debounce: only the
                -- value the slider settles on (0.3s of no change) is sent to the server.
                s.OnValueChanged = function( _, val )
                    timer.Create( "ImposterSet_" .. cvar, 0.3, 1, function()
                        imposterSendSetting( cvar, math.Round( val ) )
                    end )
                end
                panel:AddItem( s )
            end

            section( "Stats" )
            slider( "Health",       "imposter_health",       1,  5000 )
            slider( "Detect Range", "imposter_detect_range", 64, 8000 )

            spacer()
            section( "Hunting" )
            checkbox( "Grab",        "imposter_grab_enable"     )
            checkbox( "Teleport",    "imposter_teleport_enable" )
            checkbox( "Tracking",    "imposter_tracking_enable" )
            checkbox( "Hearing",     "imposter_hearing_enable"  )
            checkbox( "Scent trail", "imposter_scent_enable"    )

            spacer()
            section( "Disguise & Deception" )
            checkbox( "Self disguise", "imposter_selfdisg_enable"     )
            checkbox( "Corpse absorb", "imposter_ragdoll_disg_enable" )
            checkbox( "Playdead",      "imposter_playdead_enable"     )
            checkbox( "Cloak",         "imposter_cloak_enable"        )

            spacer()
            section( "Survival" )
            checkbox( "Flee", "imposter_flee_enable" )

            spacer()
            section( "Debug" )
            checkbox( "Show overlay + console logs", "imposter_debug" )
        end )
end )
