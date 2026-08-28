import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { AiProviderConfig, AiProviderId, AiSettings } from './types';

const DEFAULT_PROVIDERS: AiProviderConfig[] = [
  { id: 'anthropic', label: 'Claude (Anthropic)', model: 'claude-sonnet-5', hasKey: false },
  { id: 'openai', label: 'OpenAI', model: 'gpt-4.1-mini', hasKey: false },
  { id: 'custom', label: 'Endpoint personalizado', hasKey: false },
  { id: 'mock', label: 'Teste local (sem custo, sem API)', hasKey: true },
];

export class SettingsManager {
  private readonly settingsPath: string;
  private readonly keysDir: string;

  constructor() {
    const base = path.join(app.getPath('userData'), 'cs-demo-analyst');
    fs.mkdirSync(base, { recursive: true });
    this.settingsPath = path.join(base, 'ai-settings.json');
    this.keysDir = path.join(base, 'keys');
    fs.mkdirSync(this.keysDir, { recursive: true });
    if (!fs.existsSync(this.settingsPath)) {
      const initial: AiSettings = {
        defaultProviderId: 'anthropic',
        providers: [...DEFAULT_PROVIDERS],
      };
      fs.writeFileSync(this.settingsPath, JSON.stringify(initial, null, 2));
    } else {
      this.backfillMissingProviders();
    }
  }

  private backfillMissingProviders() {
    const settings = this.readRaw();
    let changed = false;
    for (const def of DEFAULT_PROVIDERS) {
      if (!settings.providers.some((p) => p.id === def.id)) {
        settings.providers.push({ ...def });
        changed = true;
      }
    }
    if (changed) this.writeRaw(settings);
  }

  private readRaw(): AiSettings {
    return JSON.parse(fs.readFileSync(this.settingsPath, 'utf-8'));
  }

  private writeRaw(settings: AiSettings) {
    fs.writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2));
  }

  private keyFile(providerId: AiProviderId) {
    return path.join(this.keysDir, `${providerId}.key`);
  }

  getSettings(): AiSettings {
    return this.readRaw();
  }

  setDefaultProvider(providerId: AiProviderId): AiSettings {
    const settings = this.readRaw();
    settings.defaultProviderId = providerId;
    this.writeRaw(settings);
    return settings;
  }

  updateProviderConfig(providerId: AiProviderId, patch: Partial<Pick<AiProviderConfig, 'label' | 'endpoint' | 'model'>>): AiSettings {
    const settings = this.readRaw();
    const provider = settings.providers.find((p) => p.id === providerId);
    if (!provider) throw new Error(`Provedor desconhecido: ${providerId}`);
    Object.assign(provider, patch);
    this.writeRaw(settings);
    return settings;
  }

  saveApiKey(providerId: AiProviderId, apiKey: string): AiSettings {
    const encrypted = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(apiKey)
      : Buffer.from(apiKey, 'utf-8');
    fs.writeFileSync(this.keyFile(providerId), encrypted);

    const settings = this.readRaw();
    const provider = settings.providers.find((p) => p.id === providerId);
    if (provider) provider.hasKey = true;
    this.writeRaw(settings);
    return settings;
  }

  clearApiKey(providerId: AiProviderId): AiSettings {
    const file = this.keyFile(providerId);
    if (fs.existsSync(file)) fs.rmSync(file);
    const settings = this.readRaw();
    const provider = settings.providers.find((p) => p.id === providerId);
    if (provider) provider.hasKey = false;
    this.writeRaw(settings);
    return settings;
  }

  getDecryptedKey(providerId: AiProviderId): string | null {
    const file = this.keyFile(providerId);
    if (!fs.existsSync(file)) return null;
    const buf = fs.readFileSync(file);
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf-8');
  }
}
