import { Directive } from '@angular/core';

/** Applies the dense data-table styles (src/styles/table.css). Tables use Inter, never pixel fonts. */
@Directive({
  selector: 'table[mc-table]',
  host: { class: 'mc-table' },
})
export class McTable {}
