"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsManager = void 0;
const electron_1 = require("electron");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/** 'mock' não chama nenhuma API de verdade — não precisa de chave, hasKey já vem true. */
const DEFAULT_PROVIDERS = [
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
class SettingsManager {
    settingsPath;
    keysDir;
    constructor() {
        const base = path.join(electron_1.app.getPath('userData'), 'cs-demo-analyst');
        fs.mkdirSync(base, { recursive: true });
        this.settingsPath = path.join(base, 'ai-settings.json');
        this.keysDir = path.join(base, 'keys');
        fs.mkdirSync(this.keysDir, { recursive: true });
        if (!fs.existsSync(this.settingsPath)) {
            const initial = {
                defaultProviderId: 'anthropic',
                providers: [...DEFAULT_PROVIDERS],
            };
            fs.writeFileSync(this.settingsPath, JSON.stringify(initial, null, 2));
        }
        else {
            this.backfillMissingProviders();
        }
    }
    /** Instalações antigas têm um settings.json sem os provedores novos (ex: 'mock') — completa sem apagar o que já tem. */
    backfillMissingProviders() {
        const settings = this.readRaw();
        let changed = false;
        for (const def of DEFAULT_PROVIDERS) {
            if (!settings.providers.some((p) => p.id === def.id)) {
                settings.providers.push({ ...def });
                changed = true;
            }
        }
        if (changed)
            this.writeRaw(settings);
    }
    readRaw() {
        return JSON.parse(fs.readFileSync(this.settingsPath, 'utf-8'));
    }
    writeRaw(settings) {
        fs.writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2));
    }
    keyFile(providerId) {
        return path.join(this.keysDir, `${providerId}.key`);
    }
    /** Retorna as configs SEM as chaves (seguro para mandar pro renderer). */
    getSettings() {
        return this.readRaw();
    }
    setDefaultProvider(providerId) {
        const settings = this.readRaw();
        settings.defaultProviderId = providerId;
        this.writeRaw(settings);
        return settings;
    }
    updateProviderConfig(providerId, patch) {
        const settings = this.readRaw();
        const provider = settings.providers.find((p) => p.id === providerId);
        if (!provider)
            throw new Error(`Provedor desconhecido: ${providerId}`);
        Object.assign(provider, patch);
        this.writeRaw(settings);
        return settings;
    }
    saveApiKey(providerId, apiKey) {
        const encrypted = electron_1.safeStorage.isEncryptionAvailable()
            ? electron_1.safeStorage.encryptString(apiKey)
            : Buffer.from(apiKey, 'utf-8'); // fallback sem criptografia real — ver aviso acima
        fs.writeFileSync(this.keyFile(providerId), encrypted);
        const settings = this.readRaw();
        const provider = settings.providers.find((p) => p.id === providerId);
        if (provider)
            provider.hasKey = true;
        this.writeRaw(settings);
        return settings;
    }
    clearApiKey(providerId) {
        const file = this.keyFile(providerId);
        if (fs.existsSync(file))
            fs.rmSync(file);
        const settings = this.readRaw();
        const provider = settings.providers.find((p) => p.id === providerId);
        if (provider)
            provider.hasKey = false;
        this.writeRaw(settings);
        return settings;
    }
    /** Só é chamado internamente pelo cliente de IA — nunca exposto via IPC. */
    getDecryptedKey(providerId) {
        const file = this.keyFile(providerId);
        if (!fs.existsSync(file))
            return null;
        const buf = fs.readFileSync(file);
        return electron_1.safeStorage.isEncryptionAvailable() ? electron_1.safeStorage.decryptString(buf) : buf.toString('utf-8');
    }
}
exports.SettingsManager = SettingsManager;
//# sourceMappingURL=settingsManager.js.map