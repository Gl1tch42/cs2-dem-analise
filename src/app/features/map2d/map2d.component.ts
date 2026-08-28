import { Component, ElementRef, Input, OnChanges, OnDestroy, SimpleChanges, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ElectronService } from '../../core/services/electron.service';
import { DemoRecord, DemoSummary, KeyPosition, RoundBlind, RoundDeath, RoundSummary } from '../../core/models/slot.model';
import { RADAR_CALIBRATION, RADAR_REFERENCE_SIZE, RadarCalibration } from './radar-calibration';

interface PlayerFrame {
  name: string;
  side: 'ct' | 't';
  x: number;
  y: number;
  yaw?: number;
  dead: boolean;
  shooting: boolean;
}

type RadarStatus = 'idle' | 'loaded' | 'missing' | 'unsupported' | 'extracting';

const CT_COLOR = '#5dade2';
const T_COLOR = '#f5b041';
const DIRECTION_COLOR = '#26282c'; // pontinha de direção — preto/cinza escuro, "grudada" na bola
const BALL_RADIUS = 5.5;
const GLOW_COLOR = '255,241,150'; // rgb — brilho na ponta do indicador de direção quando atira
const SHOT_FLASH_WINDOW = 0.25; // segundos ao redor do tiro em que a ponta brilha

// Raios aproximados (unidades de mundo do CS) das áreas de efeito das granadas —
// só pra desenhar a região no mapa, não precisam ser exatos ao milímetro.
const SMOKE_RADIUS = 144;
const FIRE_RADIUS = 120;
const FLASH_PULSE_DURATION = 0.5; // segundos que o "estouro" da flash fica visível
const BLIND_RING_RADIUS = 12; // px fixos (não escala com o zoom do mapa)

/** Interpolação de ângulo pelo caminho mais curto (evita giro de 350° em vez de -10°). */
function lerpAngle(a: number, b: number, ratio: number): number {
  const diff = (((b - a + 180) % 360) + 360) % 360 - 180;
  return a + diff * ratio;
}

@Component({
  selector: 'app-map2d',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './map2d.component.html',
  styleUrl: './map2d.component.scss',
})
export class Map2dComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) slotId!: string;
  @Input() demos: DemoRecord[] = [];

  @ViewChild('canvas') canvasRef?: ElementRef<HTMLCanvasElement>;

  readonly speedOptions = [0.5, 1, 2, 4];
  readonly sides: ('ct' | 't')[] = ['ct', 't'];

  selectedDemoId = '';
  summary?: DemoSummary;
  loading = false;
  loadError = '';

  roundIndex = 0;
  currentTime = 0;
  maxTime = 0;
  playing = false;
  speed = 1;

  radarStatus: RadarStatus = 'idle';
  extractError = '';

  private rafHandle?: number;
  private lastTimestamp = 0;
  private bounds = { minX: 0, maxX: 1, minY: 0, maxY: 1 };
  private calibration?: RadarCalibration;
  private radarImageEl?: HTMLImageElement;
  private useRealRadar = false;

  constructor(private electron: ElectronService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['demos'] && this.demos.length > 0) {
      const stillExists = this.demos.some((d) => d.id === this.selectedDemoId);
      if (!stillExists) {
        this.selectedDemoId = this.demos[0].id;
        this.loadSummary();
      }
    }
  }

  ngOnDestroy(): void {
    this.stopPlayback();
  }

  get currentRound(): RoundSummary | undefined {
    return this.summary?.rounds[this.roundIndex];
  }

  async onDemoChange() {
    this.stopPlayback();
    await this.loadSummary();
  }

  private async loadSummary() {
    if (!this.selectedDemoId) return;
    this.loading = true;
    this.loadError = '';
    this.summary = undefined;
    try {
      this.summary = await this.electron.api.demos.getSummary(this.slotId, this.selectedDemoId);
      this.roundIndex = 0;
      this.setupRound();
      await this.loadRadarImage(this.summary.map);
    } catch (err) {
      this.loadError = (err as Error).message ?? 'Falha ao carregar dados da demo.';
    } finally {
      this.loading = false;
    }
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
    this.calibration = RADAR_CALIBRATION[map];
    this.radarImageEl = undefined;
    this.useRealRadar = false;
    this.extractError = '';
    if (!this.calibration) {
      this.radarStatus = 'unsupported';
      this.safeDraw();
      return;
    }

    // 1. Radares já vêm empacotados com o app (assets/radars/) — funciona sem CS2 instalado.
    const bundled = await this.loadImage(`assets/radars/${map}.png`);
    if (bundled) {
      this.radarImageEl = bundled;
      this.useRealRadar = true;
      this.radarStatus = 'loaded';
      this.safeDraw();
      return;
    }

    // 2. Fallback: mapa novo ainda não empacotado — tenta o cache extraído do CS2 local.
    try {
      const dataUrl = await this.electron.api.assets.getRadarImage(map);
      if (!dataUrl) {
        this.radarStatus = 'missing';
        this.safeDraw();
        return;
      }
      const img = await this.loadImage(dataUrl);
      if (!img) throw new Error('Falha ao carregar imagem do radar.');
      this.radarImageEl = img;
      this.useRealRadar = true;
      this.radarStatus = 'loaded';
    } catch {
      this.radarStatus = 'missing';
    }
    this.safeDraw();
  }

  async extractRadars() {
    this.radarStatus = 'extracting';
    this.extractError = '';
    try {
      const res = await this.electron.api.assets.extractRadars();
      if (!res.cs2Found) {
        this.extractError = 'Instalação do CS2 não encontrada na Steam local.';
        this.radarStatus = 'missing';
      } else if (res.error) {
        this.extractError = res.error;
        this.radarStatus = 'missing';
      } else if (res.extractedMaps.length === 0) {
        this.extractError = 'Nenhum radar foi extraído (verifique se o CS2 está atualizado).';
        this.radarStatus = 'missing';
      } else if (this.summary) {
        await this.loadRadarImage(this.summary.map);
      }
    } catch (err) {
      this.extractError = (err as Error).message ?? 'Falha ao extrair radares.';
      this.radarStatus = 'missing';
    }
  }

  setRound(index: number) {
    if (!this.summary) return;
    if (index < 0 || index >= this.summary.rounds.length) return;
    this.roundIndex = index;
    this.setupRound();
  }

  prevRound() {
    this.setRound(this.roundIndex - 1);
  }

  nextRound() {
    this.setRound(this.roundIndex + 1);
  }

  private setupRound() {
    this.stopPlayback();
    this.currentTime = 0;
    const positions = this.currentRound?.keyPositions ?? [];
    this.maxTime = positions.length > 0 ? Math.max(...positions.map((p) => p.t)) : 0;
    this.computeBounds(positions);
    this.safeDraw();
  }

  private computeBounds(positions: KeyPosition[]) {
    if (positions.length === 0) {
      this.bounds = { minX: 0, maxX: 1, minY: 0, maxY: 1 };
      return;
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of positions) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    // padding proporcional + garante uma área quadrada mínima pra não distorcer
    // a posição relativa dos jogadores quando o range de um eixo é bem menor que o outro.
    const span = Math.max(maxX - minX, maxY - minY, 200);
    const pad = span * 0.1;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const half = span / 2 + pad;
    this.bounds = { minX: cx - half, maxX: cx + half, minY: cy - half, maxY: cy + half };
  }

  togglePlay() {
    if (this.playing) {
      this.stopPlayback();
      return;
    }
    if (!this.currentRound?.keyPositions?.length) return;
    if (this.currentTime >= this.maxTime) this.currentTime = 0;
    this.playing = true;
    this.lastTimestamp = performance.now();
    this.rafHandle = requestAnimationFrame(this.loop);
  }

  private loop = (timestamp: number) => {
    const deltaSeconds = (timestamp - this.lastTimestamp) / 1000;
    this.lastTimestamp = timestamp;
    this.currentTime += deltaSeconds * this.speed;
    if (this.currentTime >= this.maxTime) {
      this.currentTime = this.maxTime;
      this.draw();
      this.playing = false;
      return;
    }
    this.draw();
    this.rafHandle = requestAnimationFrame(this.loop);
  };

  private stopPlayback() {
    this.playing = false;
    if (this.rafHandle !== undefined) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = undefined;
    }
  }

  setSpeed(speed: number) {
    this.speed = speed;
  }

  onScrub(value: number) {
    this.stopPlayback();
    this.currentTime = value;
    this.draw();
  }

  formatTime(t: number): string {
    return `${t.toFixed(1)}s`;
  }

  formatWeapon(weapon: string | null | undefined): string {
    if (!weapon) return '—';
    return weapon
      .replace(/^weapon_/, '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  loadoutBySide(side: 'ct' | 't') {
    return (this.currentRound?.loadout ?? []).filter((l) => l.side === side);
  }

  deathOf(playerName: string): RoundDeath | undefined {
    return this.currentRound?.deaths?.find((d) => d.player === playerName);
  }

  killsThisRound(playerName: string): number {
    return this.currentRound?.deaths?.filter((d) => d.by === playerName).length ?? 0;
  }

  private computeFrames(): PlayerFrame[] {
    const round = this.currentRound;
    if (!round) return [];
    const t = this.currentTime;

    const deathByPlayer = new Map<string, RoundDeath>();
    for (const d of round.deaths ?? []) {
      if (!deathByPlayer.has(d.player)) deathByPlayer.set(d.player, d);
    }
    const shotsByPlayer = new Map<string, number[]>();
    for (const s of round.shots ?? []) {
      const list = shotsByPlayer.get(s.player) ?? [];
      list.push(s.t);
      shotsByPlayer.set(s.player, list);
    }
    const byPlayer = new Map<string, KeyPosition[]>();
    for (const p of round.keyPositions) {
      const list = byPlayer.get(p.player) ?? [];
      list.push(p);
      byPlayer.set(p.player, list);
    }

    const frames: PlayerFrame[] = [];
    for (const [name, rawSamples] of byPlayer) {
      const death = deathByPlayer.get(name);
      if (death && t >= death.t) {
        frames.push({ name, side: death.side, x: death.x, y: death.y, dead: true, shooting: false });
        continue;
      }

      const samples = [...rawSamples].sort((a, b) => a.t - b.t);
      let before = samples[0];
      let after = samples[samples.length - 1];
      if (t <= samples[0].t) {
        before = after = samples[0];
      } else if (t >= samples[samples.length - 1].t) {
        before = after = samples[samples.length - 1];
      } else {
        for (let i = 0; i < samples.length - 1; i++) {
          if (samples[i].t <= t && samples[i + 1].t >= t) {
            before = samples[i];
            after = samples[i + 1];
            break;
          }
        }
      }
      const span = after.t - before.t;
      const ratio = span > 0 ? (t - before.t) / span : 0;

      let yaw: number | undefined;
      if (before.yaw !== undefined && after.yaw !== undefined) {
        yaw = lerpAngle(before.yaw, after.yaw, ratio);
      } else {
        yaw = before.yaw ?? after.yaw;
      }

      const shots = shotsByPlayer.get(name) ?? [];
      const shooting = shots.some((st) => Math.abs(st - t) < SHOT_FLASH_WINDOW);

      frames.push({
        name,
        side: before.side,
        x: before.x + (after.x - before.x) * ratio,
        y: before.y + (after.y - before.y) * ratio,
        yaw,
        dead: false,
        shooting,
      });
    }
    return frames;
  }

  private toCanvasXY(x: number, y: number, width: number, height: number): { px: number; py: number } {
    if (this.useRealRadar && this.calibration) {
      const px = ((x - this.calibration.posX) / this.calibration.scale) * (width / RADAR_REFERENCE_SIZE);
      // eixo Y do radar cresce de cima pra baixo a partir de pos_y (canto superior esquerdo em world Y).
      const py = ((this.calibration.posY - y) / this.calibration.scale) * (height / RADAR_REFERENCE_SIZE);
      return { px, py };
    }
    const { minX, maxX, minY, maxY } = this.bounds;
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const px = ((x - minX) / rangeX) * width;
    // eixo Y do mundo do CS cresce pra "norte" — inverte pra desenhar com y pra baixo na tela.
    const py = height - ((y - minY) / rangeY) * height;
    return { px, py };
  }

  /** Converte um raio em unidades de mundo (ex: raio de fumaça) pra pixels do canvas atual. */
  private worldRadiusToPixels(radius: number, width: number): number {
    if (this.useRealRadar && this.calibration) {
      return (radius / this.calibration.scale) * (width / RADAR_REFERENCE_SIZE);
    }
    const rangeX = this.bounds.maxX - this.bounds.minX || 1;
    return (radius / rangeX) * width;
  }

  private isBlinded(playerName: string): RoundBlind | undefined {
    const t = this.currentTime;
    return (this.currentRound?.blinds ?? []).find(
      (b) => b.player === playerName && t >= b.t && t <= b.t + b.duration
    );
  }

  private drawBackground(ctx: CanvasRenderingContext2D, width: number, height: number) {
    if (this.useRealRadar && this.radarImageEl) {
      ctx.drawImage(this.radarImageEl, 0, 0, width, height);
      return;
    }
    ctx.fillStyle = '#12161c';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    const gridStep = width / 10;
    for (let i = 1; i < 10; i++) {
      ctx.beginPath();
      ctx.moveTo(i * gridStep, 0);
      ctx.lineTo(i * gridStep, height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * gridStep);
      ctx.lineTo(width, i * gridStep);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  }

  /**
   * A bola (círculo, sempre na cor do time) é o marcador principal do
   * jogador. Quando a demo expõe yaw, uma pontinha triangular pequena e
   * escura (preto/cinza) fica grudada na borda da bola, apontando pra onde
   * ele está olhando. Quando `shooting` é true, acende um brilho bem na
   * ponta dessa seta — sem mudar a cor da bola nem da seta.
   */
  private drawPlayerMarker(
    ctx: CanvasRenderingContext2D,
    px: number,
    py: number,
    color: string,
    yawDeg: number | undefined,
    shooting: boolean
  ) {
    ctx.save();
    ctx.translate(px, py);

    // a bola — sempre presente, é ela que representa o jogador.
    ctx.beginPath();
    ctx.arc(0, 0, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.stroke();

    if (yawDeg !== undefined) {
      // yaw 0° = +X (leste); no canvas (Y pra baixo), o mesmo sentido físico
      // vira uma rotação negativa em relação ao eixo X do canvas.
      ctx.rotate((-yawDeg * Math.PI) / 180);

      const triSize = 4;
      const baseX = BALL_RADIUS - 1; // começa um pouco "dentro" da bola, grudada na borda
      ctx.beginPath();
      ctx.moveTo(baseX + triSize, 0);
      ctx.lineTo(baseX - triSize * 0.4, triSize * 0.6);
      ctx.lineTo(baseX - triSize * 0.4, -triSize * 0.6);
      ctx.closePath();
      ctx.fillStyle = DIRECTION_COLOR;
      ctx.fill();

      if (shooting) {
        const glowCx = baseX + triSize + 2;
        const grad = ctx.createRadialGradient(glowCx, 0, 0, glowCx, 0, 8);
        grad.addColorStop(0, `rgba(${GLOW_COLOR},0.95)`);
        grad.addColorStop(1, `rgba(${GLOW_COLOR},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(glowCx, 0, 8, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (shooting) {
      // sem yaw (dado de demo antiga sem esse prop) — brilho ao redor da própria bola.
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 12);
      grad.addColorStop(0, `rgba(${GLOW_COLOR},0.85)`);
      grad.addColorStop(1, `rgba(${GLOW_COLOR},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawBlindRing(ctx: CanvasRenderingContext2D, px: number, py: number) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, BLIND_RING_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawDeathMarker(ctx: CanvasRenderingContext2D, px: number, py: number, color: string) {
    const s = 6;
    ctx.save();
    ctx.translate(px, py);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-s, -s);
    ctx.lineTo(s, s);
    ctx.moveTo(-s, s);
    ctx.lineTo(s, -s);
    ctx.stroke();
    ctx.restore();
  }

  /** Fumaça (cinza), fogo de molotov (vermelho/laranja) e decoy (contorno pontilhado) — sob os jogadores. */
  private drawGrenadeEffects(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const round = this.currentRound;
    if (!round) return;
    const t = this.currentTime;

    for (const s of round.smokes ?? []) {
      if (t < s.startT || t > s.endT) continue;
      const { px, py } = this.toCanvasXY(s.x, s.y, width, height);
      const r = this.worldRadiusToPixels(SMOKE_RADIUS, width);
      ctx.beginPath();
      ctx.fillStyle = 'rgba(195,200,205,0.55)';
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(225,225,225,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    for (const f of round.fires ?? []) {
      if (t < f.startT || t > f.endT) continue;
      const { px, py } = this.toCanvasXY(f.x, f.y, width, height);
      const r = this.worldRadiusToPixels(FIRE_RADIUS, width);
      const flicker = 1 + Math.sin(t * 14 + f.x) * 0.06;
      const grad = ctx.createRadialGradient(px, py, 0, px, py, r * flicker);
      grad.addColorStop(0, 'rgba(255,196,64,0.85)');
      grad.addColorStop(0.55, 'rgba(230,90,30,0.6)');
      grad.addColorStop(1, 'rgba(180,30,20,0)');
      ctx.beginPath();
      ctx.fillStyle = grad;
      ctx.arc(px, py, r * flicker, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const d of round.decoys ?? []) {
      if (t < d.startT || t > d.endT) continue;
      const { px, py } = this.toCanvasXY(d.x, d.y, width, height);
      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(200,200,200,0.6)';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1.5;
      ctx.arc(px, py, 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Estouro de flashbang: um clarão branco que expande e desaparece rápido. */
  private drawFlashPulses(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const round = this.currentRound;
    if (!round) return;
    const t = this.currentTime;
    for (const f of round.flashes ?? []) {
      const elapsed = t - f.t;
      if (elapsed < 0 || elapsed > FLASH_PULSE_DURATION) continue;
      const { px, py } = this.toCanvasXY(f.x, f.y, width, height);
      const progress = elapsed / FLASH_PULSE_DURATION;
      const r = 6 + progress * 34;
      const alpha = 1 - progress;
      const grad = ctx.createRadialGradient(px, py, 0, px, py, r);
      grad.addColorStop(0, `rgba(255,255,255,${0.9 * alpha})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.beginPath();
      ctx.fillStyle = grad;
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * @ViewChild só é resolvido depois que a view termina de assentar — chamadas
   * vindas de fluxos assíncronos (loadRadarImage, extractRadars) podem terminar
   * antes disso e cair num draw() sem canvas ainda. Dá um segundo tiro via
   * setTimeout(0) pra cobrir esse caso, sem custo perceptível quando já funcionou
   * de primeira.
   */
  private safeDraw() {
    this.draw();
    setTimeout(() => this.draw());
  }

  private draw() {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    this.drawBackground(ctx, width, height);
    this.drawGrenadeEffects(ctx, width, height);

    for (const frame of this.computeFrames()) {
      const { px, py } = this.toCanvasXY(frame.x, frame.y, width, height);

      if (frame.dead) {
        this.drawDeathMarker(ctx, px, py, frame.side === 'ct' ? CT_COLOR : T_COLOR);
        continue;
      }

      const color = frame.side === 'ct' ? CT_COLOR : T_COLOR;
      this.drawPlayerMarker(ctx, px, py, color, frame.yaw, frame.shooting);
      if (this.isBlinded(frame.name)) {
        this.drawBlindRing(ctx, px, py);
      }

      ctx.fillStyle = 'rgba(230,233,238,0.9)';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(frame.name, px, py - 11);
    }

    this.drawFlashPulses(ctx, width, height);
  }
}
