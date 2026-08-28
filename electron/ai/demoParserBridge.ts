import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { app } from 'electron';
import { DemoSummary } from '../storage/types';

function resolveParserCommand(): { cmd: string; baseArgs: string[] } {
  const isPackaged = app.isPackaged;
  if (isPackaged) {
    const bin = path.join(
      process.resourcesPath,
      'python',
      process.platform === 'win32' ? 'parse_demo.exe' : 'parse_demo'
    );
    return { cmd: bin, baseArgs: [] };
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
    const args = [...baseArgs, '--input', demoPath, '--output', outFile];

    const child = spawn(cmd, args);
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d.toString()));

    child.on('error', (err) => reject(new Error(`Falha ao iniciar o parser de demo: ${err.message}`)));

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Parser de demo terminou com erro (código ${code}): ${stderr}`));
        return;
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
