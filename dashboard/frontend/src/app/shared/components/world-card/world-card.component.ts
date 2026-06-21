import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../icon/icon.component';

export interface WorldInfo {
  id: string;
  name: string;
  imageUrl?: string;
  status: 'running' | 'stopped' | 'starting';
}

@Component({
  selector: 'app-world-card',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './world-card.component.html',
  styleUrls: ['./world-card.component.scss']
})
export class WorldCardComponent {
  world = input<WorldInfo>({
    id: '1',
    name: 'All the Mods 10 - ATM10',
    status: 'stopped'
  });

  // Angular v22 output function
  togglePower = output<void>();
  delete = output<void>();

  handleImageError(event: Event) {
    const img = event.target as HTMLImageElement;
    img.src = '/assets/images/default-world.png';
  }
}
