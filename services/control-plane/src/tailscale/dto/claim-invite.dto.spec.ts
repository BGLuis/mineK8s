import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ClaimInviteDto } from './claim-invite.dto';

async function nickErrors(minecraftNick: string): Promise<string[]> {
  const dto = plainToInstance(ClaimInviteDto, {
    token: 'd9b73f8a0e2c418fb263914a87e50c4f',
    realName: 'Lucas Henrique',
    minecraftNick,
  });
  const errors = await validate(dto);
  return errors.filter((e) => e.property === 'minecraftNick').flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('ClaimInviteDto: nickname canônico C-06 (3 a 16)', () => {
  it('recusa nick de 2 caracteres, que o Minecraft aceita mas o projeto não', async () => {
    expect(await nickErrors('ab')).toEqual([expect.stringContaining('3 to 16')]);
  });

  it.each(['abc', 'Lucas_Craft', 'a'.repeat(16)])('aceita %s', async (nick) => {
    expect(await nickErrors(nick)).toEqual([]);
  });

  it('recusa 17 caracteres e símbolos', async () => {
    expect(await nickErrors('a'.repeat(17))).not.toEqual([]);
    expect(await nickErrors('nick-com-hifen')).not.toEqual([]);
  });
});
