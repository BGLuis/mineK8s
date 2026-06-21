import { Component, input, model } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../icon/icon.component';

export type InputVariant = 'Default' | 'Password' | 'Select' | 'Search';

@Component({
  selector: 'app-input',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './input.component.html',
  styleUrls: ['./input.component.scss']
})
export class InputComponent {
  variant = input<InputVariant>('Default');
  placeholder = input<string>('Search');
  
  // Model input for 2-way binding in Angular v22
  value = model<string>('');

  showPassword = false;

  onInput(event: Event) {
    const target = event.target as HTMLInputElement;
    this.value.set(target.value);
  }

  togglePassword() {
    this.showPassword = !this.showPassword;
  }
}
