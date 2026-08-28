import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ElectronService } from '../../core/services/electron.service';

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
