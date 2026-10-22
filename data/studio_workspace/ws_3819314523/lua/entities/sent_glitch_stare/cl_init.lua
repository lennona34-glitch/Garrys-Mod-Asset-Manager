include("shared.lua")

function ENT:Draw()
    self:DrawShadow(false)
end

function ENT:DrawTranslucent()
    self:DrawShadow(false)
end
