import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type ButtonVariant = 'Dark' | 'Light' | 'Green' | 'Realms' | 'Blue' | 'Yellow';

@Component({
  selector: 'app-button',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './button.component.html',
  styleUrls: ['./button.component.scss']
})
export class ButtonComponent {
  variant = input<ButtonVariant>('Dark');
}
