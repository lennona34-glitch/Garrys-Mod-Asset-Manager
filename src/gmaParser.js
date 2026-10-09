const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

/**
 * Parses GMA binary file format
 */
function parseGmaHeader(gmaPath) {
    if (!fs.existsSync(gmaPath)) {
        throw new Error(`File not found: ${gmaPath}`);
    }

    const fd = fs.openSync(gmaPath, 'r');
    let currentPos = 0;

    function readBytes(length) {
        const buf = Buffer.alloc(length);
        const bytesRead = fs.readSync(fd, buf, 0, length, currentPos);
        currentPos += bytesRead;
        return buf;
    }

    function readNullString() {
        const bytes = [];
        while (true) {
            const b = readBytes(1);
            if (b.length === 0 || b[0] === 0) break;
            bytes.push(b[0]);
        }
        return Buffer.from(bytes).toString('utf8');
    }

    try {
        const ident = readBytes(4).toString('utf8');
        if (ident !== 'GMAD') {
            fs.closeSync(fd);
            return null;
        }

        const formatVersion = readBytes(1)[0];
        const steamId = readBytes(8).readBigUInt64LE(0).toString();
        const timestamp = Number(readBytes(8).readBigUInt64LE(0));

        const requiredContent = readNullString();
        const addonName = readNullString();
        const rawDesc = readNullString();
        const addonAuthor = readNullString();
        const addonVersion = readBytes(4).readInt32LE(0);

        let parsedDesc = null;
        let addonType = '';
        let tags = [];
        try {
            parsedDesc = JSON.parse(rawDesc);
            if (parsedDesc.type) addonType = parsedDesc.type;
            if (Array.isArray(parsedDesc.tags)) tags = parsedDesc.tags;
        } catch (e) {
            parsedDesc = { description: rawDesc };
        }

        const files = [];
        while (true) {
            const entryBuf = readBytes(4);
            const entry = entryBuf.readUInt32LE(0);
            if (entry === 0) break;

            const fname = readNullString();
            const sizeBuf = readBytes(8);
            const size = Number(sizeBuf.readBigInt64LE(0));
            const crcBuf = readBytes(4);
            const crc = crcBuf.readUInt32LE(0);

            files.push({
                name: fname,
                size,
                crc
            });
        }

        // Calculate byte offsets for internal files
        let dataOffset = currentPos;
        for (const file of files) {
            file.offset = dataOffset;
            dataOffset += file.size;
        }

        fs.closeSync(fd);

        // Analyze contained content
        const maps = files
            .filter(f => f.name.toLowerCase().startsWith('maps/') && f.name.toLowerCase().endsWith('.bsp'))
            .map(f => {
                const baseName = path.basename(f.name, '.bsp');
                return {
                    fullPath: f.name,
                    mapName: baseName,
                    size: f.size,
                    offset: f.offset
                };
            });

        const navMeshes = files
            .filter(f => f.name.toLowerCase().startsWith('maps/') && f.name.toLowerCase().endsWith('.nav'))
            .map(f => path.basename(f.name, '.nav'));

        // Auto-detect category if not specified in metadata
        let detectedCategory = addonType || 'Addon';
        if (maps.length > 0) {
            detectedCategory = 'Map';
        } else if (files.some(f => f.name.toLowerCase().includes('models/') || f.name.toLowerCase().includes('player/'))) {
            detectedCategory = 'Model / Playermodel';
        } else if (files.some(f => f.name.toLowerCase().includes('weapons/') || f.name.toLowerCase().includes('swep'))) {
            detectedCategory = 'Weapon';
        } else if (files.some(f => f.name.toLowerCase().includes('vehicles/'))) {
            detectedCategory = 'Vehicle';
        } else if (files.some(f => f.name.toLowerCase().includes('gamemodes/'))) {
            detectedCategory = 'Gamemode';
        } else if (files.some(f => f.name.toLowerCase().includes('tools/'))) {
            detectedCategory = 'Tool';
        } else if (files.some(f => f.name.toLowerCase().includes('materials/'))) {
            detectedCategory = 'Textures / Materials';
        }

        return {
            valid: true,
            filePath: gmaPath,
            formatVersion,
            steamId,
            timestamp: new Date(timestamp * 1000).toISOString(),
            name: addonName || path.basename(gmaPath, path.extname(gmaPath)),
            description: parsedDesc && parsedDesc.description ? parsedDesc.description : rawDesc,
            author: addonAuthor || 'Unknown',
            version: addonVersion,
            category: detectedCategory,
            tags,
            filesCount: files.length,
            totalContentSize: files.reduce((acc, f) => acc + f.size, 0),
            files,
            maps,
            navMeshes
        };
    } catch (err) {
        try { fs.closeSync(fd); } catch (_) {}
        throw err;
    }
}

/**
 * Extracts a single file out of a GMA file by byte offset
 */
function extractSingleFile(gmaPath, internalFilePath, destinationPath) {
    const header = parseGmaHeader(gmaPath);
    if (!header) throw new Error('Invalid GMA file');

    const target = header.files.find(f => f.name.toLowerCase() === internalFilePath.toLowerCase());
    if (!target) {
        throw new Error(`File '${internalFilePath}' not found inside GMA`);
    }

    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });

    const fdIn = fs.openSync(gmaPath, 'r');
    const fdOut = fs.openSync(destinationPath, 'w');

    const CHUNK_SIZE = 64 * 1024;
    const buf = Buffer.alloc(CHUNK_SIZE);
    let bytesRemaining = target.size;
    let readPos = target.offset;

    try {
        while (bytesRemaining > 0) {
            const toRead = Math.min(bytesRemaining, CHUNK_SIZE);
            const n = fs.readSync(fdIn, buf, 0, toRead, readPos);
            if (n === 0) break;
            fs.writeSync(fdOut, buf, 0, n);
            bytesRemaining -= n;
            readPos += n;
        }
    } finally {
        fs.closeSync(fdIn);
        fs.closeSync(fdOut);
    }

    return destinationPath;
}

/**
 * Extract all files using pure JS (zero external dependencies)
 */
function extractAllPureJs(gmaPath, outputDir) {
    const header = parseGmaHeader(gmaPath);
    if (!header) throw new Error('Invalid GMA file');

    fs.mkdirSync(outputDir, { recursive: true });
    const fdIn = fs.openSync(gmaPath, 'r');
    const CHUNK_SIZE = 64 * 1024;
    const buf = Buffer.alloc(CHUNK_SIZE);

    try {
        for (const file of header.files) {
            const destFilePath = path.join(outputDir, file.name);
            fs.mkdirSync(path.dirname(destFilePath), { recursive: true });
            const fdOut = fs.openSync(destFilePath, 'w');

            let bytesRemaining = file.size;
            let readPos = file.offset;
            while (bytesRemaining > 0) {
                const toRead = Math.min(bytesRemaining, CHUNK_SIZE);
                const n = fs.readSync(fdIn, buf, 0, toRead, readPos);
                if (n === 0) break;
                fs.writeSync(fdOut, buf, 0, n);
                bytesRemaining -= n;
                readPos += n;
            }
            fs.closeSync(fdOut);
        }
    } finally {
        fs.closeSync(fdIn);
    }

    return outputDir;
}

/**
 * Extract using Garry's Mod gmad.exe (if available) with fallback to pure JS
 */
function extractWithGmad(gmadExePath, gmaPath, outputDir) {
    return new Promise((resolve, reject) => {
        if (!gmadExePath || !fs.existsSync(gmadExePath)) {
            try {
                const res = extractAllPureJs(gmaPath, outputDir);
                return resolve(res);
            } catch (err) {
                return reject(err);
            }
        }

        fs.mkdirSync(outputDir, { recursive: true });
        execFile(gmadExePath, ['extract', '-file', gmaPath, '-out', outputDir], (error, stdout, stderr) => {
            if (error) {
                // Fallback to pure JS unpacker
                try {
                    const res = extractAllPureJs(gmaPath, outputDir);
                    return resolve(res);
                } catch (fallbackErr) {
                    return reject(new Error(`gmad failed and pure JS fallback failed: ${error.message}`));
                }
            }
            resolve(outputDir);
        });
    });
}

/**
 * Create a GMA file from a folder using gmad.exe
 */
function createWithGmad(gmadExePath, folderPath, outGmaPath) {
    return new Promise((resolve, reject) => {
        if (!gmadExePath || !fs.existsSync(gmadExePath)) {
            return reject(new Error('gmad.exe is required to pack folders into GMA files.'));
        }

        const args = ['create', '-folder', folderPath];
        if (outGmaPath) {
            args.push('-out', outGmaPath);
        }

        execFile(gmadExePath, args, (error, stdout, stderr) => {
            if (error) {
                return reject(new Error(`gmad create error: ${error.message}\n${stderr || stdout}`));
            }
            resolve(outGmaPath || stdout);
        });
    });
}

module.exports = {
    parseGmaHeader,
    extractSingleFile,
    extractAllPureJs,
    extractWithGmad,
    createWithGmad
};
