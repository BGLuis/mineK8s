import { visiblePoll } from './visible-poll';

describe('visiblePoll', () => {
  let visibility: ReturnType<typeof vi.spyOn>;

  const setVisibility = (state: 'visible' | 'hidden') => {
    visibility.mockReturnValue(state);
    document.dispatchEvent(new Event('visibilitychange'));
  };

  beforeEach(() => {
    vi.useFakeTimers();
    visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  });

  afterEach(() => {
    visibility.mockRestore();
    vi.useRealTimers();
  });

  it('ticks at once and then on every interval while visible', () => {
    const ticks: number[] = [];
    const sub = visiblePoll(10_000).subscribe((n) => ticks.push(n));

    vi.advanceTimersByTime(0);
    vi.advanceTimersByTime(20_000);
    sub.unsubscribe();

    expect(ticks).toHaveLength(3);
  });

  it('stops while the tab is hidden and refreshes immediately when it comes back', () => {
    const ticks: number[] = [];
    const sub = visiblePoll(10_000).subscribe((n) => ticks.push(n));
    vi.advanceTimersByTime(0);

    setVisibility('hidden');
    vi.advanceTimersByTime(60_000);
    expect(ticks).toHaveLength(1);

    setVisibility('visible');
    vi.advanceTimersByTime(0);
    sub.unsubscribe();

    expect(ticks).toHaveLength(2);
  });
});
