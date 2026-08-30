import { Component, ElementRef, Input, OnChanges, SimpleChanges, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ElectronService } from '../../core/services/electron.service';
import { DemoRecord, DemoSummary } from '../../core/models/slot.model';
import { RADAR_CALIBRATION, RADAR_REFERENCE_SIZE } from '../map2d/radar-calibration';

interface PlayerOption {
  steamId: string;
  name: string;
}

interface HeatPoint {
  x: number;
  y: number;
}

const POINT_RADIUS_RATIO = 0.035;
const MIN_POINT_RADIUS = 14;

@Component({
  selector: 'app-heatmap',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './heatmap.component.html',
  styleUrl: './heatmap.component.scss',
})
export class HeatmapComponent implements OnChanges {
  @Input({ required: true }) slotId!: string;
  @Input() demos: DemoRecord[] = [];

  @ViewChild('canvasAll') canvasAllRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('canvasCt') canvasCtRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('canvasT') canvasTRef?: ElementRef<HTMLCanvasElement>;

  players: PlayerOption[] = [];
  maps: string[] = [];
  selectedSteamId = '';
  selectedMap = '';

  loading = false;
  loadError = '';

  allSampleCount = 0;
  ctSampleCount = 0;
  tSampleCount = 0;
  allRoundCount = 0;
  ctRoundCount = 0;
  tRoundCount = 0;

  private allPoints: HeatPoint[] = [];
  private ctPoints: HeatPoint[] = [];
  private tPoints: HeatPoint[] = [];

  private summaryCache = new Map<string, DemoSummary>();
  private radarImageEl?: HTMLImageElement;
  private radarLoaded = false;
  private paletteCache?: Uint8ClampedArray;

  constructor(private electron: ElectronService) {}

  async ngOnChanges(changes: SimpleChanges): Promise<void> {
    if (changes['demos']) {
      await this.rebuildOptions();
      await this.refresh();
    }
  }

  get hasRoster(): boolean {
    return this.demos.some((d) => d.myTeamSteamIds && d.myTeamSteamIds.length > 0);
  }

  async onPlayerChange() {
    await this.refresh();
  }

  async onMapChange() {
    await this.refresh();
  }

  private async getSummary(demo: DemoRecord): Promise<DemoSummary> {
    const key = `${this.slotId}:${demo.id}`;
    const cached = this.summaryCache.get(key);
    if (cached) return cached;
    const summary = await this.electron.api.demos.getSummary(this.slotId, demo.id);
    this.summaryCache.set(key, summary);
    return summary;
  }

  private async rebuildOptions() {
    this.maps = [...new Set(this.demos.map((d) => d.map))].sort();
    if (!this.selectedMap || !this.maps.includes(this.selectedMap)) {
      this.selectedMap = this.maps[0] ?? '';
    }

    const rostered = this.demos.filter((d) => d.myTeamSteamIds && d.myTeamSteamIds.length > 0);
    const nameBySteamId = new Map<string, string>();
    for (const demo of rostered) {
      try {
        const summary = await this.getSummary(demo);
        for (const steamId of demo.myTeamSteamIds ?? []) {
          const agg = summary.playerAggregates.find((p) => p.steamId === steamId);
          if (agg) nameBySteamId.set(steamId, agg.name);
        }
      } catch {
        // demo pode ter sido removida ou o arquivo de resumo pode estar corrompido; ignora e segue
      }
    }

    this.players = [...nameBySteamId.entries()]
      .map(([steamId, name]) => ({ steamId, name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (!this.selectedSteamId || !this.players.some((p) => p.steamId === this.selectedSteamId)) {
      this.selectedSteamId = this.players[0]?.steamId ?? '';
    }
  }

  private async refresh() {
    this.allSampleCount = 0;
    this.ctSampleCount = 0;
    this.tSampleCount = 0;
    this.allRoundCount = 0;
    this.ctRoundCount = 0;
    this.tRoundCount = 0;
    this.allPoints = [];
    this.ctPoints = [];
    this.tPoints = [];
    this.loadError = '';
    this.radarLoaded = false;
    this.radarImageEl = undefined;

    if (!this.selectedSteamId || !this.selectedMap) {
      this.safeDraw();
      return;
    }

    const player = this.players.find((p) => p.steamId === this.selectedSteamId);
    if (!player) {
      this.safeDraw();
      return;
    }

    this.loading = true;
    const allPoints: HeatPoint[] = [];
    const ctPoints: HeatPoint[] = [];
    const tPoints: HeatPoint[] = [];
    let allRounds = 0;
    let ctRounds = 0;
    let tRounds = 0;
    try {
      const demosForMap = this.demos.filter(
        (d) => d.map === this.selectedMap && d.myTeamSteamIds?.includes(this.selectedSteamId)
      );
      for (const demo of demosForMap) {
        const summary = await this.getSummary(demo);
        for (const round of summary.rounds) {
          let sawAll = false;
          let sawCt = false;
          let sawT = false;
          for (const kp of round.keyPositions) {
            if (kp.player !== player.name) continue;
            const point = { x: kp.x, y: kp.y };
            allPoints.push(point);
            sawAll = true;
            if (kp.side === 'ct') {
              ctPoints.push(point);
              sawCt = true;
            } else {
              tPoints.push(point);
              sawT = true;
            }
          }
          if (sawAll) allRounds++;
          if (sawCt) ctRounds++;
          if (sawT) tRounds++;
        }
      }
      await this.loadRadarImage(this.selectedMap);
    } catch (err) {
      this.loadError = (err as Error).message ?? 'Falha ao carregar posições.';
    } finally {
      this.loading = false;
    }

    this.allPoints = allPoints;
    this.ctPoints = ctPoints;
    this.tPoints = tPoints;
    this.allSampleCount = allPoints.length;
    this.ctSampleCount = ctPoints.length;
    this.tSampleCount = tPoints.length;
    this.allRoundCount = allRounds;
    this.ctRoundCount = ctRounds;
    this.tRoundCount = tRounds;
    this.safeDraw();
  }

  private safeDraw() {
    const render = () => {
      this.drawInto(this.canvasAllRef?.nativeElement, this.allPoints);
      this.drawInto(this.canvasCtRef?.nativeElement, this.ctPoints);
      this.drawInto(this.canvasTRef?.nativeElement, this.tPoints);
    };
    render();
    setTimeout(render);
  }

  private loadImage(src: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  private async loadRadarImage(map: string) {
    if (!RADAR_CALIBRATION[map]) return;
    const bundled = await this.loadImage(`assets/radars/${map}.png`);
    if (bundled) {
      this.radarImageEl = bundled;
      this.radarLoaded = true;
      return;
    }
    try {
      const dataUrl = await this.electron.api.assets.getRadarImage(map);
      if (!dataUrl) return;
      const img = await this.loadImage(dataUrl);
      if (img) {
        this.radarImageEl = img;
        this.radarLoaded = true;
      }
    } catch {
      // sem radar disponível; segue exibindo o heatmap sobre um fundo neutro
    }
  }

  private toCanvasXY(x: number, y: number, width: number, height: number): { px: number; py: number } {
    const calibration = RADAR_CALIBRATION[this.selectedMap];
    if (calibration) {
      const px = ((x - calibration.posX) / calibration.scale) * (width / RADAR_REFERENCE_SIZE);
      const py = ((calibration.posY - y) / calibration.scale) * (height / RADAR_REFERENCE_SIZE);
      return { px, py };
    }
    return { px: width / 2, py: height / 2 };
  }

  private drawBackground(ctx: CanvasRenderingContext2D, width: number, height: number) {
    if (this.radarLoaded && this.radarImageEl) {
      ctx.drawImage(this.radarImageEl, 0, 0, width, height);
      return;
    }
    ctx.fillStyle = '#12161c';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  }

  private buildPalette(): Uint8ClampedArray {
    if (this.paletteCache) return this.paletteCache;
    const strip = document.createElement('canvas');
    strip.width = 256;
    strip.height = 1;
    const ctx = strip.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 256, 0);
    grad.addColorStop(0.0, '#1d3557');
    grad.addColorStop(0.3, '#2a9d8f');
    grad.addColorStop(0.55, '#e9c46a');
    grad.addColorStop(0.78, '#f4a261');
    grad.addColorStop(1.0, '#e63946');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 1);
    this.paletteCache = ctx.getImageData(0, 0, 256, 1).data;
    return this.paletteCache;
  }

  private drawHeatLayer(ctx: CanvasRenderingContext2D, width: number, height: number, points: HeatPoint[]) {
    if (points.length === 0) return;

    const density = document.createElement('canvas');
    density.width = width;
    density.height = height;
    const dctx = density.getContext('2d')!;
    const radius = Math.max(MIN_POINT_RADIUS, width * POINT_RADIUS_RATIO);

    for (const p of points) {
      const { px, py } = this.toCanvasXY(p.x, p.y, width, height);
      const grad = dctx.createRadialGradient(px, py, 0, px, py, radius);
      grad.addColorStop(0, 'rgba(0,0,0,0.16)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      dctx.fillStyle = grad;
      dctx.beginPath();
      dctx.arc(px, py, radius, 0, Math.PI * 2);
      dctx.fill();
    }

    const imgData = dctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    const palette = this.buildPalette();
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a === 0) continue;
      const idx = Math.min(255, a) * 4;
      data[i] = palette[idx];
      data[i + 1] = palette[idx + 1];
      data[i + 2] = palette[idx + 2];
      data[i + 3] = Math.min(225, 55 + a * 1.5);
    }
    dctx.putImageData(imgData, 0, 0);
    ctx.drawImage(density, 0, 0);
  }

  private drawInto(canvas: HTMLCanvasElement | undefined, points: HeatPoint[]) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    this.drawBackground(ctx, width, height);
    this.drawHeatLayer(ctx, width, height, points);
  }
}
