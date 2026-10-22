local CONFIG = {
    { cvar = "gsn_auto_spawn_enabled", label = "WE CAN HEAR YOU", description = "/Summon TBS_The_Broken_End", kind = "checkbox" },
    { cvar = "gsn_spawn_delay", label = "Auto Spawn Delay", min = 0, max = 600, decimals = 0 },
    { cvar = "gsn_min_spawn_distance", label = "Minimum Spawn Distance", min = 128, max = 12000, decimals = 0 },
    { cvar = "gsn_max_spawn_distance", label = "Maximum Spawn Distance", min = 256, max = 16000, decimals = 0 },
    { cvar = "gsn_too_close_distance", label = "Too Close Distance", min = 32, max = 3000, decimals = 0 },
    { cvar = "gsn_reappear_delay", label = "Chase Reappear Delay", min = 0, max = 300, decimals = 0 },
    { cvar = "gsn_crate_reappear_delay", label = "Crate Reappear Delay", min = 0, max = 600, decimals = 0 },
    { cvar = "gsn_crate_outcome_chance", label = "Crate Outcome Chance", min = 0, max = 100, decimals = 0 },
    { cvar = "gsn_cross_outcome_chance", label = "Red Cross Outcome Chance", min = 0, max = 100, decimals = 0 },
    { cvar = "gsn_chase_speed", label = "Chase Speed", min = 80, max = 3000, decimals = 0 },
    { cvar = "gsn_rain_bounds_expand", label = "Rain Bounds Expand", min = 0, max = 12000, decimals = 0 },
    { cvar = "gsn_rain_height", label = "Rain Height", min = 256, max = 20000, decimals = 0 }
}

local values = {}
local controls = {}

local function sendUpdate(cvar, value)
    timer.Create("gsn_config_send_" .. cvar, 0.25, 1, function()
        net.Start("gsn_config_update")
            net.WriteString(cvar)
            net.WriteFloat(value)
        net.SendToServer()
    end)
end

local function sendAction(action)
    net.Start("gsn_config_action")
        net.WriteString(action)
    net.SendToServer()
end

local function requestConfig()
    net.Start("gsn_config_request")
    net.SendToServer()
end

net.Receive("gsn_config_send", function()
    for _ = 1, net.ReadUInt(8) do
        local name = net.ReadString()
        local value = net.ReadFloat()
        values[name] = value

        local control = controls[name]
        if IsValid(control) then
            control.GSNRefreshing = true
            if control.SetChecked then
                control:SetChecked(value >= 1)
            else
                control:SetValue(value)
            end
            control.GSNRefreshing = false
        end
    end
end)

local function addConfigCheckbox(panel, item)
    local checkbox = vgui.Create("DCheckBoxLabel", panel)
    checkbox:SetText(item.label)
    checkbox:SetChecked((values[item.cvar] or 0) >= 1)
    checkbox:SizeToContents()
    checkbox.OnChange = function(self, checked)
        if self.GSNRefreshing then return end
        sendUpdate(item.cvar, checked and 1 or 0)
    end
    controls[item.cvar] = checkbox
    panel:AddItem(checkbox)
    if item.description then panel:Help(item.description) end
end

hook.Add("PopulateToolMenu", "gsn_tbs_config_menu", function()
    spawnmenu.AddToolMenuOption("Options", "The Broken End", "gsn_tbs_config", "TBS Config", "", "", function(panel)
        panel:ClearControls()
        panel:Help("TBS Config")
        panel:Help("Server settings only apply if you are in singleplayer or you are an admin.")
        controls = {}

        for _, item in ipairs(CONFIG) do
            if item.kind == "checkbox" then
                addConfigCheckbox(panel, item)
            else
                local slider = panel:NumSlider(item.label, item.cvar, item.min, item.max, item.decimals)
                slider.GSNRefreshing = true
                slider:SetValue(values[item.cvar] or item.min)
                slider.GSNRefreshing = false
                slider.OnValueChanged = function(self, value)
                    if not self.GSNRefreshing then sendUpdate(item.cvar, value) end
                end
                controls[item.cvar] = slider
            end
        end

        panel:Help("")
        local jumpscare = panel:CheckBox("NULL JUMPSCARE", "")
        jumpscare.OnChange = function(self, checked)
            if checked then
                sendAction("null_jumpscare")
                timer.Simple(0.1, function()
                    if IsValid(self) then self:SetChecked(false) end
                end)
            end
        end

        local clear = panel:Button("Clear Respawn/Noclip Locks")
        clear.DoClick = function() sendAction("clear_locks") end
        local refresh = panel:Button("Refresh Values")
        refresh.DoClick = requestConfig
        requestConfig()
    end)
end)
