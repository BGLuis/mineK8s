import { Component, input, model } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-collapsible-block',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './collapsible-block.component.html',
  styleUrls: ['./collapsible-block.component.scss']
})
export class CollapsibleBlockComponent {
  title = input<string>('Options');
  isOpen = model<boolean>(false);

  toggle() {
    this.isOpen.set(!this.isOpen());
  }
}
