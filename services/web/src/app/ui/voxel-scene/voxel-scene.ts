import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

const BLOCK = 16;
const COLUMNS = 24;
const ROWS = 12;

type Fill = 'sky' | 'sky-light' | 'cloud' | 'grass' | 'grass-dark' | 'dirt' | 'dirt-dark';

const FILL_VARS: Record<Fill, string> = {
  sky: 'var(--color-scene-sky)',
  'sky-light': 'var(--color-scene-sky-light)',
  cloud: 'var(--color-scene-cloud)',
  grass: 'var(--color-scene-grass)',
  'grass-dark': 'var(--color-scene-grass-dark)',
  dirt: 'var(--color-scene-dirt)',
  'dirt-dark': 'var(--color-scene-dirt-dark)',
};

/** Surface height (in blocks, from the bottom) for each column, three variations. */
const HILLS: readonly (readonly number[])[] = [
  [3, 3, 3, 4, 4, 4, 5, 5, 5, 4, 4, 3, 3, 3, 4, 4, 5, 5, 4, 4, 3, 3, 3, 3],
  [4, 4, 3, 3, 3, 4, 4, 5, 5, 4, 4, 4, 3, 3, 4, 4, 4, 5, 5, 5, 4, 3, 3, 4],
  [3, 4, 4, 5, 5, 4, 3, 3, 3, 3, 4, 4, 5, 5, 5, 4, 4, 3, 3, 4, 4, 4, 3, 3],
];
const TREE_COLUMNS: readonly (readonly number[])[] = [
  [3, 11, 19],
  [2, 10, 20],
  [5, 12, 18],
];
const CLOUDS: readonly (readonly [number, number])[] = [
  [3, 1],
  [4, 1],
  [5, 1],
  [4, 0],
  [14, 2],
  [15, 2],
  [16, 2],
  [15, 1],
  [20, 0],
  [21, 0],
];
const SUN: readonly (readonly [number, number])[] = [
  [9, 0],
  [10, 0],
  [9, 1],
  [10, 1],
];

/** Pure scene builder: returns one SVG path per fill colour, made of 16 px unit squares. */
export function buildScene(variant: number): { fill: string; path: string }[] {
  const index = ((variant % HILLS.length) + HILLS.length) % HILLS.length;
  const heights = HILLS[index];
  const cells: [number, number, Fill][] = [];

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLUMNS; x++) {
      cells.push([x, y, y >= ROWS - 8 ? 'sky-light' : 'sky']);
    }
  }
  for (const [x, y] of [...CLOUDS, ...SUN]) {
    cells.push([x, y, 'cloud']);
  }
  heights.forEach((height, x) => {
    const top = ROWS - height;
    for (let y = top; y < ROWS; y++) {
      const fill: Fill =
        y === top
          ? 'grass'
          : y === top + 1
            ? 'grass-dark'
            : (x + y) % 2 === 0
              ? 'dirt'
              : 'dirt-dark';
      cells.push([x, y, fill]);
    }
  });
  for (const x of TREE_COLUMNS[index]) {
    const top = ROWS - heights[x];
    cells.push([x, top - 1, 'dirt-dark'], [x, top - 2, 'dirt-dark']);
    for (let dx = -1; dx <= 1; dx++) {
      cells.push([x + dx, top - 3, 'grass-dark'], [x + dx, top - 4, 'grass-dark']);
    }
    cells.push([x, top - 5, 'grass-dark']);
  }

  const byFill = new Map<Fill, string>();
  const seen = new Set<string>();
  for (const [x, y, fill] of cells.reverse()) {
    const key = `${x},${y}`;
    if (x < 0 || x >= COLUMNS || y < 0 || seen.has(key)) {
      continue;
    }
    seen.add(key);
    byFill.set(
      fill,
      `${byFill.get(fill) ?? ''}M${x * BLOCK} ${y * BLOCK}h${BLOCK}v${BLOCK}h-${BLOCK}z`,
    );
  }
  return [...byFill].map(([fill, path]) => ({ fill: FILL_VARS[fill], path }));
}

/** Decorative voxel landscape drawn with 16 px blocks. Scales to cover its container. */
@Component({
  selector: 'mc-voxel-scene',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block overflow-hidden', '[style.aspect-ratio]': '"2 / 1"' },
  template: `
    <svg
      class="block h-full w-full"
      xmlns="http://www.w3.org/2000/svg"
      shape-rendering="crispEdges"
      preserveAspectRatio="xMidYMax slice"
      [attr.viewBox]="'0 0 ' + width + ' ' + height"
      [attr.role]="label() ? 'img' : null"
      [attr.aria-label]="label() || null"
      [attr.aria-hidden]="label() ? null : 'true'"
    >
      @for (layer of layers(); track layer.fill) {
        <path [style.fill]="layer.fill" [attr.d]="layer.path" />
      }
    </svg>
  `,
})
export class McVoxelScene {
  /** Picks one of three terrain layouts so neighbouring cards do not look identical. */
  readonly variant = input(0);
  readonly label = input('');

  protected readonly width = COLUMNS * BLOCK;
  protected readonly height = ROWS * BLOCK;
  protected readonly layers = computed(() => buildScene(this.variant()));
}
