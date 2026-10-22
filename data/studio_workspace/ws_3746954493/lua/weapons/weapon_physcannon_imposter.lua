AddCSLuaFile()

-- A cosmetic gravity-gun analog for the Imposter to hold while disguised. termhunter
-- has no built-in physcannon analog, so we reskin the crowbar analog with the
-- gravity gun's world model and a "physgun" hold type. The imposter never actually
-- fires it (its combat is all manual), so only the world model + hold pose matter.

SWEP.Base      = "weapon_crowbar_term"
SWEP.PrintName = "Imposter Gravity Gun"
SWEP.Author    = "ElegantChudWaffle"
SWEP.Spawnable = false
SWEP.AdminOnly = false

SWEP.ViewModel  = "models/weapons/c_physcannon.mdl"
SWEP.WorldModel = "models/weapons/w_physics.mdl"
SWEP.HoldType   = "physgun"
SWEP.PreOverrideClass = "weapon_physcannon"
