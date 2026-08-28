import { Routes } from '@angular/router';
import { SlotDetailComponent } from './features/slot-detail/slot-detail.component';
import { AiSettingsComponent } from './features/ai-settings/ai-settings.component';

export const routes: Routes = [
  { path: 'slot/:id', component: SlotDetailComponent },
  { path: 'config-ia', component: AiSettingsComponent },
  { path: '', redirectTo: 'slot/own', pathMatch: 'full' },
];
