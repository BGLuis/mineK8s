import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type IconName = 'grid' | 'list' | 'play' | 'chevron' | 'more' | 'edit' | 'trash' | 'time' | 'pickaxe' | 'sword' | 'boots' | 'achievements' | 'dressing-room' | 'camera' | 'character' | 'square' | 'eye' | 'power' | 'world' | string;

@Component({
  selector: 'app-icon',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="mc-icon-container" [class]="'dir-' + direction()">
      <!-- Assume icons are stored in assets/icons/ -->
      <img [src]="'/assets/icons/' + name() + '.svg'" [alt]="name() + ' icon'" class="mc-icon-img" (error)="handleError($event)">
    </div>
  `,
  styles: [`
    :host {
      display: inline-block;
      width: 32px;
      height: 32px;
    }
    .mc-icon-container {
      width: 100%;
      height: 100%;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .mc-icon-img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    /* Direction rotations for chevron/eye etc */
    .dir-down .mc-icon-img { transform: rotate(90deg); }
    .dir-up .mc-icon-img { transform: rotate(-90deg); }
    .dir-left .mc-icon-img { transform: scaleX(-1); }
  `]
})
export class IconComponent {
  name = input<IconName>('grid');
  direction = input<'Default' | 'up' | 'down' | 'left' | 'right'>('Default');

  handleError(event: Event) {
    // Fallback if SVG not found
    const target = event.target as HTMLImageElement;
    target.style.display = 'none';
  }
}
