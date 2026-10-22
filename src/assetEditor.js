const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { parseGmaHeader, extractAllPureJs, extractSingleFile, createWithGmad } = require('./gmaParser');

/**
 * Generates a valid uncompressed Valve Texture Format (VTF v7.2) buffer
 * from an Electron nativeImage (BGRA8888 512x512).
 */
function createVtfFromNativeImage(img, size = 512) {
    const resized = img.resize({ width: size, height: size, quality: 'best' });
    const bgraBitmap = resized.toBitmap(); // 4 bytes per pixel (BGRA8888)
    const pixelBytes = size * size * 4;

    const header = Buffer.alloc(80, 0);
    // Signature "VTF\0"
    header.write('VTF\0', 0, 4, 'ascii');
    // Version 7.2
    header.writeUInt32LE(7, 4);
    header.writeUInt32LE(2, 8);
    // Header size = 80
    header.writeUInt32LE(80, 12);
    // Width & Height
    header.writeUInt16LE(size, 16);
    header.writeUInt16LE(size, 18);
    // Flags: CLAMPS (0x04) | CLAMPT (0x08) | NOMIP (0x100) | NOLOD (0x200) | EIGHTBITALPHA (0x2000) = 0x230C
    header.writeUInt32LE(0x0000230C, 20);
    // Frames = 1, FirstFrame = 0
    header.writeUInt16LE(1, 24);
    header.writeUInt16LE(0, 26);
    // Reflectivity (3 floats at offset 32)
    header.writeFloatLE(0.5, 32);
    header.writeFloatLE(0.5, 36);
    header.writeFloatLE(0.5, 40);
    // Bumpmap scale (offset 48)
    header.writeFloatLE(1.0, 48);
    // HighResImageFormat = 12 (IMAGE_FORMAT_BGRA8888)
    header.writeUInt32LE(12, 52);
    // Mipmap count = 1
    header.writeUInt8(1, 56);
    // LowResImageFormat = 0xFFFFFFFF (NONE)
    header.writeUInt32LE(0xFFFFFFFF, 57);
    // LowResWidth = 0, LowResHeight = 0
    header.writeUInt8(0, 61);
    header.writeUInt8(0, 62);
    // Depth = 1
    header.writeUInt16LE(1, 63);

    return Buffer.concat([header, bgraBitmap.subarray(0, pixelBytes)]);
}

/**
 * Friendly label for sound files inside a 2D NextBot
 */
function describeSoundSlot(soundRelPath) {
    const base = path.basename(soundRelPath).toLowerCase();
    if (base.includes('panic') || base.includes('chase') || base.includes('loop') || base.includes('esponjatriste') || base.includes('sunp12')) {
        return { role: 'chase', label: '🔥 Main Chase / Panic Music', isPrimaryMusic: true };
    }
    if (base.includes('jumpscare') || base.includes('js.')) {
        return { role: 'jumpscare', label: '😱 Jumpscare / Attack Sound', isPrimaryMusic: false };
    }
    if (base.includes('spring') || base.includes('jumphigh')) {
        return { role: 'spring', label: '🚀 High Leap / Bounce Sound', isPrimaryMusic: false };
    }
    if (base.includes('jump')) {
        return { role: 'jump', label: '🦘 Jump Sound', isPrimaryMusic: false };
    }
    if (base.includes('pieceofcake') || base.includes('tooeasy') || base.includes('tooslow') || base.includes('stepitup')) {
        return { role: 'taunt', label: `🗣️ Taunt / Catchphrase (${path.basename(soundRelPath)})`, isPrimaryMusic: false };
    }
    return { role: 'sfx', label: `🔊 Sound Effect (${path.basename(soundRelPath)})`, isPrimaryMusic: false };
}

/**
 * Scans all installed Workshop GMAs and Local Addon folders for 2D NextBot / Character addons
 */
async function scanEditableCharacters(gmodInfo) {
    const characters = [];
    if (!gmodInfo) return characters;

    const cacheDir = path.join(__dirname, '..', 'data', 'studio_cache');
    fs.mkdirSync(cacheDir, { recursive: true });

    // 1. Scan Workshop GMAs
    if (gmodInfo.workshopDir && fs.existsSync(gmodInfo.workshopDir)) {
        try {
            const folders = fs.readdirSync(gmodInfo.workshopDir, { withFileTypes: true });
            for (const folder of folders) {
                if (!folder.isDirectory()) continue;
                const folderPath = path.join(gmodInfo.workshopDir, folder.name);
                const files = fs.readdirSync(folderPath);
                for (const file of files) {
                    if (!file.toLowerCase().endsWith('.gma')) continue;
                    const gmaPath = path.join(folderPath, file);
                    try {
                        const header = parseGmaHeader(gmaPath);
                        if (!header || !header.files || header.files.length > 45) continue;

                        const entityLuas = header.files.filter(f =>
                            f.name.toLowerCase().startsWith('lua/entities/') &&
                            f.name.toLowerCase().endsWith('.lua') &&
                            !f.name.toLowerCase().includes('weapon_')
                        );
                        if (entityLuas.length === 0) continue;

                        // Skip 3D model nextbots (ones that ship .mdl files) so we focus on true 2D image characters
                        const hasModels = header.files.some(f => f.name.toLowerCase().endsWith('.mdl'));
                        if (hasModels) continue;

                        const images = header.files.filter(f => /\.(png|jpg|jpeg)$/i.test(f.name));
                        const sounds = header.files.filter(f => /\.(mp3|wav|ogg)$/i.test(f.name));
                        if (images.length === 0 || sounds.length === 0) continue;

                        // Extract preview icon if available
                        let previewDataUrl = null;
                        const bestImg = images.find(i => !i.name.includes('killicon') && !i.name.startsWith('materials/entities/'))
                            || images.find(i => i.name.startsWith('materials/entities/'))
                            || images[0];

                        if (bestImg) {
                            const cachedImgPath = path.join(cacheDir, `ws_${folder.name}_${path.basename(bestImg.name)}`);
                            if (!fs.existsSync(cachedImgPath)) {
                                try {
                                    extractSingleFile(gmaPath, bestImg.name, cachedImgPath);
                                } catch (_) {}
                            }
                            if (fs.existsSync(cachedImgPath)) {
                                const ext = path.extname(cachedImgPath).toLowerCase().replace('.', '') || 'png';
                                const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
                                previewDataUrl = `data:${mime};base64,${fs.readFileSync(cachedImgPath).toString('base64')}`;
                            }
                        }

                        characters.push({
                            id: `ws_${folder.name}`,
                            workshopId: folder.name,
                            name: header.name || `Workshop #${folder.name}`,
                            sourceType: 'workshop_gma',
                            sourcePath: gmaPath,
                            entityLua: entityLuas[0].name,
                            soundsCount: sounds.length,
                            imagesCount: images.length,
                            previewDataUrl,
                            isCustomRemix: false
                        });
                    } catch (_) {}
                }
            }
        } catch (err) {
            console.error('Error scanning workshop for 2D characters:', err);
        }
    }

    // 2. Scan Local Addon Folders (including user's custom Studio creations)
    if (gmodInfo.addonsDir && fs.existsSync(gmodInfo.addonsDir)) {
        try {
            const entries = fs.readdirSync(gmodInfo.addonsDir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const addonDir = path.join(gmodInfo.addonsDir, entry.name);
                const entitiesDir = path.join(addonDir, 'lua', 'entities');
                if (!fs.existsSync(entitiesDir)) continue;

                const luaFiles = fs.readdirSync(entitiesDir).filter(f => f.endsWith('.lua'));
                if (luaFiles.length === 0) continue;

                let title = entry.name;
                let isCustomRemix = entry.name.startsWith('studio_2d_');
                const addonJsonPath = path.join(addonDir, 'addon.json');
                if (fs.existsSync(addonJsonPath)) {
                    try {
                        const meta = JSON.parse(fs.readFileSync(addonJsonPath, 'utf8'));
                        if (meta.title) title = meta.title;
                        if (meta.studioRemix) isCustomRemix = true;
                    } catch (_) {}
                }

                // Look for entity icon or sprite
                let previewDataUrl = null;
                const entIconDir = path.join(addonDir, 'materials', 'entities');
                if (fs.existsSync(entIconDir)) {
                    const icons = fs.readdirSync(entIconDir).filter(f => /\.(png|jpg)$/i.test(f));
                    if (icons.length > 0) {
                        const iconPath = path.join(entIconDir, icons[0]);
                        const ext = path.extname(iconPath).toLowerCase().replace('.', '') || 'png';
                        previewDataUrl = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${fs.readFileSync(iconPath).toString('base64')}`;
                    }
                }

                // Count sounds
                let soundsCount = 0;
                const soundDir = path.join(addonDir, 'sound');
                if (fs.existsSync(soundDir)) {
                    const walkSounds = (dir) => {
                        for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
                            if (item.isDirectory()) walkSounds(path.join(dir, item.name));
                            else if (/\.(mp3|wav|ogg)$/i.test(item.name)) soundsCount++;
                        }
                    };
                    walkSounds(soundDir);
                }

                characters.push({
                    id: `local_${entry.name}`,
                    workshopId: null,
                    name: title,
                    sourceType: 'local_folder',
                    sourcePath: addonDir,
                    entityLua: `lua/entities/${luaFiles[0]}`,
                    soundsCount,
                    imagesCount: 1,
                    previewDataUrl,
                    isCustomRemix
                });
            }
        } catch (err) {
            console.error('Error scanning local 2D characters:', err);
        }
    }

    // Sort custom remixes first, then alphabetical
    characters.sort((a, b) => {
        if (a.isCustomRemix !== b.isCustomRemix) return a.isCustomRemix ? -1 : 1;
        return a.name.localeCompare(b.name);
    });

    return characters;
}

/**
 * Parses a NextBot Lua file to extract its configurable stats and metadata
 */
function parseNextbotLuaStats(luaContent, fallbackClass) {
    let npcClass = fallbackClass || 'npc_custom_bot';
    let displayName = npcClass;
    let category = 'Nextbot';
    let spriteSize = 128;
    let chaseSpeed = 650;
    let jumpHeight = 300;
    let attackForce = 800;
    let smashProps = true;

    // Extract display name from list.Set("NPC", ...) or language.Add(...)
    const nameMatch = luaContent.match(/Name\s*=\s*"([^"]+)"/) || luaContent.match(/language\.Add\s*\(\s*"[^"]+"\s*,\s*"([^"]+)"\s*\)/);
    if (nameMatch && nameMatch[1]) displayName = nameMatch[1].trim();

    const catMatch = luaContent.match(/Category\s*=\s*"([^"]+)"/);
    if (catMatch && catMatch[1]) category = catMatch[1].trim();

    // Sprite size
    const spriteSizeMatch = luaContent.match(/local\s+SPRITE_SIZE\s*=\s*(\d+)/) ||
                            luaContent.match(/render\.DrawSprite\s*\([^,]+,\s*(\d+)\s*,\s*(\d+)/);
    if (spriteSizeMatch && spriteSizeMatch[1]) {
        spriteSize = parseInt(spriteSizeMatch[1], 10) || 128;
    }

    // Desired speed
    const speedMatch = luaContent.match(/SetDesiredSpeed\s*\(\s*(?:game\.SinglePlayer\(\)\s*and\s*)?(\d+)/);
    if (speedMatch && speedMatch[1]) {
        chaseSpeed = parseInt(speedMatch[1], 10) || 650;
    }

    // Jump height
    const jumpMatch = luaContent.match(/SetJumpHeight\s*\(\s*(\d+)\s*\)/);
    if (jumpMatch && jumpMatch[1]) {
        jumpHeight = parseInt(jumpMatch[1], 10) || 300;
    }

    // Attack force
    const forceMatch = luaContent.match(/_attack_force"\s*,\s*(\d+)/);
    if (forceMatch && forceMatch[1]) {
        attackForce = parseInt(forceMatch[1], 10) || 800;
    }

    // Smash props
    const smashMatch = luaContent.match(/_smash_props"\s*,\s*([01])/);
    if (smashMatch) {
        smashProps = smashMatch[1] === '1';
    }

    return {
        npcClass,
        displayName,
        category,
        spriteSize,
        chaseSpeed,
        jumpHeight,
        attackForce,
        smashProps
    };
}

/**
 * Loads a character (either from an existing GMA/folder or the Blank Template) into a workspace
 * for interactive editing in the Asset Studio.
 */
async function loadCharacterForEditing(gmodInfo, characterId) {
    const workspaceRoot = path.join(__dirname, '..', 'data', 'studio_workspace');
    fs.mkdirSync(workspaceRoot, { recursive: true });

    if (characterId === 'template_new') {
        return {
            id: 'template_new',
            isNewTemplate: true,
            sourceName: 'Blank 2D NextBot Template',
            npcClass: 'npc_custom_2dbot',
            displayName: 'My Custom 2D Nextbot',
            category: 'Nextbot',
            spriteSize: 128,
            chaseSpeed: 650,
            jumpHeight: 300,
            attackForce: 800,
            smashProps: true,
            imageDataUrl: null,
            sounds: [
                {
                    relPath: 'sound/custom_bot/panic.mp3',
                    role: 'chase',
                    label: '🔥 Main Chase / Panic Music (Loops when nearby)',
                    isPrimaryMusic: true,
                    fullPath: null,
                    hasFile: false
                },
                {
                    relPath: 'sound/custom_bot/jump.mp3',
                    role: 'jump',
                    label: '🦘 Jump Sound Effect',
                    isPrimaryMusic: false,
                    fullPath: null,
                    hasFile: false
                },
                {
                    relPath: 'sound/custom_bot/pieceofcake.mp3',
                    role: 'taunt',
                    label: '🗣️ Catchphrase / Taunt Sound',
                    isPrimaryMusic: false,
                    fullPath: null,
                    hasFile: false
                }
            ]
        };
    }

    const characters = await scanEditableCharacters(gmodInfo);
    const target = characters.find(c => c.id === characterId);
    if (!target) {
        throw new Error(`Character '${characterId}' not found.`);
    }

    const workDir = path.join(workspaceRoot, target.id);
    if (fs.existsSync(workDir)) {
        fs.rmSync(workDir, { recursive: true, force: true });
    }
    fs.mkdirSync(workDir, { recursive: true });

    if (target.sourceType === 'workshop_gma') {
        extractAllPureJs(target.sourcePath, workDir);
    } else if (target.sourceType === 'local_folder') {
        fs.cpSync(target.sourcePath, workDir, { recursive: true });
    }

    // Locate primary Lua entity script
    const entitiesDir = path.join(workDir, 'lua', 'entities');
    let luaFilePath = path.join(workDir, target.entityLua);
    let fallbackClass = path.basename(target.entityLua, '.lua');

    if (!fs.existsSync(luaFilePath) && fs.existsSync(entitiesDir)) {
        const files = fs.readdirSync(entitiesDir).filter(f => f.endsWith('.lua'));
        if (files.length > 0) {
            luaFilePath = path.join(entitiesDir, files[0]);
            fallbackClass = path.basename(files[0], '.lua');
        }
    }

    const luaContent = fs.existsSync(luaFilePath) ? fs.readFileSync(luaFilePath, 'utf8') : '';
    const stats = parseNextbotLuaStats(luaContent, fallbackClass);

    // Find all images and pick the main sprite image
    const allImages = [];
    const walkDir = (dir, prefix = '') => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walkDir(full, rel);
            } else if (/\.(png|jpg|jpeg)$/i.test(entry.name)) {
                allImages.push({ relPath: rel.replace(/\\/g, '/'), fullPath: full });
            }
        }
    };
    walkDir(path.join(workDir, 'materials'), 'materials');

    const primaryImg = allImages.find(i => !i.relPath.includes('killicon') && !i.relPath.startsWith('materials/entities/'))
        || allImages.find(i => i.relPath.startsWith('materials/entities/'))
        || allImages[0];

    let imageDataUrl = null;
    if (primaryImg && fs.existsSync(primaryImg.fullPath)) {
        const ext = path.extname(primaryImg.fullPath).toLowerCase().replace('.', '') || 'png';
        const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
        imageDataUrl = `data:${mime};base64,${fs.readFileSync(primaryImg.fullPath).toString('base64')}`;
    }

    // Find all sound files
    const sounds = [];
    const walkSounds = (dir, prefix = '') => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walkSounds(full, rel);
            } else if (/\.(mp3|wav|ogg)$/i.test(entry.name)) {
                const normalizedRel = rel.replace(/\\/g, '/');
                const desc = describeSoundSlot(normalizedRel);
                sounds.push({
                    relPath: normalizedRel,
                    role: desc.role,
                    label: desc.label,
                    isPrimaryMusic: desc.isPrimaryMusic,
                    fullPath: full,
                    hasFile: true,
                    fileSize: fs.statSync(full).size
                });
            }
        }
    };
    walkSounds(path.join(workDir, 'sound'), 'sound');

    // Ensure all 3 standard slots (chase, jump, taunt) are always available in the UI even if a slot was previously muted
    const soundNamespace = stats.npcClass || 'custom_bot';
    const standardSlots = [
        {
            role: 'chase',
            relPath: `sound/${soundNamespace}/panic.mp3`,
            label: '🔥 Main Chase / Panic Music (Loops when nearby)',
            isPrimaryMusic: true
        },
        {
            role: 'jump',
            relPath: `sound/${soundNamespace}/jump.mp3`,
            label: '🦘 Jump Sound Effect',
            isPrimaryMusic: false
        },
        {
            role: 'taunt',
            relPath: `sound/${soundNamespace}/pieceofcake.mp3`,
            label: '🗣️ Catchphrase / Taunt Sound',
            isPrimaryMusic: false
        }
    ];
    for (const slot of standardSlots) {
        if (!sounds.some(s => s.role === slot.role)) {
            sounds.push({
                relPath: slot.relPath,
                role: slot.role,
                label: slot.label,
                isPrimaryMusic: slot.isPrimaryMusic,
                fullPath: null,
                hasFile: false,
                fileSize: 0
            });
        }
    }

    // Attach default Workshop audio tracks by role so user can click "↺ Default" on any character/remix
    const defaultByRole = {};
    if (!target.isCustomRemix) {
        for (const s of sounds) {
            if (s.hasFile && s.fullPath && !defaultByRole[s.role]) {
                defaultByRole[s.role] = s.fullPath;
            }
        }
    } else {
        // Look for extracted Workshop character sounds in workspaceRoot (e.g. ws_*)
        try {
            const wsDirs = fs.readdirSync(workspaceRoot).filter(d => d.startsWith('ws_'));
            for (const wsDirName of wsDirs) {
                const wsSoundRoot = path.join(workspaceRoot, wsDirName, 'sound');
                const collectDefaults = (d, pref = '') => {
                    if (!fs.existsSync(d)) return;
                    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
                        const r = pref ? `${pref}/${e.name}` : e.name;
                        const f = path.join(d, e.name);
                        if (e.isDirectory()) collectDefaults(f, r);
                        else if (/\.(mp3|wav|ogg)$/i.test(e.name)) {
                            const info = describeSoundSlot(r.replace(/\\/g, '/'));
                            if (!defaultByRole[info.role]) defaultByRole[info.role] = f;
                        }
                    }
                };
                collectDefaults(wsSoundRoot, 'sound');
            }
        } catch (_) {}
    }

    for (const s of sounds) {
        const defPath = defaultByRole[s.role] || (s.hasFile && !target.isCustomRemix ? s.fullPath : null);
        s.defaultFullPath = defPath && fs.existsSync(defPath) ? defPath : null;
        s.defaultFileName = s.defaultFullPath ? path.basename(s.defaultFullPath) : null;
    }

    // Sort primary chase music to top
    sounds.sort((a, b) => (b.isPrimaryMusic ? 1 : 0) - (a.isPrimaryMusic ? 1 : 0));

    return {
        id: target.id,
        isNewTemplate: false,
        isCustomRemix: Boolean(target.isCustomRemix),
        sourceName: target.name,
        sourcePath: target.sourcePath,
        workDir,
        npcClass: stats.npcClass,
        displayName: stats.displayName,
        category: stats.category,
        spriteSize: stats.spriteSize,
        chaseSpeed: stats.chaseSpeed,
        jumpHeight: stats.jumpHeight,
        attackForce: stats.attackForce,
        smashProps: stats.smashProps,
        imageDataUrl,
        sounds
    };
}

/**
 * Generates a complete, self-contained 2D NextBot Lua script (Sanic/WeGotta architecture)
 * with smooth sprite rendering, proximity chase music, jumping, prop smashing, and Q-menu registration.
 */
function generateStandaloneNextbotLua({
    npcClass,
    displayName,
    category,
    folderSlug,
    spriteSize,
    chaseSpeed,
    jumpHeight,
    attackForce,
    smashProps,
    chaseSoundRel,
    jumpSoundRel,
    tauntSoundRel
}) {
    const halfSize = Math.round(spriteSize / 2);
    const safeDisplayName = displayName.replace(/"/g, '\\"');
    const safeCategory = (category || 'Nextbot').replace(/"/g, '\\"');
    const cvarPrefix = npcClass.replace(/[^a-zA-Z0-9_]/g, '_');

    return `AddCSLuaFile()

ENT.Base = "base_nextbot"
ENT.PhysgunDisabled = true
ENT.AutomaticFrameAdvance = false

local SPRITE_SIZE = ${Number(spriteSize) || 128}
local CHASE_SPEED = ${Number(chaseSpeed) || 650}
local JUMP_HEIGHT = ${Number(jumpHeight) || 300}

${chaseSoundRel ? `util.PrecacheSound("${chaseSoundRel}")` : ''}
${jumpSoundRel ? `util.PrecacheSound("${jumpSoundRel}")` : ''}
${tauntSoundRel ? `util.PrecacheSound("${tauntSoundRel}")` : ''}

local IsValid = IsValid

if SERVER then

local ${cvarPrefix}_acquire_distance = CreateConVar("${cvarPrefix}_acquire_distance", 2500, FCVAR_NONE, "Maximum chase distance")
local ${cvarPrefix}_attack_distance = CreateConVar("${cvarPrefix}_attack_distance", 80, FCVAR_NONE, "Attack reach")
local ${cvarPrefix}_attack_interval = CreateConVar("${cvarPrefix}_attack_interval", 0.2, FCVAR_NONE, "Attack delay")
local ${cvarPrefix}_attack_force = CreateConVar("${cvarPrefix}_attack_force", ${Number(attackForce) || 800}, FCVAR_NONE, "Attack knockback force")
local ${cvarPrefix}_smash_props = CreateConVar("${cvarPrefix}_smash_props", ${smashProps ? 1 : 0}, FCVAR_NONE, "Smash through props")

function ENT:Initialize()
    if game.SinglePlayer() then
        self:SetModel("models/props_c17/oildrum001.mdl")
    else
        self:SetModel("models/props_c17/oildrum001.mdl")
    end
    self:SetNoDraw(false)
    self:DrawShadow(false)
    self:SetSolidMask(MASK_NPCSOLID_BRUSHONLY)
    self:SetCollisionGroup(COLLISION_GROUP_INTERACTIVE_DEBRIS)

    self.loco:SetStepHeight(36)
    self.loco:SetDeathDropHeight(800)
    self.loco:SetDesiredSpeed(CHASE_SPEED)
    self.loco:SetAcceleration(650)
    self.loco:SetDeceleration(650)
    self.loco:SetJumpHeight(JUMP_HEIGHT)

    self.LastAttack = 0
    self.LastTaunt = 0
    self.LastJump = 0
end

function ENT:OnInjured(dmg)
    dmg:SetDamage(0)
end

function ENT:FindNearestTarget()
    local myPos = self:GetPos()
    local maxDistSqr = math.pow(${cvarPrefix}_acquire_distance:GetFloat(), 2)
    local bestTarget = nil
    local bestDistSqr = maxDistSqr

    for _, ply in ipairs(player.GetAll()) do
        if IsValid(ply) and ply:Alive() and not ply:IsFlagSet(FL_NOTARGET) then
            local d = myPos:DistToSqr(ply:GetPos())
            if d < bestDistSqr then
                bestDistSqr = d
                bestTarget = ply
            end
        end
    end
    return bestTarget
end

function ENT:AttackNearbyTargets()
    if CurTime() - self.LastAttack < ${cvarPrefix}_attack_interval:GetFloat() then return end
    local myPos = self:GetPos()
    local reach = ${cvarPrefix}_attack_distance:GetFloat()
    local force = ${cvarPrefix}_attack_force:GetFloat()
    local hitAnyone = false

    for _, ent in ipairs(ents.FindInSphere(myPos, reach)) do
        if IsValid(ent) and ent ~= self then
            if ent:IsPlayer() and ent:Alive() then
                local dmg = DamageInfo()
                dmg:SetAttacker(self)
                dmg:SetInflictor(self)
                dmg:SetDamage(250)
                dmg:SetDamageType(DMG_CLUB)
                dmg:SetDamageForce(((ent:GetPos() - myPos):GetNormalized() + Vector(0, 0, 0.5)) * force * 50)
                ent:TakeDamageInfo(dmg)
                ent:SetVelocity(((ent:GetPos() - myPos):GetNormalized() + Vector(0, 0, 0.45)) * force)
                hitAnyone = true
            elseif ${cvarPrefix}_smash_props:GetBool() and ent:GetMoveType() == MOVETYPE_VPHYSICS then
                local phys = ent:GetPhysicsObject()
                if IsValid(phys) then
                    constraint.RemoveAll(ent)
                    phys:EnableMotion(true)
                    phys:Wake()
                    phys:ApplyForceCenter(((ent:GetPos() - myPos):GetNormalized() + Vector(0, 0, 0.35)) * force * phys:GetMass())
                end
                if ent:GetClass() == "prop_door_rotating" or ent:GetClass() == "func_door_rotating" or ent:GetClass() == "func_door" then
                    ent:Fire("Unlock", "", 0)
                    ent:Fire("Open", "", 0.01)
                end
            end
        end
    end

    if hitAnyone then
        self.LastAttack = CurTime()
        ${tauntSoundRel ? `if CurTime() - self.LastTaunt > 1.5 then self:EmitSound("${tauntSoundRel}", 350, 100) self.LastTaunt = CurTime() end` : ''}
    end
end

function ENT:RunBehaviour()
    while true do
        local target = self:FindNearestTarget()
        if IsValid(target) then
            local path = Path("Follow")
            path:SetMinLookAheadDistance(300)
            path:SetGoalTolerance(25)
            path:Compute(self, target:GetPos())

            local repathTime = CurTime() + 0.15
            while path:IsValid() and IsValid(target) and target:Alive() do
                if CurTime() > repathTime then
                    path:Compute(self, target:GetPos())
                    repathTime = CurTime() + 0.15
                end
                path:Update(self)
                self:AttackNearbyTargets()

                -- Occasional leap if target is high or stuck
                if JUMP_HEIGHT > 0 and self.loco:IsOnGround() and (target:GetPos().z - self:GetPos().z > 90) and CurTime() - self.LastJump > 2.2 then
                    self.loco:Jump()
                    self.LastJump = CurTime()
                    ${jumpSoundRel ? `self:EmitSound("${jumpSoundRel}", 350, 100)` : ''}
                end

                if self.loco:IsStuck() then
                    self:HandleStuck()
                end
                coroutine.yield()
            end
        else
            coroutine.wait(0.25)
        end
        coroutine.yield()
    end
end

else -- CLIENT --

killicon.Add("${npcClass}", "${folderSlug}/${npcClass}", color_white)
language.Add("${npcClass}", "${safeDisplayName}")

ENT.RenderGroup = RENDERGROUP_TRANSLUCENT

local spriteMaterial = Material("${folderSlug}/${npcClass}.png", "nocull smooth mips")
local drawOffset = Vector(0, 0, ${halfSize})

function ENT:Initialize()
    self:SetRenderBounds(
        Vector(-${halfSize}, -${halfSize}, 0),
        Vector(${halfSize}, ${halfSize}, ${spriteSize}),
        Vector(8, 8, 8)
    )
end

function ENT:RenderOverride()
    render.SetMaterial(spriteMaterial)
    local pos = self:GetPos() + drawOffset
    local normal = EyePos() - pos
    normal:Normalize()
    local xyNormal = Vector(normal.x, normal.y, 0)
    xyNormal:Normalize()
    local pitch = math.acos(math.Clamp(normal:Dot(xyNormal), -1, 1)) / 3
    local cos = math.cos(pitch)
    normal = Vector(
        xyNormal.x * cos,
        xyNormal.y * cos,
        math.sin(pitch)
    )
    render.DrawQuadEasy(pos, normal, ${spriteSize}, ${spriteSize}, color_white, 180)
end

function ENT:DrawTranslucent()
    self:RenderOverride()
end

${chaseSoundRel ? `
_G.__StudioPanicState = _G.__StudioPanicState or {}
local prevState = _G.__StudioPanicState["${npcClass}"]
if prevState then
    if IsValid(prevState.channel) then prevState.channel:Stop() end
    if prevState.patch then prevState.patch:Stop() end
end

local musicState = {
    channel = nil,
    loading = false,
    useFallback = false,
    patch = nil,
    patchPlaying = false,
    patchStart = 0
}
_G.__StudioPanicState["${npcClass}"] = musicState

local MUSIC_CUTOFF_DISTANCE = 1200
local MUSIC_PANIC_DISTANCE = 200

local function stopAllMusic()
    if IsValid(musicState.channel) then
        musicState.channel:Pause()
        musicState.channel:SetTime(0)
    end
    if musicState.patch and musicState.patchPlaying then
        musicState.patch:Stop()
        musicState.patchPlaying = false
    end
end

local function updatePanicMusic()
    local bots = ents.FindByClass("${npcClass}")
    if #bots == 0 or not IsValid(LocalPlayer()) then
        stopAllMusic()
        return
    end

    local plyPos = LocalPlayer():GetPos()
    local bestScore = 0
    for _, bot in ipairs(bots) do
        if IsValid(bot) then
            local dist = plyPos:Distance(bot:GetPos())
            if dist < MUSIC_CUTOFF_DISTANCE then
                local score = (MUSIC_CUTOFF_DISTANCE - dist) / (MUSIC_CUTOFF_DISTANCE - MUSIC_PANIC_DISTANCE)
                if score > bestScore then bestScore = score end
            end
        end
    end

    local vol = math.Clamp(bestScore, 0, 1)
    if vol <= 0 then
        stopAllMusic()
        return
    end

    if not LocalPlayer():Alive() then
        vol = vol * 0.25
    end

    -- Primary BASS audio channel (never overlaps or double-triggers MP3/WAV files)
    if IsValid(musicState.channel) then
        musicState.channel:EnableLooping(true)
        musicState.channel:SetVolume(math.max(0.02, vol))
        if musicState.channel:GetState() ~= GMOD_CHANNEL_PLAYING then
            musicState.channel:Play()
        end
        return
    end

    if not musicState.loading and not musicState.useFallback then
        musicState.loading = true
        sound.PlayFile("sound/${chaseSoundRel}", "noplay noblock", function(station)
            musicState.loading = false
            if IsValid(station) then
                if _G.__StudioPanicState["${npcClass}"] ~= musicState then
                    station:Stop()
                    return
                end
                station:EnableLooping(true)
                station:SetVolume(math.max(0.02, vol))
                station:Play()
                musicState.channel = station
            else
                musicState.useFallback = true
            end
        end)
        return
    end

    if musicState.useFallback then
        if not musicState.patch then
            musicState.patch = CreateSound(LocalPlayer(), "${chaseSoundRel}")
        end
        local dur = math.max(SoundDuration("${chaseSoundRel}") or 15, 8)
        if not musicState.patchPlaying or (CurTime() - musicState.patchStart >= dur) then
            musicState.patch:Stop()
            musicState.patch:PlayEx(math.max(0.02, vol), 100)
            musicState.patchPlaying = true
            musicState.patchStart = CurTime()
        else
            musicState.patch:ChangeVolume(math.max(0.02, vol), 0)
        end
    end
end

function ENT:OnRemove()
    timer.Simple(0, function()
        if #ents.FindByClass("${npcClass}") == 0 then
            stopAllMusic()
        end
    end)
end

timer.Create("${npcClass}_PanicMusicTimer", 0.05, 0, updatePanicMusic)
` : ''}

end

list.Set("NPC", "${npcClass}", {
    Name = "${safeDisplayName}",
    Class = "${npcClass}",
    Category = "${safeCategory}",
    AdminOnly = false
})
`;
}

/**
 * Saves an edited or newly created 2D Character into garrysmod/addons/
 */
async function saveEditedCharacter(gmodInfo, payload, nativeImage) {
    if (!gmodInfo || !gmodInfo.addonsDir) {
        throw new Error("Garry's Mod addons directory not found.");
    }

    const {
        characterId,
        saveMode = 'new_character', // 'new_character' or 'override'
        displayName = 'My Custom 2D Nextbot',
        category = 'Nextbot',
        croppedImageDataUrl,
        spriteSize = 128,
        chaseSpeed = 650,
        jumpHeight = 300,
        attackForce = 800,
        smashProps = true,
        soundSwaps = {} // { [relPath]: absoluteLocalFilePath }
    } = payload;

    const cleanSlug = displayName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 28) || 'custom_bot';

    // Load character workspace if based on an existing character
    const loaded = await loadCharacterForEditing(gmodInfo, characterId || 'template_new');

    let targetAddonFolderName;
    let targetNpcClass;

    if (!loaded.isNewTemplate && saveMode === 'override') {
        targetNpcClass = loaded.npcClass;
        if (loaded.isCustomRemix && loaded.sourcePath) {
            targetAddonFolderName = path.basename(loaded.sourcePath);
        } else {
            targetAddonFolderName = `studio_2d_override_${targetNpcClass}`;
        }
    } else {
        targetNpcClass = `npc_2d_${cleanSlug}`;
        targetAddonFolderName = `studio_2d_${cleanSlug}`;
    }

    const outAddonDir = path.join(gmodInfo.addonsDir, targetAddonFolderName);
    if (fs.existsSync(outAddonDir)) {
        fs.rmSync(outAddonDir, { recursive: true, force: true });
    }
    fs.mkdirSync(outAddonDir, { recursive: true });

    // Prepare 32-bit RGBA PNG buffer from croppedImageDataUrl (or loaded.imageDataUrl)
    // Pure PNG avoids Source Engine CTexture::ReconstructPartialTexture VTF errors while preserving 100% alpha transparency
    const activeDataUrl = croppedImageDataUrl || loaded.imageDataUrl;
    let pngBuffer = null;

    if (activeDataUrl && nativeImage) {
        const img = nativeImage.createFromDataURL(activeDataUrl);
        if (!img.isEmpty()) {
            const resized512 = img.resize({ width: 512, height: 512, quality: 'best' });
            pngBuffer = resized512.toPNG();
        }
    }

    if (!loaded.isNewTemplate && !loaded.isCustomRemix && saveMode === 'override' && loaded.workDir && fs.existsSync(loaded.workDir)) {
        // Copy existing Workshop addon files into outAddonDir and patch in-place
        fs.cpSync(loaded.workDir, outAddonDir, { recursive: true });

        // 1. Replace character sprite with 32-bit RGBA PNG and remove any legacy .vtf/.vmt
        if (pngBuffer) {
            const entIconPath = path.join(outAddonDir, 'materials', 'entities', `${targetNpcClass}.png`);
            fs.mkdirSync(path.dirname(entIconPath), { recursive: true });
            fs.writeFileSync(entIconPath, pngBuffer);

            const customSpriteRel = `${targetNpcClass}_studio_sprite.png`;
            const customSpritePath = path.join(outAddonDir, 'materials', customSpriteRel);
            fs.writeFileSync(customSpritePath, pngBuffer);

            const replaceMatFiles = (dir) => {
                if (!fs.existsSync(dir)) return;
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                    const full = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        replaceMatFiles(full);
                    } else if (/\.(png|jpg|jpeg)$/i.test(entry.name)) {
                        fs.writeFileSync(full, pngBuffer);
                    }
                }
            };
            replaceMatFiles(path.join(outAddonDir, 'materials'));
        }

        // 2. Apply sound swaps (including '__NONE__' mute and '__DEFAULT__' restore)
        const extChanges = {}; // oldSoundInternal -> newSoundInternal
        const mutedSoundRefs = [];
        for (const [relPath, swapVal] of Object.entries(soundSwaps)) {
            if (!swapVal) continue;
            const destOldFull = path.join(outAddonDir, relPath);
            const oldSoundRef = relPath.replace(/^sound\//i, '');

            if (swapVal === '__NONE__') {
                if (fs.existsSync(destOldFull)) fs.unlinkSync(destOldFull);
                mutedSoundRefs.push(oldSoundRef);
                continue;
            }

            const slotInfo = loaded.sounds.find(s => s.relPath === relPath);
            const newSrcPath = swapVal === '__DEFAULT__'
                ? (slotInfo && slotInfo.defaultFullPath ? slotInfo.defaultFullPath : null)
                : swapVal;

            if (!newSrcPath || !fs.existsSync(newSrcPath)) continue;
            const oldExt = path.extname(relPath).toLowerCase();
            const newExt = path.extname(newSrcPath).toLowerCase();

            if (oldExt === newExt) {
                fs.mkdirSync(path.dirname(destOldFull), { recursive: true });
                fs.copyFileSync(newSrcPath, destOldFull);
            } else {
                if (fs.existsSync(destOldFull)) fs.unlinkSync(destOldFull);
                const newRelPath = relPath.slice(0, -oldExt.length) + newExt;
                const destNewFull = path.join(outAddonDir, newRelPath);
                fs.mkdirSync(path.dirname(destNewFull), { recursive: true });
                fs.copyFileSync(newSrcPath, destNewFull);

                const newSoundRef = newRelPath.replace(/^sound\//i, '');
                extChanges[oldSoundRef] = newSoundRef;
            }
        }

        // 3. Patch Lua entity file with updated stats, sprite size, display name, and any sound changes
        const luaPath = path.join(outAddonDir, 'lua', 'entities', `${targetNpcClass}.lua`);
        if (fs.existsSync(luaPath)) {
            let lua = fs.readFileSync(luaPath, 'utf8');
            lua = lua.replace(/local\s+SPRITE_SIZE\s*=\s*\d+/g, `local SPRITE_SIZE = ${Number(spriteSize) || 128}`);
            lua = lua.replace(/render\.DrawSprite\s*\(([^,]+),\s*\d+\s*,\s*\d+\s*\)/g, `render.DrawSprite($1, ${Number(spriteSize) || 128}, ${Number(spriteSize) || 128})`);
            lua = lua.replace(/local\s+drawOffset\s*=\s*Vector\s*\(\s*0\s*,\s*0\s*,\s*\d+\s*\)/g, `local drawOffset = Vector(0, 0, ${Math.round((Number(spriteSize) || 128) / 2)})`);
            lua = lua.replace(/SetDesiredSpeed\s*\([^\)]+\)/g, `SetDesiredSpeed(${Number(chaseSpeed) || 650})`);
            lua = lua.replace(/SetJumpHeight\s*\(\s*\d+\s*\)/g, `SetJumpHeight(${Number(jumpHeight) || 300})`);
            lua = lua.replace(/(_attack_force"\s*,\s*)\d+/g, `$1${Number(attackForce) || 800}`);
            lua = lua.replace(/(_smash_props"\s*,\s*)[01]/g, `$1${smashProps ? 1 : 0}`);
            if (displayName) {
                const safeName = displayName.replace(/"/g, '\\"');
                lua = lua.replace(/(Name\s*=\s*)"[^"]*"/g, `$1"${safeName}"`);
                lua = lua.replace(/(language\.Add\s*\(\s*"[^"]+"\s*,\s*)"[^"]*"/g, `$1"${safeName}"`);
            }
            if (pngBuffer) {
                lua = lua.replace(/local\s+(MAT_[a-zA-Z0-9_]+|[a-zA-Z0-9_]+Material)\s*=\s*Material\s*\([^\)]+\)/g, `local $1 = Material("${targetNpcClass}_studio_sprite.png", "nocull smooth mips")`);
            }
            for (const [oldRef, newRef] of Object.entries(extChanges)) {
                lua = lua.split(oldRef).join(newRef);
            }
            for (const mutedRef of mutedSoundRefs) {
                const escaped = mutedRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                lua = lua.replace(new RegExp(`util\\.PrecacheSound\\s*\\(\\s*"${escaped}"\\s*\\)`, 'g'), '');
                lua = lua.replace(new RegExp(`self:EmitSound\\s*\\(\\s*"${escaped}"[^\\)]*\\)`, 'g'), '');
            }
            fs.writeFileSync(luaPath, lua, 'utf8');
        }
    } else {
        // Standalone Character Builder (for new characters AND updating studio_2d_* custom remixes)
        const folderSlug = targetNpcClass;
        const matFolder = path.join(outAddonDir, 'materials', folderSlug);
        const entIconFolder = path.join(outAddonDir, 'materials', 'entities');
        const soundFolder = path.join(outAddonDir, 'sound', folderSlug);
        const luaEntFolder = path.join(outAddonDir, 'lua', 'entities');

        fs.mkdirSync(matFolder, { recursive: true });
        fs.mkdirSync(entIconFolder, { recursive: true });
        fs.mkdirSync(soundFolder, { recursive: true });
        fs.mkdirSync(luaEntFolder, { recursive: true });

        if (pngBuffer) {
            fs.writeFileSync(path.join(matFolder, `${targetNpcClass}.png`), pngBuffer);
            fs.writeFileSync(path.join(entIconFolder, `${targetNpcClass}.png`), pngBuffer);
        }

        // Copy sounds (handling '__NONE__' mute, '__DEFAULT__' restore, and preventing duplicate song overlap)
        let chaseSoundRel = null;
        let jumpSoundRel = null;
        let tauntSoundRel = null;
        let chaseExplicitlyMuted = false;
        let chaseFileSize = 0;
        let chaseSrcPath = null;

        for (const s of loaded.sounds) {
            const swappedSrc = soundSwaps[s.relPath];
            if (swappedSrc === '__NONE__') {
                if (s.role === 'chase' || s.isPrimaryMusic) chaseExplicitlyMuted = true;
                continue;
            }

            let srcToUse = null;
            if (swappedSrc === '__DEFAULT__') {
                srcToUse = (s.defaultFullPath && fs.existsSync(s.defaultFullPath))
                    ? s.defaultFullPath
                    : (s.fullPath && fs.existsSync(s.fullPath) ? s.fullPath : null);
            } else if (swappedSrc && fs.existsSync(swappedSrc)) {
                srcToUse = swappedSrc;
            } else if (s.fullPath && fs.existsSync(s.fullPath)) {
                srcToUse = s.fullPath;
            }
            if (!srcToUse) continue;

            const srcSize = fs.statSync(srcToUse).size;

            // Guard against assigning the exact same full song (>100KB) to both Chase Music and Jump/Taunt SFX
            if ((s.role === 'jump' || s.role === 'taunt') && chaseSoundRel && chaseFileSize > 100000) {
                if (srcToUse === chaseSrcPath || srcSize === chaseFileSize) {
                    continue;
                }
            }

            const ext = path.extname(srcToUse).toLowerCase() || '.mp3';
            const baseName = path.basename(s.relPath, path.extname(s.relPath)) + ext;
            const destPath = path.join(soundFolder, baseName);
            fs.copyFileSync(srcToUse, destPath);

            const gmodSoundRef = `${folderSlug}/${baseName}`;
            if (s.role === 'chase' || (!chaseSoundRel && s.isPrimaryMusic)) {
                chaseSoundRel = gmodSoundRef;
                chaseFileSize = srcSize;
                chaseSrcPath = srcToUse;
            } else if (s.role === 'jump' && !jumpSoundRel) {
                jumpSoundRel = gmodSoundRef;
            } else if (!tauntSoundRel) {
                tauntSoundRel = gmodSoundRef;
            }
        }

        // Fallback if only 1 sound was provided and chase music wasn't muted
        if (!chaseSoundRel && tauntSoundRel && !chaseExplicitlyMuted) {
            chaseSoundRel = tauntSoundRel;
            tauntSoundRel = null;
        }

        const luaScript = generateStandaloneNextbotLua({
            npcClass: targetNpcClass,
            displayName,
            category,
            folderSlug,
            spriteSize,
            chaseSpeed,
            jumpHeight,
            attackForce,
            smashProps,
            chaseSoundRel,
            jumpSoundRel,
            tauntSoundRel
        });

        fs.writeFileSync(path.join(luaEntFolder, `${targetNpcClass}.lua`), luaScript, 'utf8');
    }

    // Write addon.json metadata
    const addonJson = {
        title: displayName,
        type: 'npc',
        tags: ['fun', 'cartoon'],
        ignore: ['*.psd', '*.vcproj', '*.svn*', '*.git*', 'icon.jpg'],
        studioRemix: true,
        baseCharacterId: characterId,
        updatedAt: Date.now()
    };
    fs.writeFileSync(path.join(outAddonDir, 'addon.json'), JSON.stringify(addonJson, null, 2), 'utf8');

    return {
        success: true,
        addonDir: outAddonDir,
        npcClass: targetNpcClass,
        displayName,
        category,
        saveMode
    };
}

/**
 * Packs and publishes a custom 2D Character from the Asset Studio to Steam Workshop
 */
async function publishCharacterToWorkshop(gmodInfo, payload, nativeImage) {
    // 1. Save locally first so the addon structure is up to date
    const saved = await saveEditedCharacter(gmodInfo, payload, nativeImage);

    const gmadExe = path.join(path.dirname(gmodInfo.garrysmodDir), 'bin', 'gmad.exe');
    const gmpublishExe = path.join(path.dirname(gmodInfo.garrysmodDir), 'bin', 'gmpublish.exe');

    if (!fs.existsSync(gmadExe) || !fs.existsSync(gmpublishExe)) {
        throw new Error('gmad.exe or gmpublish.exe not found in Garry\'s Mod bin folder.');
    }

    const stagingBase = path.join(__dirname, '..', 'data', 'workshop_staging');
    fs.mkdirSync(stagingBase, { recursive: true });

    const outGma = path.join(stagingBase, `${saved.npcClass}.gma`);
    if (fs.existsSync(outGma)) fs.unlinkSync(outGma);

    await createWithGmad(gmadExe, saved.addonDir, outGma);

    // Prepare 512x512 icon.jpg from the character's cropped photo
    const iconPath = path.join(stagingBase, `${saved.npcClass}_icon.jpg`);
    const activeDataUrl = payload.croppedImageDataUrl;
    if (activeDataUrl && nativeImage) {
        const img = nativeImage.createFromDataURL(activeDataUrl);
        const resized = img.resize({ width: 512, height: 512, quality: 'best' });
        fs.writeFileSync(iconPath, resized.toJPEG(92));
    } else {
        throw new Error('Please choose a character photo before publishing to Steam Workshop.');
    }

    const publishArgs = ['create', '-addon', outGma, '-icon', iconPath];
    return await new Promise((resolve) => {
        execFile(gmpublishExe, publishArgs, (err, stdout, stderr) => {
            const combined = (stdout || '') + (stderr || '');
            if (combined.includes("Couldn't initialize Steam")) {
                return resolve({
                    success: false,
                    error: 'Steam is not running! Please open Steam before uploading to Workshop.'
                });
            }

            const idMatch = combined.match(/\b(\d{9,11})\b/);
            const workshopId = (idMatch && !idMatch[1].startsWith('7656119')) ? idMatch[1] : null;
            if (/success|done|created|updated/i.test(combined) || workshopId) {
                return resolve({
                    success: true,
                    workshopId,
                    url: workshopId ? `https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}` : null,
                    message: `Successfully uploaded "${saved.displayName}" to Steam Workshop!`
                });
            }

            return resolve({
                success: false,
                error: combined.trim() || (err ? err.message : 'Unknown Workshop upload error')
            });
        });
    });
}

/**
 * Saves a recorded WAV buffer (from the built-in Voicemod / Microphone Recorder) to disk
 */
function saveRecordedAudio(base64Wav, slotHint = 'voice') {
    const recDir = path.join(__dirname, '..', 'data', 'studio_recordings');
    fs.mkdirSync(recDir, { recursive: true });
    const safeHint = String(slotHint || 'voice').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24);
    const fileName = `voicemod_${safeHint}_${Date.now()}.wav`;
    const filePath = path.join(recDir, fileName);
    const cleanB64 = String(base64Wav || '').replace(/^data:audio\/[a-z0-9.+-]+;base64,/i, '');
    const buf = Buffer.from(cleanB64, 'base64');
    fs.writeFileSync(filePath, buf);
    return {
        success: true,
        filePath,
        fileName,
        fileSize: buf.length
    };
}

module.exports = {
    scanEditableCharacters,
    loadCharacterForEditing,
    saveEditedCharacter,
    publishCharacterToWorkshop,
    saveRecordedAudio
};
