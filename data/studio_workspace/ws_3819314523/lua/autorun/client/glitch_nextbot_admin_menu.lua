local OWNER_STEAMID64 = "76561198980455975"

local adminFrame
local panelToggle
local wasF6Down = false

local function isOwner()
    local ply = LocalPlayer()
    return IsValid(ply) and ply:SteamID64() == OWNER_STEAMID64
end

local function sendAdminAction(action)
    if not isOwner() then return end
    net.Start("gsn_private_admin_action_v2")
        net.WriteString(action)
    net.SendToServer()
end

local function closeSidePanel()
    if IsValid(adminFrame) then adminFrame:Remove() end
    adminFrame = nil
    if IsValid(panelToggle) and panelToggle:GetChecked() then
        panelToggle:SetChecked(false)
    end
end

local function addPanelButton(parent, label, action)
    local button = vgui.Create("DButton", parent)
    button:Dock(TOP)
    button:DockMargin(10, 0, 10, 8)
    button:SetTall(34)
    button:SetText(label)
    button.DoClick = function() sendAdminAction(action) end
end

local function openSidePanel()
    if not isOwner() then return end
    if IsValid(adminFrame) then
        adminFrame:MakePopup()
        return
    end

    adminFrame = vgui.Create("DFrame")
    adminFrame:SetTitle("TBS Admin Panel - F6 to close")
    adminFrame:SetSize(290, 184)
    adminFrame:SetPos(ScrW() - 314, math.floor((ScrH() - 184) * 0.5))
    adminFrame:SetSizable(false)
    adminFrame:SetDeleteOnClose(true)
    adminFrame:MakePopup()
    adminFrame.OnRemove = function()
        adminFrame = nil
        if IsValid(panelToggle) then panelToggle:SetChecked(false) end
    end

    local contents = vgui.Create("DPanel", adminFrame)
    contents:Dock(FILL)
    contents:DockPadding(0, 12, 0, 0)
    contents.Paint = nil
    addPanelButton(contents, "Spawn Private Stare", "spawn_private_stare")
    addPanelButton(contents, "Release Five Chasers", "spawn_five_simple_chasers")
    addPanelButton(contents, "NULL Jumpscare Everyone", "null_jumpscare_all")
end

local function toggleSidePanel()
    if IsValid(adminFrame) then closeSidePanel() else openSidePanel() end
end

hook.Add("Think", "gsn_admin_panel_f6_toggle", function()
    if not isOwner() then return end
    local down = input.IsKeyDown(KEY_F6)
    if down and not wasF6Down then toggleSidePanel() end
    wasF6Down = down
end)

hook.Add("PopulateToolMenu", "gsn_private_admin_toggle_menu", function()
    if not isOwner() then return end
    spawnmenu.AddToolMenuOption("Options", "The Broken End", "gsn_private_admin_toggle", "TBS Admin Config", "", "", function(panel)
        panel:ClearControls()
        panel:Help("TBS Admin Config")
        panelToggle = vgui.Create("DCheckBoxLabel", panel)
        panelToggle:SetText("Show Admin Panel")
        panelToggle:SetChecked(IsValid(adminFrame))
        panelToggle:SizeToContents()
        panelToggle.OnChange = function(_, checked)
            if checked then openSidePanel() else closeSidePanel() end
        end
        panel:AddItem(panelToggle)
        panel:Help("Press F6 to open or close the panel with mouse control.")
    end)
end)
