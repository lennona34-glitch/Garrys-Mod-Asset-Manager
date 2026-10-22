-- Hunter's Glee spawnset for The Imposter.
-- Discovered automatically by Hunter's Glee via file.Find("glee_spawnsets/*.lua", "LUA").
-- Base imposters start prowling from wave one; restless variants arrive mid-game
-- as a harder, faster version that spends less time blending in before hunting.

if not scripted_ents.GetStored( "nextbot_imposter" ) then return end

local set = {
    name            = "imposter_glee",
    prettyName      = "The Imposter's Glee",
    description     = "Something is watching. It looks just like one of you.",
    difficultyPerMin        = "default",
    waveInterval            = "default",
    diffBumpWhenWaveKilled  = "default",
    startingBudget          = "default",
    spawnCountPerDifficulty = "default",
    startingSpawnCount      = 1,
    maxSpawnCount           = 4,
    maxSpawnDist            = "default",
    roundEndSound           = "default",
    roundStartSound         = "default",
    roundEarlyStartSound    = "default",
    chanceToBeVotable       = 1,
    spawns = {
        -- One imposter from the start; capped at two until difficulty climbs.
        {
            name          = "imposter",
            prettyName    = "The Imposter",
            class         = "nextbot_imposter",
            spawnType     = "hunter",
            difficultyCost = { 15 },
            countClass    = "nextbot_imposter*",
            minCount      = { 1 },
            maxCount      = { 2 },
        },
        -- Additional imposters become affordable as difficulty grows.
        {
            name          = "imposter_later",
            prettyName    = "The Imposter",
            class         = "nextbot_imposter",
            spawnType     = "hunter",
            difficultyCost = { 20, 30 },
            countClass    = "nextbot_imposter*",
            minutesNeeded = { 5, 8 },
        },
        -- Restless variant: faster, hunts sooner, blends in less. Appears mid-game
        -- with a random chance so it doesn't show up every single round.
        {
            hardRandomChance = { 0, 3 },
            name          = "imposter_restless",
            prettyName    = "The Restless Imposter",
            class         = "nextbot_imposter_restless",
            spawnType     = "hunter",
            difficultyCost = { 25 },
            countClass    = "nextbot_imposter*",
            minutesNeeded = { 6, 10 },
        },
    },
}

table.insert( GLEE_SPAWNSETS, set )
