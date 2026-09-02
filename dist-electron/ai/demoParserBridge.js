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
exports.parseDemoFile = void 0;
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const electron_1 = require("electron");
const mapGeometryExtractor_1 = require("./mapGeometryExtractor");
function resolveParserCommand() {
    const isPackaged = electron_1.app.isPackaged;
    if (isPackaged) {
        // Bundled embeddable Python runtime (see scripts/setup-python-runtime.ps1)
        // instead of a PyInstaller-compiled binary — demoparser2 is a Rust/PyO3
        // native extension that PyInstaller has a history of silently mishandling.
        const pythonExe = path.join(process.resourcesPath, 'python-runtime', process.platform === 'win32' ? 'python.exe' : 'bin/python3');
        const script = path.join(process.resourcesPath, 'python', 'parse_demo.py');
        return { cmd: pythonExe, baseArgs: [script] };
    }
    const script = path.join(__dirname, '..', '..', 'python', 'parse_demo.py');
    return { cmd: process.platform === 'win32' ? 'python' : 'python3', baseArgs: [script] };
}
function parseDemoFile(demoPath) {
    return new Promise((resolve, reject) => {
        const outFile = path.join(os.tmpdir(), `cs-demo-summary-${Date.now()}.json`);
        const { cmd, baseArgs } = resolveParserCommand();
        // Diretório cacheado pela extração de geometria (electron/ai/mapGeometryExtractor.ts).
        // parse_demo.py trata a ausência de .vphys/.tri pro mapa da demo como "sem
        // geometria disponível" e cai de volta pra heurística distância/ângulo — nunca
        // é um erro passar um diretório que ainda não tem nada extraído.
        const args = [...baseArgs, '--input', demoPath, '--output', outFile, '--map-geometry-dir', (0, mapGeometryExtractor_1.mapGeometryDir)()];
        const child = (0, child_process_1.spawn)(cmd, args);
        let stderr = '';
        child.stderr.on('data', (d) => (stderr += d.toString()));
        child.on('error', (err) => reject(new Error(`Falha ao iniciar o parser de demo: ${err.message}`)));
        child.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`Parser de demo terminou com erro (código ${code}): ${stderr}`));
                return;
            }
            // Mesmo com sucesso (código 0), parse_demo.py pode ter emitido avisos de
            // degradação de dado (ex: "player_blind não expõe attacker_steamid nesta
            // demo") — sem isso esses avisos desapareciam em silêncio; agora pelo
            // menos ficam no console do processo principal, e o campo correspondente
            // em summary.calibration (flashAttackerDataAvailable/purchaseItemDataAvailable)
            // é a forma "oficial", visível na própria UI, de saber que algo faltou.
            if (stderr.trim()) {
                console.warn(`[parse_demo] avisos durante o parse de ${path.basename(demoPath)}:\n${stderr}`);
            }
            try {
                const summary = JSON.parse(fs.readFileSync(outFile, 'utf-8'));
                fs.rmSync(outFile, { force: true });
                resolve({
                    fileName: path.basename(demoPath),
                    map: summary.map,
                    finalScore: summary.finalScore,
                    rounds: summary.rounds,
                    playerAggregates: summary.playerAggregates,
                    writeSummary: (destFolder) => {
                        fs.mkdirSync(destFolder, { recursive: true });
                        fs.writeFileSync(path.join(destFolder, 'summary.json'), JSON.stringify(summary, null, 2));
                    },
                });
            }
            catch (err) {
                reject(new Error(`Não foi possível ler a saída do parser: ${err.message}`));
            }
        });
    });
}
exports.parseDemoFile = parseDemoFile;
//# sourceMappingURL=demoParserBridge.js.map