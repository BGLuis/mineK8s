import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { ServersApi } from '../../../core/api/servers.api';
import { ToastService } from '../../../ui';
import { SERVER_ICON_ENCODER } from './server-icon';
import { ServerIconPanel } from './server-icon-panel';

describe('ServerIconPanel', () => {
  let api: {
    icon: ReturnType<typeof vi.fn>;
    setIcon: ReturnType<typeof vi.fn>;
    removeIcon: ReturnType<typeof vi.fn>;
  };
  let toast: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let encode: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<ServerIconPanel>;
  let el: HTMLElement;
  let created: string[];
  let revoked: string[];

  const png = (name = 'a') => new Blob([name], { type: 'image/png' });
  const button = (label: string) =>
    Array.from(el.querySelectorAll('button')).find((b) =>
      b.textContent?.includes(label),
    ) as HTMLButtonElement;
  const image = () => el.querySelector('img');

  async function render(existing: Blob | null) {
    api = {
      icon: vi.fn(() => (existing ? of(existing) : throwError(() => ({ status: 404 })))),
      setIcon: vi.fn(() => of({ message: 'ok' })),
      removeIcon: vi.fn(() => of({ message: 'ok' })),
    };
    toast = { success: vi.fn(), error: vi.fn() };
    encode = vi.fn(async (file: File) => png(`converted-${file.name}`));
    created = [];
    revoked = [];
    let count = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      const url = `blob:icon-${count++}`;
      created.push(url);
      return url;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => void revoked.push(url));

    TestBed.configureTestingModule({
      providers: [
        { provide: ServersApi, useValue: api },
        { provide: ToastService, useValue: toast },
        { provide: SERVER_ICON_ENCODER, useValue: encode },
      ],
    });
    fixture = TestBed.createComponent(ServerIconPanel);
    fixture.componentRef.setInput('serverId', 'srv-1');
    el = fixture.nativeElement;
    await fixture.whenStable();
  }

  async function pick(name: string) {
    const input = el.querySelector('input[type=file]') as HTMLInputElement;
    const file = new File(['x'], name, { type: 'image/jpeg' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();
  }

  const dropEvent = (type: 'dragover' | 'drop', files: File[] = []) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files } });
    return event;
  };
  const dropZone = () => el.querySelector('.border-dashed') as HTMLElement;

  afterEach(() => vi.restoreAllMocks());

  it('shows the icon the server already has', async () => {
    await render(png());

    expect(api.icon).toHaveBeenCalledWith('srv-1');
    expect(image()?.getAttribute('src')).toBe('blob:icon-0');
    expect(button('Remover').disabled).toBe(false);
  });

  it('shows a placeholder for a server without an icon, and nothing to remove', async () => {
    await render(null);

    expect(image()).toBeNull();
    expect(el.textContent).toContain('Sem ícone');
    expect(button('Remover').disabled).toBe(true);
    expect(button('Enviar').disabled).toBe(true);
  });

  it('has a visible button that opens the file picker, since the native control is hard to see on the dark theme', async () => {
    await render(null);
    const input = el.querySelector('input[type=file]') as HTMLInputElement;
    const open = vi.spyOn(input, 'click');

    button('Escolher imagem').click();

    expect(open).toHaveBeenCalledTimes(1);
    expect(el.textContent).toContain('Nenhuma imagem escolhida');
  });

  it('shows the name of the chosen file next to the button', async () => {
    await render(null);

    await pick('foto-do-mundo.jpg');

    expect(el.textContent).toContain('foto-do-mundo.jpg');
  });

  it('previews the converted image and sends that one, not the original file', async () => {
    await render(null);

    await pick('foto.jpg');

    expect(encode).toHaveBeenCalledTimes(1);
    expect(image()?.getAttribute('src')).toBe('blob:icon-0');
    expect(button('Enviar').disabled).toBe(false);

    button('Enviar').click();
    await fixture.whenStable();

    const [id, sent] = api.setIcon.mock.calls[0];
    expect(id).toBe('srv-1');
    expect(await (sent as Blob).text()).toBe('converted-foto.jpg');
    expect(toast.success).toHaveBeenCalled();
    expect(button('Enviar').disabled).toBe(true);
    expect(button('Remover').disabled).toBe(false);
    expect(revoked).toEqual([]);
  });

  it('accepts an image dropped on the panel, and does not let the browser open it instead', async () => {
    await render(null);
    const over = dropEvent('dragover');
    dropZone().dispatchEvent(over);
    await fixture.whenStable();
    expect(over.defaultPrevented).toBe(true);
    expect(dropZone().className).toContain('border-action-primary');

    const drop = dropEvent('drop', [new File(['x'], 'arrastada.png', { type: 'image/png' })]);
    dropZone().dispatchEvent(drop);
    await fixture.whenStable();

    expect(drop.defaultPrevented).toBe(true);
    expect(encode).toHaveBeenCalledTimes(1);
    expect(el.textContent).toContain('arrastada.png');
    expect(dropZone().className).not.toContain('border-action-primary');
    expect(button('Enviar').disabled).toBe(false);
  });

  it('refuses a dropped file that is not an image', async () => {
    await render(null);

    dropZone().dispatchEvent(
      dropEvent('drop', [new File(['x'], 'notas.txt', { type: 'text/plain' })]),
    );
    await fixture.whenStable();

    expect(encode).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('não é uma imagem'));
  });

  it('accepts an image pasted from the clipboard, such as a screenshot', async () => {
    await render(null);
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: { files: [new File(['x'], 'captura.png', { type: 'image/png' })] },
    });

    document.dispatchEvent(paste);
    await fixture.whenStable();

    expect(encode).toHaveBeenCalledTimes(1);
    expect(el.textContent).toContain('captura.png');
  });

  it('ignores a paste that carries no image, so ordinary text pasting keeps working', async () => {
    await render(null);
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { files: [] } });

    document.dispatchEvent(paste);
    await fixture.whenStable();

    expect(encode).not.toHaveBeenCalled();
    expect(paste.defaultPrevented).toBe(false);
  });

  it('frees the previous preview when another image is picked', async () => {
    await render(null);

    await pick('um.jpg');
    await pick('dois.jpg');

    expect(revoked).toEqual(['blob:icon-0']);
    expect(image()?.getAttribute('src')).toBe('blob:icon-1');
  });

  it('keeps the preview and reports the reason when the upload fails', async () => {
    await render(null);
    api.setIcon.mockReturnValue(
      throwError(() => ({ error: { message: 'The icon must be a PNG image' } })),
    );
    await pick('foto.jpg');

    button('Enviar').click();
    await fixture.whenStable();

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Não foi possível enviar'));
    expect(button('Enviar').disabled).toBe(false);
  });

  it('removes the icon from the server and clears the picture', async () => {
    await render(png());

    button('Remover').click();
    await fixture.whenStable();

    expect(api.removeIcon).toHaveBeenCalledWith('srv-1');
    expect(image()).toBeNull();
    expect(revoked).toEqual(['blob:icon-0']);
  });

  it('tells the admin when the picked file is not a readable image', async () => {
    await render(null);
    encode.mockRejectedValue(new Error('invalid image'));

    await pick('texto.txt');

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('ler essa imagem'));
    expect(button('Enviar').disabled).toBe(true);
  });

  it('frees every object URL when the panel goes away', async () => {
    await render(png());
    await pick('foto.jpg');

    fixture.destroy();

    expect(revoked.sort()).toEqual(created.sort());
  });
});
