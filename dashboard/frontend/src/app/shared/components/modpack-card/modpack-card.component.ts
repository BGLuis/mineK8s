import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../icon/icon.component';

export interface ModpackInfo {
  name: string;
  author: string;
  description: string;
  coverUrl?: string;
  updatedAt: Date | string | number;
  version: string;
  loader: string;
}

@Component({
  selector: 'app-modpack-card',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './modpack-card.component.html',
  styleUrls: ['./modpack-card.component.scss']
})
export class ModpackCardComponent {
  modpack = input<ModpackInfo>({
    name: 'All the Mods 10 - ATM10',
    author: 'AtM Team',
    description: 'The top pack of 2025 with around 500 mods! Tons of quests and a proper endgame.',
    updatedAt: new Date('2026-05-15'),
    version: '1.21.1',
    loader: 'NeoForge'
  });

  handleCoverError(event: Event) {
    const img = event.target as HTMLImageElement;
    img.src = '/assets/images/default-modpack.png'; // Fallback
  }
}
