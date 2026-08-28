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
function resolveParserCommand() {
    const isPackaged = electron_1.app.isPackaged;
    if (isPackaged) {
        const bin = path.join(process.resourcesPath, 'python', process.platform === 'win32' ? 'parse_demo.exe' : 'parse_demo');
        return { cmd: bin, baseArgs: [] };
    }
    const script = path.join(__dirname, '..', '..', 'python', 'parse_demo.py');
    return { cmd: process.platform === 'win32' ? 'python' : 'python3', baseArgs: [script] };
}
function parseDemoFile(demoPath) {
    return new Promise((resolve, reject) => {
        const outFile = path.join(os.tmpdir(), `cs-demo-summary-${Date.now()}.json`);
        const { cmd, baseArgs } = resolveParserCommand();
        const args = [...baseArgs, '--input', demoPath, '--output', outFile];
        const child = (0, child_process_1.spawn)(cmd, args);
        let stderr = '';
        child.stderr.on('data', (d) => (stderr += d.toString()));
        child.on('error', (err) => reject(new Error(`Falha ao iniciar o parser de demo: ${err.message}`)));
        child.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`Parser de demo terminou com erro (código ${code}): ${stderr}`));
                return;
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