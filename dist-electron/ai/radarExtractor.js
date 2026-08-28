"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCachedRadarPath = exports.extractRadarsFromLocalCs2 = void 0;
const electron_1 = require("electron");
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const https = __importStar(require("https"));
const radarCalibration_1 = require("../storage/radarCalibration");
const VRF_RELEASE_TAG = '20.0';
const VRF_CLI_ZIP_URL = `https://github.com/ValveResourceFormat/ValveResourceFormat/releases/download/${VRF_RELEASE_TAG}/cli-windows-x64.zip`;
function appDataRoot() {
    return path.join(electron_1.app.getPath('userData'), 'cs-demo-analyst');
}
function radarsDir() {
    const dir = path.join(appDataRoot(), 'radars');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}
function toolsDir() {
    const dir = path.join(appDataRoot(), 'tools', 'vrf');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}
function findCs2InstallDir() {
    const steamRoots = ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam'];
    for (const steamRoot of steamRoots) {
        if (!fs.existsSync(steamRoot))
            continue;
        const libraries = new Set([steamRoot]);
        const libraryVdf = path.join(steamRoot, 'steamapps', 'libraryfolders.vdf');
        if (fs.existsSync(libraryVdf)) {
            const content = fs.readFileSync(libraryVdf, 'utf-8');
            for (const m of content.matchAll(/"path"\s+"([^"]+)"/g)) {
                libraries.add(m[1].replace(/\\\\/g, '\\'));
            }
        }
        for (const lib of libraries) {
            const csDir = path.join(lib, 'steamapps', 'common', 'Counter-Strike Global Offensive');
            const vpk = path.join(csDir, 'game', 'csgo', 'pak01_dir.vpk');
            if (fs.existsSync(vpk))
                return csDir;
        }
    }
    return null;
}
function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        https
            .get(url, (res) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                file.close();
                fs.rmSync(destPath, { force: true });
                downloadFile(res.headers.location, destPath).then(resolve, reject);
                return;
            }
            if (res.statusCode !== 200) {
                file.close();
                fs.rmSync(destPath, { force: true });
                reject(new Error(`Download falhou (HTTP ${res.statusCode}): ${url}`));
                return;
            }
            res.pipe(file);
            file.on('finish', () => file.close(() => resolve()));
        })
            .on('error', (err) => {
            fs.rmSync(destPath, { force: true });
            reject(err);
        });
    });
}
function runCommand(cmd, args) {
    return new Promise((resolve, reject) => {
        const child = (0, child_process_1.spawn)(cmd, args);
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => (stdout += d.toString()));
        child.stderr.on('data', (d) => (stderr += d.toString()));
        child.on('error', reject);
        child.on('close', (code) => {
            if (code !== 0)
                reject(new Error(`"${cmd}" terminou com código ${code}: ${stderr || stdout}`));
            else
                resolve(stdout);
        });
    });
}
async function ensureExtractorCli() {
    const dir = toolsDir();
    const exe = path.join(dir, 'Source2Viewer-CLI.exe');
    if (fs.existsSync(exe))
        return exe;
    if (process.platform !== 'win32') {
        throw new Error('Extração automática de radares só é suportada no Windows.');
    }
    const zipPath = path.join(dir, 'cli-windows-x64.zip');
    await downloadFile(VRF_CLI_ZIP_URL, zipPath);
    await runCommand('powershell.exe', [
        '-NoProfile',
        '-Command',
        `Expand-Archive -Path "${zipPath}" -DestinationPath "${dir}" -Force`,
    ]);
    fs.rmSync(zipPath, { force: true });
    if (!fs.existsSync(exe)) {
        throw new Error('Source2Viewer-CLI.exe não encontrado após extrair o download.');
    }
    return exe;
}
async function extractRadarsFromLocalCs2() {
    const cs2Dir = findCs2InstallDir();
    if (!cs2Dir) {
        return { cs2Found: false, extractedMaps: [] };
    }
    const vpk = path.join(cs2Dir, 'game', 'csgo', 'pak01_dir.vpk');
    try {
        const cliExe = await ensureExtractorCli();
        const tmpOut = path.join(toolsDir(), 'export-tmp');
        fs.rmSync(tmpOut, { recursive: true, force: true });
        fs.mkdirSync(tmpOut, { recursive: true });
        await runCommand(cliExe, ['-i', vpk, '-o', tmpOut, '-d', '--vpk_filepath', 'panorama/images/overheadmaps/']);
        const srcDir = path.join(tmpOut, 'panorama', 'images', 'overheadmaps');
        const destDir = radarsDir();
        const extracted = [];
        for (const map of radarCalibration_1.RADAR_EXTRACTABLE_MAPS) {
            const src = path.join(srcDir, `${map}_radar_psd.png`);
            if (fs.existsSync(src)) {
                fs.copyFileSync(src, path.join(destDir, `${map}.png`));
                extracted.push(map);
            }
        }
        fs.rmSync(tmpOut, { recursive: true, force: true });
        return { cs2Found: true, extractedMaps: extracted };
    }
    catch (err) {
        return { cs2Found: true, extractedMaps: [], error: err.message };
    }
}
exports.extractRadarsFromLocalCs2 = extractRadarsFromLocalCs2;
function getCachedRadarPath(map) {
    const p = path.join(radarsDir(), `${map}.png`);
    return fs.existsSync(p) ? p : null;
}
exports.getCachedRadarPath = getCachedRadarPath;
//# sourceMappingURL=radarExtractor.js.map