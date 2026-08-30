import { Extension, type Editor, type Range } from '@tiptap/core';
import Suggestion, { type SuggestionProps, type SuggestionKeyDownProps } from '@tiptap/suggestion';

export interface SlashCommandItem {
  id: string;
  title: string;
  subtitle: string;
  keywords: string[];
  icon: string;
  run: (editor: Editor, range: Range) => void;
}

const ICON_H1 = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6v12M12 6v12M4 12h8"/><path d="M20 8v10M17 11l3-2v9"/></svg>';
const ICON_H2 = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6v12M12 6v12M4 12h8"/><path d="M16 10.5c0-1.4 1.1-2.5 2.5-2.5S21 9.1 21 10.5c0 1.8-2.2 2.6-5 5.5h5"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12.5l2.5 2.5L16 9.5"/></svg>';
const ICON_LIST = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/><path d="M9 6h11M9 12h11M9 18h11"/></svg>';
const ICON_CODE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 8l-5 4 5 4M15 8l5 4-5 4"/></svg>';
const ICON_QUOTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 8c-2.2 0-4 1.8-4 4v4h4v-4H5c0-1.1.9-2 2-2z"/><path d="M17 8c-2.2 0-4 1.8-4 4v4h4v-4h-2c0-1.1.9-2 2-2z"/></svg>';

export const SLASH_COMMAND_ITEMS: SlashCommandItem[] = [
  {
    id: 'h1',
    title: 'Título 1',
    subtitle: 'Seção principal da análise',
    keywords: ['h1', 'titulo', 'title', 'heading'],
    icon: ICON_H1,
    run: (editor, range) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run(),
  },
  {
    id: 'h2',
    title: 'Título 2',
    subtitle: 'Subseção',
    keywords: ['h2', 'subtitulo', 'subtitle', 'heading'],
    icon: ICON_H2,
    run: (editor, range) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run(),
  },
  {
    id: 'checklist',
    title: 'Checklist (Plano de Ação)',
    subtitle: 'Itens acionáveis de treino',
    keywords: ['checklist', 'todo', 'tarefa', 'plano', 'acao'],
    icon: ICON_CHECK,
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    id: 'list',
    title: 'Lista (Ponto)',
    subtitle: 'Pontos de análise',
    keywords: ['lista', 'list', 'bullet', 'ponto'],
    icon: ICON_LIST,
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    id: 'code',
    title: 'Código (Tático)',
    subtitle: 'Trecho tático / coordenadas',
    keywords: ['codigo', 'code', 'tatico', 'coordenadas'],
    icon: ICON_CODE,
    run: (editor, range) => editor.chain().focus().deleteRange(range).setCodeBlock().run(),
  },
  {
    id: 'quote',
    title: 'Citação (Observação)',
    subtitle: 'Observação situacional',
    keywords: ['citacao', 'quote', 'observacao'],
    icon: ICON_QUOTE,
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
];

function filterItems(query: string): SlashCommandItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_COMMAND_ITEMS;
  return SLASH_COMMAND_ITEMS.filter(
    (item) => item.title.toLowerCase().includes(q) || item.keywords.some((k) => k.includes(q)),
  );
}

class SlashMenuView {
  private el: HTMLDivElement;
  private items: SlashCommandItem[] = [];
  private selected = 0;
  private command: (item: SlashCommandItem) => void;
  private unmount?: () => void;

  constructor(props: SuggestionProps<SlashCommandItem>) {
    this.el = document.createElement('div');
    this.el.className = 'slash-menu';
    this.command = (item) => props.command(item as never);
    this.update(props);
    this.unmount = props.mount(this.el);
  }

  update(props: SuggestionProps<SlashCommandItem>) {
    this.items = props.items;
    this.selected = 0;
    this.render();
  }

  private render() {
    this.el.innerHTML = '';
    if (this.items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'slash-menu-empty';
      empty.textContent = 'Nenhum bloco encontrado';
      this.el.appendChild(empty);
      return;
    }

    this.items.forEach((item, index) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'slash-menu-item';
      row.classList.toggle('is-selected', index === this.selected);
      row.innerHTML = `
        <span class="slash-menu-icon">${item.icon}</span>
        <span class="slash-menu-text">
          <span class="slash-menu-title">${item.title}</span>
          <span class="slash-menu-subtitle">${item.subtitle}</span>
        </span>
      `;
      row.addEventListener('mousedown', (event) => {
        event.preventDefault();
        this.command(item);
      });
      row.addEventListener('mouseenter', () => {
        this.selected = index;
        this.render();
      });
      this.el.appendChild(row);
    });
  }

  onKeyDown({ event }: SuggestionKeyDownProps): boolean {
    if (this.items.length === 0) return false;

    if (event.key === 'ArrowDown') {
      this.selected = (this.selected + 1) % this.items.length;
      this.render();
      return true;
    }
    if (event.key === 'ArrowUp') {
      this.selected = (this.selected - 1 + this.items.length) % this.items.length;
      this.render();
      return true;
    }
    if (event.key === 'Enter') {
      this.command(this.items[this.selected]);
      return true;
    }
    if (event.key === 'Escape') {
      this.destroy();
      return true;
    }
    return false;
  }

  destroy() {
    this.unmount?.();
  }
}

export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        startOfLine: false,
        allow: ({ state, range }: { state: import('@tiptap/pm/state').EditorState; range: Range }) => {
          const $from = state.doc.resolve(range.from);
          return $from.parent.type.name === 'paragraph' && range.from === $from.start();
        },
        items: ({ query }: { query: string }) => filterItems(query),
        command: ({ editor, range, props }: { editor: Editor; range: Range; props: SlashCommandItem }) => {
          props.run(editor, range);
        },
        render: () => {
          let view: SlashMenuView | undefined;
          return {
            onStart: (props: SuggestionProps<SlashCommandItem>) => {
              view = new SlashMenuView(props);
            },
            onUpdate: (props: SuggestionProps<SlashCommandItem>) => {
              view?.update(props);
            },
            onKeyDown: (props: SuggestionKeyDownProps) => view?.onKeyDown(props) ?? false,
            onExit: () => {
              view?.destroy();
              view = undefined;
            },
          };
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options['suggestion'],
      }),
    ];
  },
});
