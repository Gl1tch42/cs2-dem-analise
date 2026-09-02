import { Pipe, PipeTransform, inject } from '@angular/core';
import { TranslationService } from '../../core/services/translation.service';

@Pipe({
  name: 'translate',
  standalone: true,
  pure: false,
})
export class TranslatePipe implements PipeTransform {
  private translation = inject(TranslationService);

  transform(value: string | null | undefined): string {
    if (!value) return '';
    return this.translation.t(value);
  }
}
