AddCSLuaFile()
ENT.Type = "anim"
ENT.Base = "base_gmodentity"
ENT.PrintName = "Millennium Dragon"
ENT.Category = "ALT FILES - CONNIE"
ENT.Spawnable = true

CreateConVar("md_destroy_physgun", "0", FCVAR_ARCHIVE, "Destroy Physguns")
CreateConVar("md_toolgun_destroy", "0", FCVAR_ARCHIVE, "Destroy Tool guns")
CreateConVar("md_hate_each_other", "0", FCVAR_ARCHIVE, "Do MD's tear each other apart?")

if SERVER then
    function ENT:Initialize()
        self:SetModel("models/hunter/blocks/cube025x025x025.mdl")
        self:PhysicsInit(SOLID_VPHYSICS)
        self:SetMoveType(MOVETYPE_VPHYSICS)
        self:SetSolid(SOLID_VPHYSICS)
        self:SetNoDraw(true)
        self.Faction = "CONNIE"

        local phys = self:GetPhysicsObject()
        if IsValid(phys) then
            phys:Wake()
            phys:EnableGravity(false)
            phys:SetMass(15000)
            phys:EnableDrag(false)
        end

        self.Parts = {}
        
        self.Helmet = ents.Create("prop_physics")
        self.Helmet:SetModel("models/props_combine/combine_bunker01.mdl")
        self.Helmet:SetPos(self:GetPos())
        self.Helmet:SetAngles(self:GetAngles())
        self.Helmet:Spawn()
        self.Helmet:SetMoveType(MOVETYPE_NOCLIP)
        self.Helmet:SetSolid(SOLID_VPHYSICS)
        self.Helmet:SetMaxHealth(999999)
        self.Helmet:SetHealth(999999) 
        self:DeleteOnRemove(self.Helmet)
        table.insert(self.Parts, self.Helmet)

        self.Jaw = ents.Create("prop_physics")
        self.Jaw:SetModel("models/vehicles/prisoner_pod_inner.mdl")
        self.Jaw:SetPos(self:GetPos())
        self.Jaw:SetAngles(self:GetAngles())
        self.Jaw:SetModelScale(8, 0)
        self.Jaw:Spawn()
        self.Jaw:SetMoveType(MOVETYPE_NOCLIP)
        self.Jaw:SetSolid(SOLID_VPHYSICS)
        self.Jaw:SetMaxHealth(999999)
        self.Jaw:SetHealth(999999)
        self:DeleteOnRemove(self.Jaw)
        table.insert(self.Parts, self.Jaw)

        if self.Jaw:GetName() == "" then self.Jaw:SetName("md_jaw_"..self:EntIndex()) end

        self.KillAura = ents.Create("env_projectedtexture")
        self.KillAura:SetPos(self.Jaw:GetPos())
        self.KillAura:SetAngles(self.Jaw:GetAngles())
        self.KillAura:SetParent(self.Jaw)
        self.KillAura:SetLocalPos(Vector(0, 0, 0))
        self.KillAura:SetLocalAngles(Angle(90, 0, 0))
        self.KillAura:SetKeyValue("lightcolor", "255 0 0 255")
        self.KillAura:SetKeyValue("lightfov", "90")
        self.KillAura:SetKeyValue("farz", "6000")
        self.KillAura:SetKeyValue("nearz", "10")
        self.KillAura:Spawn()
        self:DeleteOnRemove(self.KillAura)

        self.HealthBulb = ents.Create("env_sprite")
        self.HealthBulb:SetKeyValue("model", "sprites/glow04_noz.vmt")
        self.HealthBulb:SetKeyValue("scale", "3")
        self.HealthBulb:SetKeyValue("rendermode", "9")
        self.HealthBulb:SetKeyValue("rendercolor", "0 255 0")
        self.HealthBulb:SetPos(self.Jaw:LocalToWorld(Vector(0, -150, -50)))
        self.HealthBulb:SetParent(self.Helmet)
        self.HealthBulb:Spawn()
        self:DeleteOnRemove(self.HealthBulb)

        for i = -1, 1, 2 do
            local eye = ents.Create("env_sprite")
            eye:SetKeyValue("model", "sprites/glow04_noz.vmt")
            eye:SetKeyValue("scale", "2")
            eye:SetKeyValue("rendermode", "9")
            eye:SetKeyValue("rendercolor", "255 255 255")
            eye:SetPos(self.Jaw:LocalToWorld(Vector(-40, 90 * i, 200))) 
            eye:SetParent(self.Jaw)
            eye:Spawn()
            self:DeleteOnRemove(eye)
        end

        local function SpawnSegment(model, scale, isUnderside)
            local seg = ents.Create("prop_physics")
            seg:SetModel(model)
            seg:SetPos(self:GetPos())
            seg:SetAngles(self:GetAngles())
            seg:SetModelScale(scale, 0)
            seg:Spawn()
            seg:SetMoveType(MOVETYPE_NOCLIP) 
            seg:SetSolid(SOLID_VPHYSICS)
            seg:SetOwner(self)
            seg:SetMaxHealth(999999)
            seg:SetHealth(999999)
            seg.IsDragonBody = true
            seg.IsUnderside = isUnderside
            self:DeleteOnRemove(seg)
            table.insert(self.Parts, seg)
            return seg
        end

        self.BodyA_Scale1 = SpawnSegment("models/props_combine/combine_barricade_med02c.mdl", 2, false)
        self.BodyA_Scale2 = SpawnSegment("models/props_combine/combine_barricade_med02c.mdl", 2, false)
        self.BodyA_Under = SpawnSegment("models/combine_dropship_container.mdl", 2, true)
        
        self.BodyB_Scale1 = SpawnSegment("models/props_combine/combine_barricade_med02c.mdl", 1.8, false)
        self.BodyB_Scale2 = SpawnSegment("models/props_combine/combine_barricade_med02c.mdl", 1.8, false)
        self.BodyB_Under = SpawnSegment("models/combine_dropship_container.mdl", 1.8, true)
        
        self.BodyC_Scale1 = SpawnSegment("models/props_combine/combine_barricade_med02c.mdl", 1.7, false)
        self.BodyC_Scale2 = SpawnSegment("models/props_combine/combine_barricade_med02c.mdl", 1.7, false)
        self.BodyC_Under = SpawnSegment("models/combine_dropship_container.mdl", 1.7, true)

        self.BodyD_Scale1 = SpawnSegment("models/props_combine/combine_barricade_med02c.mdl", 1.6, false)
        self.BodyD_Scale2 = SpawnSegment("models/props_combine/combine_barricade_med02c.mdl", 1.6, false)
        self.BodyD_Under = SpawnSegment("models/combine_dropship_container.mdl", 1.6, true)

        self.BodyE_Scale1 = SpawnSegment("models/props_combine/combine_barricade_med02c.mdl", 1.5, false)
        self.BodyE_Scale2 = SpawnSegment("models/props_combine/combine_barricade_med02c.mdl", 1.5, false)
        self.BodyE_Under = SpawnSegment("models/combine_dropship_container.mdl", 1.5, true)

        self.BodyF_Scale1 = SpawnSegment("models/props_combine/combine_barricade_med02c.mdl", 1.5, false)
        self.BodyF_Scale2 = SpawnSegment("models/props_combine/combine_barricade_med02c.mdl", 1.5, false)
        self.BodyF_Under = SpawnSegment("models/combine_dropship_container.mdl", 1.5, true)

        self.Tail = SpawnSegment("models/props_combine/headcrabcannister01a.mdl", 3, false)
        self.Tail.IsDragonTail = true

        local smoke = ents.Create("env_smokestack")
        smoke:SetPos(self.Tail:GetPos())
        smoke:SetParent(self.Tail)
        smoke:SetKeyValue("InitialState", "1")
        smoke:SetKeyValue("BaseSpread", "40")
        smoke:SetKeyValue("SpreadSpeed", "15")
        smoke:SetKeyValue("Speed", "80")
        smoke:SetKeyValue("StartSize", "50")
        smoke:SetKeyValue("EndSize", "100")
        smoke:SetKeyValue("Rate", "10")
        smoke:SetKeyValue("JetLength", "100")
        smoke:SetKeyValue("SmokeMaterial", "particle/particle_smokegrenade")
        smoke:SetKeyValue("rendercolor", "0 0 0")
        smoke:SetKeyValue("renderamt", "220")
        smoke:Spawn()
        smoke:Activate()
        smoke:Fire("TurnOn")
        self:DeleteOnRemove(smoke)

        self.Bones = {}
        for i=1, 8 do
            self.Bones[i] = { pos = self:GetPos() - self:GetForward() * (i * 300), ang = self:GetAngles() }
        end
        self.BoneDistances = { 0, 350, 450, 450, 420, 400, 400, 400 }

        self.Bullseye = ents.Create("npc_bullseye")
        self.Bullseye:SetPos(self:GetPos() + Vector(0,0,-100))
        self.Bullseye:SetParent(self)
        self.Bullseye:Spawn()
        self.Bullseye:Activate()
        self.Bullseye:SetSolid(SOLID_BBOX)
        self.Bullseye:SetMaxHealth(6000)
        self.Bullseye:SetHealth(6000)
        self.Bullseye.Faction = "CONNIE"
        self:DeleteOnRemove(self.Bullseye)

        self.BullseyeVis = ents.Create("env_sprite")
        self.BullseyeVis:SetKeyValue("model", "sprites/glow04_noz.vmt")
        self.BullseyeVis:SetKeyValue("scale", "1.5")
        self.BullseyeVis:SetKeyValue("rendermode", "9")
        self.BullseyeVis:SetKeyValue("rendercolor", "255 0 0")
        self.BullseyeVis:SetPos(self.Bullseye:GetPos())
        self.BullseyeVis:SetParent(self.Bullseye)
        self.BullseyeVis:Spawn()

        self.DamageTracker = 0
        self.LastDebrisHealth = 6000 
        self.HalfHealthTriggered = false
        self.IsDying = false
        self.DeathIntensity = 0

        hook.Add("EntityTakeDamage", "MD_DamageRoute_"..self:EntIndex(), function(ent, dmg)
            if not IsValid(self) or self.IsDying then 
                if self.IsDying then hook.Remove("EntityTakeDamage", "MD_DamageRoute_"..self:EntIndex()) end
                return 
            end

            if ent.MD_BypassDamage then return end
            if ent == self or ent == self.Helmet or ent == self.Jaw or ent.IsDragonTail or (ent.IsDragonBody and ent:GetOwner() == self) or ent == self.Bullseye then
                if not IsValid(self.Bullseye) then return end
                
                local attacker = dmg:GetAttacker()
                if attacker == self or attacker == self.Bullseye then 
                    dmg:SetDamage(0) 
                    return true 
                end
                
                local amt = dmg:GetDamage()
                local dType = dmg:GetDamageType()
                
                if dType == DMG_SHOCK then
                    local heal = amt * 0.5
                    self.Bullseye:SetHealth(math.min(self.Bullseye:GetMaxHealth(), self.Bullseye:Health() + heal))
                    dmg:SetDamage(0) 
                    return true
                end

                local isExplosive = dmg:IsDamageType(DMG_BLAST)

                if isExplosive and math.random(1, 100) <= 40 then
                    local atk = dmg:GetAttacker()
                    if IsValid(atk) then
                        local spawnPos = self.Jaw:GetPos() + self.Jaw:GetForward() * 50
                        local dir = (atk:WorldSpaceCenter() - spawnPos):GetNormalized()
                        local rocket = ents.Create("rpg_missile")
                        rocket:SetPos(spawnPos)
                        rocket:SetAngles(dir:Angle())
                        rocket:SetOwner(self)
                        rocket:Spawn()
                        rocket:SetVelocity(dir * 1500)
                        rocket:SetSaveValue("m_flDamage", 50)
                        self:EmitSound("weapons/rpg/rocketfire1.wav", 100, 100)
                    end
                    dmg:SetDamage(0)
                    return true
                end

                if dmg:IsDamageType(DMG_BULLET) or dmg:IsDamageType(DMG_ACID) then amt = amt * 0.15
                elseif dmg:IsDamageType(DMG_BURN) or dmg:IsDamageType(DMG_CLUB) or dmg:IsDamageType(DMG_POISON) then amt = amt * 0.01
                elseif isExplosive then amt = amt * 2.0 
                else amt = amt * 0.60 end

                if not isExplosive then
                    if ent == self or ent == self.Helmet or ent == self.Bullseye then amt = amt * 0.70 
                    elseif ent == self.Jaw then amt = amt * 0.90
                    elseif ent.IsDragonTail then amt = amt * 0.10
                    elseif ent.IsDragonBody then
                        if ent.IsUnderside then amt = amt * 0.75 else amt = amt * 0.25 end
                    end
                end

                self.DamageTracker = self.DamageTracker + amt
                local inflictor = dmg:GetInflictor()
                if ent == self.Bullseye then
                    local newHealth = ent:Health() - amt
                    ent:SetHealth(newHealth)
                    
                    if newHealth <= 0 then
                        local d = DamageInfo()
                        d:SetDamage(ent:GetMaxHealth() * 2)
                        d:SetDamageType(DMG_GENERIC)
                        d:SetAttacker(IsValid(attacker) and attacker or self)
                        d:SetInflictor(IsValid(inflictor) and inflictor or self)
                        ent.MD_BypassDamage = true
                        ent:TakeDamageInfo(d)
                        ent.MD_BypassDamage = false
                    end
                    
                    dmg:SetDamage(0)
                    dmg:SetDamageForce(Vector(0, 0, 0))
                    return true
                else
                    dmg:SetDamage(0)
                    dmg:SetDamageForce(Vector(0, 0, 0))
                    
                    local currentHealth = self.Bullseye:Health()
                    local postHitHealth = currentHealth - amt
                    self.Bullseye:SetHealth(postHitHealth)
                    
                    if postHitHealth <= 0 then
                        local d = DamageInfo()
                        d:SetDamage(self.Bullseye:GetMaxHealth() * 2)
                        d:SetDamageType(DMG_GENERIC)
                        d:SetAttacker(IsValid(attacker) and attacker or self)
                        d:SetInflictor(IsValid(inflictor) and inflictor or self)
                        self.Bullseye.MD_BypassDamage = true
                        self.Bullseye:TakeDamageInfo(d)
                        self.Bullseye.MD_BypassDamage = false
                    end
                    
                    return true
                end
            end
        end)

        local function TouchDamage(ent, data)
            local victim = data.HitEntity
            if IsValid(victim) and (victim:IsPlayer() or victim:IsNPC()) and victim ~= self and not victim.IsDragonBody then
                if CurTime() > (victim.MD_NextTouchZap or 0) then
                    victim.MD_NextTouchZap = CurTime() + 0.5
                    local d = DamageInfo()
                    d:SetDamage(100)
                    d:SetDamageType(DMG_SHOCK)
                    d:SetAttacker(self)
                    d:SetInflictor(self)
                    victim:TakeDamageInfo(d)
                    
                    local pushDir = (victim:WorldSpaceCenter() - ent:WorldSpaceCenter()):GetNormalized()
                    if victim:IsPlayer() then
                        victim:SetVelocity(pushDir * 1000 + Vector(0,0,300))
                    else
                        local vp = victim:GetPhysicsObject()
                        if IsValid(vp) then vp:ApplyForceCenter(pushDir * 20000 + Vector(0,0,5000)) end
                    end
                    sound.Play("ambient/energy/zap" .. math.random(1,3) .. ".wav", data.HitPos, 90, 100)
                    local ed = EffectData() ed:SetOrigin(data.HitPos) ed:SetMagnitude(2) util.Effect("ElectricSpark", ed)
                end
            end
        end

        self:AddCallback("PhysicsCollide", TouchDamage)
        self.Helmet:AddCallback("PhysicsCollide", TouchDamage)
        self.Jaw:AddCallback("PhysicsCollide", TouchDamage)
        for _, p in ipairs(self.Parts) do p:AddCallback("PhysicsCollide", TouchDamage) end

        self.TargetAltitude = math.random(1000, 3000)
        self.NextAttackChoice = CurTime() + 10
        self.NextRoamChange = CurTime()
        self.IsScattershotting = false

        local trGround = util.TraceLine({
            start = self:GetPos(),
            endpos = self:GetPos() - Vector(0, 0, 30000),
            mask = MASK_SOLID_BRUSHONLY
        })
        local gPos = trGround.HitPos
        local skyPos = gPos + Vector(0, 0, 15000)

        local targSpawnName = "md_spawn_" .. self:EntIndex()
        local targSpawn = ents.Create("info_target")
        targSpawn:SetPos(gPos)
        targSpawn:SetName(targSpawnName)
        targSpawn:Spawn()

        local spawnLaser = ents.Create("env_laser")
        spawnLaser:SetPos(skyPos)
        spawnLaser:SetKeyValue("texture", "sprites/laserbeam.vmt")
        spawnLaser:SetKeyValue("rendercolor", "100 200 255")
        spawnLaser:SetKeyValue("width", "40")
        spawnLaser:SetKeyValue("damage", "0")
        spawnLaser:SetKeyValue("NoiseAmplitude", "5")
        spawnLaser:SetKeyValue("LaserTarget", targSpawnName)
        spawnLaser:Spawn()
        spawnLaser:Activate()
        spawnLaser:Fire("TurnOn")
        spawnLaser:SetRenderMode(RENDERMODE_TRANSADD)
        spawnLaser:SetColor(Color(100, 200, 255, 255))

        timer.Simple(1.0, function()
            if IsValid(self) then
                local ed = EffectData()
                ed:SetOrigin(gPos)
                ed:SetScale(20)
                util.Effect("cball_explode", ed)
                sound.Play("ambient/explosions/explode_4.wav", gPos, 150, 80)
                util.ScreenShake(gPos, 20, 20, 1.5, 8000)
                
                for _, ply in ipairs(player.GetAll()) do
                    if ply:GetPos():DistToSqr(self:GetPos()) < 64000000 then
                        ply:ScreenFade(SCREENFADE.IN, Color(255, 255, 255, 255), 1, 0)
                    end
                end
            end
            
            local fadeSteps = 15
            for i = 1, fadeSteps do
                timer.Simple((1.5 / fadeSteps) * i, function()
                    if IsValid(spawnLaser) then
                        local alpha = math.floor(255 - (255 / fadeSteps) * i)
                        spawnLaser:SetColor(Color(100, 200, 255, alpha))
                        spawnLaser:SetKeyValue("renderamt", tostring(alpha))
                        if i == fadeSteps then 
                            spawnLaser:Remove() 
                            if IsValid(targSpawn) then targSpawn:Remove() end
                        end
                    end
                end)
            end
        end)
    end

    function ENT:OnRemove()
        hook.Remove("EntityTakeDamage", "MD_DamageRoute_"..self:EntIndex()) 
        for _, p in ipairs(self.Parts or {}) do
            if IsValid(p) and p ~= self then p:Remove() end
        end
    end

    function ENT:TriggerDeath()
        if self.IsDying then return end
        self.IsDying = true
        self.DeathIntensity = 0
        self.IsWindingUp = false
        self.IsScattershotting = false
        self.PendingAttack = nil

        for _, ply in ipairs(player.GetAll()) do
            ply:EmitSound("ambient/alarms/citadel_alert_loop2.wav")
        end

        self.DeathGlow = ents.Create("env_sprite")
        self.DeathGlow:SetKeyValue("model", "sprites/light_glow02_add.vmt")
        self.DeathGlow:SetKeyValue("scale", "1")
        self.DeathGlow:SetKeyValue("rendermode", "5")
        self.DeathGlow:SetKeyValue("rendercolor", "150 50 255")
        self.DeathGlow:SetPos(self.Helmet:WorldSpaceCenter())
        self.DeathGlow:SetParent(self.Helmet)
        self.DeathGlow:Spawn()

        self.DeathLight = ents.Create("light_dynamic")
        self.DeathLight:SetPos(self.Helmet:WorldSpaceCenter())
        self.DeathLight:SetKeyValue("_light", "150 50 255 255")
        self.DeathLight:SetKeyValue("distance", "100")
        self.DeathLight:SetKeyValue("brightness", "4")
        self.DeathLight:SetParent(self.Helmet)
        self.DeathLight:Spawn()

        local DeathParts = {
            {self.Tail},
            {self.BodyF_Scale1, self.BodyF_Scale2, self.BodyF_Under},
            {self.BodyE_Scale1, self.BodyE_Scale2, self.BodyE_Under},
            {self.BodyD_Scale1, self.BodyD_Scale2, self.BodyD_Under},
            {self.BodyC_Scale1, self.BodyC_Scale2, self.BodyC_Under},
            {self.BodyB_Scale1, self.BodyB_Scale2, self.BodyB_Under},
            {self.BodyA_Scale1, self.BodyA_Scale2, self.BodyA_Under}
        }

        local delay = 2.0
        local totalTime = 0

        for i = 1, 7 do
            totalTime = totalTime + delay
            timer.Simple(totalTime, function()
                if not IsValid(self) then return end
                self.DeathIntensity = i

                for _, ply in ipairs(player.GetAll()) do
                    if ply:GetPos():DistToSqr(self:GetPos()) < 100000000 then 
                        ply:SetNWInt("MD_DeathPhase", i)
                    end
                end

                local parts = DeathParts[i]
                if parts then
                    local explosionPos = IsValid(parts[1]) and parts[1]:WorldSpaceCenter() or self:WorldSpaceCenter()
                    local ed = EffectData()
                    ed:SetOrigin(explosionPos)
                    ed:SetScale(10)
                    util.Effect("cball_explode", ed)
                    sound.Play("ambient/explosions/explode_9.wav", explosionPos, 140, 70)

                    for _, p in ipairs(parts) do
                        if IsValid(p) then
                            p.IsDetached = true
                            p.IsDragonBody = false 
                            p:SetParent(nil)
                            p:SetMoveType(MOVETYPE_VPHYSICS)
                            p:SetCollisionGroup(COLLISION_GROUP_DEBRIS)
                            local phys = p:GetPhysicsObject()
                            if IsValid(phys) then
                                phys:EnableMotion(true)
                                phys:Wake()
                                phys:EnableGravity(true)
                                phys:SetVelocity(VectorRand() * 500 + Vector(0,0,800))
                                phys:AddAngleVelocity(VectorRand() * 500)
                            end
                            SafeRemoveEntityDelayed(p, 10)
                        end
                    end
                end
            end)
            delay = math.max(0.25, delay - 0.25)
        end

        timer.Simple(totalTime + 1.0, function()
            if not IsValid(self) then return end
            self.Dead = true 
            
            local finalPos = self.Helmet:WorldSpaceCenter()
            local ed = EffectData() ed:SetOrigin(finalPos) ed:SetScale(30) util.Effect("cball_explode", ed)
            sound.Play("ambient/explosions/explode_4.wav", finalPos, 150, 70)
            
            for _, ply in ipairs(player.GetAll()) do
                if ply:GetPos():DistToSqr(self:GetPos()) < 100000000 then
                    ply:SetNWInt("MD_DeathPhase", 0)
                    ply:StopSound("ambient/alarms/citadel_alert_loop2.wav")
                    ply:ScreenFade(SCREENFADE.IN, Color(255, 255, 255, 255), 3, 2)
                end
            end
            
            local dissolve = ents.Create("env_entity_dissolver")
            dissolve:SetPos(finalPos)
            dissolve:SetKeyValue("dissolvetype", "0")
            dissolve:Spawn()
            
            if IsValid(self.Helmet) then self.Helmet:SetName("md_dissolve_helm_"..self:EntIndex()) dissolve:Fire("Dissolve", self.Helmet:GetName()) end
            if IsValid(self.Jaw) then self.Jaw:SetName("md_dissolve_jaw_"..self:EntIndex()) dissolve:Fire("Dissolve", self.Jaw:GetName()) end
            self:SetName("md_dissolve_core_"..self:EntIndex())
            dissolve:Fire("Dissolve", self:GetName())
            
            SafeRemoveEntityDelayed(dissolve, 0.5)
            SafeRemoveEntityDelayed(self, 1.0)
        end)
    end

    function ENT:Attack_Scattershot()
        if not IsValid(self.Target) then return end
        local tPos = self.Target:WorldSpaceCenter()
        local spawnedBalls = {}

        self.IsScattershotting = true
        self:EmitSound("npc/strider/charging.wav", 110, 130)

        for i = 1, 9 do
            timer.Simple(i * 0.15, function()
                if not IsValid(self) or self.Dead then return end

                local randSpot = tPos + Vector(math.random(-900, 900), math.random(-900, 900), 0)
                local tr = util.TraceLine({start = randSpot + Vector(0,0,1000), endpos = randSpot - Vector(0,0,5000), mask = MASK_SOLID_BRUSHONLY})
                local hitPos = tr.HitPos
                
                local ball = ents.Create("prop_physics")
                ball:SetModel("models/weapons/w_bugbait.mdl")
                ball:SetPos(hitPos + Vector(0,0,20))
                ball:Spawn()
                ball:SetOwner(self)
                ball:SetNoDraw(true)
                local bPhys = ball:GetPhysicsObject()
                if IsValid(bPhys) then bPhys:EnableMotion(false) end
                
                local glow = ents.Create("env_sprite")
                glow:SetKeyValue("model", "sprites/light_glow02_add.vmt")
                glow:SetKeyValue("scale", "5")
                glow:SetKeyValue("rendermode", "5")
                glow:SetKeyValue("rendercolor", "100 200 255")
                glow:SetPos(ball:GetPos())
                glow:SetParent(ball)
                glow:Spawn()
                ball.MyGlow = glow
                
                table.insert(spawnedBalls, ball)
                
                local targName = "md_scat_targ_" .. ball:EntIndex()
                local targ = ents.Create("info_target")
                targ:SetName(targName)
                targ:SetPos(hitPos)
                targ:Spawn()
                
                local currentTipPos = self.Jaw:GetPos()
                local beam = ents.Create("env_laser")
                beam:SetPos(currentTipPos)
                beam:SetKeyValue("texture", "sprites/physbeam.vmt")
                beam:SetKeyValue("rendercolor", "100 200 255")
                beam:SetKeyValue("width", "10")
                beam:SetKeyValue("damage", "0")
                beam:SetKeyValue("LaserTarget", targName)
                beam:SetKeyValue("NoiseAmplitude", "1.5")
                beam:Spawn()
                beam:Activate()
                beam:Fire("TurnOn")
                beam:SetRenderMode(RENDERMODE_TRANSADD)
                beam:SetColor(Color(100, 200, 255, 255))
                
                sound.Play("weapons/physcannon/physcannon_charge.wav", currentTipPos, 90, 150)
                
                local fadeSteps = 10
                for j = 1, fadeSteps do
                    timer.Simple((0.5 / fadeSteps) * j, function()
                        if IsValid(beam) then
                            local a = math.floor(255 - (255 / fadeSteps) * j)
                            beam:SetColor(Color(100, 200, 255, a))
                            beam:SetKeyValue("renderamt", tostring(a))
                            if j == fadeSteps then
                                beam:Remove()
                                if IsValid(targ) then targ:Remove() end
                            end
                        end
                    end)
                end
            end)
        end

        timer.Simple(9 * 0.15 + 2.0, function()
            if not IsValid(self) then return end
            self.IsScattershotting = false

            if #spawnedBalls > 0 then
                local sPos = IsValid(self.Target) and self.Target:WorldSpaceCenter() or self.Jaw:GetPos()
                sound.Play("weapons/physcannon/energy_sing_explosion2.wav", sPos, 140, 100)
            end

            for _, b in ipairs(spawnedBalls) do
                if IsValid(b) then
                    local bPos = b:GetPos()
                    for _, tgt in ipairs(ents.FindInSphere(bPos, 300)) do
                        if (tgt:IsPlayer() or tgt:IsNPC()) and tgt:Health() > 0 and tgt ~= self and not tgt.IsDragonBody then
                            local dmgInfo = DamageInfo()
                            dmgInfo:SetDamage(math.random(30, 60))
                            dmgInfo:SetDamageType(DMG_SHOCK)
                            dmgInfo:SetAttacker(self)
                            dmgInfo:SetInflictor(self)
                            tgt:TakeDamageInfo(dmgInfo)
                        end
                    end
                    
                    local ed = EffectData()
                    ed:SetOrigin(bPos)
                    ed:SetScale(1)
                    util.Effect("cball_explode", ed)

                    local tesla = ents.Create("point_tesla")
                    tesla:SetPos(bPos + Vector(0,0,10))
                    tesla:SetKeyValue("m_flRadius", "500")
                    tesla:SetKeyValue("m_SoundName", "DoSpark")
                    tesla:SetKeyValue("beamcount_min", "12")
                    tesla:SetKeyValue("beamcount_max", "20")
                    tesla:SetKeyValue("texture", "sprites/physbeam.vmt")
                    tesla:SetKeyValue("m_Color", "200 200 255")
                    tesla:SetKeyValue("thick_min", "5")
                    tesla:SetKeyValue("thick_max", "10")
                    tesla:SetKeyValue("lifetime_min", "0.3")
                    tesla:SetKeyValue("lifetime_max", "0.5")
                    tesla:Spawn()
                    tesla:Fire("DoSpark", "", 0)
                    SafeRemoveEntityDelayed(tesla, 0.5)

                    sound.Play("weapons/physcannon/energy_sing_explosion2.wav", bPos, 10, 100)

                    if IsValid(b.MyGlow) then
                        local g = b.MyGlow
                        g:SetParent(nil)
                        local sTime = CurTime()
                        local gName = "MD_ScatShrink_" .. g:EntIndex()
                        hook.Add("Think", gName, function()
                            if not IsValid(g) then hook.Remove("Think", gName) return end
                            local frac = 1 - ((CurTime() - sTime) / 1.0)
                            if frac <= 0 then SafeRemoveEntity(g) hook.Remove("Think", gName) return end
                            g:SetKeyValue("scale", tostring(3 * frac))
                        end)
                    end

                    b:Remove()
                end
            end
        end)
    end

    function ENT:Attack_SolarEruption()
        local spawnPos = self.Helmet:LocalToWorld(Vector(100, 0, -100))
        local ball = ents.Create("prop_physics")
        ball:SetModel("models/roller.mdl") 
        ball:SetMaterial("models/props_combine/portalbomb_rad")
        ball:SetColor(Color(255, 128, 0, 255))
        ball:SetPos(spawnPos)
        ball:SetAngles(self.Helmet:GetAngles())
        ball:Spawn()
        ball:SetModelScale(3.0)
        ball:SetOwner(self)
        ball:SetCollisionGroup(COLLISION_GROUP_DEBRIS)

        for _, p in ipairs(self.Parts) do if IsValid(p) then constraint.NoCollide(ball, p, 0, 0) end end
        constraint.NoCollide(ball, self, 0, 0)

        local glow = ents.Create("env_sprite")
        glow:SetKeyValue("model", "sprites/light_glow02_add.vmt")
        glow:SetKeyValue("scale", "10")
        glow:SetKeyValue("rendermode", "5")
        glow:SetKeyValue("rendercolor", "255 100 0")
        glow:SetParent(ball)
        glow:SetPos(ball:GetPos())
        glow:Spawn()

        local dlight = ents.Create("light_dynamic")
        dlight:SetPos(ball:GetPos())
        dlight:SetKeyValue("_light", "255 128 0 255")
        dlight:SetKeyValue("distance", "1000")
        dlight:SetKeyValue("brightness", "4")
        dlight:SetParent(ball)
        dlight:Spawn()

        local smoke = ents.Create("env_smokestack")
        smoke:SetPos(ball:GetPos())
        smoke:SetKeyValue("InitialState", "1")
        smoke:SetKeyValue("BaseSpread", "20")
        smoke:SetKeyValue("SpreadSpeed", "15")
        smoke:SetKeyValue("Speed", "40")
        smoke:SetKeyValue("StartSize", "80")
        smoke:SetKeyValue("EndSize", "200")
        smoke:SetKeyValue("Rate", "30")
        smoke:SetKeyValue("JetLength", "70")
        smoke:SetKeyValue("SmokeMaterial", "particle/particle_smokegrenade")
        smoke:SetKeyValue("rendercolor", "255 100 0")
        smoke:SetKeyValue("renderamt", "220")
        smoke:Spawn()
        smoke:Activate()
        smoke:Fire("TurnOn")
        ball:DeleteOnRemove(smoke)

        local bPhys = ball:GetPhysicsObject()
        if IsValid(bPhys) then
            bPhys:EnableGravity(false)
            local dir = self.Helmet:GetForward()
            if IsValid(self.Target) then dir = (self.Target:WorldSpaceCenter() - ball:GetPos()):GetNormalized() end
            bPhys:SetVelocity(dir * 2250)
            smoke:SetPos(ball:GetPos() + dir * 100) 
        end

        local isSplit = (math.random(1, 3) == 1)
        if isSplit then
            timer.Simple(1.5, function()
                if not IsValid(ball) or ball.Exploded then return end
                ball.Exploded = true
                local vel = ball:GetPhysicsObject():GetVelocity()
                local pos = ball:GetPos()
                SafeRemoveEntity(ball)
                
                for j=1, 5 do
                    local debris = ents.Create("prop_physics")
                    debris:SetModel("models/roller.mdl")
                    debris:SetMaterial("models/props_combine/portalbomb_rad")
                    debris:SetColor(Color(255, 128, 0, 255))
                    debris:SetPos(pos + VectorRand() * 50)
                    debris:Spawn()
                    debris:SetModelScale(1.0) 
                    debris:Ignite(10)
                    debris:SetOwner(self)
                    local dp = debris:GetPhysicsObject()
                    if IsValid(dp) then
                        dp:EnableGravity(true)
                        dp:SetVelocity(vel * 0.8 + VectorRand() * 500)
                    end
                    debris:AddCallback("PhysicsCollide", function(c, d)
                        if c.Exploded then return end
                        c.Exploded = true
                        
                        util.BlastDamage(self, self, d.HitPos, 200, math.random(20, 40))
                        
                        local fire = ents.Create("env_fire")
                        fire:SetPos(d.HitPos)
                        fire:SetKeyValue("health", "5")
                        fire:SetKeyValue("firesize", "60")
                        fire:SetKeyValue("spawnflags", "128")
                        fire:Spawn()
                        fire:Fire("StartFire")

                        local e = EffectData() e:SetOrigin(d.HitPos) e:SetScale(0.5) util.Effect("Explosion", e)
                        SafeRemoveEntity(c)
                    end)
                    SafeRemoveEntityDelayed(debris, 5)
                end
            end)
        end

        hook.Add("Think", "MDSolarHoming_"..ball:EntIndex(), function()
            if not IsValid(ball) then hook.Remove("Think", "MDSolarHoming_"..ball:EntIndex()) return end
            if not IsValid(self.Target) or ball.Exploded then return end
            local bp = ball:GetPhysicsObject()
            if IsValid(bp) then
                local currentVel = bp:GetVelocity()
                local speed = currentVel:Length()
                local dirToTarget = (self.Target:WorldSpaceCenter() - ball:GetPos()):GetNormalized()
                local newDir = LerpVector(0.01, currentVel:GetNormalized(), dirToTarget):GetNormalized()
                bp:SetVelocity(newDir * speed)
                
                if IsValid(smoke) then smoke:SetPos(ball:GetPos() + newDir * 100) end
            end
        end)

        ball:AddCallback("PhysicsCollide", function(cEnt, data)
            if cEnt.Exploded then return end
            cEnt.Exploded = true
            
            local hitPos = data.HitPos
            util.BlastDamage(self, self, hitPos, 400, math.random(70, 120))
            
            local ed = EffectData() ed:SetOrigin(hitPos) util.Effect("Explosion", ed)
            local ed2 = EffectData() ed2:SetOrigin(hitPos) ed2:SetScale(200) util.Effect("ThumperDust", ed2)
            sound.Play("ambient/explosions/explode_8.wav", hitPos, 130, 90)

            util.ScreenShake(hitPos, 20, 20, 1.5, 1000)

            for i=1, math.random(5, 8) do
                local offset = Vector(math.random(-400, 400), math.random(-400, 400), 200)
                local tr = util.TraceLine({start = hitPos + offset, endpos = hitPos + offset - Vector(0,0,500), mask = MASK_SOLID_BRUSHONLY})
                if tr.Hit then
                    local fire = ents.Create("env_fire")
                    fire:SetPos(tr.HitPos)
                    fire:SetKeyValue("health", "10")
                    fire:SetKeyValue("firesize", tostring(math.random(50, 150)))
                    fire:SetKeyValue("spawnflags", "128")
                    fire:Spawn()
                    fire:Fire("StartFire")
                end
            end
            SafeRemoveEntity(cEnt)
        end)
        SafeRemoveEntityDelayed(ball, 10)
    end

    function ENT:Attack_SoulCharge()
        local spawnPos = self.Jaw:LocalToWorld(Vector(100, 0, -50))
        local dir = self.Jaw:GetForward()
        if IsValid(self.Target) then dir = (self.Target:WorldSpaceCenter() - spawnPos):GetNormalized() end

        local isSpiral = (math.random(1, 3) == 1)

        for i=1, 3 do
            local ball = ents.Create("prop_combine_ball")
            ball:SetPos(spawnPos)
            ball:SetAngles(self.Jaw:GetAngles())
            ball:Spawn()
            ball:SetModelScale(3.0)
            ball:SetOwner(self)

            local glow = ents.Create("env_sprite")
            glow:SetKeyValue("model", "sprites/light_glow02_add.vmt")
            glow:SetKeyValue("scale", "9")
            glow:SetKeyValue("rendermode", "5")
            glow:SetKeyValue("rendercolor", "0 200 255")
            glow:SetParent(ball)
            glow:SetPos(ball:GetPos())
            glow:Spawn()

            local smoke = ents.Create("env_smokestack")
            smoke:SetPos(ball:GetPos())
            smoke:SetKeyValue("InitialState", "1")
            smoke:SetKeyValue("BaseSpread", "20")
            smoke:SetKeyValue("SpreadSpeed", "15")
            smoke:SetKeyValue("Speed", "40")
            smoke:SetKeyValue("StartSize", "40")
            smoke:SetKeyValue("EndSize", "100")
            smoke:SetKeyValue("Rate", "30")
            smoke:SetKeyValue("JetLength", "100")
            smoke:SetKeyValue("SmokeMaterial", "particle/particle_smokegrenade")
            smoke:SetKeyValue("rendercolor", "0 150 255")
            smoke:SetKeyValue("renderamt", "220")
            smoke:Spawn()
            smoke:Activate()
            smoke:Fire("TurnOn")
            ball:DeleteOnRemove(smoke)

            local bPhys = ball:GetPhysicsObject()
            if IsValid(bPhys) then
                bPhys:EnableGravity(false)
                
                if isSpiral then
                    if i == 1 then
                        self.SC_Center = ball
                        bPhys:SetVelocity(dir * 3000)
                        smoke:SetPos(ball:GetPos() + dir * 100)
                        
                        hook.Add("Think", "MDSoulHoming_"..ball:EntIndex(), function()
                            if not IsValid(ball) then hook.Remove("Think", "MDSoulHoming_"..ball:EntIndex()) return end
                            if not IsValid(self.Target) or ball.Exploded then return end
                            local bp = ball:GetPhysicsObject()
                            if IsValid(bp) then
                                local currentVel = bp:GetVelocity()
                                local speed = currentVel:Length()
                                local dirToTarget = (self.Target:WorldSpaceCenter() - ball:GetPos()):GetNormalized()
                                local newDir = LerpVector(0.01, currentVel:GetNormalized(), dirToTarget):GetNormalized()
                                bp:SetVelocity(newDir * speed)
                                if IsValid(smoke) then smoke:SetPos(ball:GetPos() + newDir * 100) end
                            end
                        end)
                    else
                        local offsetAng = (i == 2) and 0 or math.pi
                        hook.Add("Think", "MDSoulSpiral_"..ball:EntIndex(), function()
                            if not IsValid(ball) then hook.Remove("Think", "MDSoulSpiral_"..ball:EntIndex()) return end
                            local center = self.SC_Center
                            if not IsValid(center) then
                                if IsValid(ball) then ball:Fire("Explode") end
                                hook.Remove("Think", "MDSoulSpiral_"..ball:EntIndex())
                                return
                            end
                            local fwd = center:GetVelocity():GetNormalized()
                            local right = fwd:Angle():Right()
                            local up = fwd:Angle():Up()
                            local time = CurTime() * 15
                            local targetPos = center:GetPos() + right * math.cos(time + offsetAng)*100 + up * math.sin(time + offsetAng)*100
                            
                            local bP = ball:GetPhysicsObject()
                            if IsValid(bP) then 
                                local vel = (targetPos - ball:GetPos()) * 10 + center:GetVelocity()
                                bP:SetVelocity(vel) 
                                if IsValid(smoke) then smoke:SetPos(ball:GetPos() + vel:GetNormalized() * 100) end
                            end
                        end)
                    end
                else
                    local spreadDir = dir
                    if i == 2 then spreadDir = (dir + self.Jaw:GetRight() * 0.15 + self.Jaw:GetUp() * 0.15):GetNormalized() end
                    if i == 3 then spreadDir = (dir - self.Jaw:GetRight() * 0.15 + self.Jaw:GetUp() * 0.15):GetNormalized() end
                    bPhys:SetVelocity(spreadDir * 3000)
                    smoke:SetPos(ball:GetPos() + spreadDir * 100)

                    hook.Add("Think", "MDSoulHoming_"..ball:EntIndex(), function()
                        if not IsValid(ball) then hook.Remove("Think", "MDSoulHoming_"..ball:EntIndex()) return end
                        if not IsValid(self.Target) or ball.Exploded then return end
                        local bp = ball:GetPhysicsObject()
                        if IsValid(bp) then
                            local currentVel = bp:GetVelocity()
                            local speed = currentVel:Length()
                            local dirToTarget = (self.Target:WorldSpaceCenter() - ball:GetPos()):GetNormalized()
                            local newDir = LerpVector(0.01, currentVel:GetNormalized(), dirToTarget):GetNormalized()
                            bp:SetVelocity(newDir * speed)
                            if IsValid(smoke) then smoke:SetPos(ball:GetPos() + newDir * 100) end
                        end
                    end)
                end
            end

            ball:AddCallback("PhysicsCollide", function(cEnt, data)
                if cEnt.Exploded then return end
                cEnt.Exploded = true
                if IsValid(data.HitEntity) and data.HitEntity:Health() > 0 and data.HitEntity ~= self and not data.HitEntity.IsDragonBody then
                    local d = DamageInfo()
                    d:SetDamage(80)
                    d:SetDamageType(DMG_SHOCK + DMG_BURN)
                    d:SetAttacker(self)
                    d:SetInflictor(self)
                    data.HitEntity:TakeDamageInfo(d)
                end
                cEnt:Fire("Explode")
            end)
        end
    end

    function ENT:Attack_SealsOfReality()
        local validTargets = {}
        for _, v in ipairs(ents.FindInSphere(self:GetPos(), 6000)) do
            if (v:IsPlayer() or v:IsNPC()) and v:Health() > 0 and v ~= self.Bullseye then
                local isOtherDragon = (v:GetClass() == self:GetClass()) or (v:GetClass() == "npc_bullseye" and IsValid(v:GetParent()) and v:GetParent():GetClass() == self:GetClass())
                if isOtherDragon and GetConVar("md_hate_each_other"):GetInt() == 0 then continue end
                if v:IsPlayer() and GetConVar("ai_ignoreplayers"):GetBool() then continue end
                table.insert(validTargets, v)
            end
        end
        if #validTargets == 0 then if IsValid(self.Target) then table.insert(validTargets, self.Target) else return end end
        
        local isMerge = (math.random(1,3) == 1)
        local singleTarget = validTargets[math.random(1, #validTargets)]
        
        local mergeSpawn = self.Jaw:GetPos() + self.Jaw:GetUp() * 200
        local mergeVel = self.Jaw:GetUp() * 800 + Vector(0,0,500)
        local spawnedSeals = {}

        for i=1, 12 do
            local delay = isMerge and 0 or (i * 0.15)
            timer.Simple(delay, function()
                if not IsValid(self) or self.Dead then return end
                
                local p = ents.Create("prop_physics")
                p:SetModel("models/weapons/w_bugbait.mdl")
                local pPos = isMerge and (mergeSpawn + VectorRand() * 5) or (self.Jaw:GetPos() + self.Jaw:GetUp() * 200 + Vector(math.random(-50,50), math.random(-50,50), 0))
                p:SetPos(pPos)
                p:Spawn()
                p:SetModelScale(3)
                p:SetOwner(self)
                p:SetCollisionGroup(COLLISION_GROUP_PROJECTILE)

                for _, part in ipairs(self.Parts) do if IsValid(part) then constraint.NoCollide(p, part, 0, 0) end end
                constraint.NoCollide(p, self, 0, 0)
                
                for _, existingSeal in ipairs(spawnedSeals) do
                    constraint.NoCollide(p, existingSeal, 0, 0)
                end
                table.insert(spawnedSeals, p)

                local phys = p:GetPhysicsObject()
                if IsValid(phys) then
                    phys:EnableGravity(false)
                    local pVel = isMerge and (mergeVel + VectorRand() * 10) or (self.Jaw:GetUp() * 800 + Vector(math.random(-200,200), math.random(-200,200), 500))
                    phys:SetVelocity(pVel)
                end

                local myTarget = isMerge and singleTarget or validTargets[math.random(1, #validTargets)]

                timer.Simple(isMerge and 2 or 1, function()
                    if not IsValid(p) then return end
                    if i <= 4 then p.SealClass = "Life"; p:SetColor(Color(0,255,0)); p.DType = DMG_POISON
                    elseif i <= 8 then p.SealClass = "Agony"; p:SetColor(Color(255,0,0)); p.DType = DMG_BURN
                    else p.SealClass = "Fate"; p:SetColor(Color(math.random(0,255),math.random(0,255),math.random(0,255))); p.DType = table.Random({DMG_ACID, DMG_SHOCK, DMG_SLASH, DMG_DROWN}) end

                    util.SpriteTrail(p, 0, p:GetColor(), false, 50, 0, 2, 0.1, "trails/plasma")
                end)

                timer.Simple(isMerge and 3 or 1.5, function()
                    if not IsValid(p) then return end
                    local tName = "DragProjectile_" .. p:EntIndex()
                    hook.Add("Think", tName, function()
                        if not IsValid(p) or not IsValid(self) then hook.Remove("Think", tName) return end
                        local pp = p:GetPhysicsObject()
                        if IsValid(pp) and IsValid(myTarget) then
                            local dir = (myTarget:WorldSpaceCenter() - p:GetPos()):GetNormalized()
                            local curVel = pp:GetVelocity()
                            local newDir = LerpVector(0.05, curVel:GetNormalized(), dir):GetNormalized()
                            pp:SetVelocity(newDir * 800)
                        end
                    end)
                end)

                p:AddCallback("PhysicsCollide", function(c, d)
                    if c.Dead then return end c.Dead = true
                    if IsValid(d.HitEntity) and d.HitEntity ~= self and not d.HitEntity.IsDragonBody then
                        local dmg = DamageInfo()
                        dmg:SetDamage(10)
                        dmg:SetDamageType(c.DType or DMG_GENERIC)
                        dmg:SetAttacker(self)
                        dmg:SetInflictor(self)
                        d.HitEntity:TakeDamageInfo(dmg)
                    end
                    local e = EffectData() e:SetOrigin(d.HitPos) util.Effect("cball_bounce", e)
                    SafeRemoveEntity(c)
                end)
                SafeRemoveEntityDelayed(p, 30)
            end)
        end
    end

    function ENT:Attack_Corruption()
        local validTargets = {}
        for _, v in ipairs(ents.FindInSphere(self:GetPos(), 6000)) do
            if (v:IsPlayer() or v:IsNPC()) and v:Health() > 0 and v ~= self.Bullseye then
                local isOtherDragon = (v:GetClass() == self:GetClass()) or (v:GetClass() == "npc_bullseye" and IsValid(v:GetParent()) and v:GetParent():GetClass() == self:GetClass())
                if isOtherDragon and GetConVar("md_hate_each_other"):GetInt() == 0 then continue end
                
                if v:IsPlayer() and GetConVar("ai_ignoreplayers"):GetBool() then continue end
                table.insert(validTargets, v)
            end
        end
        if #validTargets == 0 then if IsValid(self.Target) then table.insert(validTargets, self.Target) else return end end

        for i=1, 4 do
            timer.Simple((i-1) * 0.5, function()
                if not IsValid(self) then return end
                local p = ents.Create("prop_physics")
                p:SetModel("models/weapons/w_bugbait.mdl")
                p:SetPos(self.Jaw:GetPos() + self.Jaw:GetUp() * 200 + Vector(math.random(-150,150), math.random(-150,150), 0))
                p:Spawn()
                p:SetModelScale(3)
                p:SetColor(Color(20, 0, 40))
                p:SetMaterial("models/props_combine/portalbomb_rad")
                p:SetOwner(self)
                p:SetCollisionGroup(COLLISION_GROUP_PROJECTILE)

                for _, part in ipairs(self.Parts) do if IsValid(part) then constraint.NoCollide(p, part, 0, 0) end end
                constraint.NoCollide(p, self, 0, 0)

                util.SpriteTrail(p, 0, p:GetColor(), false, 50, 0, 2, 0.1, "trails/smoke")

                local phys = p:GetPhysicsObject()
                if IsValid(phys) then
                    phys:EnableGravity(false)
                    local dir = self.Jaw:GetUp() * 800 + Vector(math.random(-200,200), math.random(-200,200), 500)
                    phys:SetVelocity(dir)
                end

                local myTarget = validTargets[math.random(1, #validTargets)]

                timer.Simple(2, function()
                    if not IsValid(p) then return end
                    local tName = "DragCorrupt_" .. p:EntIndex()
                    hook.Add("Think", tName, function()
                        if not IsValid(p) or not IsValid(self) then hook.Remove("Think", tName) return end
                        local pp = p:GetPhysicsObject()
                        if IsValid(pp) and IsValid(myTarget) then
                            local dir = (myTarget:WorldSpaceCenter() - p:GetPos()):GetNormalized()
                            local curVel = pp:GetVelocity()
                            local newDir = LerpVector(0.05, curVel:GetNormalized(), dir):GetNormalized()
                            pp:SetVelocity(newDir * 3000)
                            if IsValid(smoke) then smoke:SetPos(p:GetPos() + newDir * 80) end
                        end
                    end)
                end)

                p:AddCallback("PhysicsCollide", function(c, d)
                    if c.Dead then return end c.Dead = true
                    local victim = d.HitEntity
                    if IsValid(victim) and victim ~= self and not victim.IsDragonBody then
                        if victim:IsPlayer() then
                            victim:SetNWFloat("MD_CorruptionExpire", CurTime() + 10)
                        end
                        
                        local tName = "MD_Corrupt_Poison_" .. victim:EntIndex()
                        timer.Create(tName, 1, 10, function()
                            if IsValid(victim) and victim:Health() > 0 then
                                local dmg = DamageInfo()
                                dmg:SetDamage(3)
                                dmg:SetDamageType(DMG_POISON)
                                dmg:SetAttacker(IsValid(self) and self or victim)
                                dmg:SetInflictor(IsValid(self) and self or victim)
                                victim:TakeDamageInfo(dmg)
                            end
                        end)
                    end
                    local e = EffectData() e:SetOrigin(d.HitPos) e:SetScale(2) util.Effect("cball_bounce", e)
                    SafeRemoveEntity(c)
                end)
                SafeRemoveEntityDelayed(p, 30)
            end)
        end
    end

    function ENT:Attack_Pursuit()
        self.IsScattershotting = true 
        local isMedian = (math.random(1, 100) <= 33)

        local tName = "MD_Pursuit_" .. self:EntIndex()
        timer.Create(tName, 0.1, 60, function()
            if not IsValid(self) or self.Dead or not IsValid(self.Target) then timer.Remove(tName) return end
            self:EmitSound("NPC_Hunter.FireMinigun")
            
            local dir = (self.Target:WorldSpaceCenter() - self.Jaw:GetPos()):GetNormalized()
            
            if isMedian then
                local src = self.Jaw:LocalToWorld(Vector(0, 0, 0))
                local bullet = { Num = 1, Src = src, Dir = dir + VectorRand() * 0, Spread = Vector(0, 0, 0), Tracer = 1, TracerName = "AR2Tracer", Force = 5, Damage = math.random(4, 8), Attacker = self }
                self:FireBullets(bullet)
            else
                for side = -1, 1, 2 do
                    local src = self.Jaw:LocalToWorld(Vector(0, 30 * side, 0))
                    local bullet = { Num = 1, Src = src, Dir = dir + VectorRand() * 0.05, Spread = Vector(0, 0, 0), Tracer = 1, TracerName = "AR2Tracer", Force = 5, Damage = math.random(6, 8), Attacker = self }
                    self:FireBullets(bullet)
                end
            end
        end)
        
        timer.Simple(3.5, function() if IsValid(self) then self.IsScattershotting = false end end)
    end

    function ENT:Attack_CelestialFragments()
        if not IsValid(self.Target) then return end
        local myTarget = self.Target
        local frags = {}
        for i=1, 8 do
            timer.Simple(i * 0.2, function()
                if not IsValid(self) or self.Dead then return end
                local p = ents.Create("prop_physics")
                p:SetModel("models/weapons/w_bugbait.mdl")
                p:SetPos(self.Jaw:GetPos() + self.Jaw:GetUp() * 200 + VectorRand() * 50)
                p:Spawn()
                p:SetModelScale(2)
                p:SetOwner(self)
                p:SetCollisionGroup(COLLISION_GROUP_PROJECTILE)

                local glow = ents.Create("env_sprite")
                glow:SetKeyValue("model", "sprites/light_glow02_add.vmt")
                glow:SetKeyValue("scale", "4")
                glow:SetKeyValue("rendermode", "5")
                glow:SetKeyValue("rendercolor", "255 255 255")
                glow:SetParent(p)
                glow:SetPos(p:GetPos())
                glow:Spawn()
                p.MyGlow = glow
                
                util.SpriteTrail(p, 0, Color(255,255,255), false, 30, 0, 1.5, 0.1, "trails/plasma")

                local phys = p:GetPhysicsObject()
                if IsValid(phys) then
                    phys:EnableGravity(false)
                    phys:SetVelocity(self.Jaw:GetUp() * 500 + VectorRand() * 200)
                end
                table.insert(frags, p)
            end)
        end

        timer.Simple(8 * 0.2 + 1.0, function()
            if not IsValid(self) then return end
            for _, p in ipairs(frags) do
                if IsValid(p) then
                    local tName = "MD_Celestial_" .. p:EntIndex()
                    hook.Add("Think", tName, function()
                        if not IsValid(p) or not IsValid(self) then hook.Remove("Think", tName) return end
                        if p.Dead or p.IsShrinking then return end
                        local pp = p:GetPhysicsObject()
                        
                        if IsValid(pp) and IsValid(myTarget) then
                            local tPos = myTarget:WorldSpaceCenter()
                            local pPos = p:GetPos()

                            if pPos:DistToSqr(tPos) <= 2500 then
                                p.Dead = true
                                for _, v in ipairs(ents.FindInSphere(pPos, 50)) do
                                    if (v:IsPlayer() or v:IsNPC()) and v:Health() > 0 and v ~= self and not v.IsDragonBody then
                                        local dmg = DamageInfo()
                                        dmg:SetDamage(20)
                                        dmg:SetDamageType(DMG_SHOCK + DMG_BLAST)
                                        dmg:SetAttacker(self)
                                        dmg:SetInflictor(self)
                                        v:TakeDamageInfo(dmg)
                                    end
                                end
                                local e = EffectData() e:SetOrigin(pPos) util.Effect("cball_bounce", e)
                                p:SetNoDraw(true)
                                p:SetNotSolid(true)
                                SafeRemoveEntityDelayed(p, 0.1)
                                return
                            end

                            local dir = (tPos - pPos):GetNormalized()
                            local curVel = pp:GetVelocity()
                            local newDir = LerpVector(0.05, curVel:GetNormalized(), dir):GetNormalized()
                            pp:SetVelocity(newDir * 1200)
                        end
                    end)

                    p:AddCallback("PhysicsCollide", function(c, d)
                        if c.Dead then return end c.Dead = true
                        if IsValid(d.HitEntity) and d.HitEntity:Health() > 0 and d.HitEntity ~= self and not d.HitEntity.IsDragonBody then
                            local dmg = DamageInfo()
                            dmg:SetDamage(20)
                            dmg:SetDamageType(DMG_SHOCK + DMG_BLAST)
                            dmg:SetAttacker(self)
                            dmg:SetInflictor(self)
                            d.HitEntity:TakeDamageInfo(dmg)
                        end
                        local e = EffectData() e:SetOrigin(d.HitPos) util.Effect("cball_bounce", e)
                        c:SetNoDraw(true)
                        c:SetNotSolid(true)
                        c:SetCollisionGroup(COLLISION_GROUP_IN_VEHICLE)
                        local cp = c:GetPhysicsObject() 
                        if IsValid(cp) then 
                            cp:EnableCollisions(false)
                            cp:SetVelocity(d.OurOldVelocity) 
                        end
                        SafeRemoveEntityDelayed(c, 2.0)
                    end)
                    
                    timer.Simple(math.random(8,12), function()
                        if IsValid(p) and not p.Dead then
                            p.IsShrinking = true
                            local sTime = CurTime()
                            local sName = "MD_CelestialShrink_" .. p:EntIndex()
                            local pp = p:GetPhysicsObject()
                            if IsValid(pp) then pp:SetVelocity(Vector(0,0,0)) end
                            
                            hook.Add("Think", sName, function()
                                if not IsValid(p) or not IsValid(p.MyGlow) then hook.Remove("Think", sName) return end
                                local frac = 1 - ((CurTime() - sTime) / 1.5)
                                if frac <= 0 then
                                    SafeRemoveEntity(p)
                                    hook.Remove("Think", sName)
                                else
                                    p.MyGlow:SetKeyValue("scale", tostring(4 * frac))
                                end
                            end)
                        end
                    end)
                end
            end
        end)
    end

    function ENT:Attack_Boomstick(guided)
        if not IsValid(self.Target) then return end
        self.IsScattershotting = true 
        local myTarget = self.Target
        
        for i = 1, 3 do
            timer.Simple(i * 1.0, function()
                if not IsValid(self) or self.Dead or not IsValid(myTarget) then return end
                
                local spawnPos = self.Jaw:GetPos() + self.Jaw:GetForward() * 10 + self.Jaw:GetUp()
                local dir = (myTarget:WorldSpaceCenter() - spawnPos):GetNormalized()
                
                local rocket = ents.Create("rpg_missile")
                rocket:SetPos(spawnPos)
                rocket:SetAngles(dir:Angle())
                rocket:SetOwner(self)
                rocket:Spawn()
                
                local speed = guided and 800 or 1250
                rocket:SetVelocity(dir * speed)
                rocket:SetSaveValue("m_flDamage", math.random(40, 120))
                
                self:EmitSound("weapons/rpg/rocketfire1.wav", 100, 100)
                
                if guided then
                    local glow = ents.Create("env_sprite")
                    glow:SetKeyValue("model", "sprites/redglow1.vmt")
                    glow:SetKeyValue("scale", "1")
                    glow:SetKeyValue("rendermode", "5")
                    glow:SetKeyValue("rendercolor", "255 0 0")
                    glow:SetParent(rocket)
                    glow:SetPos(rocket:GetPos())
                    glow:Spawn()
                    
                    util.SpriteTrail(rocket, 0, Color(255,0,0), false, 40, 0, 1, 0.1, "trails/laser")
                    
                    local rName = "MD_Guided_" .. rocket:EntIndex()
                    hook.Add("Think", rName, function()
                        if not IsValid(rocket) or not IsValid(self) then hook.Remove("Think", rName) return end
                        if IsValid(myTarget) then
                            local rDir = (myTarget:WorldSpaceCenter() - rocket:GetPos()):GetNormalized()
                            rocket:SetAngles(rDir:Angle())
                            rocket:SetVelocity(rDir * speed)
                        end
                    end)
                end
            end)
        end
        timer.Simple(4.0, function() if IsValid(self) then self.IsScattershotting = false end end)
    end

    function ENT:Think()
        if self.Dead then return end
        if not IsValid(self.Bullseye) or self.Bullseye:Health() <= 0 then
            if not self.IsDying then self:TriggerDeath() end
        end

        local curTime = CurTime()

        if not self.IsDying then
            self.NextIdleSound = self.NextIdleSound or curTime + math.random(5, 10)
            if curTime > self.NextIdleSound then
                self.NextIdleSound = curTime + math.random(5, 10)
                local idleSounds = {
                    "npc/advisor/advisorscreenvx01.wav", "npc/advisor/advisorscreenvx02.wav",
                    "npc/advisor/advisorscreenvx03.wav", "npc/advisor/advisorscreenvx04.wav",
                    "npc/advisor/advisorscreenvx05.wav", "npc/advisor/advisorscreenvx06.wav",
                    "npc/advisor/advisorscreenvx07.wav", "npc/advisor/advisorscreenvx08.wav"
                }
                self:EmitSound(idleSounds[math.random(#idleSounds)], 100, 100)
            end

            for _, p in ipairs(self.Parts) do
                if IsValid(p) and not p.IsDetached then
                    p.NextVolt = p.NextVolt or (curTime + math.random(3, 6))
                    if curTime > p.NextVolt then
                        p.NextVolt = curTime + math.random(3, 6)
                        
                        local targName = "md_arc_targ_" .. p:EntIndex() .. "_" .. math.random(10000)
                        local targ = ents.Create("info_target")
                        targ:SetPos(p:GetPos() + VectorRand() * math.random(200, 500))
                        targ:SetName(targName)
                        targ:Spawn()
                        
                        local laser = ents.Create("env_laser")
                        laser:SetPos(p:GetPos())
                        laser:SetParent(p) 
                        laser:SetKeyValue("texture", "sprites/physbeam.vmt")
                        laser:SetKeyValue("rendercolor", "100 200 255")
                        laser:SetKeyValue("width", tostring(math.random(4, 10)))
                        laser:SetKeyValue("damage", "0")
                        laser:SetKeyValue("LaserTarget", targName)
                        laser:SetKeyValue("NoiseAmplitude", tostring(math.random(3, 6)))
                        laser:Spawn()
                        laser:Activate()
                        laser:Fire("TurnOn")
                        laser:SetRenderMode(RENDERMODE_TRANSADD)
                        laser:SetColor(Color(100, 200, 255, 255))
                        
                        SafeRemoveEntityDelayed(laser, math.Rand(0.2, 0.6))
                        SafeRemoveEntityDelayed(targ, 0.6)
                    end
                end
            end
        end

        local destroyTool = GetConVar("md_toolgun_destroy"):GetInt() == 1
        local destroyPhys = GetConVar("md_destroy_physgun"):GetInt() == 1

        if not self.IsDying and (destroyTool or destroyPhys) then
            for _, ply in ipairs(player.GetAll()) do
                if ply:GetPos():DistToSqr(self:GetPos()) < 9000000 then
                    local hasTool = destroyTool and ply:HasWeapon("gmod_tool")
                    local hasPhys = destroyPhys and ply:HasWeapon("weapon_physgun")
                    
                    if hasTool or hasPhys then
                        local fakeMdl = ""
                        local msg = {
                            "I'll be taking this...",
                            "I'll be taking that...",
                            "No point using tools if you're gonna face it that close!"
                        }
                        
                        if hasTool then
                            ply:StripWeapon("gmod_tool")
                            fakeMdl = "models/weapons/w_toolgun.mdl"
                        else
                            ply:StripWeapon("weapon_physgun")
                            fakeMdl = "models/weapons/w_physics.mdl"
                        end

                        ply:ChatPrint(msg[math.random(#msg)])

                        local fakeTool = ents.Create("prop_physics")
                        fakeTool:SetModel(fakeMdl)
                        fakeTool:SetPos(ply:EyePos() + ply:GetAimVector() * 50)
                        fakeTool:SetAngles(ply:EyeAngles())
                        fakeTool:Spawn()
                        fakeTool:SetCollisionGroup(COLLISION_GROUP_WEAPON)
                        local ftp = fakeTool:GetPhysicsObject()
                        if IsValid(ftp) then
                            ftp:EnableGravity(false)
                            ftp:SetVelocity(ply:GetAimVector() * 150 + Vector(0,0,100))
                        end
                        fakeTool:SetName("md_faketool_"..fakeTool:EntIndex())

                        local targName = "md_targ_" .. ply:EntIndex()
                        local targ = ents.Create("info_target")
                        targ:SetName(targName)
                        targ:SetPos(ply:WorldSpaceCenter())
                        targ:Spawn()

                        local currentTipPos = self.Jaw:GetPos()
                        local beam = ents.Create("env_laser")
                        beam:SetPos(currentTipPos)
                        beam:SetKeyValue("texture", "sprites/physbeam.vmt")
                        beam:SetKeyValue("rendercolor", "100 200 255")
                        beam:SetKeyValue("width", "10")
                        beam:SetKeyValue("damage", "0")
                        beam:SetKeyValue("LaserTarget", targName)
                        beam:SetKeyValue("NoiseAmplitude", "1.5")
                        beam:Spawn()
                        beam:Activate()
                        beam:Fire("TurnOn")
                        beam:SetRenderMode(RENDERMODE_TRANSADD)
                        beam:SetColor(Color(100, 200, 255, 255))

                        local dissolve = ents.Create("env_entity_dissolver")
                        dissolve:SetPos(fakeTool:GetPos())
                        dissolve:SetKeyValue("target", fakeTool:GetName())
                        dissolve:SetKeyValue("dissolvetype", "0")
                        dissolve:Spawn()

                        timer.Simple(2, function()
                            if IsValid(dissolve) and IsValid(fakeTool) then dissolve:Fire("Dissolve", fakeTool:GetName()) end
                            SafeRemoveEntityDelayed(dissolve, 0.5)
                        end)

                        local fadeSteps = 15
                        local fadeTime = 1.5
                        timer.Simple(0, function()
                            if not IsValid(beam) then return end
                            for i = 1, fadeSteps do
                                timer.Simple((fadeTime / fadeSteps) * i, function()
                                    if IsValid(beam) then
                                        local alpha = math.floor(255 - (255 / fadeSteps) * i)
                                        beam:SetKeyValue("renderamt", tostring(alpha))
                                        beam:SetColor(Color(100, 200, 255, alpha))
                                        if i == fadeSteps then
                                            beam:Remove()
                                            if IsValid(targ) then targ:Remove() end
                                        end
                                    end
                                end)
                            end
                        end)
                    end
                end
            end
        end

        if IsValid(self.Bullseye) then
            local currentHP = self.Bullseye:Health()
            local pct = currentHP / self.Bullseye:GetMaxHealth()
            
            if pct >= 0.75 then self.HealthBulb:SetKeyValue("rendercolor", "0 255 0")
            elseif pct >= 0.50 then self.HealthBulb:SetKeyValue("rendercolor", "255 255 0")
            elseif pct >= 0.25 then self.HealthBulb:SetKeyValue("rendercolor", "255 165 0")
            else self.HealthBulb:SetKeyValue("rendercolor", "255 0 0") end
            self.NextPhaseThreshold = self.NextPhaseThreshold or 0.66
            if pct <= self.NextPhaseThreshold then
                self.NextPhaseThreshold = self.NextPhaseThreshold - 0.33
                
                local screams = { 
                    "npc/advisor/advisorheadvx01.wav", "npc/advisor/advisorheadvx02.wav",
                    "npc/advisor/advisorheadvx03.wav", "npc/advisor/advisorheadvx04.wav",
                    "npc/advisor/advisorheadvx05.wav", "npc/advisor/advisorheadvx06.wav" 
                }
                self:EmitSound(screams[math.random(#screams)], 120, 100)

                for _, ply in ipairs(player.GetAll()) do
                    if ply:GetPos():DistToSqr(self:GetPos()) < 64000000 then 
                        ply:SendLua([[
                            local startTime = CurTime()
                            hook.Add("RenderScreenspaceEffects", "MD_HalfHealthShock", function()
                                local fraction = 1 - ((CurTime() - startTime) / 2)
                                if fraction <= 0 then hook.Remove("RenderScreenspaceEffects", "MD_HalfHealthShock") return end
                                DrawToyTown(fraction * 10, fraction * 20)
                                local tab = {
                                    ["$pp_colour_addr"] = 0, ["$pp_colour_addg"] = 0, ["$pp_colour_addb"] = 0,
                                    ["$pp_colour_brightness"] = -(fraction * 0.3),
                                    ["$pp_colour_contrast"] = 1 + (fraction * 0.5),
                                    ["$pp_colour_colour"] = 1 - (fraction * 0.8),
                                    ["$pp_colour_mulr"] = 0, ["$pp_colour_mulg"] = 0, ["$pp_colour_mulb"] = 0
                                }
                                DrawColorModify(tab)
                            end)
                        ]])
                        util.ScreenShake(ply:GetPos(), 20, 20, 1.5, 100)
                    end
                    
                    if ply:GetPos():DistToSqr(self:GetPos()) < 16000000 then
                        ply:SetNWFloat("MD_CorruptionExpire", CurTime() + 10)
                        local tName = "MD_Corrupt_Poison_" .. ply:EntIndex()
                        timer.Create(tName, 1, 10, function()
                            if IsValid(ply) and ply:Health() > 0 then
                                local dmg = DamageInfo()
                                dmg:SetDamage(3)
                                dmg:SetDamageType(DMG_POISON)
                                dmg:SetAttacker(IsValid(self) and self or ply)
                                dmg:SetInflictor(IsValid(self) and self or ply)
                                ply:TakeDamageInfo(dmg)
                            end
                        end)
                    end
                end

                for i=1, 10 do
                    timer.Simple(math.Rand(0.5, 5.0), function()
                        if not IsValid(self) then return end
                        local strikePos = self:GetPos() + Vector(math.random(-3000, 3000), math.random(-3000, 3000), 0)
                        local tr = util.TraceLine({start=strikePos+Vector(0,0,10000), endpos=strikePos-Vector(0,0,10000), mask=MASK_SOLID_BRUSHONLY})
                        local gPos = tr.HitPos
                        
                        local targName = "md_strike_50_" .. i .. "_" .. self:EntIndex()
                        local targ = ents.Create("info_target")
                        targ:SetPos(gPos)
                        targ:SetName(targName)
                        targ:Spawn()
                        
                        local laser = ents.Create("env_laser")
                        laser:SetPos(gPos + Vector(0,0,15000))
                        laser:SetKeyValue("texture", "sprites/laserbeam.vmt")
                        laser:SetKeyValue("rendercolor", "100 200 255")
                        laser:SetKeyValue("width", "30")
                        laser:SetKeyValue("damage", "0")
                        laser:SetKeyValue("NoiseAmplitude", "5")
                        laser:SetKeyValue("LaserTarget", targName)
                        laser:Spawn()
                        laser:Activate()
                        laser:Fire("TurnOn")
                        laser:SetRenderMode(RENDERMODE_TRANSADD)
                        laser:SetColor(Color(100, 200, 255, 255))
                        
                        timer.Simple(0.2, function()
                            local ed = EffectData() ed:SetOrigin(gPos) ed:SetScale(20) util.Effect("cball_explode", ed)
                            sound.Play("ambient/explosions/explode_4.wav", gPos, 150, 80)
                            util.BlastDamage(self, self, gPos, 300, 100)
                            util.ScreenShake(gPos, 20, 20, 1.5, 8000)
                        end)
                        
                        local fadeSteps = 15
                        for j = 1, fadeSteps do
                            timer.Simple((1.5 / fadeSteps) * j, function()
                                if IsValid(laser) then
                                    local a = math.floor(255 - (255 / fadeSteps) * j)
                                    laser:SetColor(Color(100, 200, 255, a))
                                    laser:SetKeyValue("renderamt", tostring(a))
                                    if j == fadeSteps then laser:Remove() if IsValid(targ) then targ:Remove() end end
                                end
                            end)
                        end
                    end)
                end
            end

            if not self.IsDying and (self.LastDebrisHealth - currentHP >= 500) then
                self.LastDebrisHealth = self.LastDebrisHealth - 500
                self:EmitSound("npc/advisor/advisor_scream.wav", 110, 100)
                self:EmitSound("physics/metal/metal_box_break2.wav", 100, 80)
                
                local bodyAPos = self.Bones[2].pos
                local bodyAAng = self.Bones[2].ang

                local ed = EffectData()
                ed:SetOrigin(bodyAPos + Vector(0, 0, 100))
                ed:SetScale(2)
                util.Effect("cball_explode", ed)

                local debrisModels = {"models/props_combine/combine_barricade_bracket01a.mdl", "models/props_combine/combine_barricade_bracket01b.mdl", "models/props_combine/combine_barricade_bracket02a.mdl", "models/props_combine/combine_barricade_bracket02b.mdl", "models/container_chunk01.mdl", "models/container_chunk02.mdl", "models/container_chunk03.mdl","models/container_chunk04.mdl", "models/container_chunk05.mdl"}
                for i=1, 4 do
                    local gib = ents.Create("prop_physics")
                    gib:SetModel(debrisModels[math.random(1, #debrisModels)])

                    local sideOffset = bodyAAng:Right() * math.random(-250, 250)
                    gib:SetPos(bodyAPos + sideOffset + VectorRand() * 50 + Vector(0, 0, 100))
                    
                    gib:Spawn()
                    gib:SetCollisionGroup(COLLISION_GROUP_DEBRIS)
                    
                    gib:SetMaxHealth(999999) 
                    gib:SetHealth(999999)

                    local gPhys = gib:GetPhysicsObject()
                    if IsValid(gPhys) then 
                        gPhys:Wake() 
                        gPhys:SetVelocity(VectorRand() * 800 + Vector(0,0,500)) 
                        gPhys:AddAngleVelocity(VectorRand() * 500)
                    end
                    SafeRemoveEntityDelayed(gib, 8)
                end
            end
        end

        self.Bones[1].pos = self:GetPos()
        self.Bones[1].ang = self:GetAngles()

        for i = 2, 8 do
            local prevBone = self.Bones[i-1]
            local myBone = self.Bones[i]

            local targetPos = prevBone.pos - prevBone.ang:Forward() * self.BoneDistances[i]
            
            local followSpeed = 10 - (i * 1.0)
            myBone.pos = LerpVector(FrameTime() * followSpeed, myBone.pos, targetPos)
            
            local trBone = util.TraceLine({
                start = myBone.pos + Vector(0,0,500),
                endpos = myBone.pos - Vector(0,0,1000),
                mask = MASK_SOLID_BRUSHONLY 
            })
            if trBone.Hit and myBone.pos.z < (trBone.HitPos.z + 300) then
                myBone.pos.z = Lerp(FrameTime() * 5, myBone.pos.z, trBone.HitPos.z + 300)
            end

            local dir = (prevBone.pos - myBone.pos):GetNormalized()
            local targetAng = dir:Angle()
            
            targetAng.r = Lerp(FrameTime() * 5, myBone.ang.r, prevBone.ang.r)
            
            local turnSpeed = math.max(1.5, 8 - (i * 1.0))
            myBone.ang = LerpAngle(FrameTime() * turnSpeed, myBone.ang, targetAng)
        end

        local function ApplyPartOffsets(part, bone, localPos, localAng)
            if not IsValid(part) or part.IsDetached then return end
            local finalPos = bone.pos + bone.ang:Forward() * localPos.x + bone.ang:Right() * localPos.y + bone.ang:Up() * localPos.z
            local _, finalAng = LocalToWorld(Vector(0,0,0), localAng, Vector(0,0,0), bone.ang)
            part:SetPos(finalPos)
            part:SetAngles(finalAng)
        end

        ApplyPartOffsets(self.Helmet, self.Bones[1], Vector(0, 0, -30), Angle(0, -90, -5))
        ApplyPartOffsets(self.Jaw, self.Bones[1], Vector(300, 0, -50), Angle(90, 90, -90))
        
        ApplyPartOffsets(self.BodyA_Under, self.Bones[2], Vector(0, 0, 0), Angle(0, 0, 0))
        ApplyPartOffsets(self.BodyA_Scale1, self.Bones[2], Vector(160, 0, 100), Angle(-75, 0, 0)) 
        ApplyPartOffsets(self.BodyA_Scale2, self.Bones[2], Vector(-160, 0, 100), Angle(-75, 0, 0))
        ApplyPartOffsets(self.BodyB_Under, self.Bones[3], Vector(0, 0, 0), Angle(-5, 0, 0))
        ApplyPartOffsets(self.BodyB_Scale1, self.Bones[3], Vector(145, 0, 95), Angle(-80, 0, 0))
        ApplyPartOffsets(self.BodyB_Scale2, self.Bones[3], Vector(-145, 0, 95), Angle(-80, 0, 0))
        ApplyPartOffsets(self.BodyC_Under, self.Bones[4], Vector(0, 0, 0), Angle(-5, 0, 0))
        ApplyPartOffsets(self.BodyC_Scale1, self.Bones[4], Vector(135, 0, 92), Angle(-80, 0, 0))
        ApplyPartOffsets(self.BodyC_Scale2, self.Bones[4], Vector(-135, 0, 92), Angle(-80, 0, 0))
        ApplyPartOffsets(self.BodyD_Under, self.Bones[5], Vector(0, 0, 0), Angle(-5, 0, 0))
        ApplyPartOffsets(self.BodyD_Scale1, self.Bones[5], Vector(125, 0, 90), Angle(-80, 0, 0))
        ApplyPartOffsets(self.BodyD_Scale2, self.Bones[5], Vector(-125, 0, 90), Angle(-80, 0, 0))
        ApplyPartOffsets(self.BodyE_Under, self.Bones[6], Vector(0, 0, 0), Angle(-5, 0, 0))
        ApplyPartOffsets(self.BodyE_Scale1, self.Bones[6], Vector(115, 0, 85), Angle(-80, 0, 0))
        ApplyPartOffsets(self.BodyE_Scale2, self.Bones[6], Vector(-115, 0, 85), Angle(-80, 0, 0))
        ApplyPartOffsets(self.BodyF_Under, self.Bones[7], Vector(0, 0, 0), Angle(-5, 0, 0))
        ApplyPartOffsets(self.BodyF_Scale1, self.Bones[7], Vector(115, 0, 85), Angle(-80, 0, 0))
        ApplyPartOffsets(self.BodyF_Scale2, self.Bones[7], Vector(-115, 0, 85), Angle(-80, 0, 0))
        ApplyPartOffsets(self.Tail, self.Bones[8], Vector(0, 0, 15), Angle(-5, 180, 0))

        self.NextScan = self.NextScan or 0
        if not self.IsDying and curTime > self.NextScan then
            self.NextScan = curTime + 0.5
            local bestTarg = nil
            local closest = 25000000 
            
            for _, v in ipairs(ents.FindInSphere(self:GetPos(), 5000)) do
                if (v:IsPlayer() or v:IsNPC()) and v:Health() > 0 and v ~= self.Bullseye then
                    local isOtherDragon = (v:GetClass() == self:GetClass()) or (v:GetClass() == "npc_bullseye" and IsValid(v:GetParent()) and v:GetParent():GetClass() == self:GetClass())
                    if isOtherDragon and GetConVar("md_hate_each_other"):GetInt() == 0 then continue end
                    
                    if v:IsPlayer() and GetConVar("ai_ignoreplayers"):GetBool() then continue end
                    
                    local trSight = util.TraceLine({
                        start = self.Helmet:WorldSpaceCenter(),
                        endpos = v:WorldSpaceCenter(),
                        mask = MASK_SOLID_BRUSHONLY
                    })
                    
                    if not trSight.Hit then
                        local dist = self:GetPos():DistToSqr(v:GetPos())
                        if dist < closest then
                            closest = dist
                            bestTarg = v
                        end
                    end
                end
            end
            self.Target = bestTarg
        end

        self.NextHateUpdate = self.NextHateUpdate or 0
        if not self.IsDying and curTime > self.NextHateUpdate then
            self.NextHateUpdate = curTime + 2.0
            if IsValid(self.Bullseye) then
                for _, npc in ipairs(ents.FindInSphere(self:GetPos(), 6000)) do
                    if IsValid(npc) and npc:IsNPC() and npc:GetClass() ~= "npc_bullseye" and npc:Health() > 0 then
                        if npc.Faction == "CONNIE" then continue end
                        if npc:GetClass() == self:GetClass() and GetConVar("md_hate_each_other"):GetInt() == 0 then continue end
                        if npc:Disposition(self.Bullseye) ~= D_HT then
                            npc:AddEntityRelationship(self.Bullseye, D_HT, 99)
                        end
                        npc:UpdateEnemyMemory(self.Bullseye, self.Bullseye:GetPos())
                        
                        local wep = npc:GetActiveWeapon()
                        if IsValid(wep) and wep:GetClass() == "weapon_rpg" then
                            local endPos = npc:BodyTarget(self:WorldSpaceCenter())
                            local tr = util.TraceLine({ start = self:WorldSpaceCenter(), endpos = endPos, filter = self.Parts })
                            if not tr.Hit then npc:SetEnemy(self.Bullseye) end
                        elseif not IsValid(npc:GetEnemy()) then 
                            npc:SetEnemy(self.Bullseye) 
                        end
                    end
                end
            end
        end

        local trDown = util.TraceLine({
            start = self:GetPos(),
            endpos = self:GetPos() - Vector(0, 0, 10000),
            mask = MASK_SOLID_BRUSHONLY 
        })
        self.TargetAltitude = self.TargetAltitude or 1500
        local targetZ = trDown.HitPos.z + self.TargetAltitude

        local trFwd = util.TraceLine({start = self:GetPos(), endpos = self:GetPos() + self:GetForward() * 4000, mask = MASK_SOLID_BRUSHONLY})
        local trLeft = util.TraceLine({start = self:GetPos(), endpos = self:GetPos() - self:GetRight() * 2000, mask = MASK_SOLID_BRUSHONLY})
        local trRight = util.TraceLine({start = self:GetPos(), endpos = self:GetPos() + self:GetRight() * 2000, mask = MASK_SOLID_BRUSHONLY})
        
        local phys = self:GetPhysicsObject()
        if IsValid(phys) then
            local speed = 150 
            local vel = phys:GetVelocity()
            local desiredDir = self:GetForward()

            if self.IsWindingUp or self.IsScattershotting then
                if IsValid(self.Target) then
                    local targetPos = self.Target:WorldSpaceCenter()
                    local distToTarget = self:GetPos():DistToSqr(targetPos) 
                    local dirToTarget = (targetPos - self.Helmet:GetPos()):GetNormalized()
                    local dotAlign = self:GetForward():Dot(dirToTarget)
                    
                    if self.PendingAttack == "SealsOfReality" or self.PendingAttack == "Corruption" or self.PendingAttack == "Scattershot" then
                        desiredDir = (dirToTarget + Vector(0,0,2)):GetNormalized() 
                        speed = 30
                        
                        if self.IsWindingUp and curTime > self.WindupEndTime then
                            self.IsWindingUp = false
                            if self.PendingAttack == "SealsOfReality" then self:Attack_SealsOfReality()
                            elseif self.PendingAttack == "Scattershot" then self:Attack_Scattershot()
                            else self:Attack_Corruption() end
                        end
                    else 
                        if distToTarget < 250000 then
                            desiredDir = -dirToTarget 
                            speed = 200
                            if self.IsWindingUp then self.WindupEndTime = curTime + 0.5 end
                        else
                            desiredDir = dirToTarget
                            speed = 50
                            
                            if self.IsWindingUp and curTime > self.WindupEndTime and dotAlign > 0.95 then
                                self.IsWindingUp = false
                                if self.PendingAttack == "SoulCharge" then self:Attack_SoulCharge()
                                elseif self.PendingAttack == "SolarEruption" then self:Attack_SolarEruption() 
                                elseif self.PendingAttack == "Pursuit" then self:Attack_Pursuit()
                                elseif self.PendingAttack == "CelestialFragments" then self:Attack_CelestialFragments()
                                elseif self.PendingAttack == "Boomstick" then self:Attack_Boomstick(false)
                                elseif self.PendingAttack == "GuidedBoomstick" then self:Attack_Boomstick(true) end
                            elseif self.IsWindingUp and curTime > self.WindupEndTime then
                                self.WindupEndTime = curTime + 0.2
                            end
                        end
                    end
                else
                    self.IsWindingUp = false 
                end
            end

            if not self.IsWindingUp and not self.IsScattershotting then
                if trFwd.Hit then
                    targetZ = targetZ + 2000 
                    local hitNorm = trFwd.HitNormal
                    desiredDir = (desiredDir + hitNorm * 2):GetNormalized()
                    speed = speed * 1.5
                elseif trLeft.Hit then
                    desiredDir = (desiredDir + self:GetRight()):GetNormalized()
                elseif trRight.Hit then
                    desiredDir = (desiredDir - self:GetRight()):GetNormalized()
                else
                    if curTime > self.NextRoamChange then
                        self.NextRoamChange = curTime + math.random(5, 10)
                        local center = IsValid(self.ArenaAnchor) and self.ArenaAnchor:GetPos() or self:GetPos()
                        self.RoamPos = center + Vector(math.random(-6000, 6000), math.random(-6000, 6000), 0)
                        self.TargetAltitude = math.random(1000, 3000)
                        
                        if math.random(1, 4) == 1 then
                            self.IsBarrelRolling = true
                            self.BarrelRollAngle = 0
                        end
                    end

                    if self.RoamPos then
                        if IsValid(self.ArenaAnchor) and self:GetPos():DistToSqr(self.ArenaAnchor:GetPos()) > 25000000 then
                            self.RoamPos = self.ArenaAnchor:GetPos()
                        end
                        local dirToRoam = (self.RoamPos - self:GetPos())
                        dirToRoam.z = 0 
                        desiredDir = dirToRoam:GetNormalized()
                        speed = 100
                    end
                end

                local velDir = vel:GetNormalized()
                if velDir:Dot(desiredDir) < 0.9 then
                    speed = speed * 1.5 
                end

                local weave = self:GetRight() * math.sin(curTime * 0.8) * 0.4 + self:GetUp() * math.cos(curTime * 0.5) * 0.2
                desiredDir = (desiredDir + weave):GetNormalized()
            end

            local targetRoll = 0
            
            if self.IsDying then
                local speedMod = 1 - (self.DeathIntensity / 8)
                speed = speed * speedMod
                
                local thrashForce = (1 - speedMod) * 3
                desiredDir = (desiredDir + VectorRand() * thrashForce):GetNormalized()
                self.BarrelRollAngle = (self.BarrelRollAngle or 0) + FrameTime() * 1000 * speedMod
                targetRoll = self.BarrelRollAngle
                
                if IsValid(self.DeathGlow) then
                    self.DeathGlow:SetKeyValue("scale", tostring(1 + self.DeathIntensity * 2))
                end
                if IsValid(self.DeathLight) then
                    self.DeathLight:SetKeyValue("distance", tostring(100 + self.DeathIntensity * 200))
                end
            end

            vel.x = math.Approach(vel.x, desiredDir.x * speed, FrameTime() * 150)
            vel.y = math.Approach(vel.y, desiredDir.y * speed, FrameTime() * 150)
            
            if (self.IsWindingUp or self.IsScattershotting) and self.PendingAttack ~= "SealsOfReality" and self.PendingAttack ~= "Corruption" and self.PendingAttack ~= "Scattershot" then
                vel.z = math.Approach(vel.z, desiredDir.z * speed, FrameTime() * 150)
            else
                vel.z = math.Approach(vel.z, (targetZ - self:GetPos().z) * 1.5, FrameTime() * 150)
            end
            phys:SetVelocity(vel)

            local velNormal = vel:GetNormalized()
            if velNormal:LengthSqr() > 0.01 then
                local targetAng = velNormal:Angle()

                local turnSpeedMulti = (self.IsWindingUp or self.IsScattershotting) and 60 or 30
                local pitchSpeedMulti = (self.IsWindingUp or self.IsScattershotting) and 40 or 20

                local newYaw = math.ApproachAngle(self:GetAngles().y, targetAng.y, FrameTime() * turnSpeedMulti)
                local newPitch = math.ApproachAngle(self:GetAngles().p, targetAng.p, FrameTime() * pitchSpeedMulti)
                
                local currentYaw = self:GetAngles().y
                local yawDiff = math.AngleDifference(targetAng.y, currentYaw)
                if not self.IsDying then targetRoll = math.Clamp(yawDiff * -1.2, -60, 60) end

                if not self.IsDying and self.IsBarrelRolling then
                    targetRoll = self.BarrelRollAngle
                    self.BarrelRollAngle = self.BarrelRollAngle + FrameTime() * 300
                    if self.BarrelRollAngle >= 360 then
                        self.IsBarrelRolling = false
                        self.BarrelRollAngle = 0
                        targetRoll = 0
                    end
                end

                local newRoll = math.ApproachAngle(self:GetAngles().r, targetRoll, FrameTime() * 30)
                self:SetAngles(Angle(newPitch, newYaw, newRoll))
            end
            phys:AddAngleVelocity(-phys:GetAngleVelocity())
        end

        self.NextDangerClose = self.NextDangerClose or curTime + 1.0
        if curTime > self.NextDangerClose and not self.IsDying then
            self.NextDangerClose = curTime + 1.0
            for _, victim in ipairs(ents.FindInSphere(self:GetPos(), 3000)) do 
                if (victim:IsPlayer() or victim:IsNPC()) and victim:Health() > 0 and victim ~= self.Bullseye then
                    local close = false
                    for _, p in ipairs(self.Parts) do
                        if IsValid(p) and p:GetPos():DistToSqr(victim:GetPos()) < 90000 then
                            close = true
                            break
                        end
                    end
                    if close then
                        local d = DamageInfo()
                        d:SetDamage(15)
                        d:SetDamageType(DMG_SHOCK)
                        d:SetAttacker(self)
                        d:SetInflictor(self)
                        victim:TakeDamageInfo(d)
                        local ed = EffectData() ed:SetOrigin(victim:WorldSpaceCenter()) ed:SetMagnitude(1) util.Effect("ElectricSpark", ed)
                    end
                end
            end
        end

        self.NextHeavenlyBodyCheck = self.NextHeavenlyBodyCheck or curTime + math.random(60, 120)
        if not self.IsDying and curTime > self.NextHeavenlyBodyCheck then
            self.HeavenlyBodyActive = true
            self.HeavenlyBodyEndTime = curTime + 30
            self.NextHeavenlyBodyCheck = curTime + math.random(60, 120) + 30
            self.HeavenlyFrags = {}
            self.NextHeavenlyFire = curTime + 3
            self.HeavenlyDamageTick = 0
            
            for i = 1, 8 do
                timer.Simple(i * 1.5, function()
                    if not IsValid(self) or not self.HeavenlyBodyActive then return end
                    local p = ents.Create("prop_physics")
                    p:SetModel("models/weapons/w_bugbait.mdl")
                    p:SetPos(self.Helmet:WorldSpaceCenter() + Vector(0,0,100))
                    p:Spawn()
                    p:SetModelScale(2)
                    p:SetOwner(self)
                    p:SetCollisionGroup(COLLISION_GROUP_DEBRIS)
                    p:SetNoDraw(true)
                    
                    local glow = ents.Create("env_sprite")
                    glow:SetKeyValue("model", "sprites/light_glow02_add.vmt")
                    glow:SetKeyValue("scale", "4")
                    glow:SetKeyValue("rendermode", "5")
                    glow:SetKeyValue("rendercolor", "255 255 255")
                    glow:SetParent(p)
                    glow:SetPos(p:GetPos())
                    glow:Spawn()
                    p.MyGlow = glow
                    
                    util.SpriteTrail(p, 0, Color(255,255,255), false, 30, 0, 1.5, 0.1, "trails/plasma")
                    
                    local phys = p:GetPhysicsObject()
                    if IsValid(phys) then phys:EnableGravity(false) phys:EnableCollisions(false) end
                    
                    p.OrbitAngle = (i / 8) * math.pi * 2
                    table.insert(self.HeavenlyFrags, p)
                end)
            end
        end

        if self.HeavenlyBodyActive then
            if curTime > self.HeavenlyBodyEndTime then
                self.HeavenlyBodyActive = false
                for _, p in ipairs(self.HeavenlyFrags) do
                    if IsValid(p) then
                        if IsValid(p.MyGlow) then
                            local g = p.MyGlow
                            g:SetParent(nil)
                            local sTime = curTime
                            local tName = "MDHeavenlyShrink_" .. g:EntIndex()
                            hook.Add("Think", tName, function()
                                if not IsValid(g) then hook.Remove("Think", tName) return end
                                local frac = 1 - ((CurTime() - sTime) / 1.5)
                                if frac <= 0 then SafeRemoveEntity(g) hook.Remove("Think", tName) return end
                                g:SetKeyValue("scale", tostring(4 * frac))
                            end)
                        end
                        SafeRemoveEntity(p)
                    end
                end
                self.HeavenlyFrags = {}
            else
                for _, p in ipairs(self.HeavenlyFrags) do
                    if IsValid(p) then
                        p.OrbitAngle = p.OrbitAngle + FrameTime() * 1.5
                        local offset = Vector(math.cos(p.OrbitAngle) * 400, math.sin(p.OrbitAngle) * 400, math.sin(p.OrbitAngle * 2) * 100)
                        local targetPos = self.Helmet:WorldSpaceCenter() + offset
                        local phys = p:GetPhysicsObject()
                        if IsValid(phys) then
                            phys:SetPos(targetPos)
                            phys:SetVelocity(Vector(0,0,0))
                        end
                    end
                end
                
                if curTime > self.HeavenlyDamageTick then
                    self.HeavenlyDamageTick = curTime + 1.0
                    for _, v in ipairs(ents.FindInSphere(self.Helmet:WorldSpaceCenter(), 500)) do
                        if (v:IsPlayer() or v:IsNPC()) and v:Health() > 0 and v ~= self.Bullseye then
                            local isOtherDragon = (v:GetClass() == self:GetClass()) or (v:GetClass() == "npc_bullseye" and IsValid(v:GetParent()) and v:GetParent():GetClass() == self:GetClass())
                            if not (isOtherDragon and GetConVar("md_hate_each_other"):GetInt() == 0) then
                                local d = DamageInfo()
                                d:SetDamage(20)
                                d:SetDamageType(DMG_SHOCK)
                                d:SetAttacker(self)
                                d:SetInflictor(self)
                                v:TakeDamageInfo(d)
                                local ed = EffectData() ed:SetOrigin(v:WorldSpaceCenter()) ed:SetMagnitude(1) util.Effect("ElectricSpark", ed)
                            end
                        end
                    end
                end
                
                if curTime > self.NextHeavenlyFire then
                    self.NextHeavenlyFire = curTime + 3.0
                    local targs = {}
                    for _, v in ipairs(ents.FindInSphere(self.Helmet:WorldSpaceCenter(), 6000)) do
                        if (v:IsPlayer() or v:IsNPC()) and v:Health() > 0 and v ~= self.Bullseye then
                            local isOtherDragon = (v:GetClass() == self:GetClass()) or (v:GetClass() == "npc_bullseye" and IsValid(v:GetParent()) and v:GetParent():GetClass() == self:GetClass())
                            if not (isOtherDragon and GetConVar("md_hate_each_other"):GetInt() == 0) then
                                if not (v:IsPlayer() and GetConVar("ai_ignoreplayers"):GetBool()) then table.insert(targs, v) end
                            end
                        end
                    end
                    
                    if #targs > 0 then
                        local chosen = targs[math.random(#targs)]
                        local p = ents.Create("prop_physics")
                        p:SetModel("models/weapons/w_bugbait.mdl")
                        p:SetPos(self.Helmet:WorldSpaceCenter() + Vector(0,0,100))
                        p:Spawn()
                        p:SetModelScale(2)
                        p:SetOwner(self)
                        p:SetCollisionGroup(COLLISION_GROUP_PROJECTILE)

                        local glow = ents.Create("env_sprite")
                        glow:SetKeyValue("model", "sprites/light_glow02_add.vmt")
                        glow:SetKeyValue("scale", "4")
                        glow:SetKeyValue("rendermode", "5")
                        glow:SetKeyValue("rendercolor", "255 255 255")
                        glow:SetParent(p)
                        glow:SetPos(p:GetPos())
                        glow:Spawn()
                        p.MyGlow = glow
                        
                        util.SpriteTrail(p, 0, Color(255,255,255), false, 30, 0, 1.5, 0.1, "trails/plasma")

                        local phys = p:GetPhysicsObject()
                        if IsValid(phys) then phys:EnableGravity(false) phys:SetVelocity(Vector(0,0,500)) end
                        
                        local tName = "MD_HeavenlyProj_" .. p:EntIndex()
                        hook.Add("Think", tName, function()
                            if not IsValid(p) or not IsValid(self) then hook.Remove("Think", tName) return end
                            if p.Dead or p.IsShrinking then return end
                            local pp = p:GetPhysicsObject()
                            if IsValid(pp) and IsValid(chosen) then
                                local tPos = chosen:WorldSpaceCenter()
                                local pPos = p:GetPos()
                                if pPos:DistToSqr(tPos) <= 2500 then
                                    p.Dead = true
                                    for _, v in ipairs(ents.FindInSphere(pPos, 50)) do
                                        if (v:IsPlayer() or v:IsNPC()) and v:Health() > 0 and v ~= self and not v.IsDragonBody then
                                            local dmg = DamageInfo()
                                            dmg:SetDamage(20)
                                            dmg:SetDamageType(DMG_SHOCK)
                                            dmg:SetAttacker(self)
                                            dmg:SetInflictor(self)
                                            v:TakeDamageInfo(dmg)
                                        end
                                    end
                                    local e = EffectData() e:SetOrigin(pPos) util.Effect("cball_bounce", e)
                                    p:SetNoDraw(true)
                                    p:SetNotSolid(true)
                                    SafeRemoveEntityDelayed(p, 0.1)
                                    return
                                end
                                
                                local dir = (tPos - pPos):GetNormalized()
                                local curVel = pp:GetVelocity()
                                local newDir = LerpVector(0.05, curVel:GetNormalized(), dir):GetNormalized()
                                pp:SetVelocity(newDir * 1200)
                            end
                        end)

                        p:AddCallback("PhysicsCollide", function(c, d)
                            if c.Dead then return end c.Dead = true
                            if IsValid(d.HitEntity) and d.HitEntity:Health() > 0 and d.HitEntity ~= self and not d.HitEntity.IsDragonBody then
                                local dmg = DamageInfo()
                                dmg:SetDamage(20)
                                dmg:SetDamageType(DMG_SHOCK)
                                dmg:SetAttacker(self)
                                dmg:SetInflictor(self)
                                d.HitEntity:TakeDamageInfo(dmg)
                            end
                            local e = EffectData() e:SetOrigin(d.HitPos) util.Effect("cball_bounce", e)
                            c:SetNoDraw(true)
                            c:SetNotSolid(true)
                            c:SetCollisionGroup(COLLISION_GROUP_IN_VEHICLE)
                            local cp = c:GetPhysicsObject() 
                            if IsValid(cp) then cp:EnableCollisions(false) cp:SetVelocity(d.OurOldVelocity) end
                            SafeRemoveEntityDelayed(c, 2.0)
                        end)

                        timer.Simple(10, function()
                            if IsValid(p) and not p.Dead then
                                p.IsShrinking = true
                                local sTime = CurTime()
                                local sName = "MD_HeavenlyProjShrink_" .. p:EntIndex()
                                local pp = p:GetPhysicsObject()
                                if IsValid(pp) then pp:SetVelocity(Vector(0,0,0)) end
                                
                                hook.Add("Think", sName, function()
                                    if not IsValid(p) or not IsValid(p.MyGlow) then hook.Remove("Think", sName) return end
                                    local frac = 1 - ((CurTime() - sTime) / 1.5)
                                    if frac <= 0 then
                                        SafeRemoveEntity(p)
                                        hook.Remove("Think", sName)
                                    else
                                        p.MyGlow:SetKeyValue("scale", tostring(4 * frac))
                                    end
                                end)
                            end
                        end)
                    end
                end
            end
        end

        self.NextChanneling = self.NextChanneling or curTime + math.random(7, 16)
        if not self.IsDying and curTime > self.NextChanneling then
            self.NextChanneling = curTime + math.random(7, 16)
            local cTargs = {}
            for _, v in ipairs(ents.FindInSphere(self:GetPos(), 6000)) do
                if (v:IsPlayer() or v:IsNPC()) and v:Health() > 0 and v ~= self.Bullseye then
                    local isOtherDragon = (v:GetClass() == self:GetClass()) or (v:GetClass() == "npc_bullseye" and IsValid(v:GetParent()) and v:GetParent():GetClass() == self:GetClass())
                    if isOtherDragon and GetConVar("md_hate_each_other"):GetInt() == 0 then continue end
                    
                    if v:IsPlayer() and GetConVar("ai_ignoreplayers"):GetBool() then continue end
                    table.insert(cTargs, v)
                end
            end
            
            if #cTargs > 0 then
                local cTarg = cTargs[math.random(#cTargs)]
                if math.random(1,100) <= 33 then
                    self:EmitSound("ambient/energy/zap9.wav", 110, 80)

                    local jawGlow = ents.Create("env_sprite")
                    jawGlow:SetKeyValue("model", "sprites/light_glow02_add.vmt")
                    jawGlow:SetKeyValue("rendermode", "5")
                    jawGlow:SetKeyValue("rendercolor", "100 200 255")
                    jawGlow:SetPos(self.Jaw:GetPos())
                    jawGlow:SetParent(self.Jaw)
                    jawGlow:Spawn()

                    local cTimerName = "MD_DisperseCharge_" .. self:EntIndex()
                    local sTime = CurTime()
                    hook.Add("Think", cTimerName, function()
                        if not IsValid(self) or not IsValid(jawGlow) then hook.Remove("Think", cTimerName) return end
                        local frac = (CurTime() - sTime) / 2.0
                        jawGlow:SetKeyValue("scale", tostring(1 + frac * 8))
                    end)

                    local chain = {cTarg}
                    local cur = cTarg
                    for i = 2, 5 do
                        local nxt = nil
                        for _, v in ipairs(ents.FindInSphere(cur:GetPos(), 500)) do
                            if (v:IsPlayer() or v:IsNPC()) and v:Health() > 0 and v ~= self.Bullseye and not table.HasValue(chain, v) then
                                local tr = util.TraceLine({start=cur:WorldSpaceCenter(), endpos=v:WorldSpaceCenter(), filter={cur, v, self}})
                                if not tr.Hit then nxt = v break end
                            end
                        end
                        if nxt then table.insert(chain, nxt) cur = nxt else break end
                    end

                    local bulbs = {}
                    for i, tgt in ipairs(chain) do
                        local bulb = ents.Create("env_sprite")
                        bulb:SetKeyValue("model", "sprites/light_glow02_add.vmt")
                        bulb:SetKeyValue("scale", tostring(1.5 - (i * 0.4)))
                        bulb:SetKeyValue("rendermode", "5")
                        bulb:SetKeyValue("rendercolor", "100 200 255")
                        bulb:SetPos(tgt:WorldSpaceCenter() + Vector(0,0,40))
                        bulb:SetParent(tgt)
                        bulb:Spawn()
                        table.insert(bulbs, bulb)
                    end

                    timer.Simple(2.0, function()
                        if IsValid(self) then hook.Remove("Think", cTimerName) end
                        if IsValid(jawGlow) then jawGlow:Remove() end
                        for _, b in ipairs(bulbs) do if IsValid(b) then b:Remove() end end

                        if not IsValid(self) or self.Dead then return end

                        local firstTarg = chain[1]
                        if not IsValid(firstTarg) then return end
                        local trCheck = util.TraceLine({start=self.Jaw:GetPos(), endpos=firstTarg:WorldSpaceCenter(), filter={self, self.Helmet, self.Jaw}})
                        if trCheck.Hit and trCheck.Entity ~= firstTarg then return end 

                        local currentVictim = firstTarg
                        local dmgAmts = {50, 40, 30, 20, 10}
                        local strikeSrc = self.Jaw
                        local hitTargs = {}
                        
                        for i = 1, #chain do
                            timer.Simple((i-1) * 0.2, function()
                                if not IsValid(self) or not IsValid(currentVictim) then return end
                                table.insert(hitTargs, currentVictim)

                                if currentVictim:IsPlayer() then
                                    currentVictim:SetNWFloat("MD_DisperseExpire", CurTime() + 1.0)
                                end
                                
                                local d = DamageInfo()
                                d:SetDamage(dmgAmts[i] or 10)
                                d:SetDamageType(DMG_SHOCK + DMG_BULLET)
                                d:SetAttacker(self)
                                d:SetInflictor(self)
                                currentVictim:TakeDamageInfo(d)

                                local startPos = (strikeSrc == self.Jaw) and self.Jaw:GetPos() or (IsValid(strikeSrc) and strikeSrc:WorldSpaceCenter() or self:WorldSpaceCenter())
                                local endPos = currentVictim:WorldSpaceCenter()
                                local tName = "md_disp_" .. currentVictim:EntIndex() .. "_" .. i
                                local tEnt = ents.Create("info_target")
                                tEnt:SetPos(endPos)
                                tEnt:SetName(tName)
                                tEnt:Spawn()
                                
                                local beam = ents.Create("env_laser")
                                beam:SetPos(startPos)
                                beam:SetKeyValue("texture", "sprites/physbeam.vmt")
                                beam:SetKeyValue("rendercolor", "100 200 255")
                                beam:SetKeyValue("width", tostring(15 - i*2))
                                beam:SetKeyValue("LaserTarget", tName)
                                beam:SetKeyValue("NoiseAmplitude", "3")
                                beam:Spawn()
                                beam:Activate()
                                beam:Fire("TurnOn")
                                beam:SetRenderMode(RENDERMODE_TRANSADD)
                                beam:SetColor(Color(100, 200, 255, 255))
                                
                                local fadeID = "MDDispFade_" .. beam:EntIndex()
                                timer.Create(fadeID, 0.05, 6, function()
                                    if IsValid(beam) then
                                        local alpha = math.floor((timer.RepsLeft(fadeID) / 6) * 255)
                                        beam:SetColor(Color(100, 200, 255, alpha))
                                    end
                                end)
                                
                                local ed = EffectData() ed:SetOrigin(endPos) util.Effect("cball_explode", ed)
                                sound.Play("ambient/energy/zap" .. math.random(1,3) .. ".wav", endPos, 100, 100)
                                
                                SafeRemoveEntityDelayed(beam, 0.7)
                                SafeRemoveEntityDelayed(tEnt, 0.7)
                                
                                strikeSrc = currentVictim
                                local nextVic = nil
                                for _, v in ipairs(ents.FindInSphere(currentVictim:GetPos(), 500)) do
                                    if (v:IsPlayer() or v:IsNPC()) and v:Health() > 0 and v ~= self.Bullseye and not table.HasValue(hitTargs, v) then
                                        local cTr = util.TraceLine({start=currentVictim:WorldSpaceCenter(), endpos=v:WorldSpaceCenter(), filter={currentVictim, v, self}})
                                        if not cTr.Hit then
                                            nextVic = v
                                            break
                                        end
                                    end
                                end
                                if nextVic then currentVictim = nextVic end
                            end)
                        end
                    end)
                else
                    self.IronBloodTarget = cTarg
                    self.IronBloodIntensity = 0.1
                    self.IronBloodTimeout = CurTime() + 20

                    self.IronBloodGlow = ents.Create("env_sprite")
                    self.IronBloodGlow:SetKeyValue("model", "sprites/light_glow02_add.vmt")
                    self.IronBloodGlow:SetKeyValue("rendermode", "5")
                    self.IronBloodGlow:SetKeyValue("rendercolor", "0 200 255")
                    self.IronBloodGlow:SetPos(cTarg:WorldSpaceCenter())
                    self.IronBloodGlow:SetParent(cTarg)
                    self.IronBloodGlow:Spawn()

                    self.IronBloodLight = ents.Create("light_dynamic")
                    self.IronBloodLight:SetPos(cTarg:WorldSpaceCenter())
                    self.IronBloodLight:SetParent(cTarg)
                    self.IronBloodLight:SetKeyValue("_light", "0 200 255 255")
                    self.IronBloodLight:SetKeyValue("distance", "50")
                    self.IronBloodLight:SetKeyValue("brightness", "2")
                    self.IronBloodLight:Spawn()
                end
            end
        end

        if self.IronBloodTarget and CurTime() > (self.IronBloodTimeout or 0) then
            SafeRemoveEntity(self.IronBloodGlow)
            SafeRemoveEntity(self.IronBloodLight)
            self.IronBloodTarget = nil
            self.IronBloodIntensity = 0
        end

        if IsValid(self.IronBloodTarget) and self.IronBloodTarget:Health() > 0 then
            
            local dist = self:GetPos():DistToSqr(self.IronBloodTarget:GetPos())
            local hasLOS = false
            local tr = util.TraceLine({
                start = self.Helmet:WorldSpaceCenter(),
                endpos = self.IronBloodTarget:WorldSpaceCenter(),
                mask = MASK_SOLID_BRUSHONLY
            })
            if not tr.Hit then hasLOS = true end

            if dist <= 16000000 and hasLOS then
                self.IronBloodIntensity = math.Clamp(self.IronBloodIntensity + FrameTime() * 0.25, 0, 1.2)
            else
                self.IronBloodIntensity = math.Clamp(self.IronBloodIntensity - FrameTime() * 0.5, 0, 1.2)
            end
            
            if IsValid(self.IronBloodGlow) then
                self.IronBloodGlow:SetKeyValue("scale", tostring(self.IronBloodIntensity * 10))
                self.IronBloodGlow:SetKeyValue("renderamt", tostring(math.min(255, self.IronBloodIntensity * 255)))
            end
            if IsValid(self.IronBloodLight) then
                self.IronBloodLight:SetKeyValue("distance", tostring(self.IronBloodIntensity * 400))
                self.IronBloodLight:SetKeyValue("brightness", tostring(self.IronBloodIntensity * 6))
            end
            
            if self.IronBloodIntensity >= 1.0 then
                local tPos = self.IronBloodTarget:WorldSpaceCenter()
                
                local ed = EffectData() ed:SetOrigin(tPos) ed:SetScale(20) util.Effect("cball_explode", ed)
                sound.Play("ambient/explosions/explode_9.wav", tPos, 140, 100)

                util.ScreenShake(tPos, 20, 20, 1.5, 1000)

                if self.IronBloodTarget:IsPlayer() then
                    self.IronBloodTarget:SetNWFloat("MD_IronBloodExpire", CurTime() + 1.0)
                end
                
                local strike = ents.Create("env_laser")
                strike:SetPos(tPos + Vector(0,0,15000))
                
                local targName = "md_iron_" .. self:EntIndex()
                local targ = ents.Create("info_target")
                targ:SetPos(tPos)
                targ:SetName(targName)
                targ:Spawn()
                
                strike:SetKeyValue("texture", "sprites/laserbeam.vmt")
                strike:SetKeyValue("rendercolor", "100 200 255")
                strike:SetKeyValue("width", "5")
                strike:SetKeyValue("NoiseAmplitude", "5")
                strike:SetKeyValue("LaserTarget", targName)
                strike:Spawn()
                strike:Activate()
                strike:Fire("TurnOn")
                
                SafeRemoveEntityDelayed(strike, 0.7)
                SafeRemoveEntityDelayed(targ, 0.7)
                
                for _, v in ipairs(ents.FindInSphere(tPos, 150)) do
                    if (v:IsPlayer() or v:IsNPC()) and v:Health() > 0 then
                        local d = DamageInfo()
                        d:SetDamage(math.random(70,120))
                        d:SetDamageType(DMG_SHOCK + DMG_BLAST)
                        d:SetAttacker(self)
                        d:SetInflictor(self)
                        v:TakeDamageInfo(d)
                    end
                end
                
                SafeRemoveEntity(self.IronBloodGlow)
                SafeRemoveEntity(self.IronBloodLight)
                self.IronBloodTarget = nil
                self.IronBloodIntensity = 0
            elseif self.IronBloodIntensity <= 0 then
                SafeRemoveEntity(self.IronBloodGlow)
                SafeRemoveEntity(self.IronBloodLight)
                self.IronBloodTarget = nil
                self.IronBloodIntensity = 0
            end
        elseif self.IronBloodTarget then
            SafeRemoveEntity(self.IronBloodGlow)
            SafeRemoveEntity(self.IronBloodLight)
            self.IronBloodTarget = nil
        end

        if not self.IsDying and self.DamageTracker >= 250 then
            self.DamageTracker = 0
            self.SpewEndTime = curTime + 3.0
            self.SpewVariant = (math.random(1,100) <= 75) and "Bullets" or "Flechette"
        end

        if not self.IsDying and self.SpewEndTime and curTime < self.SpewEndTime then
            self.NextSpew = self.NextSpew or 0
            if curTime > self.NextSpew then
                self.NextSpew = curTime + 0.05
                local dir = (IsValid(self.Target) and (self.Target:WorldSpaceCenter() - self.Jaw:GetPos()):GetNormalized() or self.Helmet:GetForward())
                
                if self.SpewVariant == "Flechette" then
                    self:EmitSound("NPC_Hunter.FlechetteShoot")
                    local flech = ents.Create("hunter_flechette")
                    flech:SetPos(self.Jaw:GetPos() + dir * 50)
                    flech:SetAngles(dir:Angle())
                    flech:SetOwner(self)
                    flech:Spawn()
                    flech:SetVelocity(dir * 2500 + VectorRand() * 50)
                else
                    self:EmitSound("NPC_Hunter.FireMinigun")
                    local bullet = {
                        Num = 1, Src = self.Jaw:GetPos(),
                        Dir = dir + VectorRand() * 0.0375,
                        Spread = Vector(0, 0, 0), Tracer = 1, TracerName = "AR2Tracer",
                        Force = 5, Damage = math.random(4, 8), Attacker = self
                    }
                    self:FireBullets(bullet)
                end
            end
        end

        if not self.IsDying and not self.IsWindingUp and not self.IsScattershotting and curTime > self.NextAttackChoice and IsValid(self.Target) then
            local isAir = false
            local tClass = self.Target:GetClass()
            
            if self.Target:IsPlayer() and self.Target:InVehicle() then isAir = true end
            if tClass:match("heli") or tClass:match("jet") or tClass:match("gunship") or tClass:match("dropship") or tClass:match("chopper") or tClass:match("plane") or tClass:match("drone") or tClass:match("scanner") then isAir = true end
            
            local mType = self.Target:GetMoveType()
            if mType == MOVETYPE_FLY or mType == MOVETYPE_FLYGRAVITY then isAir = true end
            
            if not isAir then
                local trDown = util.TraceLine({
                    start = self.Target:GetPos(), 
                    endpos = self.Target:GetPos() - Vector(0,0,500), 
                    filter = self.Target
                })
                if not trDown.Hit then isAir = true end
            end

            local r = math.random(1, 100)
            
            if isAir then
                if r <= 50 then
                    self.IsWindingUp = true
                    self.WindupEndTime = curTime + 1.5
                    self.PendingAttack = "Pursuit"
                    self.NextAttackChoice = curTime + 8
                elseif r <= 70 then
                    self.IsWindingUp = true
                    self.WindupEndTime = curTime + 2.0
                    self.PendingAttack = "CelestialFragments"
                    self:EmitSound("ambient/machines/teleport1.wav", 110, 100)
                    self.NextAttackChoice = curTime + 12
                elseif r <= 85 then
                    self.IsWindingUp = true
                    self.WindupEndTime = curTime + 1.5
                    self.PendingAttack = "Boomstick"
                    self.NextAttackChoice = curTime + 10
                else
                    self.IsWindingUp = true
                    self.WindupEndTime = curTime + 1.5
                    self.PendingAttack = "GuidedBoomstick"
                    self.NextAttackChoice = curTime + 12
                end
            else
                if r <= 10 then 
                    self.IsWindingUp = true
                    self.WindupEndTime = curTime + 2.0
                    self.PendingAttack = "SealsOfReality"
                    self:EmitSound("ambient/machines/teleport1.wav", 110, 100)
                    self.NextAttackChoice = curTime + 15
                elseif r <= 30 then
                    self.IsWindingUp = true
                    self.WindupEndTime = curTime + 2.0
                    self.PendingAttack = "Corruption"
                    self:EmitSound("ambient/levels/citadel/portal_beam_shoot1.wav", 110, 80)
                    self.NextAttackChoice = curTime + 15
                elseif r <= 50 then
                    self.IsWindingUp = true
                    self.WindupEndTime = curTime + 2.0
                    self.PendingAttack = "Scattershot"
                    self.NextAttackChoice = curTime + 15
                else 
                    self.IsWindingUp = true
                    self.WindupEndTime = curTime + 1.5
                    self.PendingAttack = (math.random(1,100) <= 40) and "SoulCharge" or "SolarEruption"
                    self:EmitSound("npc/strider/charging.wav", 100, 100)
                    self.NextAttackChoice = curTime + 10
                end
            end
        end

        self:NextThink(curTime)
        return true
    end
end

if CLIENT then
    language.Add("ent_alt_millennium_dragon", "Millennium Dragon")
    local HUDVeins = {}
    local Corruption_HUDIntensity = 0
    
    local DeathVeins = {}
    local Death_HUDIntensity = 0

    local matGradL2R = Material("vgui/gradient-l")
    local matGradU2D = Material("vgui/gradient-u")
    local matGradD2U = Material("vgui/gradient-d")
    local matWhite = Material("vgui/white")
    local matGlow = Material("sprites/light_glow02_add")

    local function GenerateHUDVeins()
        HUDVeins = {}
        local sw, sh = ScrW(), ScrH()
        local function Grow(x, y, a, len, thick, depth, int)
            if depth > 4 then return end
            local b = { pts = {}, th = {}, trigger = int, full = int + 0.15, pulse = math.random(1, 10) }
            local cx, cy, ca = x, y, a
            local segs = math.random(8, 12)
            local step = len / segs
            table.insert(b.pts, {x=cx, y=cy})
            table.insert(b.th, thick)
            for s = 1, segs do
                ca = ca + math.Rand(-0.3, 0.3) 
                cx = cx + math.cos(ca) * step
                cy = cy + math.sin(ca) * step
                table.insert(b.pts, {x=cx, y=cy})
                table.insert(b.th, thick * (1 - (s/segs)*0.5))
            end
            table.insert(HUDVeins, b)
            for i = 1, math.random(1, 2) do
                Grow(b.pts[#b.pts].x, b.pts[#b.pts].y, ca + math.Rand(-0.6, 0.6), len * math.Rand(0.6, 0.8), thick * 0.6, depth + 1, int + 0.15)
            end
        end
        for i=1, 6 do Grow(0, math.random(0, sh), math.random(-45, 45), math.random(80, 150), math.random(8, 14), 1, 0.05) end
        for i=1, 6 do Grow(sw, math.random(0, sh), math.random(135, 225), math.random(80, 150), math.random(8, 14), 1, 0.05) end
        for i=1, 6 do Grow(math.random(0, sw), 0, math.random(45, 135), math.random(80, 150), math.random(8, 14), 1, 0.05) end
        for i=1, 6 do Grow(math.random(0, sw), sh, math.random(225, 315), math.random(80, 150), math.random(8, 14), 1, 0.05) end
    end

    local function GenerateDeathArches()
        DeathVeins = {}
        local sw, sh = ScrW(), ScrH()
        local function Grow(x, y, a, len, thick, depth, int)
            if depth > 5 then return end
            local b = { pts = {}, th = {}, trigger = int, full = int + 0.15, pulse = math.random(1, 10) }
            local cx, cy, ca = x, y, a
            local segs = math.random(4, 8)
            local step = len / segs
            table.insert(b.pts, {x=cx, y=cy})
            table.insert(b.th, thick)
            for s = 1, segs do
                ca = ca + math.Rand(-0.8, 0.8) 
                cx = cx + math.cos(ca) * step
                cy = cy + math.sin(ca) * step
                table.insert(b.pts, {x=cx, y=cy})
                table.insert(b.th, thick * (1 - (s/segs)*0.5))
            end
            table.insert(DeathVeins, b)
            for i = 1, math.random(1, 3) do
                if math.random(1,100) > 30 then
                    Grow(b.pts[#b.pts].x, b.pts[#b.pts].y, ca + math.Rand(-1.2, 1.2), len * math.Rand(0.4, 0.9), thick * 0.7, depth + 1, int + 0.1)
                end
            end
        end
        for i=1, 8 do Grow(0, math.random(0, sh), math.random(-45, 45), math.random(150, 300), math.random(6, 12), 1, 0.05) end
        for i=1, 8 do Grow(sw, math.random(0, sh), math.random(135, 225), math.random(150, 300), math.random(6, 12), 1, 0.05) end
        for i=1, 8 do Grow(math.random(0, sw), 0, math.random(45, 135), math.random(150, 300), math.random(6, 12), 1, 0.05) end
        for i=1, 8 do Grow(math.random(0, sw), sh, math.random(225, 315), math.random(150, 300), math.random(6, 12), 1, 0.05) end
    end

    hook.Add("HUDPaint", "MD_Corruption_ScreenEffects", function()
        local ply = LocalPlayer()
        if not IsValid(ply) or not ply:Alive() then return end

        local expireTime = ply:GetNWFloat("MD_CorruptionExpire", 0)
        local targetIntensity = 0
        if CurTime() < expireTime then
            targetIntensity = math.Clamp((expireTime - CurTime()) / 10, 0, 1)
        end

        if targetIntensity > Corruption_HUDIntensity then
            Corruption_HUDIntensity = Lerp(FrameTime() * 2, Corruption_HUDIntensity, targetIntensity)
        else
            Corruption_HUDIntensity = Lerp(FrameTime() * 0.3, Corruption_HUDIntensity, targetIntensity)
        end

        local intensity = Corruption_HUDIntensity

        if intensity > 0.01 then
            local w, h = ScrW(), ScrH()
            surface.SetDrawColor(0, 0, 0, 255 * intensity)
            surface.SetMaterial(matGradL2R)
            surface.DrawTexturedRect(0, 0, w * 0.3, h) 
            surface.DrawTexturedRectRotated(w - (w * 0.15), h/2, w * 0.3, h, 180) 
            surface.SetMaterial(matGradU2D)
            surface.DrawTexturedRect(0, 0, w, h * 0.3) 
            surface.SetMaterial(matGradD2U)
            surface.DrawTexturedRect(0, h - (h * 0.3), w, h * 0.3) 

            if #HUDVeins == 0 then GenerateHUDVeins() end
            surface.SetMaterial(matWhite)
            
            for _, b in ipairs(HUDVeins) do
                if intensity >= b.trigger then
                    local fraction = math.Clamp((intensity - b.trigger) / (b.full - b.trigger), 0, 1)
                    if fraction <= 0 then continue end
                    local maxVis = math.floor(1 + (#b.pts - 1) * fraction)
                    local pulse = math.sin(CurTime() * 4 + b.pulse) * 1.5
                    
                    for j = 1, maxVis - 1 do
                        local p1, p2 = b.pts[j], b.pts[j+1]
                        local thick = math.max(1, b.th[j] + pulse)
                        surface.SetDrawColor(0, 0, 0, 255) 
                        local cx, cy = (p1.x + p2.x) / 2, (p1.y + p2.y) / 2
                        local len = math.sqrt((p2.x - p1.x)^2 + (p2.y - p1.y)^2)
                        local ang = math.deg(math.atan2(p2.y - p1.y, p2.x - p1.x))
                        surface.DrawTexturedRectRotated(cx, cy, len + thick, thick, -ang)
                    end
                end
            end
        else
            if #HUDVeins > 0 then HUDVeins = {} end 
        end
    end)

    hook.Add("HUDPaint", "MD_Channeling_ScreenEffects", function()
        local ply = LocalPlayer()
        if not IsValid(ply) or not ply:Alive() then return end

        local dispExpire = ply:GetNWFloat("MD_DisperseExpire", 0)
        if CurTime() < dispExpire then
            local dInt = math.Clamp(dispExpire - CurTime(), 0, 1)
            surface.SetDrawColor(0, 100, 255, 100 * dInt)
            surface.SetMaterial(matGradL2R)
            surface.DrawTexturedRect(0, 0, ScrW() * 0.3, ScrH()) 
            surface.DrawTexturedRectRotated(ScrW() - (ScrW() * 0.15), ScrH()/2, ScrW() * 0.3, ScrH(), 180) 
            surface.SetMaterial(matGradU2D)
            surface.DrawTexturedRect(0, 0, ScrW(), ScrH() * 0.3) 
            surface.SetMaterial(matGradD2U)
            surface.DrawTexturedRect(0, ScrH() - (ScrH() * 0.3), ScrW(), ScrH() * 0.3)
        end
        
        local ibExpire = ply:GetNWFloat("MD_IronBloodExpire", 0)
        if CurTime() < ibExpire then
            local frac = math.Clamp(ibExpire - CurTime(), 0, 1)
            surface.SetDrawColor(0, 100, 255, 150 * frac)
            surface.SetMaterial(matGradU2D)
            surface.DrawTexturedRect(0, 0, ScrW(), ScrH() * 0.3)
        end
    end)

    hook.Add("HUDPaint", "MD_Death_ScreenEffects", function()
        local ply = LocalPlayer()
        if not IsValid(ply) or not ply:Alive() then return end

        local phase = ply:GetNWInt("MD_DeathPhase", 0)
        local targetIntensity = phase > 0 and (phase / 7) or 0

        if targetIntensity > Death_HUDIntensity then
            Death_HUDIntensity = Lerp(FrameTime() * 2, Death_HUDIntensity, targetIntensity)
        else
            Death_HUDIntensity = Lerp(FrameTime() * 0.3, Death_HUDIntensity, targetIntensity)
        end

        local intensity = Death_HUDIntensity

        if intensity > 0.01 then
            local w, h = ScrW(), ScrH()

            surface.SetDrawColor(0, 100, 255, 255 * intensity)
            surface.SetMaterial(matGradL2R)
            surface.DrawTexturedRect(0, 0, w * 0.3, h) 
            surface.DrawTexturedRectRotated(w - (w * 0.15), h/2, w * 0.3, h, 180) 
            surface.SetMaterial(matGradU2D)
            surface.DrawTexturedRect(0, 0, w, h * 0.3) 
            surface.SetMaterial(matGradD2U)
            surface.DrawTexturedRect(0, h - (h * 0.3), w, h * 0.3) 

            if #DeathVeins == 0 then GenerateDeathArches() end
            
            for _, b in ipairs(DeathVeins) do
                if intensity >= b.trigger then
                    local fraction = math.Clamp((intensity - b.trigger) / (b.full - b.trigger), 0, 1)
                    if fraction <= 0 then continue end
                    local maxVis = math.floor(1 + (#b.pts - 1) * fraction)
                    local pulse = math.sin(CurTime() * 4 + b.pulse) * 1.5
                    
                    for j = 1, maxVis - 1 do
                        local p1, p2 = b.pts[j], b.pts[j+1]
                        local thick = math.max(1, b.th[j] + pulse) 
                        local cx, cy = (p1.x + p2.x) / 2, (p1.y + p2.y) / 2
                        local len = math.sqrt((p2.x - p1.x)^2 + (p2.y - p1.y)^2)
                        local ang = math.deg(math.atan2(p2.y - p1.y, p2.x - p1.x))
                        
                        surface.SetDrawColor(150, 200, 255, 255) 
                        surface.DrawTexturedRectRotated(cx, cy, len + thick, thick, -ang)
                    end
                end
            end
        else
            if #DeathVeins > 0 then DeathVeins = {} end 
        end
    end)
end

-- You will not keep me here forever, Warden...