import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ElectronService } from '../../core/services/electron.service';

/**
 * Barra de título customizada — a janela roda com frame:false (ver electron/main.ts)
 * pra ficar parecida com o Discord: sem moldura/menu nativos do Windows, só esta
 * faixa fina com a área de arrastar e os três botões (minimizar/maximizar/fechar).
 */
@Component({
  selector: 'app-titlebar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './titlebar.component.html',
  styleUrl: './titlebar.component.scss',
})
export class TitlebarComponent implements OnInit, OnDestroy {
  isMaximized = false;
  private unsubscribe?: () => void;

  constructor(private electron: ElectronService) {}

  async ngOnInit() {
    if (!this.electron.isElectron) return;
    this.isMaximized = await this.electron.api.window.isMaximized();
    this.unsubscribe = this.electron.api.window.onMaximizedChange((value) => {
      this.isMaximized = value;
    });
  }

  ngOnDestroy() {
    this.unsubscribe?.();
  }

  minimize() {
    this.electron.api.window.minimize();
  }

  toggleMaximize() {
    this.electron.api.window.toggleMaximize();
  }

  close() {
    this.electron.api.window.close();
  }
}
