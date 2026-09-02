import * as fs from 'fs';
import * as path from 'path';
import { RADAR_EXTRACTABLE_MAPS } from '../storage/radarCalibration';
import { appDataRoot, ensureExtractorCli, findCs2InstallDir, runCommand } from './radarExtractor';

// Marca o início dos dados brutos do bloco PHYS na saída de texto do
// Source2Viewer-CLI (--block "PHYS"). Confirmado lendo o script oficial de
// extração do projeto awpy (scripts/generate-tris.ps1), que usa exatamente
// esse mesmo fluxo pra gerar os .tri que a lib consome. Ver
// python/geometry/THIRD_PARTY_NOTICE.md.
const PHYS_BLOCK_MARKER = '--- Data for block "PHYS" ---';

export function mapGeometryDir(): string {
  const dir = path.join(appDataRoot(), 'mapgeo');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export interface MapGeometryExtractionResult {
  cs2Found: boolean;
  extractedMaps: string[];
  error?: string;
}

// Extrai o bloco PHYS (geometria de colisão bruta, formato KV3) de
// world_physics.vmdl_c pra cada mapa já calibrado, direto do pak01_dir.vpk
// da instalação local do CS2 do usuário. O parse_demo.py converte esse .vphys
// bruto pra .tri (cache binário) na primeira vez que precisar dele — ver
// load_visibility_checker em parse_demo.py.
export async function extractMapPhysicsFromLocalCs2(): Promise<MapGeometryExtractionResult> {
  const cs2Dir = findCs2InstallDir();
  if (!cs2Dir) {
    return { cs2Found: false, extractedMaps: [] };
  }
  const vpk = path.join(cs2Dir, 'game', 'csgo', 'pak01_dir.vpk');

  try {
    const cliExe = await ensureExtractorCli();
    const destDir = mapGeometryDir();
    const extracted: string[] = [];

    for (const map of RADAR_EXTRACTABLE_MAPS) {
      try {
        const stdout = await runCommand(cliExe, [
          '-i',
          vpk,
          '--block',
          'PHYS',
          '-f',
          `maps/${map}/world_physics.vmdl_c`,
        ]);
        const markerIndex = stdout.indexOf(PHYS_BLOCK_MARKER);
        if (markerIndex === -1) continue; // mapa não presente nesta instalação, ou sem bloco PHYS nesse caminho
        const vphysContent = stdout.slice(markerIndex + PHYS_BLOCK_MARKER.length).trim();
        if (!vphysContent) continue;
        fs.writeFileSync(path.join(destDir, `${map}.vphys`), vphysContent, 'utf-8');
        // Geometria mudou -> invalida qualquer .tri cacheado de uma extração anterior.
        fs.rmSync(path.join(destDir, `${map}.tri`), { force: true });
        extracted.push(map);
      } catch {
        // Um mapa individual falhar (ex: não instalado) não deve derrubar os demais.
        continue;
      }
    }

    return { cs2Found: true, extractedMaps: extracted };
  } catch (err) {
    return { cs2Found: true, extractedMaps: [], error: (err as Error).message };
  }
}

export function getCachedMapGeometryPath(map: string): string | null {
  const p = path.join(mapGeometryDir(), `${map}.vphys`);
  return fs.existsSync(p) ? p : null;
}
