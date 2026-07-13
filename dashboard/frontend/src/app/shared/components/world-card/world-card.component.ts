import { CommonModule } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

export interface WorldInfo {
	id: string;
	name: string;
	imageUrl?: string;
	url?: string;
	status:
		| 'running'
		| 'stopped'
		| 'starting'
		| 'Online'
		| 'Offline'
		| 'Iniciando'
		| 'Desligado';
}

@Component({
	selector: 'app-world-card',
	standalone: true,
	imports: [CommonModule, IconComponent],
	templateUrl: './world-card.component.html',
	styleUrls: ['./world-card.component.scss'],
})
export class WorldCardComponent {
	world = input<WorldInfo>({
		id: '1',
		name: 'All the Mods 10 - ATM10',
		status: 'stopped',
	});

	// Angular v22 output function
	togglePower = output<void>();
	delete = output<void>();

	handleImageError(event: Event) {
		const img = event.target as HTMLImageElement;
		if (!img.src.includes('default-world.png')) {
			img.src = '/assets/images/default-world.png';
		} else {
			img.src =
				'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="%23cccccc"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="14" fill="%23666666">No Image</text></svg>';
		}
	}
}
