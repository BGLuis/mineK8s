import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { UpdateServerDto } from './update-server.dto';

const invalidFields = async (body: object) =>
  (await validate(plainToInstance(UpdateServerDto, body))).map((e) => e.property);

describe('UpdateServerDto', () => {
  it('aceita atualização parcial dentro dos limites da criação', async () => {
    expect(await invalidFields({ sleep_timeout_minutes: 1440, auto_wake: false, access_policy: 'PUBLIC' })).toEqual([]);
  });

  it('recusa timeout fora de 0 a 1440 minutos', async () => {
    expect(await invalidFields({ sleep_timeout_minutes: 1441 })).toEqual(['sleep_timeout_minutes']);
    expect(await invalidFields({ sleep_timeout_minutes: -1 })).toEqual(['sleep_timeout_minutes']);
  });

  it('não deixa INTERNET passar por aqui, pois publicar exige DNS e online-mode', async () => {
    expect(await invalidFields({ access_policy: 'INTERNET' })).toEqual(['access_policy']);
  });
});
