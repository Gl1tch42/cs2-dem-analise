import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  ViewEncapsulation,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Markdown } from 'tiptap-markdown';
import { ElectronService } from '../../core/services/electron.service';
import { SlashCommand } from './notebook-slash-command';
import { NoImages, hasImageFile } from './notebook-no-images';
import { TranslationService } from '../../core/services/translation.service';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';

const SAVE_DEBOUNCE_MS = 300;

@Component({
  selector: 'app-notebook',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './notebook.component.html',
  styleUrl: './notebook.component.scss',
  encapsulation: ViewEncapsulation.None,
})
export class NotebookComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input({ required: true }) slotId!: string;
  @Input() initialContent = '';
  @Output() contentSaved = new EventEmitter<string>();

  @ViewChild('editorHost') editorHost!: ElementRef<HTMLDivElement>;

  status: 'idle' | 'saving' | 'saved' = 'idle';

  historyOpen = false;
  historyLoading = false;
  historyError = '';
  historyEntries: { timestamp: string; label: string }[] = [];

  private editor?: Editor;
  private saveTimer?: ReturnType<typeof setTimeout>;
  private viewReady = false;
  private loadedSlotId?: string;

  constructor(private electron: ElectronService, private translation: TranslationService) {}

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.mountEditor();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.viewReady && changes['slotId'] && this.slotId !== this.loadedSlotId) {
      this.mountEditor();
    }
  }

  private mountEditor() {
    if (this.loadedSlotId === this.slotId && this.editor) return;
    this.editor?.destroy();
    this.loadedSlotId = this.slotId;
    this.editor = new Editor({
      element: this.editorHost.nativeElement,
      extensions: [
        StarterKit,
        TaskList,
        TaskItem.configure({ nested: false }),
        NoImages,
        SlashCommand,
        Placeholder.configure({
          placeholder: this.translation.t(
            'Ex: time joga muito rush B no pistol, mas quase sempre com pouco cross-fire de A. Rifler 2 costuma isolar cedo demais no retake... Digite "/" para inserir um bloco.'
          ),
        }),
        Markdown.configure({ html: false, transformPastedText: true }),
      ],
      content: this.initialContent,
      editorProps: {
        handleDrop: (_view, event) => {
          if (!hasImageFile(event.dataTransfer)) return false;
          event.preventDefault();
          return true;
        },
        handlePaste: (_view, event) => {
          if (!hasImageFile(event.clipboardData)) return false;
          event.preventDefault();
          return true;
        },
      },
      onUpdate: () => this.onEdit(),
      onBlur: () => this.save(),
    });
  }

  onEdit() {
    this.status = 'idle';
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), SAVE_DEBOUNCE_MS);
  }

  /** Insere um marcador em negrito (ex: "[de_dust2 · R7 · 12.3s]") como novo parágrafo no
   * fim do notebook e deixa o cursor logo depois, pronto pra digitar a observação. Usado
   * pelo Mapa 2D pra marcar o momento do replay sem sair da tela do replay. */
  insertMarker(label: string) {
    if (!this.editor) return;
    this.editor
      .chain()
      .focus('end')
      .insertContent({
        type: 'paragraph',
        content: [
          { type: 'text', marks: [{ type: 'bold' }], text: label },
          { type: 'text', text: ' ' },
        ],
      })
      .run();
    this.onEdit();
  }

  async save() {
    if (!this.editor) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.status = 'saving';
    const markdown = (this.editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown();
    await this.electron.api.slots.saveNotebook(this.slotId, markdown);
    this.status = 'saved';
    this.contentSaved.emit(markdown);
  }

  async toggleHistory() {
    this.historyOpen = !this.historyOpen;
    if (!this.historyOpen) return;
    this.historyLoading = true;
    this.historyError = '';
    try {
      const entries = await this.electron.api.slots.listNotebookHistory(this.slotId);
      const locale = this.translation.lang() === 'en' ? 'en-US' : 'pt-BR';
      this.historyEntries = entries.map((e) => ({
        timestamp: e.timestamp,
        label: new Date(e.timestamp).toLocaleString(locale),
      }));
    } catch (err) {
      this.historyError = (err as Error).message ?? this.translation.t('Falha ao carregar histórico do notebook.');
    } finally {
      this.historyLoading = false;
    }
  }

  async restoreHistory(timestamp: string) {
    if (!this.editor) return;
    const ok = confirm(
      this.translation.t(
        'Restaurar essa versão substitui o conteúdo atual do notebook (a versão atual também vira um checkpoint no histórico). Continuar?'
      )
    );
    if (!ok) return;
    try {
      const restored = await this.electron.api.slots.restoreNotebookHistory(this.slotId, timestamp);
      this.editor.commands.setContent(restored.content);
      this.status = 'saved';
      this.historyOpen = false;
      this.contentSaved.emit(restored.content);
    } catch (err) {
      this.historyError = (err as Error).message ?? this.translation.t('Falha ao restaurar versão.');
    }
  }

  ngOnDestroy(): void {
    const hadPendingEdit = !!this.saveTimer;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (hadPendingEdit) this.save();
    this.editor?.destroy();
  }
}
