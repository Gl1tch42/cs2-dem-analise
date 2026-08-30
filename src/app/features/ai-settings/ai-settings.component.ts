import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ElectronService } from '../../core/services/electron.service';
import { AiSettings, AiProviderId } from '../../core/models/slot.model';

const PROVIDER_ICONS: Record<AiProviderId, string> = {
  anthropic: '✳',
  openai: '◈',
  custom: '⚡',
  mock: '🖥',
};

@Component({
  selector: 'app-ai-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ai-settings.component.html',
  styleUrl: './ai-settings.component.scss',
})
export class AiSettingsComponent implements OnInit {
  settings?: AiSettings;
  loading = true;
  keyDrafts: Record<string, string> = {};
  savingKeyFor: string | null = null;

  constructor(private electron: ElectronService) {}

  async ngOnInit() {
    await this.reload();
  }

  async reload() {
    this.loading = true;
    this.settings = await this.electron.api.ai.getSettings();
    this.loading = false;
  }

  async setDefault(providerId: AiProviderId) {
    this.settings = await this.electron.api.ai.setDefaultProvider(providerId);
  }

  async saveModel(providerId: AiProviderId, model: string) {
    this.settings = await this.electron.api.ai.updateProviderConfig(providerId, { model });
  }

  async saveEndpoint(providerId: AiProviderId, endpoint: string) {
    this.settings = await this.electron.api.ai.updateProviderConfig(providerId, { endpoint });
  }

  async saveKey(providerId: AiProviderId) {
    const key = this.keyDrafts[providerId];
    if (!key) return;
    this.savingKeyFor = providerId;
    this.settings = await this.electron.api.ai.saveApiKey(providerId, key);
    this.keyDrafts[providerId] = '';
    this.savingKeyFor = null;
  }

  async clearKey(providerId: AiProviderId) {
    this.settings = await this.electron.api.ai.clearApiKey(providerId);
  }

  isDefault(providerId: AiProviderId): boolean {
    return this.settings?.defaultProviderId === providerId;
  }

  iconFor(providerId: AiProviderId): string {
    return PROVIDER_ICONS[providerId] ?? '◇';
  }

  tagLabel(providerId: AiProviderId, hasKey: boolean): string {
    if (providerId === 'mock') return 'sempre disponível';
    return hasKey ? 'chave salva' : 'sem chave';
  }
}
