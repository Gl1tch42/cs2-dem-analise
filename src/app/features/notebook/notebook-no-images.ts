import { Extension } from '@tiptap/core';
import type MarkdownIt from 'markdown-it';

/**
 * Notas do notebook viram contexto de texto para a IA — imagens não têm uso ali.
 * Desliga a regra de imagem do markdown-it (sintaxe ![alt](url) vira texto literal)
 * e bloqueia paste/drop de arquivos de imagem antes que cheguem ao editor.
 */
export const NoImages = Extension.create({
  name: 'noImages',

  addStorage() {
    return {
      markdown: {
        parse: {
          setup(md: MarkdownIt) {
            md.disable('image');
          },
        },
      },
    };
  },
});

export function hasImageFile(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.files ?? []).some((file) => file.type.startsWith('image/'));
}
