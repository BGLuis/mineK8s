import { CommonModule } from '@angular/common';
import { Component, input } from '@angular/core';
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
	styleUrls: ['./modpack-card.component.scss'],
})
export class ModpackCardComponent {
	modpack = input<ModpackInfo>({
		name: 'All the Mods 10 - ATM10',
		author: 'AtM Team',
		description:
			'The top pack of 2025 with around 500 mods! Tons of quests and a proper endgame.',
		updatedAt: new Date('2026-05-15'),
		version: '1.21.1',
		loader: 'NeoForge',
	});

	handleCoverError(event: Event) {
		const img = event.target as HTMLImageElement;
		if (!img.src.includes('default-modpack.png')) {
			img.src = '/assets/images/default-modpack.png'; // Fallback
		} else {
			// Se a imagem de fallback não existir, usa um placeholder gerado
			img.src =
				'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="%23cccccc"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="14" fill="%23666666">No Image</text></svg>';
		}
	}
}
