import { Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ElectronService } from '../../core/services/electron.service';
import { DemoRecord, DemoSummary, GrenadePathPoint, KeyPosition, RoundBlind, RoundDeath, RoundLoadout, RoundSummary } from '../../core/models/slot.model';
import { RADAR_CALIBRATION, RADAR_REFERENCE_SIZE, RadarCalibration } from './radar-calibration';
import { NotebookComponent } from '../notebook/notebook.component';
import { TranslationService } from '../../core/services/translation.service';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';

interface PlayerFrame {
  name: string;
  side: 'ct' | 't';
  x: number;
  y: number;
  yaw?: number;
  health?: number;
  dead: boolean;
  shooting: boolean;
}

type RadarStatus = 'idle' | 'loaded' | 'missing' | 'unsupported' | 'extracting';

type TimelineEventType = 'death' | 'kill' | 'flash' | 'smoke' | 'fire' | 'decoy' | 'he';

interface TimelineEvent {
  type: TimelineEventType;
  t: number;
  detail: string;
}

type BombState = 'idle' | 'planted' | 'defused' | 'exploded';

const CT_COLOR = '#5dade2';
const T_COLOR = '#f5b041';
const DIRECTION_COLOR = '#26282c';
const BALL_RADIUS = 5.5;
const GLOW_COLOR = '255,241,150';
const SHOT_FLASH_WINDOW = 0.25;

const SMOKE_RADIUS = 144;
const FIRE_RADIUS = 120;
const FLASH_PULSE_DURATION = 0.5;
const HE_PULSE_DURATION = 0.6;
const HE_COLOR = '255,30,30';
const HE_FUSE_SECONDS = 2.0;
const FLASH_FUSE_SECONDS = 1.5;
const SMOKE_FUSE_SECONDS = 2.0;
const FIRE_FUSE_SECONDS = 1.5;
const DECOY_FUSE_SECONDS = 2.0;
const GRENADE_TRAIL_MATCH_WINDOW = 5.0;
const BLIND_RING_RADIUS = 12;

const C4_FUSE_SECONDS = 40;
const C4_EXPLODE_PULSE_DURATION = 1.2;
const BOMB_IDLE_COLOR = '#f4d03f';
const BOMB_PLANTED_COLOR = '#e74c3c';
const BOMB_DEFUSED_COLOR = '#2ecc71';

const HEALTH_GRAY = { r: 90, g: 92, b: 96 };
const HEALTH_BLEND_MAX = 0.75;

function lerpAngle(a: number, b: number, ratio: number): number {
  const diff = (((b - a + 180) % 360) + 360) % 360 - 180;
  return a + diff * ratio;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return { r, g, b };
}

function blendColorWithHealth(hexColor: string, health: number | undefined): string {
  const h = health === undefined ? 100 : Math.max(0, Math.min(100, health));
  const ratio = (1 - h / 100) * HEALTH_BLEND_MAX;
  const base = hexToRgb(hexColor);
  const r = Math.round(base.r + (HEALTH_GRAY.r - base.r) * ratio);
  const g = Math.round(base.g + (HEALTH_GRAY.g - base.g) * ratio);
  const b = Math.round(base.b + (HEALTH_GRAY.b - base.b) * ratio);
  return `rgb(${r},${g},${b})`;
}

@Component({
  selector: 'app-map2d',
  standalone: true,
  imports: [CommonModule, FormsModule, NotebookComponent, TranslatePipe],
  templateUrl: './map2d.component.html',
  styleUrl: './map2d.component.scss',
})
export class Map2dComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) slotId!: string;
  @Input() demos: DemoRecord[] = [];
  @Input() notebookContent = '';
  @Output() notebookContentChanged = new EventEmitter<string>();

  @ViewChild('canvas') canvasRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild(NotebookComponent) notebookCmp?: NotebookComponent;

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

  selectedTimelinePlayer: string | null = null;
  hoveredTimelineEvent: TimelineEvent | null = null;

  notesOpen = false;

  private rafHandle?: number;
  private lastTimestamp = 0;
  private frameByPlayer = new Map<string, PlayerFrame>();
  private bounds = { minX: 0, maxX: 1, minY: 0, maxY: 1 };
  private calibration?: RadarCalibration;
  private radarImageEl?: HTMLImageElement;
  private useRealRadar = false;

  constructor(private electron: ElectronService, private translation: TranslationService) {}

  private t(key: string): string {
    return this.translation.t(key);
  }

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

  get ctWinsUpToCurrent(): number {
    return (this.summary?.rounds ?? []).slice(0, this.roundIndex + 1).filter((r) => r.winner === 'ct').length;
  }

  get trWinsUpToCurrent(): number {
    return (this.summary?.rounds ?? []).slice(0, this.roundIndex + 1).filter((r) => r.winner === 't').length;
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
    this.selectedTimelinePlayer = null;
    try {
      this.summary = await this.electron.api.demos.getSummary(this.slotId, this.selectedDemoId);
      this.roundIndex = 0;
      this.setupRound();
      await this.loadRadarImage(this.summary.map);
    } catch (err) {
      this.loadError = (err as Error).message ?? this.t('Falha ao carregar dados da demo.');
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

    const bundled = await this.loadImage(`assets/radars/${map}.png`);
    if (bundled) {
      this.radarImageEl = bundled;
      this.useRealRadar = true;
      this.radarStatus = 'loaded';
      this.safeDraw();
      return;
    }

    try {
      const dataUrl = await this.electron.api.assets.getRadarImage(map);
      if (!dataUrl) {
        this.radarStatus = 'missing';
        this.safeDraw();
        return;
      }
      const img = await this.loadImage(dataUrl);
      if (!img) throw new Error(this.t('Falha ao carregar imagem do radar.'));
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
        this.extractError = this.t('Instalação do CS2 não encontrada na Steam local.');
        this.radarStatus = 'missing';
        return;
      }
      if (res.error) {
        this.extractError = res.error;
        this.radarStatus = 'missing';
        return;
      }
      if (res.extractedMaps.length === 0) {
        this.extractError = this.t('Nenhum radar foi extraído (verifique se o CS2 está atualizado).');
        this.radarStatus = 'missing';
        return;
      }

      // Geometria de colisão (LOS real do Overexposure — A04) usa o mesmo
      // VPK/CLI do radar, então extraímos na mesma ação em vez de obrigar o
      // usuário a baixar o Source2Viewer-CLI duas vezes. Falha aqui não
      // bloqueia o radar: Overexposure só cai de volta pra heurística de
      // distância/ângulo (comportamento de hoje).
      try {
        const geoRes = await this.electron.api.assets.extractMapGeometry();
        if (geoRes.error || geoRes.extractedMaps.length === 0) {
          this.extractError = this.t(
            'Radar extraído. Geometria de colisão (LOS real) não pôde ser extraída — Overexposure vai continuar usando a heurística de distância/ângulo.'
          );
        }
      } catch {
        this.extractError = this.t(
          'Radar extraído. Geometria de colisão (LOS real) não pôde ser extraída — Overexposure vai continuar usando a heurística de distância/ângulo.'
        );
      }

      if (this.summary) {
        await this.loadRadarImage(this.summary.map);
      }
    } catch (err) {
      this.extractError = (err as Error).message ?? this.t('Falha ao extrair radares.');
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
    this.hoveredTimelineEvent = null;
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

  toggleNotes() {
    this.notesOpen = !this.notesOpen;
  }

  onEmbeddedNotebookSaved(content: string) {
    this.notebookContentChanged.emit(content);
  }

  /** Insere "[mapa · demo · R7 · 12.3s]" em negrito no fim do notebook real do slot
   * (mesmo componente/arquivo da aba Notebook) e deixa o cursor pronto pra digitar
   * a observação, sem sair da tela do replay. */
  insertMoment() {
    const round = this.currentRound;
    if (!round || !this.notebookCmp) return;
    const demoLabel = this.summary?.map ?? this.selectedDemoId;
    const label = `[${demoLabel} · R${round.roundNumber} · ${this.formatTime(this.currentTime)}]`;
    this.notebookCmp.insertMarker(label);
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

  armorTitle(l: RoundLoadout): string {
    if (!l.armor) return this.t('sem colete');
    return `${l.armor} ${this.t('de colete')}${l.hasHelmet ? ' + ' + this.t('capacete') : ''}`;
  }

  deathTitle(playerName: string): string {
    const death = this.liveDeath(playerName);
    return death?.by ? `${this.t('morto por')} ${death.by}` : '';
  }

  get playPauseLabel(): string {
    return this.t(this.playing ? '❚❚ pausar' : '▶ tocar');
  }

  get bombHudLabel(): string {
    const state = this.bombState;
    if (state === 'idle') return this.t('C4 não plantada');
    if (state === 'planted') return `${this.t('C4 plantada')} · ${this.bombCountdownLabel}`;
    if (state === 'defused') return this.t('C4 defusada');
    return this.t('C4 explodiu');
  }

  roundSegmentTitle(r: RoundSummary): string {
    return `Round ${r.roundNumber} · ${r.winner === 'ct' ? this.t('CT venceu') : this.t('TR venceu')}`;
  }

  deathOf(playerName: string): RoundDeath | undefined {
    return this.currentRound?.deaths?.find((d) => d.player === playerName);
  }

  /** Só considera o jogador morto se a morte já aconteceu até o instante atual do timelapse. */
  liveDeath(playerName: string): RoundDeath | undefined {
    const death = this.deathOf(playerName);
    if (!death || death.t > this.currentTime) return undefined;
    return death;
  }

  /** Vida interpolada no instante atual do timelapse (mesma fonte usada pro marcador no mapa). */
  liveHealth(playerName: string): number | undefined {
    const frame = this.frameByPlayer.get(playerName);
    if (!frame) return undefined;
    if (frame.dead) return 0;
    return frame.health !== undefined ? Math.round(frame.health) : undefined;
  }

  killsThisRound(playerName: string): number {
    return this.currentRound?.deaths?.filter((d) => d.by === playerName && d.t <= this.currentTime).length ?? 0;
  }

  selectPlayerTimeline(playerName: string) {
    this.selectedTimelinePlayer = this.selectedTimelinePlayer === playerName ? null : playerName;
    this.hoveredTimelineEvent = null;
  }

  closeTimeline() {
    this.selectedTimelinePlayer = null;
    this.hoveredTimelineEvent = null;
  }

  get timelineEvents(): TimelineEvent[] {
    const player = this.selectedTimelinePlayer;
    const round = this.currentRound;
    if (!player || !round) return [];
    const events: TimelineEvent[] = [];

    const death = round.deaths?.find((d) => d.player === player);
    if (death) {
      const weapon = this.formatWeapon(death.weapon);
      const detail = death.by
        ? `${this.t('morto por')} ${death.by} (${weapon}${death.headshot ? ', HS' : ''})`
        : `${this.t('morto')} (${weapon})`;
      events.push({ type: 'death', t: death.t, detail });
    }
    for (const k of round.deaths ?? []) {
      if (k.by !== player) continue;
      const weapon = this.formatWeapon(k.weapon);
      events.push({ type: 'kill', t: k.t, detail: `${this.t('matou')} ${k.player} (${weapon}${k.headshot ? ', HS' : ''})` });
    }
    for (const f of round.flashes ?? []) {
      if (f.player === player) events.push({ type: 'flash', t: f.t, detail: this.t('jogou flash') });
    }
    for (const s of round.smokes ?? []) {
      if (s.player === player) events.push({ type: 'smoke', t: s.startT, detail: this.t('jogou fumaça') });
    }
    for (const fi of round.fires ?? []) {
      if (fi.player === player) events.push({ type: 'fire', t: fi.startT, detail: this.t('jogou molotov') });
    }
    for (const dc of round.decoys ?? []) {
      if (dc.player === player) events.push({ type: 'decoy', t: dc.startT, detail: this.t('jogou decoy') });
    }
    for (const h of round.he ?? []) {
      if (h.player === player) events.push({ type: 'he', t: h.t, detail: this.t('jogou HE') });
    }

    return events.sort((a, b) => a.t - b.t);
  }

  timelineMarkerLeft(ev: TimelineEvent): number {
    if (this.maxTime <= 0) return 0;
    return Math.max(0, Math.min(100, (ev.t / this.maxTime) * 100));
  }

  jumpToTimelineEvent(ev: TimelineEvent) {
    this.onScrub(ev.t);
  }

  get bombState(): BombState {
    const round = this.currentRound;
    if (!round?.bombPlant) return 'idle';
    const t = this.currentTime;
    if (t < round.bombPlant.t) return 'idle';
    if (round.bombDefuse && t >= round.bombDefuse.t) return 'defused';
    if (round.bombExplode && t >= round.bombExplode.t) return 'exploded';
    return 'planted';
  }

  get bombCountdownLabel(): string {
    const round = this.currentRound;
    if (!round?.bombPlant || this.bombState !== 'planted') return '';
    const remaining = Math.max(0, C4_FUSE_SECONDS - (this.currentTime - round.bombPlant.t));
    const mins = Math.floor(remaining / 60);
    const secs = Math.floor(remaining % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
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

      let health: number | undefined;
      if (before.health !== undefined && after.health !== undefined) {
        health = before.health + (after.health - before.health) * ratio;
      } else {
        health = before.health ?? after.health;
      }

      const shots = shotsByPlayer.get(name) ?? [];
      const shooting = shots.some((st) => Math.abs(st - t) < SHOT_FLASH_WINDOW);

      frames.push({
        name,
        side: before.side,
        x: before.x + (after.x - before.x) * ratio,
        y: before.y + (after.y - before.y) * ratio,
        yaw,
        health,
        dead: false,
        shooting,
      });
    }
    return frames;
  }

  private toCanvasXY(x: number, y: number, width: number, height: number): { px: number; py: number } {
    if (this.useRealRadar && this.calibration) {
      const px = ((x - this.calibration.posX) / this.calibration.scale) * (width / RADAR_REFERENCE_SIZE);
      const py = ((this.calibration.posY - y) / this.calibration.scale) * (height / RADAR_REFERENCE_SIZE);
      return { px, py };
    }
    const { minX, maxX, minY, maxY } = this.bounds;
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const px = ((x - minX) / rangeX) * width;
    const py = height - ((y - minY) / rangeY) * height;
    return { px, py };
  }

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

  private drawPlayerMarker(
    ctx: CanvasRenderingContext2D,
    px: number,
    py: number,
    color: string,
    yawDeg: number | undefined,
    shooting: boolean,
    health?: number
  ) {
    ctx.save();
    ctx.translate(px, py);

    ctx.beginPath();
    ctx.arc(0, 0, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = blendColorWithHealth(color, health);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.stroke();

    if (yawDeg !== undefined) {
      ctx.rotate((-yawDeg * Math.PI) / 180);

      const triSize = 4;
      const baseX = BALL_RADIUS - 1;
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

  private drawHePulses(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const round = this.currentRound;
    if (!round) return;
    const t = this.currentTime;
    for (const h of round.he ?? []) {
      const elapsed = t - h.t;
      if (elapsed < 0 || elapsed > HE_PULSE_DURATION) continue;
      const { px, py } = this.toCanvasXY(h.x, h.y, width, height);
      const progress = elapsed / HE_PULSE_DURATION;
      const r = 6 + progress * 40;
      const alpha = 1 - progress;
      const grad = ctx.createRadialGradient(px, py, 0, px, py, r);
      grad.addColorStop(0, `rgba(${HE_COLOR},${0.95 * alpha})`);
      grad.addColorStop(0.6, `rgba(${HE_COLOR},${0.5 * alpha})`);
      grad.addColorStop(1, `rgba(${HE_COLOR},0)`);
      ctx.beginPath();
      ctx.fillStyle = grad;
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private findGrenadeOrigin(
    round: RoundSummary,
    player: string,
    detonateT: number,
    fuseSeconds: number
  ): { x: number; y: number; t: number } | undefined {
    const targetT = detonateT - fuseSeconds;
    let best: KeyPosition | undefined;
    let bestDiff = Infinity;
    for (const kp of round.keyPositions ?? []) {
      if (kp.player !== player || kp.t > detonateT) continue;
      const diff = Math.abs(kp.t - targetT);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = kp;
      }
    }
    if (!best || bestDiff > GRENADE_TRAIL_MATCH_WINDOW) return undefined;
    return { x: best.x, y: best.y, t: best.t };
  }

  private drawGrenadeTrail(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    round: RoundSummary,
    player: string | undefined,
    targetX: number,
    targetY: number,
    detonateT: number,
    fuseSeconds: number,
    path?: GrenadePathPoint[]
  ) {
    const t = this.currentTime;
    if (t > detonateT) return;

    // Voo real (com quiques em parede) veio de parse_grenades() no backend —
    // usa direto em vez da aproximação em linha reta.
    if (path && path.length >= 2) {
      if (t < path[0].t) return;
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      path.forEach((p, i) => {
        const { px, py } = this.toCanvasXY(p.x, p.y, width, height);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (!player) return;
    const origin = this.findGrenadeOrigin(round, player, detonateT, fuseSeconds);
    if (!origin || t < origin.t) return;

    const { px: fromX, py: fromY } = this.toCanvasXY(origin.x, origin.y, width, height);
    const { px: toX, py: toY } = this.toCanvasXY(targetX, targetY, width, height);

    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
    ctx.restore();
  }

  private drawGrenadeTrails(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const round = this.currentRound;
    if (!round) return;

    for (const h of round.he ?? []) {
      this.drawGrenadeTrail(ctx, width, height, round, h.player, h.x, h.y, h.t, HE_FUSE_SECONDS, h.path);
    }
    for (const f of round.flashes ?? []) {
      this.drawGrenadeTrail(ctx, width, height, round, f.player, f.x, f.y, f.t, FLASH_FUSE_SECONDS, f.path);
    }
    for (const s of round.smokes ?? []) {
      this.drawGrenadeTrail(ctx, width, height, round, s.player, s.x, s.y, s.startT, SMOKE_FUSE_SECONDS, s.path);
    }
    for (const fr of round.fires ?? []) {
      this.drawGrenadeTrail(ctx, width, height, round, fr.player, fr.x, fr.y, fr.startT, FIRE_FUSE_SECONDS, fr.path);
    }
    for (const d of round.decoys ?? []) {
      this.drawGrenadeTrail(ctx, width, height, round, d.player, d.x, d.y, d.startT, DECOY_FUSE_SECONDS, d.path);
    }
  }

  private drawBomb(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const round = this.currentRound;
    if (!round?.bombPlant) return;
    const state = this.bombState;
    if (state === 'idle') return;

    const { px, py } = this.toCanvasXY(round.bombPlant.x, round.bombPlant.y, width, height);
    const color = state === 'defused' ? BOMB_DEFUSED_COLOR : BOMB_PLANTED_COLOR;

    if (state === 'exploded' && round.bombExplode) {
      const elapsed = this.currentTime - round.bombExplode.t;
      if (elapsed >= 0 && elapsed <= C4_EXPLODE_PULSE_DURATION) {
        const progress = elapsed / C4_EXPLODE_PULSE_DURATION;
        const r = 8 + progress * 60;
        const alpha = 1 - progress;
        const grad = ctx.createRadialGradient(px, py, 0, px, py, r);
        grad.addColorStop(0, `rgba(255,140,40,${0.85 * alpha})`);
        grad.addColorStop(1, 'rgba(255,60,20,0)');
        ctx.beginPath();
        ctx.fillStyle = grad;
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.save();
    ctx.beginPath();
    ctx.arc(px, py, 7, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.stroke();
    ctx.fillStyle = '#1a1a1a';
    ctx.font = 'bold 8px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('C4', px, py + 0.5);
    ctx.restore();

    if (state === 'planted') {
      ctx.save();
      ctx.fillStyle = color;
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.bombCountdownLabel, px, py - 14);
      ctx.restore();
    }
  }

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

    const frames = this.computeFrames();
    this.frameByPlayer = new Map(frames.map((f) => [f.name, f]));

    for (const frame of frames) {
      const { px, py } = this.toCanvasXY(frame.x, frame.y, width, height);

      if (frame.dead) {
        this.drawDeathMarker(ctx, px, py, frame.side === 'ct' ? CT_COLOR : T_COLOR);
        continue;
      }

      const color = frame.side === 'ct' ? CT_COLOR : T_COLOR;
      this.drawPlayerMarker(ctx, px, py, color, frame.yaw, frame.shooting, frame.health);
      if (this.isBlinded(frame.name)) {
        this.drawBlindRing(ctx, px, py);
      }

      ctx.fillStyle = 'rgba(230,233,238,0.9)';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(frame.name, px, py - 11);
    }

    this.drawFlashPulses(ctx, width, height);
    this.drawGrenadeTrails(ctx, width, height);
    this.drawHePulses(ctx, width, height);
    this.drawBomb(ctx, width, height);
  }
}
