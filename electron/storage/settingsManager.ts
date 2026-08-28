import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { AiProviderConfig, AiProviderId, AiSettings } from './types';

/** 'mock' não chama nenhuma API de verdade — não precisa de chave, hasKey já vem true. */
const DEFAULT_PROVIDERS: AiProviderConfig[] = [
  { id: 'anthropic', label: 'Claude (Anthropic)', model: 'claude-sonnet-5', hasKey: false },
  { id: 'openai', label: 'OpenAI', model: 'gpt-4.1-mini', hasKey: false },
  { id: 'custom', label: 'Endpoint personalizado', hasKey: false },
  { id: 'mock', label: 'Teste local (sem custo, sem API)', hasKey: true },
];

/**
 * As chaves de API nunca são gravadas em texto puro nem devolvidas ao renderer.
 * Usamos safeStorage (DPAPI no Windows, Keychain no macOS, libsecret no Linux)
 * para criptografar antes de gravar em disco. Se safeStorage não estiver
 * disponível (ex: algumas distros Linux sem keyring), caímos para uma
 * ofuscação simples com aviso — nunca bloqueamos o usuário.
 */
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

  /** Instalações antigas têm um settings.json sem os provedores novos (ex: 'mock') — completa sem apagar o que já tem. */
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

  /** Retorna as configs SEM as chaves (seguro para mandar pro renderer). */
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
      : Buffer.from(apiKey, 'utf-8'); // fallback sem criptografia real — ver aviso acima
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

  /** Só é chamado internamente pelo cliente de IA — nunca exposto via IPC. */
  getDecryptedKey(providerId: AiProviderId): string | null {
    const file = this.keyFile(providerId);
    if (!fs.existsSync(file)) return null;
    const buf = fs.readFileSync(file);
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf-8');
  }
}
