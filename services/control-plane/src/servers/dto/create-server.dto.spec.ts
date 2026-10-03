import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateServerDto, ServerType } from './create-server.dto';

async function serverTypeErrors(server_type: string): Promise<string[]> {
  const dto = plainToInstance(CreateServerDto, { server_type });
  const errors = await validate(dto);
  return errors.filter((e) => e.property === 'server_type').flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('CreateServerDto: server_type', () => {
  it('aceita PURPUR, previsto no assistente de criação (SRS 06, Tela 4)', async () => {
    expect(ServerType.PURPUR).toBe('PURPUR');
    expect(await serverTypeErrors('PURPUR')).toEqual([]);
  });

  it('continua recusando tipos desconhecidos', async () => {
    expect(await serverTypeErrors('SPIGOT')).not.toEqual([]);
  });
});
