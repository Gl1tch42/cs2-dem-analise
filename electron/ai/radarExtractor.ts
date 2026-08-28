import { app } from 'electron';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { RADAR_EXTRACTABLE_MAPS } from '../storage/radarCalibration';

/**
 * Extrai as imagens reais de radar (overview) do CS2 instalado localmente pelo
 * usuário, usando o Source2Viewer-CLI (ValveResourceFormat, MIT license) —
 * ferramenta open-source padrão da comunidade pra ler VPKs do Source 2.
 *
 * Importante: isso só toca a instalação do Steam em modo LEITURA, e a imagem
 * extraída fica só no userData local do próprio usuário (nunca é commitada no
 * projeto nem redistribuída) — o app não tem esses assets da Valve embutidos.
 * Só funciona no Windows (onde o CS2/Steam roda de forma padrão aqui).
 */

const VRF_RELEASE_TAG = '20.0';
const VRF_CLI_ZIP_URL = `https://github.com/ValveResourceFormat/ValveResourceFormat/releases/download/${VRF_RELEASE_TAG}/cli-windows-x64.zip`;

function appDataRoot(): string {
  return path.join(app.getPath('userData'), 'cs-demo-analyst');
}

function radarsDir(): string {
  const dir = path.join(appDataRoot(), 'radars');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function toolsDir(): string {
  const dir = path.join(appDataRoot(), 'tools', 'vrf');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Procura a pasta de instalação do CS2 nas bibliotecas do Steam (Windows). */
function findCs2InstallDir(): string | null {
  const steamRoots = ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam'];
  for (const steamRoot of steamRoots) {
    if (!fs.existsSync(steamRoot)) continue;
    const libraries = new Set<string>([steamRoot]);
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
      if (fs.existsSync(vpk)) return csDir;
    }
  }
  return null;
}

function downloadFile(url: string, destPath: string): Promise<void> {
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

function runCommand(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`"${cmd}" terminou com código ${code}: ${stderr || stdout}`));
      else resolve(stdout);
    });
  });
}

async function ensureExtractorCli(): Promise<string> {
  const dir = toolsDir();
  const exe = path.join(dir, 'Source2Viewer-CLI.exe');
  if (fs.existsSync(exe)) return exe;
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

export interface RadarExtractionResult {
  cs2Found: boolean;
  extractedMaps: string[];
  error?: string;
}

/** Roda a extração de verdade — baixa a CLI se preciso, lê o VPK local, copia os PNGs pro userData. */
export async function extractRadarsFromLocalCs2(): Promise<RadarExtractionResult> {
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
    const extracted: string[] = [];
    for (const map of RADAR_EXTRACTABLE_MAPS) {
      const src = path.join(srcDir, `${map}_radar_psd.png`);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(destDir, `${map}.png`));
        extracted.push(map);
      }
    }
    fs.rmSync(tmpOut, { recursive: true, force: true });

    return { cs2Found: true, extractedMaps: extracted };
  } catch (err) {
    return { cs2Found: true, extractedMaps: [], error: (err as Error).message };
  }
}

/** Caminho do PNG em cache pra um mapa, se já foi extraído antes. */
export function getCachedRadarPath(map: string): string | null {
  const p = path.join(radarsDir(), `${map}.png`);
  return fs.existsSync(p) ? p : null;
}
