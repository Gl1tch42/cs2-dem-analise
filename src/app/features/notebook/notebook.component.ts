import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
  ViewEncapsulation,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from 'tiptap-markdown';
import { ElectronService } from '../../core/services/electron.service';

@Component({
  selector: 'app-notebook',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './notebook.component.html',
  styleUrl: './notebook.component.scss',
  encapsulation: ViewEncapsulation.None,
})
export class NotebookComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input({ required: true }) slotId!: string;
  @Input() initialContent = '';

  @ViewChild('editorHost') editorHost!: ElementRef<HTMLDivElement>;

  status: 'idle' | 'saving' | 'saved' = 'idle';

  private editor?: Editor;
  private saveTimer?: ReturnType<typeof setTimeout>;
  private viewReady = false;
  private loadedSlotId?: string;

  constructor(private electron: ElectronService) {}

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
        Placeholder.configure({
          placeholder:
            'Ex: time joga muito rush B no pistol, mas quase sempre com pouco cross-fire de A. Rifler 2 costuma isolar cedo demais no retake...',
        }),
        Markdown.configure({ html: false, transformPastedText: true }),
      ],
      content: this.initialContent,
      onUpdate: () => this.onEdit(),
    });
  }

  onEdit() {
    this.status = 'idle';
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 800);
  }

  async save() {
    if (!this.editor) return;
    this.status = 'saving';
    const markdown = (this.editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown();
    await this.electron.api.slots.saveNotebook(this.slotId, markdown);
    this.status = 'saved';
  }

  ngOnDestroy(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.editor?.destroy();
  }
}
