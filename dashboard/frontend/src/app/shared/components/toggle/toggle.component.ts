import { Component, model } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-toggle',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './toggle.component.html',
  styleUrls: ['./toggle.component.scss']
})
export class ToggleComponent {
  // Angular v22 model for two-way data binding
  value = model<boolean>(false);

  toggle() {
    this.value.set(!this.value());
  }
}
