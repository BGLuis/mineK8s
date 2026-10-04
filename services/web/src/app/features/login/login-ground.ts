import { ChangeDetectionStrategy, Component } from '@angular/core';

const BLOCK = 16;
const COLUMNS = 64;
const ROWS = 12;

/** Stepped surface height (in blocks) per column; a pit in the middle frames the card. */
const SURFACE = Array.from({ length: COLUMNS }, (_, column) => {
  const edge = Math.min(column, COLUMNS - 1 - column);
  if (edge < 6) {
    return 7;
  }
  if (edge < 14) {
    return 5;
  }
  return 3;
});

/** Deterministic scatter so the ground looks speckled without any randomness at render time. */
function speckles(): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];
  let seed = 7;
  for (let column = 0; column < COLUMNS; column++) {
    for (let row = ROWS - SURFACE[column] + 1; row < ROWS; row++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      if (seed % 7 === 0) {
        cells.push({ x: column * BLOCK, y: row * BLOCK });
      }
    }
  }
  return cells;
}

/** Decorative dark-stone strip along the bottom of the login screen. */
@Component({
  selector: 'mc-login-ground',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block overflow-hidden' },
  template: `
    <svg
      class="block h-full w-full"
      aria-hidden="true"
      shape-rendering="crispEdges"
      preserveAspectRatio="xMidYMax slice"
      [attr.viewBox]="'0 0 ' + width + ' ' + height"
    >
      @for (height of surface; track $index) {
        <rect
          class="fill-bg-sunken"
          [attr.x]="$index * block"
          [attr.y]="rows * block - height * block"
          [attr.width]="block"
          [attr.height]="height * block"
        />
        <rect
          class="fill-border-default"
          [attr.x]="$index * block"
          [attr.y]="rows * block - height * block"
          [attr.width]="block"
          [attr.height]="4"
        />
      }
      @for (cell of cells; track $index) {
        <rect class="fill-surface-default" [attr.x]="cell.x" [attr.y]="cell.y" [attr.width]="block" [attr.height]="block" />
      }
    </svg>
  `,
})
export class LoginGround {
  protected readonly block = BLOCK;
  protected readonly rows = ROWS;
  protected readonly width = COLUMNS * BLOCK;
  protected readonly height = ROWS * BLOCK;
  protected readonly surface = SURFACE;
  protected readonly cells = speckles();
}
