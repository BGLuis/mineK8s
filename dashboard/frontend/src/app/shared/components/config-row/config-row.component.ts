import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-config-row',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './config-row.component.html',
  styleUrls: ['./config-row.component.scss']
})
export class ConfigRowComponent {
  label = input<string>('Option');
}
