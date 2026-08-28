import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { ElectronService } from '../../core/services/electron.service';
import { SlotMeta } from '../../core/models/slot.model';

const COLLAPSED_STORAGE_KEY = 'sidebar-collapsed';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent implements OnInit {
  ownSlot?: SlotMeta;
  opponentSlots: SlotMeta[] = [];
  loading = true;

  collapsed = false;
  hovering = false;

  constructor(private electron: ElectronService) {}

  async ngOnInit() {
    this.collapsed = localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true';
    await this.reload();
  }

  toggleCollapsed() {
    this.collapsed = !this.collapsed;
    localStorage.setItem(COLLAPSED_STORAGE_KEY, String(this.collapsed));
  }

  onMouseEnter() {
    this.hovering = true;
  }

  onMouseLeave() {
    this.hovering = false;
  }

  async reload() {
    this.loading = true;
    const slots = await this.electron.api.slots.list();
    this.ownSlot = slots.find((s) => s.kind === 'own');
    this.opponentSlots = slots.filter((s) => s.kind === 'opponent');
    this.loading = false;
  }
}
