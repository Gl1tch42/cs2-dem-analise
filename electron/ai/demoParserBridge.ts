import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { app } from 'electron';
import { DemoSummary } from '../storage/types';
import { mapGeometryDir } from './mapGeometryExtractor';

function resolveParserCommand(): { cmd: string; baseArgs: string[] } {
  const isPackaged = app.isPackaged;
  if (isPackaged) {
    // Bundled embeddable Python runtime (see scripts/setup-python-runtime.ps1)
    // instead of a PyInstaller-compiled binary — demoparser2 is a Rust/PyO3
    // native extension that PyInstaller has a history of silently mishandling.
    const pythonExe = path.join(
      process.resourcesPath,
      'python-runtime',
      process.platform === 'win32' ? 'python.exe' : 'bin/python3'
    );
    const script = path.join(process.resourcesPath, 'python', 'parse_demo.py');
    return { cmd: pythonExe, baseArgs: [script] };
  }
  const script = path.join(__dirname, '..', '..', 'python', 'parse_demo.py');
  return { cmd: process.platform === 'win32' ? 'python' : 'python3', baseArgs: [script] };
}

export interface ParsedDemoResult {
  fileName: string;
  map: string;
  finalScore: { team: number; opponent: number };
  rounds: DemoSummary['rounds'];
  playerAggregates: DemoSummary['playerAggregates'];
  writeSummary: (destFolder: string) => void;
}

export function parseDemoFile(demoPath: string): Promise<ParsedDemoResult> {
  return new Promise((resolve, reject) => {
    const outFile = path.join(os.tmpdir(), `cs-demo-summary-${Date.now()}.json`);
    const { cmd, baseArgs } = resolveParserCommand();
    // Diretório cacheado pela extração de geometria (electron/ai/mapGeometryExtractor.ts).
    // parse_demo.py trata a ausência de .vphys/.tri pro mapa da demo como "sem
    // geometria disponível" e cai de volta pra heurística distância/ângulo — nunca
    // é um erro passar um diretório que ainda não tem nada extraído.
    const args = [...baseArgs, '--input', demoPath, '--output', outFile, '--map-geometry-dir', mapGeometryDir()];

    const child = spawn(cmd, args);
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
        const summary: DemoSummary = JSON.parse(fs.readFileSync(outFile, 'utf-8'));
        fs.rmSync(outFile, { force: true });
        resolve({
          fileName: path.basename(demoPath),
          map: summary.map,
          finalScore: summary.finalScore,
          rounds: summary.rounds,
          playerAggregates: summary.playerAggregates,
          writeSummary: (destFolder: string) => {
            fs.mkdirSync(destFolder, { recursive: true });
            fs.writeFileSync(path.join(destFolder, 'summary.json'), JSON.stringify(summary, null, 2));
          },
        });
      } catch (err) {
        reject(new Error(`Não foi possível ler a saída do parser: ${(err as Error).message}`));
      }
    });
  });
}
