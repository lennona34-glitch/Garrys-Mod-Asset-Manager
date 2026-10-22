AddCSLuaFile( "cl_init.lua" )
AddCSLuaFile( "shared.lua" )
include( "shared.lua" )  -- ENT.Base = "nextbot_imposter" + metadata (both realms)

-- shared.lua's DEFINE_BASECLASS is file-local, so re-fetch the imposter parent here
-- for the BaseClass.AdditionalInitialize chain-up below.
local BaseClass = baseclass.Get( "nextbot_imposter" )

function ENT:AdditionalInitialize()
    -- Flag the agitated behaviour BEFORE the base init runs (the base brain reads
    -- ImposterIsRestless() in roam/disguise to prowl faster and hunt sooner).
    self.ImposterRestless = true

    -- Faster and more reckless, so a bit easier to put down than the patient base form
    -- (which keeps the default 0.45). Set before base init so it isn't overwritten.
    self.ImposterDamageScale = 0.55

    -- Make sure the quicker run speed is what the base captures into ImposterNormalRun.
    self.RunSpeed = 360

    BaseClass.AdditionalInitialize( self )
end
