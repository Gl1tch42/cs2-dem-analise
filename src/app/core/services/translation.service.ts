import { Injectable, signal } from '@angular/core';
import { EN_TRANSLATIONS } from '../i18n/en';

export type AppLang = 'pt' | 'en';

const LANG_STORAGE_KEY = 'app-lang';

@Injectable({ providedIn: 'root' })
export class TranslationService {
  readonly lang = signal<AppLang>(this.readInitialLang());

  private readInitialLang(): AppLang {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    return stored === 'en' ? 'en' : 'pt';
  }

  setLang(lang: AppLang) {
    this.lang.set(lang);
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  }

  toggle() {
    this.setLang(this.lang() === 'pt' ? 'en' : 'pt');
  }

  /** Textos-fonte estão em pt-BR; em 'en' busca a tradução no dicionário e cai pro
   * texto original se a chave ainda não tiver sido traduzida. */
  t(key: string): string {
    if (this.lang() === 'pt') return key;
    return EN_TRANSLATIONS[key] ?? key;
  }
}
